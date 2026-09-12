/**
 * 树形自动布局（紧凑树）。
 * 纯函数，可在主线程或 Web Worker 中运行。
 *
 * horizontal：层级沿 X 轴向右展开，兄弟沿 Y 轴堆叠（父在左，子在右）
 * vertical：  层级沿 Y 轴向下展开，兄弟沿 X 轴排列（父在上，子在下）
 */

export interface LayoutInputNode {
  id: string;
  width: number;
  height: number;
  children: string[];
}

export interface LayoutInput {
  rootId: string;
  nodes: Record<string, LayoutInputNode>;
  direction: 'horizontal' | 'vertical';
  /** 兄弟间距（默认 24） */
  gapSibling?: number;
  /** 层级间距（默认 80） */
  gapLevel?: number;
  /** 根节点目标位置（绝对坐标） */
  rootX: number;
  rootY: number;
}

export type LayoutOutput = Record<string, { x: number; y: number }>;

export function computeTreeLayout(input: LayoutInput): LayoutOutput {
  const { rootId, nodes, direction } = input;
  const gapSibling = input.gapSibling ?? 24;
  const gapLevel = input.gapLevel ?? 80;
  const out: LayoutOutput = {};
  const root = nodes[rootId];
  if (!root) return out;

  const crossSize = (n: LayoutInputNode) => (direction === 'horizontal' ? n.height : n.width);
  const levelSize = (n: LayoutInputNode) => (direction === 'horizontal' ? n.width : n.height);

  // 第一遍：后序计算每棵子树在法线方向的总跨度
  const spanCache = new Map<string, number>();
  const computing = new Set<string>();
  function spanOf(id: string): number {
    const cached = spanCache.get(id);
    if (cached !== undefined) return cached;
    if (computing.has(id)) return 0; // 防环
    computing.add(id);
    const node = nodes[id];
    if (!node) return 0;
    const kids = node.children.filter((c) => nodes[c] && c !== id);
    let span: number;
    if (kids.length === 0) {
      span = crossSize(node);
    } else {
      let total = 0;
      for (const c of kids) total += spanOf(c);
      total += gapSibling * (kids.length - 1);
      span = Math.max(total, crossSize(node));
    }
    computing.delete(id);
    spanCache.set(id, span);
    return span;
  }

  // 第二遍：前序放置（visited 防环）
  const placed = new Set<string>();
  function place(id: string, crossCenter: number, levelPos: number): void {
    if (placed.has(id)) return;
    placed.add(id);
    const node = nodes[id];
    if (!node) return;
    const pos =
      direction === 'horizontal'
        ? { x: levelPos, y: crossCenter - crossSize(node) / 2 }
        : { x: crossCenter - crossSize(node) / 2, y: levelPos };
    out[id] = pos;

    const kids = node.children.filter((c) => nodes[c] && c !== id && !placed.has(c));
    if (!kids.length) return;
    let total = 0;
    for (const c of kids) total += spanOf(c);
    total += gapSibling * (kids.length - 1);

    const nextLevel = levelPos + levelSize(node) + gapLevel;
    let cross = crossCenter - total / 2;
    for (const c of kids) {
      const cSpan = spanOf(c);
      place(c, cross + cSpan / 2, nextLevel);
      cross += cSpan + gapSibling;
    }
  }

  // 根节点以 (rootX, rootY) 为左上角
  const rootCross = (direction === 'horizontal' ? input.rootY : input.rootX) + crossSize(root) / 2;
  const rootLevel = direction === 'horizontal' ? input.rootX : input.rootY;
  place(rootId, rootCross, rootLevel);
  return out;
}
