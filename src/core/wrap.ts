/**
 * 容器包裹模式（wrapMode）：容器几何由内部元素推导的纯逻辑层。
 *
 * 不变量：开启包裹的容器，其包围盒始终等于「直接子元素包围盒外扩 wrapPadding」，
 * 即最外层子元素与容器边框保持 wrapPadding 的距离。几何在子元素移动 / 缩放 /
 * 删除 / 文本重排时实时贴合（调用方在 doc.live / mutate 内调用，保证撤销完整性）。
 *
 * 嵌套：内层容器也是外层容器的子元素，贴合顺序必须「由深到浅」——
 * 内层贴合后的新几何才能被外层的子包围盒吃到（见 collectWrapContainers 的排序）。
 */
import type { Document } from './Document';
import type { CanvasNode } from './types';
import { isContainerNode } from './types';
import { nodeRect, unionRect, type Rect } from './geometry';
import { CONTAINER_DEFAULT_WRAP_PAD } from './defaults';

/** 包裹容器几何快照（撤销记录用；是 ResizeStartRecord / Partial<CanvasNode> 的公共子集） */
export interface GeometrySnapshot {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const isWrapContainer = (n: CanvasNode): boolean => isContainerNode(n) && !!n.wrapMode;

/** 包裹内边距：未设置过 → 默认值（非法值视为未设置） */
export function wrapPadOf(n: CanvasNode): number {
  const p = n.wrapPadding;
  return typeof p === 'number' && Number.isFinite(p) && p >= 0 ? p : CONTAINER_DEFAULT_WRAP_PAD;
}

/**
 * 子元素包围盒外扩 pad 后的容器几何；无子元素返回 null（空容器不参与包裹，保持当前几何）。
 * 线类子元素按 points 包围盒计（nodeRect 已是重排后的包围盒）。
 */
export function wrapBoxFor(children: CanvasNode[], pad: number): Rect | null {
  let box: Rect | null = null;
  for (const c of children) box = unionRect(box, nodeRect(c));
  if (!box) return null;
  return { x: box.x - pad, y: box.y - pad, width: box.width + pad * 2, height: box.height + pad * 2 };
}

/**
 * 收集 ids 涉及的所有包裹容器：沿 containerId 链向上（含嵌套祖先），去重后按深度
 * 降序返回（最深优先）。注意默认从各 id 的父级开始 —— 节点自身的移动由调用方处理，
 * 它的祖先容器才需要贴合；includeSelf 用于「id 本身就是被改动的包裹容器」（如改内边距）。
 */
export function collectWrapContainers(doc: Document, ids: Iterable<string>, includeSelf = false): CanvasNode[] {
  const found = new Map<string, CanvasNode>();
  for (const id of ids) {
    const start = doc.getNode(id);
    if (!start) continue;
    if (includeSelf && isWrapContainer(start)) found.set(start.id, start);
    let cur = start.containerId ?? null;
    const guard = new Set<string>([start.id]);
    while (cur && !guard.has(cur)) {
      guard.add(cur);
      const p = doc.getNode(cur);
      if (!p) break;
      if (isWrapContainer(p)) found.set(p.id, p);
      cur = p.containerId ?? null;
    }
  }
  const depthOf = (n: CanvasNode): number => {
    let d = 0;
    let cur = n.containerId ?? null;
    const guard = new Set<string>();
    while (cur && !guard.has(cur)) {
      guard.add(cur);
      const p = doc.getNode(cur);
      if (!p) break;
      d++;
      cur = p.containerId ?? null;
    }
    return d;
  };
  const list = [...found.values()];
  const depths = new Map(list.map((n) => [n.id, depthOf(n)]));
  return list.sort((a, b) => depths.get(b.id)! - depths.get(a.id)!);
}

/** 按 collectWrapContainers 给出的顺序（深→浅）重设容器几何：直接改节点，须在 doc.live / mutate 内调用 */
export function fitWrapContainers(doc: Document, containers: Iterable<CanvasNode>): void {
  for (const c of containers) {
    // 会话中途可能被关掉包裹（撤销/重做还原字段），贴合前重验
    if (!isWrapContainer(c)) continue;
    const box = wrapBoxFor(doc.containerChildren(c.id), wrapPadOf(c));
    if (!box) continue;
    c.x = box.x;
    c.y = box.y;
    c.width = box.width;
    c.height = box.height;
  }
}

/** 便捷入口：ids 涉及的全部包裹容器（深→浅）按当前子元素包围盒贴合 */
export function fitWrapAround(doc: Document, ids: Iterable<string>, includeSelf = false): void {
  fitWrapContainers(doc, collectWrapContainers(doc, ids, includeSelf));
}

/** 包裹容器起始几何快照：拖拽 / 排列会话开始时捕获，提交时并入同一条撤销记录 */
export function wrapStartRecords(doc: Document, ids: Iterable<string>, includeSelf = false): Map<string, GeometrySnapshot> {
  const out = new Map<string, GeometrySnapshot>();
  for (const c of collectWrapContainers(doc, ids, includeSelf)) {
    out.set(c.id, { x: c.x, y: c.y, width: c.width, height: c.height });
  }
  return out;
}
