/** 交互流冒烟测试：Overlay 手柄命中 + SelectTool 端点拖拽重链（mock engine，验逻辑不验像素） */
import { describe, expect, it, vi } from 'vitest';

vi.mock('konva', () => ({
  default: {
    Group: class {
      children: unknown[] = [];
      visible() {
        return true;
      }
      add(c: unknown) {
        this.children.push(c);
        return this;
      }
      destroyChildren() {
        this.children = [];
      }
    },
    Rect: class {
      constructor(public attrs: Record<string, unknown>) {}
    },
    Circle: class {
      constructor(public attrs: Record<string, unknown>) {}
    },
    Line: class {
      constructor(public attrs: Record<string, unknown>) {}
    },
    Ellipse: class {
      constructor(public attrs: Record<string, unknown>) {}
    },
    Label: class {
      constructor(public attrs: Record<string, unknown>) {}
      add() {
        return this;
      }
      position() {}
      visible() {
        return true;
      }
      getChildren() {
        return [];
      }
      offsetX() {
        return 0;
      }
      offsetY() {
        return 0;
      }
      width() {
        return 0;
      }
      height() {
        return 0;
      }
    },
    Tag: class {
      constructor(public attrs: Record<string, unknown>) {}
    },
    Text: class {
      constructor(public attrs: Record<string, unknown>) {}
    },
  },
}));

import { Overlay, type OverlayState } from '../src/engine/Overlay';
import { SelectTool } from '../src/tools/SelectTool';
import { ShapeTool } from '../src/tools/ShapeTool';
import { Document } from '../src/core/Document';
import { syncBoundArrow } from '../src/core/arrowLink';
import type { Palette } from '../src/engine/palette';
import type { Engine } from '../src/engine/Engine';
import { mergeSettings } from '../src/core/defaults';

const palette = {
  accent: '#000',
  selectionFill: 'rgba(0,0,0,0.1)',
  guide: '#f00',
  text: '#000',
  textMuted: '#888',
  canvasBg: '#fff',
  edge: '#888',
} as Palette;

/** 最小 Konva Layer 替身 */
const layer = {
  add() {},
  batchDraw() {},
} as never;

function makeOverlay(): Overlay {
  return new Overlay(layer, palette);
}

/** 画一个带端点手柄的 overlay 状态（line-like 单选的 endpoints + 连线 edgeEndpoints） */
function drawHandles(ov: Overlay, st: Partial<OverlayState>): void {
  ov.draw(
    {
      selection: [],
      handles: null,
      endpoints: null,
      edgeEndpoints: null,
      marquee: null,
      guides: [],
      eraserCursor: null,
      erasePreview: [],
      focus: null,
      containerHover: null,
      draft: null,
      lineDraft: null,
      edgeDraft: null,
      ports: [],
      edgeSelect: null,
      ...st,
    } as OverlayState,
    { x: 0, y: 0, scale: 1 },
    800,
    600,
  );
}

describe('Overlay 端点手柄命中', () => {
  it('线类端点 pt 手柄：绘制后可被 handleAt 命中', () => {
    const ov = makeOverlay();
    drawHandles(ov, {
      endpoints: [
        { x: 100, y: 100 },
        { x: 200, y: 100 },
      ],
    });
    expect(ov.handleAt(100, 100)?.id).toBe('pt0');
    expect(ov.handleAt(200, 100)?.id).toBe('pt1');
    expect(ov.handleAt(300, 100)).toBeNull();
  });

  it('连线端点 edge-* 手柄：绘制后可被 handleAt 命中并区分 from/to', () => {
    const ov = makeOverlay();
    drawHandles(ov, {
      edgeEndpoints: [
        { id: 'edge-from', pos: { x: 50, y: 30 } },
        { id: 'edge-to', pos: { x: 300, y: 30 } },
      ],
    });
    expect(ov.handleAt(50, 30)?.id).toBe('edge-from');
    expect(ov.handleAt(300, 30)?.id).toBe('edge-to');
    expect(ov.handleAt(150, 30)).toBeNull();
  });

  it('旋转手柄：绘制后可被 handleAt 命中（顶部中点上方 22px），线杆本身不可点', () => {
    const ov = makeOverlay();
    drawHandles(ov, {
      rotation: { angle: 0, rect: { x: 0, y: 0, width: 100, height: 60 }, center: { x: 50, y: 30 }, top: { x: 50, y: 0 } },
    });
    expect(ov.handleAt(50, -22)?.id).toBe('rotate');
    expect(ov.handleAt(50, 0)).toBeNull(); // 只在圆形手柄上有命中区，连接线不算
    expect(ov.handleAt(150, 30)).toBeNull();
  });
});

