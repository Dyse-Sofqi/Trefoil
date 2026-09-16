import { describe, expect, it } from 'vitest';
import { paintOrder } from '../src/core/zorder';
import type { CanvasNode } from '../src/core/types';

const leaf = (id: string, containerId?: string | null): CanvasNode => ({
  id,
  type: 'text',
  x: 0,
  y: 0,
  width: 10,
  height: 10,
  ...(containerId !== undefined ? { containerId } : {}),
});

const box = (id: string, containerId?: string | null): CanvasNode => ({
  id,
  type: 'trefoil/container',
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  ...(containerId !== undefined ? { containerId } : {}),
});

const ids = (nodes: CanvasNode[]): string[] => nodes.map((n) => n.id);

describe('paintOrder', () => {
  it('没有容器时原样返回（非容器节点的相对顺序永不改变）', () => {
    const nodes = [leaf('a'), leaf('b'), leaf('c')];
    expect(ids(paintOrder(nodes))).toEqual(['a', 'b', 'c']);
  });

  it('容器排在子节点之后时，下移到子节点之前（背景不盖住内容）', () => {
    // 真实数据形态：组合为容器是把容器 push 到数组末尾
    const nodes = [leaf('c1', 'box'), leaf('c2', 'box'), box('box')];
    expect(ids(paintOrder(nodes))).toEqual(['box', 'c1', 'c2']);
  });

  it('容器排在子节点之前时保持不动', () => {
    const nodes = [box('box'), leaf('c1', 'box'), leaf('c2', 'box')];
    expect(ids(paintOrder(nodes))).toEqual(['box', 'c1', 'c2']);
  });

  it('子节点分布在容器两侧时，容器下移到最靠前的子节点之前', () => {
    const nodes = [leaf('before', 'box'), box('box'), leaf('after', 'box')];
    expect(ids(paintOrder(nodes))).toEqual(['box', 'before', 'after']);
  });

  it('没有子节点的容器留在原位', () => {
    const nodes = [leaf('a'), box('box'), leaf('b')];
    expect(ids(paintOrder(nodes))).toEqual(['a', 'box', 'b']);
  });

  it('嵌套容器：每个容器都排在自己的内容之前（外层容器最下）', () => {
    const nodes = [leaf('innerChild', 'inner'), box('inner', 'outer'), leaf('outerChild', 'outer'), box('outer')];
    const out = ids(paintOrder(nodes));
    // 每个容器都在自己的子节点之前
    expect(out.indexOf('outer')).toBeLessThan(out.indexOf('inner'));
    expect(out.indexOf('inner')).toBeLessThan(out.indexOf('innerChild'));
    expect(out.indexOf('outer')).toBeLessThan(out.indexOf('outerChild'));
    // 非容器节点之间保持原有相对顺序（innerChild 原下标 0 < outerChild 原下标 2）
    expect(out.indexOf('innerChild')).toBeLessThan(out.indexOf('outerChild'));
  });

  it('无关节点的相对顺序不受影响', () => {
    const nodes = [leaf('x'), leaf('y'), box('box'), leaf('z'), leaf('c', 'box')];
    // 容器本来就在自己的子节点之前 → 原位；x/y/z 之间仍是 x → y → z
    expect(ids(paintOrder(nodes))).toEqual(['x', 'y', 'box', 'z', 'c']);
  });

  it('容器必须跨越无关节点时，只动容器、不动其它节点的相对顺序', () => {
    // 内容在容器之前、中间夹了一个无关节点：容器下移到内容之前，无关节点仍排在内容之后
    const nodes = [leaf('c', 'box'), leaf('z'), box('box')];
    expect(ids(paintOrder(nodes))).toEqual(['box', 'c', 'z']);
  });

  it('悬空的 containerId 不报错，按自由元素处理', () => {
    const nodes = [leaf('a', 'ghost'), box('box'), leaf('b')];
    expect(ids(paintOrder(nodes))).toEqual(['a', 'box', 'b']);
  });

  it('containerId 成环不死循环', () => {
    const nodes = [box('a', 'b'), box('b', 'a'), leaf('tail')];
    const out = paintOrder(nodes);
    expect(out).toHaveLength(3);
    expect([...ids(out)].sort()).toEqual(['a', 'b', 'tail']);
  });

  it('不修改输入数组，也不改动元素对象', () => {
    const nodes = [leaf('c1', 'box'), box('box')];
    const snapshot = [...nodes];
    const out = paintOrder(nodes);
    expect(nodes).toEqual(snapshot);
    expect(out).not.toBe(nodes);
    expect(out[0]).toBe(nodes[1]);
  });

  it('空数组 / 单元素直接返回', () => {
    expect(paintOrder([])).toEqual([]);
    const one = [leaf('only')];
    expect(ids(paintOrder(one))).toEqual(['only']);
  });
});
