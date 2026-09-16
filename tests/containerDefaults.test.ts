import { describe, expect, it, vi } from 'vitest';

/**
 * Konva 在 node 环境没有 DOM 可用，用一个只记录 attrs 的替身即可 ——
 * 容器渲染是纯「数据 → 属性」的映射，断言 attrs 就够了。
 */
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
    getClassName() {
      return this.constructor.name;
    }
    x(v?: number) {
      if (v === undefined) return (this.attrs.x as number) ?? 0;
      this.attrs.x = v;
      return this;
    }
    y(v?: number) {
      if (v === undefined) return (this.attrs.y as number) ?? 0;
      this.attrs.y = v;
      return this;
    }
    opacity(v?: number) {
      if (v === undefined) return (this.attrs.opacity as number) ?? 1;
      this.attrs.opacity = v;
      return this;
    }
    scale(v?: { x: number; y: number }) {
      if (v) this.attrs.scale = v;
      return this;
    }
    scaleX() {
      return 1;
    }
    scaleY() {
      return 1;
    }
    visible(v?: boolean) {
      if (v === undefined) return (this.attrs.visible as boolean) ?? true;
      this.attrs.visible = v;
      return this;
    }
    getWidth() {
      return 60;
    }
    getHeight() {
      return 20;
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
  return {
    default: {
      Group: class extends FakeNode {},
      Shape: class extends FakeNode {},
      Rect: class extends FakeNode {},
      Label: class extends FakeNode {},
      Tag: class extends FakeNode {},
      Text: class extends FakeNode {},
    },
  };
});

import { NodeView } from '../src/engine/NodeView';
import { CONTAINER_DEFAULT_FILL_OPACITY, CONTAINER_DEFAULT_RADIUS } from '../src/core/defaults';
import type { CanvasNode } from '../src/core/types';
import type { Palette } from '../src/engine/palette';

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

function container(over: Partial<CanvasNode> = {}): CanvasNode {
  return { id: 'c1', type: 'trefoil/container', x: 0, y: 0, width: 300, height: 200, ...over };
}

/** 取出容器视图里的矩形（fill 矩形可能不存在，边框矩形恒在），按绘制顺序 */
function rects(node: CanvasNode): { fill: unknown; cornerRadius: unknown; opacity: number }[] {
  const view = new NodeView(node, palette, null as never);
  const inner = (view.group as unknown as { children: { children: unknown[] }[] }).children[0]!;
  return (inner.children as { getClassName(): string; attrs: Record<string, unknown> }[])
    .filter((s) => s.getClassName() === 'Rect')
    .map((s) => ({
      fill: s.attrs.fill,
      cornerRadius: s.attrs.cornerRadius,
      opacity: s.attrs.opacity as number,
    }));
}

describe('容器默认外观', () => {
  it('没设过圆角时用默认圆角（背景与虚线边框共用同一半径）', () => {
    const out = rects(container());
    expect(out).toHaveLength(1); // 无背景 → 只有虚线边框
    expect(out[0]!.cornerRadius).toBe(CONTAINER_DEFAULT_RADIUS);
  });

  it('没设过背景透明度时用默认值', () => {
    const out = rects(container({ fill: '#4c8dff' }));
    expect(out).toHaveLength(2); // 背景 + 边框
    expect(out[0]!.fill).toBe('#4c8dff');
    expect(out[0]!.opacity).toBeCloseTo(CONTAINER_DEFAULT_FILL_OPACITY, 6);
    // 虚线边框的 0.85 不受背景透明度影响
    expect(out[1]!.opacity).toBeCloseTo(0.85, 6);
    expect(out[1]!.cornerRadius).toBe(CONTAINER_DEFAULT_RADIUS);
  });

  it('显式设过的值优先（含 0：0 是合法取值，不能被当成「没设置」）', () => {
    const out = rects(container({ fill: '#4c8dff', fillOpacity: 0, borderRadius: 0 }));
    expect(out[0]!.opacity).toBe(0);
    expect(out[0]!.cornerRadius).toBe(0);
    expect(out[1]!.cornerRadius).toBe(0);
  });

  it('默认值本身不是 0 / 1 —— 否则这条用例永远通过', () => {
    expect(CONTAINER_DEFAULT_RADIUS).toBe(10);
    expect(CONTAINER_DEFAULT_FILL_OPACITY).toBe(0.1);
  });
});
