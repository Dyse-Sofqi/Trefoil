/**
 * 思维导图容器操作：子节点/兄弟节点增删、折叠展开、自动布局。
 * 容器内部遵循树形结构；treeParent=null 且 containerId 有值的节点为“森林根”。
 */
import type { Document } from './Document';
import { uid } from './id';
import { computeTreeLayout, type LayoutInput } from './layout';

export interface LayoutResult {
  positions: Record<string, { x: number; y: number }>;
}

export const CONTAINER_PADDING = 24;
export const CONTAINER_TITLE_H = 28;

/** 新建导图节点时可从「文本默认」继承的样式（缺省时回退到参考节点/内置值） */
export interface MapNodeDefaults {
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: number;
  color?: string;
}

/** 添加子节点（Tab）；parentId 为 null 时新建根节点，返回新节点 id */
export function addChildNode(doc: Document, containerId: string, parentId: string | null, defaults: MapNodeDefaults): string | null {
  const parent = parentId ? doc.getNode(parentId) : null;
  const baseX = parent ? parent.x + parent.width + 80 : 120;
  const baseY = parent ? parent.y : 120;
  const node = {
    id: uid('n'),
    type: 'text' as const,
    x: baseX,
    y: baseY + (doc.nodes.length % 3) * 44,
    width: 120,
    height: 36,
    text: '',
    containerId,
    treeParent: parentId,
    fontSize: defaults.fontSize ?? 14,
    fontFamily: defaults.fontFamily,
    fontWeight: defaults.fontWeight,
    color: defaults.color,
    hAlign: 'center' as const,
  };
  doc.mutate('添加子节点', () => {
    doc.nodes.push(node);
    if (parent) {
      doc.edges.push({
        id: uid('e'),
        fromNode: parent.id,
        toNode: node.id,
        kind: 'mindmap',
      });
    }
    doc.reindex();
  });
  return node.id;
}

/** 添加兄弟节点（Enter），返回新节点 id */
export function addSiblingNode(doc: Document, containerId: string, nodeId: string, defaults: MapNodeDefaults): string | null {
  const ref = doc.getNode(nodeId);
  if (!ref || !ref.containerId) return null;
  const treeParent = ref.treeParent;
  if (!treeParent) {
    // 兄弟位于顶层：新建森林根
    const node = {
      id: uid('n'),
      type: 'text' as const,
      x: ref.x,
      y: ref.y + ref.height + 24,
      width: ref.width,
      height: ref.height,
      text: '',
      containerId,
      treeParent: null,
      fontSize: defaults.fontSize ?? ref.fontSize ?? 14,
      fontFamily: defaults.fontFamily ?? ref.fontFamily,
      fontWeight: defaults.fontWeight ?? ref.fontWeight,
      color: ref.color,
      hAlign: 'center' as const,
    };
    doc.mutate('添加节点', () => {
      doc.nodes.push(node);
      doc.reindex();
    });
    return node.id;
  }
  const node = {
    id: uid('n'),
    type: 'text' as const,
    x: ref.x,
    y: ref.y + ref.height + 12,
    width: ref.width,
    height: ref.height,
    text: '',
    containerId,
    treeParent,
    fontSize: defaults.fontSize ?? ref.fontSize ?? 14,
    fontFamily: defaults.fontFamily ?? ref.fontFamily,
    fontWeight: defaults.fontWeight ?? ref.fontWeight,
    color: ref.color,
    hAlign: 'center' as const,
  };
  doc.mutate('添加兄弟节点', () => {
    doc.nodes.push(node);
    doc.edges.push({
      id: uid('e'),
      fromNode: treeParent,
      toNode: node.id,
      kind: 'mindmap',
    });
    doc.reindex();
  });
  return node.id;
}

/** 删除导图节点及其子树（容器内部） */
export function deleteSubtree(doc: Document, nodeId: string): void {
  const ids = new Set<string>();
  const collect = (id: string) => {
    ids.add(id);
    for (const c of doc.nodes.filter((n) => n.treeParent === id)) collect(c.id);
  };
  collect(nodeId);
  doc.mutate('删除节点', () => {
    doc.nodes = doc.nodes.filter((n) => !ids.has(n.id));
    doc.edges = doc.edges.filter((e) => !ids.has(e.fromNode) && !ids.has(e.toNode));
    doc.reindex();
    for (const id of ids) doc.selection.delete(id);
  });
}

/** 折叠/展开（Space） */
export function toggleCollapse(doc: Document, nodeId: string): void {
  const n = doc.getNode(nodeId);
  if (!n) return;
  const collapsed = !n.collapsed;
  doc.updateNode(nodeId, { collapsed }, '折叠/展开');
}

/** 以 rootId 为根整理树形布局（horizontal/vertical） */
export function layoutSubtree(doc: Document, rootId: string, direction: 'horizontal' | 'vertical', positions?: Record<string, { x: number; y: number }>): void {
  const root = doc.getNode(rootId);
  if (!root) return;

  let pos: Record<string, { x: number; y: number }>;
  if (positions) {
    pos = positions;
  } else {
    const input = buildLayoutInput(doc, rootId, direction, root.x, root.y);
    pos = computeTreeLayout(input);
  }

  doc.mutate('自动布局', () => {
    for (const [id, p] of Object.entries(pos)) {
      const n = doc.getNode(id);
      if (n) {
        n.x = p.x;
        n.y = p.y;
      }
    }
    fitContainerToChildren(doc, root.containerId ?? undefined);
  });
}

export function buildLayoutInput(doc: Document, rootId: string, direction: 'horizontal' | 'vertical', rootX: number, rootY: number): LayoutInput {
  const nodes: LayoutInput['nodes'] = {};
  const collect = (id: string) => {
    const n = doc.getNode(id);
    if (!n) return;
    nodes[id] = { id, width: n.width, height: n.height, children: doc.treeChildren(id).map((c) => c.id) };
    for (const c of doc.treeChildren(id)) collect(c.id);
  };
  collect(rootId);
  return { rootId, nodes, direction, rootX, rootY };
}

/** 容器边框收缩到子节点范围（保持至少 200x140） */
export function fitContainerToChildren(doc: Document, containerId?: string | null): void {
  if (!containerId) return;
  const container = doc.getNode(containerId);
  if (!container) return;
  const children = doc.containerChildren(containerId);
  if (!children.length) return;
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const c of children) {
    minX = Math.min(minX, c.x);
    minY = Math.min(minY, c.y);
    maxX = Math.max(maxX, c.x + c.width);
    maxY = Math.max(maxY, c.y + c.height);
  }
  const pad = CONTAINER_PADDING + CONTAINER_TITLE_H;
  const target = {
    x: minX - pad,
    y: minY - pad,
    width: Math.max(200, maxX - minX + pad * 2),
    height: Math.max(140, maxY - minY + pad * 2),
  };
  container.x = target.x;
  container.y = target.y;
  container.width = target.width;
  container.height = target.height;
}
