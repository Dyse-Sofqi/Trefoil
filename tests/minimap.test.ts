import { describe, expect, it } from 'vitest';
import {
  MIN_INDICATOR,
  MINIMAP_H,
  MINIMAP_W,
  computeMinimapLayout,
  indicatorRect,
  mapToWorld,
  miniNodePaint,
  viewWorldRect,
  worldToMap,
} from '../src/app/minimap';
import type { Palette } from '../src/engine/palette';
import type { CanvasNode } from '../src/core/types';
import { CONTAINER_DEFAULT_FILL_OPACITY } from '../src/core/defaults';

const palette: Palette = {
  canvasBg: '#ffffff',
  text: '#111111',
  textMuted: '#777777',
  accent: '#4c8dff',
  accentSoft: 'rgba(0,0,0,0)',
  nodeStroke: '#5a5a5a',
  edge: '#9a9a9a',
  guide: '#ff0000',
  danger: '#e05252',
  containerBorder: '#a0a0a0',
  selectionFill: 'rgba(0,0,0,0.08)',
  presets: ['#111111', '#222222', '#333333', '#444444', '#555555', '#666666'],
};

function node(over: Partial<CanvasNode> & { type: string }): CanvasNode {
  return { id: 'n1', x: 0, y: 0, width: 10, height: 10, ...over };
}

describe('computeMinimapLayout', () => {
  it('把内容映射进留白内的方框（按较小比例，letterbox 居中）', () => {
    const rect = { x: 0, y: 0, width: 100, height: 50 };
    const l = computeMinimapLayout(rect, rect);
    // 可用区 164 x 116；宽度受限 → scale = 1.64
    expect(l.scale).toBeCloseTo((MINIMAP_W - 12) / 100, 6);
    expect(l.offsetX).toBeCloseTo(6, 6);
    expect(l.offsetY).toBeCloseTo((MINIMAP_H - 50 * l.scale) / 2, 6);
  });

  it('内容为空时以视口为映射范围', () => {
    const view = { x: 30, y: 40, width: 120, height: 120 };
    const l = computeMinimapLayout(null, view);
    expect(l.bounds).toEqual(view);
  });

  it('视口在内容之外时取并集（视口不越出缩略图）', () => {
    const content = { x: 0, y: 0, width: 50, height: 50 };
    const view = { x: 200, y: 0, width: 100, height: 100 };
    const l = computeMinimapLayout(content, view);
    expect(l.bounds).toEqual({ x: 0, y: 0, width: 300, height: 100 });

    const a = worldToMap(l, 0, 0);
    const b = worldToMap(l, 300, 100);
    expect(a.x).toBeGreaterThanOrEqual(6 - 1e-6);
    expect(a.y).toBeGreaterThanOrEqual(6 - 1e-6);
    expect(b.x).toBeLessThanOrEqual(MINIMAP_W - 6 + 1e-6);
    expect(b.y).toBeLessThanOrEqual(MINIMAP_H - 6 + 1e-6);
  });
});

describe('坐标映射', () => {
  it('worldToMap / mapToWorld 互为逆运算', () => {
    const l = computeMinimapLayout({ x: -40, y: 15, width: 300, height: 180 }, { x: 0, y: 0, width: 200, height: 200 });
    const p = worldToMap(l, 123.5, -67.25);
    const back = mapToWorld(l, p.x, p.y);
    expect(back.x).toBeCloseTo(123.5, 6);
    expect(back.y).toBeCloseTo(-67.25, 6);
  });

  it('视口映射为 bounds 的左上角/右下角', () => {
    const view = { x: 0, y: 0, width: 100, height: 100 };
    const l = computeMinimapLayout(null, view);
    const tl = worldToMap(l, 0, 0);
    const br = worldToMap(l, 100, 100);
    expect(tl.x).toBeCloseTo(l.offsetX, 6);
    expect(br.x).toBeCloseTo(l.offsetX + 100 * l.scale, 6);
  });
});

describe('viewWorldRect', () => {
  it('按缩放换算屏幕尺寸为世界尺寸', () => {
    expect(viewWorldRect({ x: 10, y: 20, scale: 2 }, 800, 600)).toEqual({ x: 10, y: 20, width: 400, height: 300 });
  });
});

