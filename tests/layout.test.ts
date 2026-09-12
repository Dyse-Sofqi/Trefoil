import { describe, expect, it } from 'vitest';
import { computeTreeLayout, type LayoutInput } from '../src/core/layout';

function makeInput(partial: Partial<LayoutInput>): LayoutInput {
  return { rootId: 'root', nodes: {}, direction: 'horizontal', rootX: 0, rootY: 0, ...partial };
}

describe('computeTreeLayout', () => {
  it('根节点以 rootX/rootY 为左上角', () => {
    const out = computeTreeLayout(makeInput({ nodes: { root: { id: 'root', width: 100, height: 40, children: [] } } }));
    expect(out.root).toEqual({ x: 0, y: 0 });
  });

  it('横向树：子节点在右侧，垂直居中于根中心', () => {
    const out = computeTreeLayout(makeInput({
      nodes: {
        root: { id: 'root', width: 100, height: 40, children: ['a', 'b'] },
        a: { id: 'a', width: 60, height: 30, children: [] },
        b: { id: 'b', width: 60, height: 30, children: [] },
      },
      rootX: 0,
      rootY: 0,
    }));
    // 子节点层级间距 80
    expect(out.a.x).toBe(180);
    expect(out.b.x).toBe(180);
    // 子树总跨度 = 30 + 24 + 30 = 84，居中于根中心 y=20
    expect(out.a.y).toBe(-22);
    expect(out.b.y).toBe(32);
  });

  it('兄弟间距 24、层级间距 80', () => {
    const out = computeTreeLayout(makeInput({
      nodes: {
        root: { id: 'root', width: 50, height: 30, children: ['a'] },
        a: { id: 'a', width: 40, height: 20, children: ['c1', 'c2'] },
        c1: { id: 'c1', width: 30, height: 20, children: [] },
        c2: { id: 'c2', width: 30, height: 20, children: [] },
      },
    }));
    expect(out.a.x).toBe(130); // 50 + 80
    expect(out.c1.x).toBe(250); // 130 + 40 + 80
    expect(out.c2.y - out.c1.y).toBe(44); // 20 + 24
  });

  it('纵向树：子节点在下方，水平居中', () => {
    const out = computeTreeLayout(makeInput({
      direction: 'vertical',
      nodes: {
        root: { id: 'root', width: 40, height: 50, children: ['a', 'b'] },
        a: { id: 'a', width: 30, height: 20, children: [] },
        b: { id: 'b', width: 30, height: 20, children: [] },
      },
      rootX: 100,
      rootY: 100,
    }));
    expect(out.a.y).toBe(230); // 100 + 50(根高) + 80(层级间距)
    expect(out.a.x).toBeLessThan(out.b.x);
    const midA = out.a.x + 15;
    const midB = out.b.x + 15;
    // 子树居中于根中心 x = 100 + 40/2 = 120
    expect((midA + midB) / 2).toBeCloseTo(120);
  });

  it('环引用不死循环', () => {
    const out = computeTreeLayout(makeInput({
      nodes: {
        root: { id: 'root', width: 50, height: 50, children: ['a'] },
        a: { id: 'a', width: 50, height: 50, children: ['root'] },
      },
    }));
    expect(Object.keys(out).length).toBeGreaterThan(0);
  });
});
