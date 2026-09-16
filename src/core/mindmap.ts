/**
 * 导图（思维导图）核心操作。
 *
 * 结构约定：
 * - 主节点：`mapRoot: true` 的节点，是导图的入口标记（属性面板「升级为导图主节点」写入）；
 * - 成员资格：节点与导图的从属关系由 `kind: 'mindmap'` 的边决定（fromNode = 父，toNode = 子），
 *   不依赖容器或节点上的父指针 —— 删边即脱离导图，删除节点时边随 Document.removeNodes 一起清理；
 * - 快捷键：Tab 添加子节点、Enter 添加同级节点（新增节点一律为文本框），交互在 SelectTool / CanvasApp。
 */
import { Document } from './Document';
import type { CanvasNode } from './types';
import { uid } from './id';

/** 新建导图节点的文字样式（调用方按参考节点/全局文本默认解析好传入） */
export interface MapNodeStyle {
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: number;
  color?: string;
}

/** 层级间距（父右缘 → 子左缘） */
export const MAP_LEVEL_GAP = 80;
/** 兄弟间距 */
export const MAP_SIBLING_GAP = 16;
/** 新建子节点的默认框形（文本框；高度在编辑提交后按内容自适应） */
export const MAP_NODE_W = 120;
export const MAP_NODE_H = 36;

/**
 * 参考节点带有实体边框时，新节点继承同款边框（颜色 / 粗细 / 线型 / 圆角）；
 * 无边框则什么都不带 —— 避免把未生效的边框参数提前种进新节点。
 */
function inheritBorder(from: CanvasNode): Partial<CanvasNode> {
  if (!from.border) return {};
  return {
    border: true,
    stroke: from.stroke,
    strokeSize: from.strokeSize,
    borderStyle: from.borderStyle,
    borderRadius: from.borderRadius,
  };
}

/** 导图成员：主节点，或任意 mindmap 边的端点 */
export function isMapMember(doc: Document, id: string): boolean {
  if (doc.getNode(id)?.mapRoot) return true;
  return doc.edges.some((e) => e.kind === 'mindmap' && (e.fromNode === id || e.toNode === id));
}

/** 导图父节点（沿 mindmap 边向上）；主节点/游离节点返回 null */
export function mapParentId(doc: Document, id: string): string | null {
  const e = doc.edges.find((e) => e.kind === 'mindmap' && e.toNode === id);
  return e ? e.fromNode : null;
}

/** 导图子节点 id（按边数组顺序） */
export function mapChildIds(doc: Document, id: string): string[] {
  return doc.edges.filter((e) => e.kind === 'mindmap' && e.fromNode === id).map((e) => e.toNode);
}

/** 升级为导图主节点：仅写入入口标记 */
export function upgradeToMapRoot(doc: Document, id: string): void {
  const n = doc.getNode(id);
  if (!n || n.mapRoot) return;
  doc.updateNode(id, { mapRoot: true }, '升级为导图主节点');
}

/** 取消导图主节点：清除标记，子树内所有 mindmap 边转为普通连线（保留连接，仅去掉导图语义） */
export function downgradeMapRoot(doc: Document, rootId: string): void {
  const root = doc.getNode(rootId);
  if (!root?.mapRoot) return;
  const ids = subtreeIds(doc, rootId);
  doc.mutate('取消导图主节点', () => {
    root.mapRoot = false;
    for (const e of doc.edges) {
      if (e.kind === 'mindmap' && ids.has(e.fromNode)) delete e.kind;
    }
  });
}

/**
 * 添加子节点（Tab）：文本框落在父节点右侧新一层，纵向排在现有子节点的最下方；
 * 容器归属、文字样式继承父节点。仅导图成员（主节点或 mindmap 边端点）可加子节点。
 * 返回新节点 id，由调用方选中并进入编辑。
 */
export function addMapChild(doc: Document, parentId: string, style: MapNodeStyle): string | null {
  const parent = doc.getNode(parentId);
  if (!parent || !isMapMember(doc, parentId)) return null;
  let bottom: number | null = null;
  for (const cid of mapChildIds(doc, parentId)) {
    const k = doc.getNode(cid);
    if (k) bottom = bottom === null ? k.y + k.height : Math.max(bottom, k.y + k.height);
  }
  const node = Document.newNode({
    type: 'text',
    x: Math.round(parent.x + parent.width + MAP_LEVEL_GAP),
    y: Math.round(bottom !== null ? bottom + MAP_SIBLING_GAP : parent.y + parent.height / 2 - MAP_NODE_H / 2),
    width: MAP_NODE_W,
    height: MAP_NODE_H,
    text: '',
    containerId: parent.containerId ?? null,
    hAlign: 'center',
    fontSize: style.fontSize ?? parent.fontSize ?? 16,
    fontFamily: style.fontFamily ?? parent.fontFamily,
    fontWeight: style.fontWeight ?? parent.fontWeight,
    color: style.color ?? parent.color,
    ...inheritBorder(parent),
  });
  doc.mutate('添加子节点', () => {
    doc.nodes.push(node);
    doc.edges.push({ id: uid('e'), fromNode: parentId, toNode: node.id, kind: 'mindmap' });
    doc.reindex();
  });
  return node.id;
}

/**
 * 添加同级节点（Enter）：文本框落在参考节点正下方，容器归属、样式与框形继承参考节点。
 * 参考节点没有导图父节点（是主节点或游离节点）时返回 null —— 主节点应按 Tab 添加子节点。
 */
export function addMapSibling(doc: Document, nodeId: string, style: MapNodeStyle): string | null {
  const ref = doc.getNode(nodeId);
  if (!ref) return null;
  const parentId = mapParentId(doc, nodeId);
  if (!parentId) return null;
  const node = Document.newNode({
    type: 'text',
    x: Math.round(ref.x),
    y: Math.round(ref.y + ref.height + MAP_SIBLING_GAP),
    width: ref.width,
    height: ref.height,
    text: '',
    containerId: ref.containerId ?? null,
    hAlign: 'center',
    fontSize: style.fontSize ?? ref.fontSize ?? 16,
    fontFamily: style.fontFamily ?? ref.fontFamily,
    fontWeight: style.fontWeight ?? ref.fontWeight,
    color: style.color ?? ref.color,
    ...inheritBorder(ref),
  });
  doc.mutate('添加同级节点', () => {
    doc.nodes.push(node);
    doc.edges.push({ id: uid('e'), fromNode: parentId, toNode: node.id, kind: 'mindmap' });
    doc.reindex();
  });
  return node.id;
}

/** 子树成员（沿 mindmap 边向下收集，防环） */
function subtreeIds(doc: Document, rootId: string): Set<string> {
  const ids = new Set<string>([rootId]);
  const queue = [rootId];
  while (queue.length) {
    const id = queue.shift()!;
    for (const cid of mapChildIds(doc, id)) {
      if (!ids.has(cid)) {
        ids.add(cid);
        queue.push(cid);
      }
    }
  }
  return ids;
}
