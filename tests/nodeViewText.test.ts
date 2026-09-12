import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('konva', () => {
  class FakeNode {
    attrs: Record<string, unknown>;
    children: FakeNode[] = [];
    constructor(config: Record<string, unknown> = {}) {
      this.attrs = { ...config };
    }
    add(c: FakeNode) {
      this.children.push(c);
      return this;
    }
    destroyChildren() {
      this.children = [];
    }
    destroy() {}
    setAttrs(a: Record<string, unknown>) {
      Object.assign(this.attrs, a);
    }
    x() {
      return (this.attrs.x as number) ?? 0;
    }
    y() {
      return (this.attrs.y as number) ?? 0;
    }
    opacity() {
      return (this.attrs.opacity as number) ?? 1;
    }
    visible(v?: boolean) {
      if (v === undefined) return (this.attrs.visible as boolean) ?? true;
      this.attrs.visible = v;
      return this;
    }
    getZIndex() {
      return 0;
    }
    setZIndex() {}
    getLayer() {
      return null;
    }
    getStage() {
      return { width: () => 800 };
    }
  }
  return { default: { Group: class extends FakeNode {}, Shape: class extends FakeNode {} } };
});

import { NodeView } from '../src/engine/NodeView';
import { TextRasterCache } from '../src/engine/textRaster';
import type { Palette } from '../src/engine/palette';
import { _setMeasureCtxForTests } from '../src/engine/textMeasure';
import type { CanvasNode } from '../src/core/types';

/** 记录调用的假 2D 上下文 */
function make2d(canvasWidth = 800) {
  const calls = { fillText: 0, drawImage: 0, fillRect: 0, reset: () => undefined as void };
  const ctx = {
    canvas: { width: canvasWidth, height: canvasWidth },
    font: '',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
    textAlign: 'left',
    textBaseline: 'alphabetic',
    save: () => undefined,
    restore: () => undefined,
    scale: () => undefined,
    fillText: () => {
      calls.fillText++;
    },
    drawImage: () => {
      calls.drawImage++;
    },
    fillRect: () => {
      calls.fillRect++;
    },
    beginPath: () => undefined,
    moveTo: () => undefined,
    lineTo: () => undefined,
    stroke: () => undefined,
    measureText: (t: string) => ({ width: t.length * 8, actualBoundingBoxAscent: 8 }),
    getImageData: (_x: number, _y: number, w: number, h: number) => ({
      data: new Uint8ClampedArray(w * h * 4),
    }),
  };
  calls.reset = () => {
    calls.fillText = 0;
    calls.drawImage = 0;
    calls.fillRect = 0;
  };
  return { ctx, calls };
}

type Rec = ReturnType<typeof make2d>;

/** 场景上下文（注入 sceneFunc 的那个）与「本次新建的所有画布上下文」 */
let scene: Rec;
let created: Rec[];

function stubDocument() {
  scene = make2d();
  created = [];
  // 每个 canvas 都发一个独立可记录的上下文：字体度量、文本位图都会走到这里，
  // 不靠调用次序区分，而是用「不是场景上下文」来认出位图画布。
  (globalThis as Record<string, unknown>).document = {
    createElement: () => {
      const rec = make2d();
      created.push(rec);
      return { width: 0, height: 0, getContext: () => rec.ctx };
    },
  };
}

/** 最近一次新建的、非场景的上下文 = 文本位图画布 */
function raster(): Rec {
  const r = created.filter((c) => c.ctx !== scene.ctx).pop();
  if (!r) throw new Error('本次没有创建位图画布');
  return r;
}

/** 构造期会顺带触发字体竖直度量（会画一次样字），断言前统一清零 */
function resetCounters() {
  scene.calls.reset();
  for (const c of created) c.calls.reset();
}

function testPalette(): Palette {
  return {
    canvasBg: '#ffffff',
    text: '#1f1f1f',
    textMuted: '#777777',
    accent: '#4c8dff',
    accentSoft: 'rgba(76,141,255,0.15)',
    nodeStroke: '#5a5a5a',
    edge: '#9a9a9a',
    guide: '#ff4d4f',
    danger: '#e05252',
    containerBorder: '#a0a0a0',
    selectionFill: 'rgba(76,141,255,0.08)',
    presets: ['#ff6b6b', '#ffa94d', '#ffd43b', '#51cf66', '#4c8dff', '#b197fc'],
  };
}

function textNode(over: Partial<CanvasNode> = {}): CanvasNode {
  return {
    id: 't1',
    type: 'text',
    x: 0,
    y: 0,
    width: 200,
    height: 60,
    text: '第一行\n第二行',
    fontSize: 20,
    fontFamily: 'system-ui, sans-serif',
    fontWeight: 400,
    color: '#000000',
    hAlign: 'left',
    ...over,
  } as CanvasNode;
}

/** 取节点视图里那个文本 Konva.Shape（group → inner → shape） */
function textShapeOf(view: NodeView): { attrs: { sceneFunc: (ctx: unknown) => void } } {
  const g = view.group as unknown as { children: { children: unknown[] }[] };
  return g.children[0].children[0] as { attrs: { sceneFunc: (ctx: unknown) => void } };
}

function drawFrame(view: NodeView) {
  const shape = textShapeOf(view);
  shape.attrs.sceneFunc({ _context: scene.ctx });
}

