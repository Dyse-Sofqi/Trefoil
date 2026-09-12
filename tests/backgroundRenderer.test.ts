import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// konva 的 node 入口依赖原生 canvas 包，测试环境用不到场景图，直接替换成空壳
vi.mock('konva', () => ({
  default: {
    Shape: class {
      getLayer() {
        return null;
      }
    },
  },
}));

import { BackgroundRenderer } from '../src/engine/BackgroundRenderer';
import { DEFAULT_SETTINGS } from '../src/core/defaults';

/** 记录调用次数的假 2D 上下文 */
function makeCtx(ratio = 1, cssWidth = 800, cssHeight = 600) {
  const calls: Record<string, number> = {};
  const hit = (name: string) => {
    calls[name] = (calls[name] ?? 0) + 1;
  };
  const pattern = { setTransform: () => hit('patternSetTransform') };
  const ctx = {
    canvas: { width: cssWidth * ratio, height: cssHeight * ratio },
    fillStyle: '',
    strokeStyle: '',
    globalAlpha: 1,
    lineWidth: 1,
    save: () => hit('save'),
    restore: () => hit('restore'),
    fillRect: () => hit('fillRect'),
    beginPath: () => hit('beginPath'),
    moveTo: () => hit('moveTo'),
    lineTo: () => hit('lineTo'),
    arc: () => hit('arc'),
    rect: () => hit('rect'),
    closePath: () => hit('closePath'),
    fill: () => hit('fill'),
    stroke: () => hit('stroke'),
    setLineDash: () => hit('setLineDash'),
    createPattern: () => pattern,
  };
  return { ctx, calls };
}

/** 假 layer：背景渲染器只用它挂 shape、取像素比 */
function makeLayer(pixelRatio = 1) {
  return {
    add: () => undefined,
    getCanvas: () => ({ getPixelRatio: () => pixelRatio }),
  };
}

function makeRenderer(bg: Record<string, unknown>, pixelRatio = 1) {
  const layer = makeLayer(pixelRatio);
  const renderer = new BackgroundRenderer(
    layer as never,
    { ...DEFAULT_SETTINGS.background, ...bg } as never,
  );
  renderer.width = 800;
  renderer.height = 600;
  return renderer;
}

