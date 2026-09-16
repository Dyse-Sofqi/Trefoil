/**
 * 绘制顺序（paint order）—— 容器背景必须落在自己的内容之下。
 *
 * 为什么需要单独算：`doc.nodes` 的数组顺序既是 Z 序也是绘制顺序，而「组合为容器」是把容器
 * **追加到数组末尾**（见 Clipboard.composeIntoContainer），于是容器排在它的子节点之后。
 * 容器只画一圈虚线边框时这无所谓（边框在容器外沿，子节点内缩 32px，视觉上不重叠），
 * 但一旦容器有了背景填充，填充就会盖住容器里的全部内容。
 *
 * 规则：**非容器节点的相对顺序完全不变**，只把每个容器下移到「它的后代中数组下标最小者」之前。
 * 实现用稳定排序：key = min(自身下标, 所有后代的下标)；同 key 时按祖先深度升序，
 * 保证外层容器排在内层容器之前、容器排在自己的后代之前。
 */
import type { CanvasNode } from './types';

/**
 * 返回绘制顺序（新数组，元素仍是原对象引用）。
 * 输入不被修改；非容器节点保持原有相对顺序。
 */
export function paintOrder(nodes: readonly CanvasNode[]): CanvasNode[] {
  if (nodes.length < 2) return [...nodes];
  const index = new Map<string, number>();
  const byId = new Map<string, CanvasNode>();
  nodes.forEach((n, i) => {
    index.set(n.id, i);
    byId.set(n.id, n);
  });

  // key 初值 = 自身下标；沿 containerId 链上溯时把最小值冒泡给所有祖先
  const key = new Map<string, number>();
  const depth = new Map<string, number>();
  for (const n of nodes) key.set(n.id, index.get(n.id) ?? 0);

  for (const n of nodes) {
    const own = index.get(n.id) ?? 0;
    let d = 0;
    let cur: CanvasNode | undefined = n;
    const seen = new Set<string>([n.id]);
    while (cur?.containerId) {
      const parent = byId.get(cur.containerId);
      // 悬空引用 / 成环：按自由元素处理，不再上溯
      if (!parent || seen.has(parent.id)) break;
      seen.add(parent.id);
      d++;
      if ((key.get(parent.id) ?? 0) > own) key.set(parent.id, own);
      cur = parent;
    }
    depth.set(n.id, d);
  }

  return nodes
    .map((n, i) => ({ n, i, key: key.get(n.id) ?? i, depth: depth.get(n.id) ?? 0 }))
    .sort((a, b) => a.key - b.key || a.depth - b.depth || a.i - b.i)
    .map((e) => e.n);
}