const noImages = { get: () => null, has: () => false, isBroken: () => false, clear: () => undefined } as never;

function makeView(cache: TextRasterCache | null, over: Partial<CanvasNode> = {}): NodeView {
  const view = new NodeView(textNode(over), testPalette(), noImages, null, cache);
  resetCounters();
  return view;
}

describe('文本节点渲染：位图缓存与矢量回退', () => {
  beforeEach(() => {
    stubDocument();
    _setMeasureCtxForTests({ font: '', measureText: (t: string) => ({ width: t.length * 8 }) });
  });
  afterEach(() => {
    _setMeasureCtxForTests(null);
    delete (globalThis as Record<string, unknown>).document;
  });

  it('低缩放：首帧光栅化一次，之后每帧只 drawImage，不再 fillText', () => {
    const view = makeView(new TextRasterCache());
    view.setScale(0.5); // 屏幕字号 10px：需要位图

    drawFrame(view);
    expect(raster().calls.fillText).toBe(2); // 位图里画了两行
    expect(scene.calls.fillText).toBe(0);
    expect(scene.calls.drawImage).toBe(1);

    // 之后连画 60 帧：不再有任何光栅化，每帧仍只有一次 drawImage
    for (let i = 0; i < 60; i++) drawFrame(view);
    expect(raster().calls.fillText).toBe(2);
    expect(scene.calls.drawImage).toBe(61);
    expect(scene.calls.fillText).toBe(0);
  });

  it('缩放跨档时重画一次位图，同档内不重画', () => {
    const view = makeView(new TextRasterCache());
    view.setScale(0.5); // 档位 0.667
    drawFrame(view);
    expect(raster().calls.fillText).toBe(2);

    // 放大到 0.9：缓存档位已不够用（会糊）→ 升档重画一次
    view.setScale(0.9);
    drawFrame(view);
    expect(raster().calls.fillText).toBe(4);

    // 之后在 0.9 附近小幅摆动：同档，不重画
    view.setScale(0.85);
    drawFrame(view);
    view.setScale(0.95);
    drawFrame(view);
    expect(raster().calls.fillText).toBe(4);
  });

  it('档位边界附近来回缩放不重画（滞回窗口有效）', () => {
    const cache = new TextRasterCache();
    const view = makeView(cache);
    // 0.45 → 理想档位 0.667
    view.setScale(0.45);
    drawFrame(view);
    expect(raster().calls.fillText).toBe(2);
    expect(cache.stats.count).toBe(1);

    // 0.44 恰好跨过 0.444 这个档位边界：缩小方向应继续复用更大的旧位图
    for (let i = 0; i < 10; i++) {
      view.setScale(0.45);
      drawFrame(view);
      view.setScale(0.44);
      drawFrame(view);
    }
    expect(raster().calls.fillText).toBe(2); // 全程零重画
  });

  it('单节点位图超上限时自动退回矢量绘制', () => {
    const cache = new TextRasterCache();
    // 2000×1000 世界单位、缩放 2 → 位图约 1000 万像素，超过单节点上限
    const view = makeView(cache, { width: 2000, height: 1000 });
    view.setScale(2);
    drawFrame(view);
    expect(scene.calls.drawImage).toBe(0);
    expect(scene.calls.fillText).toBe(2);
    expect(cache.stats.count).toBe(0);
  });

  it('总预算耗尽时新节点不缓存，退回矢量绘制（而不是每帧重画）', () => {
    // 预算只够一个节点（200×60 @ 档位 0.667 ≈ 5.4k 像素），第二个节点直接走矢量
    const cache = new TextRasterCache(8_000);
    const a = makeView(cache);
    a.setScale(0.5);
    drawFrame(a);
    expect(cache.stats.count).toBe(1);

    const b = makeView(cache, { id: 't2' });
    b.setScale(0.5);
    drawFrame(b);
    drawFrame(b);
    expect(scene.calls.fillText).toBe(4); // 两帧各画两行，没有缓存也没有抖动
    expect(cache.stats.count).toBe(1);
  });

  it('未注入缓存时走矢量绘制（测试台/降级路径）', () => {
    const view = makeView(null);
    view.setScale(0.5);
    drawFrame(view);
    expect(scene.calls.drawImage).toBe(0);
    expect(scene.calls.fillText).toBe(2);
  });

  it('屏幕字号低于 LOD 阈值时画占位块，既不 fillText 也不 drawImage', () => {
    const cache = new TextRasterCache();
    const view = makeView(cache);
    view.setScale(0.1); // 20px × 0.1 = 2px < 4.5px
    drawFrame(view);
    expect(scene.calls.fillRect).toBe(1);
    expect(scene.calls.fillText).toBe(0);
    expect(scene.calls.drawImage).toBe(0);
    expect(cache.stats.count).toBe(0);
  });

  it('文本内容变化后重画位图（修订号参与缓存键）', () => {
    const cache = new TextRasterCache();
    const view = makeView(cache);
    view.setScale(0.5);
    drawFrame(view);
    expect(raster().calls.fillText).toBe(2);

    view.update(textNode({ text: '改过了' }));
    drawFrame(view);
    expect(raster().calls.fillText).toBe(3); // 单行重画一次
    expect(cache.stats.count).toBe(1);
  });
});