describe('背景渲染：点阵开销与缩放无关', () => {
  const tileCtx = makeCtx();
  beforeEach(() => {
    // dotTileFor 会创建离屏图块，node 环境补一个最小 canvas 桩
    (globalThis as Record<string, unknown>).document = {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => tileCtx.ctx,
      }),
    };
  });
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).document;
  });

  it('25% 缩放下每帧只有 1 次 fillRect，不再逐点入路径', () => {
    const renderer = makeRenderer({ mode: 'dots', dotSpacing: 24, dotSize: 6, dotShape: 'diamond' });
    const { ctx, calls } = makeCtx();
    renderer.vp = { x: -1234.5, y: 987.25, scale: 0.25 };
    renderer.draw(ctx as never);
    expect(calls.fillRect).toBe(2); // 底色 1 次 + 点阵平铺 1 次
    expect(calls.moveTo ?? 0).toBe(0);
    expect(calls.lineTo ?? 0).toBe(0);
    expect(calls.patternSetTransform).toBe(1);
  });

  it('缩放 20% → 50% 的绘制调用数完全一致（与缩放无关）', () => {
    const renderer = makeRenderer({ mode: 'dots', dotSpacing: 24, dotSize: 6 });
    const counts: number[] = [];
    for (const scale of [0.2, 0.25, 0.3, 0.4, 0.5, 1]) {
      const { ctx, calls } = makeCtx();
      renderer.vp = { x: -500, y: -500, scale };
      renderer.draw(ctx as never);
      counts.push(Object.values(calls).reduce((a, b) => a + b, 0));
    }
    // 20% 时点阵被整层跳过（更省），其余各档调用数必须一致
    expect(new Set(counts.slice(1)).size).toBe(1);
    expect(counts[0]).toBeLessThan(counts[1]);
  });

  it('点间距低于下限时整层跳过', () => {
    const renderer = makeRenderer({ mode: 'dots', dotSpacing: 24, dotSize: 6 });
    const { ctx, calls } = makeCtx();
    renderer.vp = { x: 0, y: 0, scale: 0.1 }; // 24 × 0.1 = 2.4px < 6px
    renderer.draw(ctx as never);
    expect(calls.fillRect).toBe(1); // 只剩底色填充
    expect(calls.patternSetTransform ?? 0).toBe(0);
  });

  it('点大到放不进一个周期格时退回逐点绘制（仍能画出来）', () => {
    const renderer = makeRenderer({ mode: 'dots', dotSpacing: 8, dotSize: 10 });
    const { ctx, calls } = makeCtx();
    renderer.vp = { x: 0, y: 0, scale: 1 }; // 步长 8px，半径 5px → 直径 10px > 8px
    renderer.draw(ctx as never);
    expect(calls.patternSetTransform ?? 0).toBe(0);
    expect(calls.moveTo ?? 0).toBeGreaterThan(0);
  });

  it('大间距 + 高倍缩放时退回逐点绘制，不建超大图块', () => {
    const renderer = makeRenderer({ mode: 'dots', dotSpacing: 120, dotSize: 6 });
    const { ctx, calls } = makeCtx();
    renderer.vp = { x: 0, y: 0, scale: 5 }; // 步长 600px，图块会到 600px 见方，超过上限
    renderer.draw(ctx as never);
    expect(calls.patternSetTransform ?? 0).toBe(0);
    // 此时全屏只有个位数个点，逐点绘制同样便宜
    expect(calls.moveTo ?? 0).toBeGreaterThan(0);
    expect(calls.moveTo ?? 0).toBeLessThan(200);
  });

  it('网格模式不绘制点阵', () => {
    const renderer = makeRenderer({ mode: 'grid', gridSpacing: 24 });
    const { ctx, calls } = makeCtx();
    renderer.vp = { x: 0, y: 0, scale: 1 };
    renderer.draw(ctx as never);
    expect(calls.patternSetTransform ?? 0).toBe(0);
    expect(calls.stroke ?? 0).toBeGreaterThan(0);
  });

  it('纯色模式恒为一次底色填充，不画任何图元', () => {
    const renderer = makeRenderer({ mode: 'solid' });
    for (const scale of [0.1, 0.25, 1, 5]) {
      const { ctx, calls } = makeCtx();
      renderer.vp = { x: -1000, y: -1000, scale };
      renderer.draw(ctx as never);
      expect(calls.fillRect).toBe(1);
      expect(calls.moveTo ?? 0).toBe(0);
      expect(calls.lineTo ?? 0).toBe(0);
      expect(calls.stroke ?? 0).toBe(0);
      expect(calls.patternSetTransform ?? 0).toBe(0);
    }
  });

  it('网格模式绘制量有下限守卫，最坏也不到 2k 次路径指令', () => {
    // 最密的合法配置：小格间距 8、大格单位 2
    const renderer = makeRenderer({ mode: 'grid', gridSpacing: 8, gridMajorEvery: 2 });
    const rows: string[] = [];
    for (const scale of [0.375, 0.5, 0.75, 1, 2, 5]) {
      const { ctx, calls } = makeCtx();
      renderer.vp = { x: -1234.5, y: 987.25, scale };
      renderer.draw(ctx as never);
      const ops = (calls.moveTo ?? 0) + (calls.lineTo ?? 0);
      rows.push(`${scale}→${ops}`);
      // 小格步长不小于 3px，线数上限 (W+H)/3，大格再叠加同等量级
      expect(ops).toBeLessThan(2000);
    }
    console.log('grid 路径指令数：' + rows.join('  '));
  });
});