describe('indicatorRect', () => {
  it('视口等于映射范围时铺满可用区', () => {
    const view = { x: 0, y: 0, width: 100, height: 100 };
    const l = computeMinimapLayout(null, view);
    const ind = indicatorRect(l, view);
    expect(ind.width).toBeCloseTo(100 * l.scale, 6);
    expect(ind.height).toBeCloseTo(100 * l.scale, 6);
    expect(ind.x).toBeCloseTo(l.offsetX, 6);
  });

  it('缩到极小时钳制最小尺寸，仍可见', () => {
    const content = { x: 0, y: 0, width: 100000, height: 100000 };
    const view = { x: 0, y: 0, width: 1, height: 1 };
    const l = computeMinimapLayout(content, view);
    const ind = indicatorRect(l, view);
    expect(ind.width).toBe(MIN_INDICATOR);
    expect(ind.height).toBe(MIN_INDICATOR);
    // 仍以视口中心为锚点
    const center = worldToMap(l, 0.5, 0.5);
    expect(ind.x + ind.width / 2).toBeCloseTo(center.x, 6);
    expect(ind.y + ind.height / 2).toBeCloseTo(center.y, 6);
  });
});

describe('miniNodePaint', () => {
  it('容器：虚线描边', () => {
    const p = miniNodePaint(node({ type: 'trefoil/container', width: 200, height: 120 }), palette);
    expect(p).toMatchObject({ color: palette.containerBorder, outline: true, dashed: true });
  });

  it('容器：设了背景色则按背景色实心块，透明度跟随 fillOpacity（低透明度有可见度下限）', () => {
    const p = miniNodePaint(node({ type: 'trefoil/container', width: 200, height: 120, fill: '#ff0000', fillOpacity: 1 }), palette);
    expect(p).toMatchObject({ color: '#ff0000', outline: false, dashed: false });
    expect(p.alpha).toBeCloseTo(0.9, 6);
    // 低透明度（含默认的 10%）在缩略图里仍要看得见
    const faint = miniNodePaint(node({ type: 'trefoil/container', width: 200, height: 120, fill: '#ff0000', fillOpacity: 0.25 }), palette);
    expect(faint.alpha).toBeCloseTo(0.35, 6);
  });

  it('容器：没设过背景透明度时按容器默认值算（不是 1）', () => {
    const p = miniNodePaint(node({ type: 'trefoil/container', width: 200, height: 120, fill: '#ff0000' }), palette);
    expect(CONTAINER_DEFAULT_FILL_OPACITY).toBeLessThan(1);
    expect(p.alpha).toBeCloseTo(Math.max(0.35, 0.9 * CONTAINER_DEFAULT_FILL_OPACITY), 6);
  });

  it('容器：背景色用预设色时按调色板解析', () => {
    const p = miniNodePaint(node({ type: 'trefoil/container', width: 200, height: 120, fill: '2' }), palette);
    expect(p).toMatchObject({ color: palette.presets[1], outline: false });
  });

  it('文本：半透明实心块', () => {
    const p = miniNodePaint(node({ type: 'text', text: 'hi' }), palette);
    expect(p).toMatchObject({ color: palette.text, outline: false, dashed: false });
    expect(p.alpha).toBeLessThan(0.5);
  });

  it('无填充形状：按描边色勾边', () => {
    const p = miniNodePaint(node({ type: 'trefoil/shape', shape: 'rect', fill: null }), palette);
    expect(p).toMatchObject({ color: palette.nodeStroke, outline: true, dashed: false });
  });

  it('有填充形状：实心块，预设色按调色板解析', () => {
    const p = miniNodePaint(node({ type: 'trefoil/shape', shape: 'rect', fill: '1' }), palette);
    expect(p).toMatchObject({ color: palette.presets[0], outline: false });
  });

  it('line/arrow：使用描边色而非填充', () => {
    const p = miniNodePaint(node({ type: 'trefoil/shape', shape: 'arrow', stroke: '#ff0000', fill: '2' }), palette);
    expect(p).toMatchObject({ color: '#ff0000', outline: false });
  });

  it('file：以强调色低透明度表示', () => {
    const p = miniNodePaint(node({ type: 'file', file: 'a.png' }), palette);
    expect(p).toMatchObject({ color: palette.accent });
    expect(p.alpha).toBeLessThan(0.6);
  });
});