/** SelectTool 运行时替身：只实现 drag 流用到的字段 */
function mockCtx(doc: Document, handleHit: { id: string } | null, pickNodeId: string | null) {
  const ports: { x: number; y: number }[] = [];
  const engine = {
    vp: { x: 0, y: 0, scale: 1 },
    overlay: { handleAt: () => handleHit },
    overlayState: { ports },
    isNodeHidden: () => false,
    worldToScreen: (wx: number, wy: number) => ({ x: wx, y: wy }), // scale 1：屏幕 = 世界
    pick: () => (pickNodeId ? ({ kind: 'node', nodeId: pickNodeId } as const) : ({ kind: 'canvas' } as const)),
    applyOverlay: () => {},
  } as unknown as Engine;
  void ports;
  return {
    engine,
    doc,
    history: { push: () => {} },
    settings: mergeSettings(),
    clipboard: {},
  };
}

const textNode = (id: string, x: number, y: number) =>
  Document.newNode({ id, type: 'text', x, y, width: 100, height: 60, text: id });

describe('SelectTool 端点拖拽重链', () => {
  it('箭头端点松手靠近元素 → 绑定 toNode（四向磁吸）', () => {
    const doc = new Document();
    const a = textNode('a', 0, 0);
    const b = textNode('b', 300, 400); // 目标：位于箭头终点(300,100) 下方
    const arrow = Document.newNode({
      id: 'arr',
      type: 'trefoil/shape',
      shape: 'arrow',
      x: 200,
      y: 100,
      width: 100,
      height: 1,
      points: [
        [0, 0],
        [100, 0],
      ],
      strokeSize: 2,
    });
    doc.addNodes([a, b, arrow]);
    doc.setSelection(['arr']);
    const tool = new SelectTool();
    const ctx = mockCtx(doc, { id: 'pt1' }, 'b');
    tool.ctx = ctx as never;

    // pointerdown 在 pt1 手柄上
    tool.onPointerDown({
      sx: 300,
      sy: 100,
      wx: 300,
      wy: 100,
      button: 0,
      shift: false,
      ctrl: false,
      alt: false,
      pick: { kind: 'canvas' },
      raw: {} as PointerEvent,
    });
    // 拖到 b 的上缘锚点附近 (350, 400)：距离 0 → 磁吸
    tool.onPointerMove({
      sx: 350,
      sy: 400,
      wx: 350,
      wy: 400,
      button: 0,
      shift: false,
      ctrl: false,
      alt: false,
      pick: { kind: 'node', nodeId: 'b' },
      raw: {} as PointerEvent,
    });
    tool.onPointerUp({
      sx: 350,
      sy: 400,
      wx: 350,
      wy: 400,
      button: 0,
      shift: false,
      ctrl: false,
      alt: false,
      pick: { kind: 'canvas' },
      raw: {} as PointerEvent,
    });
    expect(arrow.toNode).toBe('b');
  });

  it('箭头端点松手在空白 → 保持自由端（不绑定）', () => {
    const doc = new Document();
    const a = textNode('a', 0, 0);
    const arrow = Document.newNode({
      id: 'arr',
      type: 'trefoil/shape',
      shape: 'arrow',
      x: 200,
      y: 100,
      width: 100,
      height: 1,
      points: [
        [0, 0],
        [100, 0],
      ],
      strokeSize: 2,
    });
    doc.addNodes([a, arrow]);
    doc.setSelection(['arr']);
    const tool = new SelectTool();
    tool.ctx = mockCtx(doc, { id: 'pt1' }, null) as never;
    tool.onPointerDown({
      sx: 300,
      sy: 100,
      wx: 300,
      wy: 100,
      button: 0,
      shift: false,
      ctrl: false,
      alt: false,
      pick: { kind: 'canvas' },
      raw: {} as PointerEvent,
    });
    tool.onPointerMove({
      sx: 600,
      sy: 500,
      wx: 600,
      wy: 500,
      button: 0,
      shift: false,
      ctrl: false,
      alt: false,
      pick: { kind: 'canvas' },
      raw: {} as PointerEvent,
    });
    tool.onPointerUp({
      sx: 600,
      sy: 500,
      wx: 600,
      wy: 500,
      button: 0,
      shift: false,
      ctrl: false,
      alt: false,
      pick: { kind: 'canvas' },
      raw: {} as PointerEvent,
    });
    expect(arrow.toNode).toBeUndefined();
    expect(arrow.points![1]).toEqual([400, 400]);
  });

  it('连线端点拖拽到其它元素 → fromNode 重绑；再拖空白 → 保持本次拖拽前状态', () => {
    const doc = new Document();
    const a = textNode('a', 0, 0);
    const b = textNode('b', 300, 0);
    const c = textNode('c', 300, 400);
    doc.addNodes([a, b, c]);
    const edge = Document.newEdge({ id: 'e1', fromNode: 'a', toNode: 'b', fromSide: 'right', toSide: 'left' });
    doc.edges.push(edge);
    doc.reindex();
    doc.setSelection(['e1']);
    const tool = new SelectTool();
    tool.ctx = mockCtx(doc, { id: 'edge-from' }, null) as never;

    // 拖 from 端（a 的右缘 (100,30)）到 c 的上缘 (350,400)
    tool.onPointerDown({
      sx: 100,
      sy: 30,
      wx: 100,
      wy: 30,
      button: 0,
      shift: false,
      ctrl: false,
      alt: false,
      pick: { kind: 'canvas' },
      raw: {} as PointerEvent,
    });
    tool.onPointerMove({
      sx: 350,
      sy: 400,
      wx: 350,
      wy: 400,
      button: 0,
      shift: false,
      ctrl: false,
      alt: false,
      pick: { kind: 'node', nodeId: 'c' },
      raw: {} as PointerEvent,
    });
    // 拖拽中实时跟随
    expect(edge.fromNode).toBe('c');
    tool.onPointerUp({
      sx: 350,
      sy: 400,
      wx: 350,
      wy: 400,
      button: 0,
      shift: false,
      ctrl: false,
      alt: false,
      pick: { kind: 'canvas' },
      raw: {} as PointerEvent,
    });
    expect(edge.fromNode).toBe('c');

    // 再拖到空白 → 恢复本次拖拽前的绑定（上一次重链 c→b 是已提交的编辑，保持不变）
    tool.onPointerDown({
      sx: 350,
      sy: 400,
      wx: 350,
      wy: 400,
      button: 0,
      shift: false,
      ctrl: false,
      alt: false,
      pick: { kind: 'canvas' },
      raw: {} as PointerEvent,
    });
    tool.onPointerMove({
      sx: 700,
      sy: 600,
      wx: 700,
      wy: 600,
      button: 0,
      shift: false,
      ctrl: false,
      alt: false,
      pick: { kind: 'canvas' },
      raw: {} as PointerEvent,
    });
    tool.onPointerUp({
      sx: 700,
      sy: 600,
      wx: 700,
      wy: 600,
      button: 0,
      shift: false,
      ctrl: false,
      alt: false,
      pick: { kind: 'canvas' },
      raw: {} as PointerEvent,
    });
    expect(edge.fromNode).toBe('c');
  });

  it('连线端点拖拽悬停目标内移动：绑定不抖动（排除集恒定）', () => {
    const doc = new Document();
    const a = textNode('a', 0, 0);
    const b = textNode('b', 300, 0);
    const c = textNode('c', 300, 400);
    doc.addNodes([a, b, c]);
    const edge = Document.newEdge({ id: 'e1', fromNode: 'a', toNode: 'b', fromSide: 'right', toSide: 'left' });
    doc.edges.push(edge);
    doc.reindex();
    doc.setSelection(['e1']);
    const tool = new SelectTool();
    tool.ctx = mockCtx(doc, { id: 'edge-from' }, null) as never;
    // 从 a 右缘拖到 c 上缘 (350,400)，再在 c 内移动（到右缘 (400,430) 附近）
    tool.onPointerDown({
      sx: 100, sy: 30, wx: 100, wy: 30, button: 0,
      shift: false, ctrl: false, alt: false, pick: { kind: 'canvas' }, raw: {} as PointerEvent,
    });
    tool.onPointerMove({
      sx: 350, sy: 400, wx: 350, wy: 400, button: 0,
      shift: false, ctrl: false, alt: false, pick: { kind: 'canvas' }, raw: {} as PointerEvent,
    });
    expect(edge.fromNode).toBe('c');
    // 仍在 c 磁吸半径内移动：排除集来自拖拽前绑定（a），不应把 c 排除 → 绑定保持
    tool.onPointerMove({
      sx: 400, sy: 430, wx: 400, wy: 430, button: 0,
      shift: false, ctrl: false, alt: false, pick: { kind: 'canvas' }, raw: {} as PointerEvent,
    });
    expect(edge.fromNode).toBe('c');
    tool.onPointerUp({
      sx: 400, sy: 430, wx: 400, wy: 430, button: 0,
      shift: false, ctrl: false, alt: false, pick: { kind: 'canvas' }, raw: {} as PointerEvent,
    });
    expect(edge.fromNode).toBe('c');
  });

  it('拖动绑定箭头本体：冻结绑定并可移动，撤销还原磁吸关系', () => {
    const doc = new Document();
    const a = textNode('a', 0, 0);
    const b = textNode('b', 300, 0);
    doc.addNodes([a, b]);
    const arrow = Document.newNode({
      id: 'arr',
      type: 'trefoil/shape',
      shape: 'arrow',
      x: 100,
      y: 30,
      width: 200,
      height: 1,
      points: [
        [0, 0],
        [200, 0],
      ],
      fromNode: 'a',
      toNode: 'b',
      strokeSize: 2,
    });
    doc.addNodes([arrow]);
    doc.setSelection(['arr']);
    const cmds: unknown[] = [];
    doc.history = { push: (c: unknown) => cmds.push(c) };
    const ctx = mockCtx(doc, null, 'arr');
    const tool = new SelectTool();
    tool.ctx = ctx as never;

    tool.onPointerDown({
      sx: 100, sy: 30, wx: 100, wy: 30, button: 0,
      shift: false, ctrl: false, alt: false, pick: { kind: 'node', nodeId: 'arr' }, raw: {} as PointerEvent,
    });
    tool.onPointerMove({
      sx: 150, sy: 60, wx: 150, wy: 60, button: 0,
      shift: false, ctrl: false, alt: false, pick: { kind: 'canvas' }, raw: {} as PointerEvent,
    });
    // 本体拖动：绑定被冻结（不再被吸回元素），位置随拖动移动
    expect(arrow.fromNode).toBeUndefined();
    expect(arrow.toNode).toBeUndefined();
    expect(arrow.x).toBe(150);
    expect(arrow.y).toBe(60);
    tool.onPointerUp({
      sx: 150, sy: 60, wx: 150, wy: 60, button: 0,
      shift: false, ctrl: false, alt: false, pick: { kind: 'canvas' }, raw: {} as PointerEvent,
    });
    // 撤销 → 还原位置与磁吸绑定
    const moveCmd = cmds.find((c) => (c as { label?: string }).label === '移动') as { undo(): void } | undefined;
    expect(moveCmd).toBeDefined();
    moveCmd!.undo();
    expect(arrow.x).toBe(100);
    expect(arrow.y).toBe(30);
    expect(arrow.fromNode).toBe('a');
    expect(arrow.toNode).toBe('b');
  });

  it('多选元素整体拖动：连线保持绑定并跟随元素（不脱钩成独立箭头）', () => {
    const doc = new Document();
    const a = textNode('a', 0, 0);
    const b = textNode('b', 0, 400);
    doc.addNodes([a, b]);
    const arrow = Document.newNode({
      id: 'arr',
      type: 'trefoil/shape',
      shape: 'arrow',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      points: [
        [0, 0],
        [100, 100],
      ],
      fromNode: 'a',
      toNode: 'b',
      strokeSize: 2,
    });
    doc.addNodes([arrow]);
    doc.setSelection(['a', 'b', 'arr']);
    const tool = new SelectTool();
    tool.ctx = mockCtx(doc, null, 'a') as never;

    tool.onPointerDown({
      sx: 0, sy: 0, wx: 0, wy: 0, button: 0,
      shift: false, ctrl: false, alt: false, pick: { kind: 'node', nodeId: 'a' }, raw: {} as PointerEvent,
    });
    tool.onPointerMove({
      sx: 60, sy: 40, wx: 60, wy: 40, button: 0,
      shift: false, ctrl: false, alt: false, pick: { kind: 'canvas' }, raw: {} as PointerEvent,
    });
    // 元素按位移移动
    expect(a.x).toBe(60);
    expect(a.y).toBe(40);
    expect(b.y).toBe(440);
    // 连线仍绑定在两端元素上（旧实现此处被冻结 → 变回独立箭头）
    expect(arrow.fromNode).toBe('a');
    expect(arrow.toNode).toBe('b');
    // 渲染一帧：箭头按新锚点重排（跟随元素，而不是留在原地）
    syncBoundArrow(arrow, (id) => doc.getNode(id));
    expect(arrow.x).toBe(110); // a 下缘中点 x = 60 + 50
    expect(arrow.y).toBe(100); // a 下缘 y = 40 + 60
    expect(arrow.height).toBe(340); // 到 b 上缘 440
    tool.onPointerUp({
      sx: 60, sy: 40, wx: 60, wy: 40, button: 0,
      shift: false, ctrl: false, alt: false, pick: { kind: 'canvas' }, raw: {} as PointerEvent,
    });
    expect(arrow.fromNode).toBe('a');
    expect(arrow.toNode).toBe('b');
  });

  it('单选箭头本体拖动：仍然冻结绑定（保持原有「拖动即脱离」语义）', () => {
    const doc = new Document();
    const a = textNode('a', 0, 0);
    const b = textNode('b', 0, 400);
    doc.addNodes([a, b]);
    const arrow = Document.newNode({
      id: 'arr',
      type: 'trefoil/shape',
      shape: 'arrow',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      points: [
        [0, 0],
        [100, 100],
      ],
      fromNode: 'a',
      toNode: 'b',
      strokeSize: 2,
    });
    doc.addNodes([arrow]);
    doc.setSelection(['arr']);
    const tool = new SelectTool();
    tool.ctx = mockCtx(doc, null, 'arr') as never;
    tool.onPointerDown({
      sx: 0, sy: 0, wx: 0, wy: 0, button: 0,
      shift: false, ctrl: false, alt: false, pick: { kind: 'node', nodeId: 'arr' }, raw: {} as PointerEvent,
    });
    tool.onPointerMove({
      sx: 40, sy: 20, wx: 40, wy: 20, button: 0,
      shift: false, ctrl: false, alt: false, pick: { kind: 'canvas' }, raw: {} as PointerEvent,
    });
    expect(arrow.fromNode).toBeUndefined();
    expect(arrow.toNode).toBeUndefined();
  });

  it('框选：只与箭头包围盒相交（未触到线段）时不选中', () => {
    const doc = new Document();
    const arrow = Document.newNode({
      id: 'arr',
      type: 'trefoil/shape',
      shape: 'arrow',
      x: 0,
      y: 0,
      width: 200,
      height: 200,
      points: [
        [0, 0],
        [200, 200],
      ],
      strokeSize: 2,
    });
    doc.addNodes([arrow]);
    const tool = new SelectTool();
    tool.ctx = mockCtx(doc, null, null) as never;
    const ev = (wx: number, wy: number) => ({
      sx: wx, sy: wy, wx, wy, button: 0,
      shift: false, ctrl: false, alt: false, pick: { kind: 'canvas' } as const, raw: {} as PointerEvent,
    });

    // 框选右上角空白三角（在箭头包围盒内，但线不经过）
    tool.onPointerDown(ev(124, 4));
    tool.onPointerMove(ev(196, 76));
    tool.onPointerUp(ev(196, 76));
    expect(doc.selection.has('arr')).toBe(false);

    // 框住对角线本体（55,55 落在线上）→ 选中
    tool.onPointerDown(ev(40, 40));
    tool.onPointerMove(ev(80, 80));
    tool.onPointerUp(ev(80, 80));
    expect(doc.selection.has('arr')).toBe(true);
  });

  it('双击旋转手柄 → 旋转归零并可撤销', () => {
    const doc = new Document();
    const card = textNode('card', 0, 0);
    card.rotation = 30;
    doc.addNodes([card]);
    doc.setSelection(['card']);
    const cmds: unknown[] = [];
    doc.history = { push: (c: unknown) => cmds.push(c) };
    const tool = new SelectTool();
    tool.ctx = mockCtx(doc, { id: 'rotate' }, 'card') as never;

    tool.onDoubleClick({
      sx: 100, sy: -20, wx: 100, wy: -20, button: 0,
      shift: false, ctrl: false, alt: false, pick: { kind: 'canvas' }, raw: {} as PointerEvent,
    });
    expect(card.rotation).toBe(0);
    const cmd = cmds[cmds.length - 1] as { undo(): void; redo(): void };
    // undo 走 applySnapshot：会替换节点对象，必须经 doc 取最新引用
    cmd.undo();
    expect(doc.getNode('card')!.rotation).toBe(30);
    cmd.redo();
    expect(doc.getNode('card')!.rotation).toBe(0);
  });

  it('双击旋转手柄但角度已是 0 → 不产生撤销记录', () => {
    const doc = new Document();
    const card = textNode('card', 0, 0);
    doc.addNodes([card]);
    doc.setSelection(['card']);
    const cmds: unknown[] = [];
    doc.history = { push: (c: unknown) => cmds.push(c) };
    const tool = new SelectTool();
    tool.ctx = mockCtx(doc, { id: 'rotate' }, 'card') as never;
    tool.onDoubleClick({
      sx: 100, sy: -20, wx: 100, wy: -20, button: 0,
      shift: false, ctrl: false, alt: false, pick: { kind: 'canvas' }, raw: {} as PointerEvent,
    });
    expect(card.rotation ?? 0).toBe(0);
    expect(cmds).toHaveLength(0);
  });

  it('端点拖拽磁吸提示：贴近元素显示四向端口 + 高亮吸附锚点，远离清空', () => {
    const doc = new Document();
    const a = textNode('a', 0, 0);
    const b = textNode('b', 300, 400);
    const arrow = Document.newNode({
      id: 'arr',
      type: 'trefoil/shape',
      shape: 'arrow',
      x: 200,
      y: 100,
      width: 100,
      height: 1,
      points: [
        [0, 0],
        [100, 0],
      ],
      strokeSize: 2,
    });
    doc.addNodes([a, b, arrow]);
    doc.setSelection(['arr']);
    const ctx = mockCtx(doc, { id: 'pt1' }, 'b');
    const tool = new SelectTool();
    tool.ctx = ctx as never;
    tool.onPointerDown({
      sx: 300, sy: 100, wx: 300, wy: 100, button: 0,
      shift: false, ctrl: false, alt: false, pick: { kind: 'canvas' }, raw: {} as PointerEvent,
    });
    const st = (ctx.engine as unknown as { overlayState: { ports: { x: number; y: number }[]; magnet: { x: number; y: number } | null } }).overlayState;
    // 贴近 b 上缘锚点 (350,400)
    tool.onPointerMove({
      sx: 350, sy: 400, wx: 350, wy: 400, button: 0,
      shift: false, ctrl: false, alt: false, pick: { kind: 'canvas' }, raw: {} as PointerEvent,
    });
    expect(st.magnet).toEqual({ x: 350, y: 400 });
    expect(st.ports).toHaveLength(4);
    // 远离 → 提示清空
    tool.onPointerMove({
      sx: 800, sy: 700, wx: 800, wy: 700, button: 0,
      shift: false, ctrl: false, alt: false, pick: { kind: 'canvas' }, raw: {} as PointerEvent,
    });
    expect(st.magnet).toBeNull();
    expect(st.ports).toHaveLength(0);
  });

  it('绘制箭头磁吸提示：线稿贴近元素边缘即提示（不要求指针进入元素内）', () => {
    const doc = new Document();
    const a = textNode('a', 300, 0);
    doc.addNodes([a]);
    const ctx = mockCtx(doc, null, null);
    const tool = new ShapeTool('arrow', 'arrow');
    tool.ctx = ctx as never;
    const st = (ctx.engine as unknown as { overlayState: { ports: { x: number; y: number }[]; magnet: { x: number; y: number } | null } }).overlayState;
    tool.onPointerDown({
      sx: 100, sy: 100, wx: 100, wy: 100, button: 0,
      shift: false, ctrl: false, alt: false, pick: { kind: 'canvas' }, raw: {} as PointerEvent,
    });
    // 指针在 a 的右缘锚点 (400,30) 附近 10px —— 还未进入元素内部，也应提示
    tool.onPointerMove({
      sx: 390, sy: 30, wx: 390, wy: 30, button: 0,
      shift: false, ctrl: false, alt: false, pick: { kind: 'canvas' }, raw: { buttons: 1 } as PointerEvent,
    });
    expect(st.magnet).toEqual({ x: 400, y: 30 });
    expect(st.ports).toHaveLength(4);
  });
});

describe('SelectTool 旋转手柄', () => {
  it('拖拽绕中心旋转：极角增量 → rotation，Shift 吸附 15°，松手落撤销记录', () => {
    const doc = new Document();
    const rect = Document.newNode({ id: 'rc', type: 'trefoil/shape', shape: 'rect', x: 0, y: 0, width: 100, height: 60 });
    doc.addNodes([rect]);
    doc.setSelection(['rc']);
    const cmds: unknown[] = [];
    doc.history = { push: (c: unknown) => cmds.push(c) };
    const tool = new SelectTool();
    tool.ctx = mockCtx(doc, { id: 'rotate' }, null) as never;

    // 按下在旋转手柄（顶部中点 (50,0) 上方 22px）：中心 (50,30)，指针极角 = -90°
    tool.onPointerDown({
      sx: 50, sy: -22, wx: 50, wy: -22, button: 0,
      shift: false, ctrl: false, alt: false, pick: { kind: 'canvas' }, raw: {} as PointerEvent,
    });
    // 拖到中心正右方 (80,30)：极角 0° → 旋转 +90°，中心/位置不变
    tool.onPointerMove({
      sx: 80, sy: 30, wx: 80, wy: 30, button: 0,
      shift: false, ctrl: false, alt: false, pick: { kind: 'canvas' }, raw: {} as PointerEvent,
    });
    expect(rect.rotation).toBeCloseTo(90, 5);
    expect(rect.x).toBe(0);
    expect(rect.y).toBe(0);
    tool.onPointerUp({
      sx: 80, sy: 30, wx: 80, wy: 30, button: 0,
      shift: false, ctrl: false, alt: false, pick: { kind: 'canvas' }, raw: {} as PointerEvent,
    });

    // 第二次拖拽（Shift 吸附 15°）：从 90° 拖到中心正左方 → 90+180=270 → 归一化 -90
    tool.onPointerDown({
      sx: 80, sy: 30, wx: 80, wy: 30, button: 0,
      shift: true, ctrl: false, alt: false, pick: { kind: 'canvas' }, raw: {} as PointerEvent,
    });
    tool.onPointerMove({
      sx: 30, sy: 30, wx: 30, wy: 30, button: 0,
      shift: true, ctrl: false, alt: false, pick: { kind: 'canvas' }, raw: {} as PointerEvent,
    });
    expect(rect.rotation).toBe(-90);
    tool.onPointerUp({
      sx: 30, sy: 30, wx: 30, wy: 30, button: 0,
      shift: true, ctrl: false, alt: false, pick: { kind: 'canvas' }, raw: {} as PointerEvent,
    });

    const rotateCmds = cmds.filter((c) => (c as { label?: string }).label === '旋转');
    expect(rotateCmds).toHaveLength(2);
    const last = rotateCmds[1] as { undo(): void; redo(): void };
    last.undo();
    expect(rect.rotation ?? 0).toBe(90); // 撤销第二次拖拽：回到 90°
    last.redo();
    expect(rect.rotation).toBe(-90);
  });

  it('点按即松（未拖动）：不改变 rotation，也不产生撤销记录', () => {
    const doc = new Document();
    const rect = Document.newNode({ id: 'rc', type: 'trefoil/shape', shape: 'rect', x: 0, y: 0, width: 100, height: 60 });
    doc.addNodes([rect]);
    doc.setSelection(['rc']);
    const cmds: unknown[] = [];
    doc.history = { push: (c: unknown) => cmds.push(c) };
    const tool = new SelectTool();
    tool.ctx = mockCtx(doc, { id: 'rotate' }, null) as never;

    tool.onPointerDown({
      sx: 50, sy: -22, wx: 50, wy: -22, button: 0,
      shift: false, ctrl: false, alt: false, pick: { kind: 'canvas' }, raw: {} as PointerEvent,
    });
    tool.onPointerUp({
      sx: 51, sy: -21, wx: 51, wy: -21, button: 0,
      shift: false, ctrl: false, alt: false, pick: { kind: 'canvas' }, raw: {} as PointerEvent,
    });
    expect(rect.rotation).toBeUndefined();
    expect(cmds.filter((c) => (c as { label?: string }).label === '旋转')).toHaveLength(0);
  });

  it('线类 / 容器不支持旋转：旋转手柄命中不建会话', () => {
    const doc = new Document();
    const arrow = Document.newNode({
      id: 'arr',
      type: 'trefoil/shape',
      shape: 'arrow',
      x: 0, y: 0, width: 100, height: 1,
      points: [[0, 0], [100, 0]],
      strokeSize: 2,
    });
    doc.addNodes([arrow]);
    doc.setSelection(['arr']);
    const tool = new SelectTool();
    tool.ctx = mockCtx(doc, { id: 'rotate' }, null) as never;
    // handleAt 返回 rotate，但节点是线类 → 不应进入旋转会话（进入后会被 canRotate 拦住）
    tool.onPointerDown({
      sx: 50, sy: -22, wx: 50, wy: -22, button: 0,
      shift: false, ctrl: false, alt: false, pick: { kind: 'canvas' }, raw: {} as PointerEvent,
    });
    tool.onPointerMove({
      sx: 80, sy: 30, wx: 80, wy: 30, button: 0,
      shift: false, ctrl: false, alt: false, pick: { kind: 'canvas' }, raw: {} as PointerEvent,
    });
    expect(arrow.rotation).toBeUndefined();
  });
});
describe('容器选择与整体移动', () => {
  const bandDown = (tool: SelectTool, cid: string, shift = false) => {
    tool.onPointerDown({
      sx: 5, sy: 5, wx: 5, wy: 5, button: 0,
      shift, ctrl: false, alt: false,
      pick: { kind: 'container-band', containerId: cid } as never,
      raw: {} as PointerEvent,
    });
  };

  it('单击容器边带 → 只选中内容（不含容器框本身）', () => {
    const doc = new Document();
    const c = Document.newNode({ id: 'c', type: 'trefoil/container', x: 0, y: 0, width: 400, height: 300, text: '容器' });
    const ch1 = textNode('ch1', 10, 10);
    const ch2 = textNode('ch2', 60, 10);
    ch1.containerId = 'c';
    ch2.containerId = 'c';
    doc.addNodes([c, ch1, ch2]);
    const tool = new SelectTool();
    tool.ctx = mockCtx(doc, null, null) as never;
    bandDown(tool, 'c');
    expect([...doc.selection].sort()).toEqual(['ch1', 'ch2']);
  });

  it('Shift 单击容器边带 → 内容并入当前选择', () => {
    const doc = new Document();
    const c = Document.newNode({ id: 'c', type: 'trefoil/container', x: 0, y: 0, width: 400, height: 300, text: '容器' });
    const out = textNode('out', 500, 500);
    const ch1 = textNode('ch1', 10, 10);
    ch1.containerId = 'c';
    doc.addNodes([c, out, ch1]);
    const tool = new SelectTool();
    tool.ctx = mockCtx(doc, null, null) as never;
    doc.setSelection(['out']);
    bandDown(tool, 'c', true);
    expect([...doc.selection].sort()).toEqual(['ch1', 'out']);
  });

  it('空容器没有内容 → 选中容器本身（否则永远点不中）', () => {
    const doc = new Document();
    const c = Document.newNode({ id: 'c', type: 'trefoil/container', x: 0, y: 0, width: 400, height: 300, text: '空容器' });
    doc.addNodes([c]);
    const tool = new SelectTool();
    tool.ctx = mockCtx(doc, null, null) as never;
    bandDown(tool, 'c');
    expect([...doc.selection]).toEqual(['c']);
  });

  it('拖容器边带 → 内容与容器框整体移动（撤销一并还原）', () => {
    const doc = new Document();
    const c = Document.newNode({ id: 'c', type: 'trefoil/container', x: 0, y: 0, width: 400, height: 300, text: '容器' });
    const ch1 = textNode('ch1', 10, 10);
    const ch2 = textNode('ch2', 60, 10);
    ch1.containerId = 'c';
    ch2.containerId = 'c';
    const out = textNode('out', 500, 500);
    doc.addNodes([c, ch1, ch2, out]);
    const tool = new SelectTool();
    tool.ctx = mockCtx(doc, null, null) as never;
    const cmds: unknown[] = [];
    doc.history = { push: (cmd: unknown) => cmds.push(cmd) };

    tool.onPointerDown({
      sx: 20, sy: 20, wx: 20, wy: 20, button: 0,
      shift: false, ctrl: false, alt: false, pick: { kind: 'container-band', containerId: 'c' }, raw: {} as PointerEvent,
    });
    tool.onPointerMove({
      sx: 70, sy: 50, wx: 70, wy: 50, button: 0,
      shift: false, ctrl: false, alt: false, pick: { kind: 'canvas' }, raw: {} as PointerEvent,
    });
    tool.onPointerUp({
      sx: 70, sy: 50, wx: 70, wy: 50, button: 0,
      shift: false, ctrl: false, alt: false, pick: { kind: 'canvas' }, raw: {} as PointerEvent,
    });
    // 只有从容器边带发起拖拽才会连带容器框：子元素移动、容器框跟随、无关元素不动
    expect(ch1.x).toBe(60);
    expect(ch2.x).toBe(110);
    expect(c.x).toBe(50);
    expect(c.y).toBe(30);
    expect(out.x).toBe(500);
    // 撤销 → 全部还原（undo 走 applySnapshot，须从 doc 取最新引用）
    const cmd = cmds[cmds.length - 1] as { undo(): void };
    cmd.undo();
    expect(doc.getNode('c')!.x).toBe(0);
    expect(doc.getNode('ch1')!.x).toBe(10);
  });

  it('部分内容移动 → 容器框不跟随', () => {
    const doc = new Document();
    const c = Document.newNode({ id: 'c', type: 'trefoil/container', x: 0, y: 0, width: 400, height: 300, text: '容器' });
    const ch1 = textNode('ch1', 10, 10);
    const ch2 = textNode('ch2', 60, 10);
    ch1.containerId = 'c';
    ch2.containerId = 'c';
    doc.addNodes([c, ch1, ch2]);
    doc.setSelection(['ch1']);
    const tool = new SelectTool();
    tool.ctx = mockCtx(doc, null, 'ch1') as never;
    tool.onPointerDown({
      sx: 20, sy: 20, wx: 20, wy: 20, button: 0,
      shift: false, ctrl: false, alt: false, pick: { kind: 'node', nodeId: 'ch1' }, raw: {} as PointerEvent,
    });
    tool.onPointerMove({
      sx: 70, sy: 50, wx: 70, wy: 50, button: 0,
      shift: false, ctrl: false, alt: false, pick: { kind: 'canvas' }, raw: {} as PointerEvent,
    });
    tool.onPointerUp({
      sx: 70, sy: 50, wx: 70, wy: 50, button: 0,
      shift: false, ctrl: false, alt: false, pick: { kind: 'canvas' }, raw: {} as PointerEvent,
    });
    expect(ch1.x).toBe(60);
    expect(c.x).toBe(0);
  });

  it('全部内容选中后从元素发起拖动 → 只动内容，容器框不跟随', () => {
    const doc = new Document();
    const c = Document.newNode({ id: 'c', type: 'trefoil/container', x: 0, y: 0, width: 400, height: 300, text: '容器' });
    const ch1 = textNode('ch1', 10, 10);
    const ch2 = textNode('ch2', 60, 10);
    ch1.containerId = 'c';
    ch2.containerId = 'c';
    doc.addNodes([c, ch1, ch2]);
    doc.setSelection(['ch1', 'ch2']);
    const tool = new SelectTool();
    tool.ctx = mockCtx(doc, null, 'ch1') as never;
    // 本测试只验证「容器框不跟随」，关闭吸附以免对容器边缘/中心的吸附引入位移干扰
    tool.ctx.settings.snap.enabled = false;
    tool.onPointerDown({
      sx: 20, sy: 20, wx: 20, wy: 20, button: 0,
      shift: false, ctrl: false, alt: false, pick: { kind: 'node', nodeId: 'ch1' }, raw: {} as PointerEvent,
    });
    tool.onPointerMove({
      sx: 70, sy: 50, wx: 70, wy: 50, button: 0,
      shift: false, ctrl: false, alt: false, pick: { kind: 'canvas' }, raw: {} as PointerEvent,
    });
    tool.onPointerUp({
      sx: 70, sy: 50, wx: 70, wy: 50, button: 0,
      shift: false, ctrl: false, alt: false, pick: { kind: 'canvas' }, raw: {} as PointerEvent,
    });
    // 容器内全部元素都被选中也只能移动元素本身：容器框保持原位
    expect(ch1.x).toBe(60);
    expect(ch2.x).toBe(110);
    expect(c.x).toBe(0);
    expect(c.y).toBe(0);
  });
});
