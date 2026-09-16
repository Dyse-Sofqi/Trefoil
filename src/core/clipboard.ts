/** 内部剪贴板：跨白板复制/粘贴（复用 JSON Canvas 序列化保证兼容） */
import type { Document } from './Document';
import { parseDoc, serializeDoc } from '../data/jsonCanvas';
import type { CanvasDoc, CanvasEdge, CanvasNode } from './types';
import { uid } from './id';
import { unionRect, type Rect } from './geometry';

export class Clipboard {
  private data: CanvasDoc | null = null;

  isEmpty(): boolean {
    return !this.data || this.data.nodes.length === 0;
  }

  copy(doc: Document): void {
    const ids = doc.expandSelectionToGroups(doc.selection);
    const nodes = doc.nodes.filter((n) => ids.has(n.id));
    if (!nodes.length) return;
    const idSet = new Set(nodes.map((n) => n.id));
    const edges = doc.edges.filter((e) => idSet.has(e.fromNode) && idSet.has(e.toNode));
    // 存储为相对坐标（首节点为原点），粘贴时偏移
    const minX = Math.min(...nodes.map((n) => n.x));
    const minY = Math.min(...nodes.map((n) => n.y));
    const shifted: CanvasNode[] = nodes.map((n) => ({ ...n, x: n.x - minX, y: n.y - minY }));
    this.data = { nodes: shifted, edges: edges.map((e) => ({ ...e })) };
  }

  cut(doc: Document): void {
    this.copy(doc);
    doc.removeNodes([...doc.selection]);
  }

  /** 当前剪贴板内容（深拷贝，用于写入系统剪贴板） */
  snapshot(): CanvasDoc | null {
    if (!this.data) return null;
    return {
      nodes: this.data.nodes.map((n) => ({ ...n })),
      edges: this.data.edges.map((e) => ({ ...e })),
    };
  }

  /** 粘贴：id 重映射 + 位置偏移，返回新选中的节点 id；at 指定绝对基准点（原位复制用） */
  paste(doc: Document, offset = 24, at?: { x: number; y: number }): string[] {
    return this.pasteData(doc, this.data, offset, at);
  }

  /** 粘贴外部数据（如系统剪贴板里带标记的画布元素） */
  pasteData(doc: Document, data: CanvasDoc | null, offset = 24, at?: { x: number; y: number }): string[] {
    if (!data || !data.nodes.length) return [];
    const idMap = new Map<string, string>();
    for (const n of data.nodes) idMap.set(n.id, uid('n'));
    const ox = at ? at.x : offset;
    const oy = at ? at.y : offset;
    const nodes: CanvasNode[] = data.nodes.map((n) => ({
      ...n,
      id: idMap.get(n.id)!,
      x: n.x + ox,
      y: n.y + oy,
      containerId: n.containerId && idMap.has(n.containerId) ? idMap.get(n.containerId)! : null,
      groupId: n.groupId ? uid('g') : null,
    }));
    const edges: CanvasEdge[] = data.edges.map((e) => ({
      ...e,
      id: uid('e'),
      fromNode: idMap.get(e.fromNode) ?? '',
      toNode: idMap.get(e.toNode) ?? '',
    })).filter((e) => e.fromNode && e.toNode);
    doc.addNodes(nodes, edges, true);
    return nodes.map((n) => n.id);
  }

  /** 原位复制当前选中（含组与内部连线），不动剪贴板内容，返回新节点 id */
  duplicate(doc: Document): string[] {
    const ids = doc.expandSelectionToGroups(doc.selection);
    const nodes = doc.nodes.filter((n) => ids.has(n.id));
    if (!nodes.length) return [];
    const minX = Math.min(...nodes.map((n) => n.x));
    const minY = Math.min(...nodes.map((n) => n.y));
    const prev = this.data;
    this.copy(doc);
    const newIds = this.paste(doc, 0, { x: minX, y: minY });
    this.data = prev;
    return newIds;
  }

  /** 组合选中的自由元素为容器（相对坐标转换由序列化层负责） */
  static composeIntoContainer(doc: Document, ids: string[]): string | null {
    const nodes = ids.map((id) => doc.getNode(id)).filter((n): n is CanvasNode => !!n && n.type !== 'trefoil/container');
    if (nodes.length === 0) return null;
    let box: Rect | null = null;
    for (const n of nodes) box = unionRect(box, { x: n.x, y: n.y, width: n.width, height: n.height });
    if (!box) return null;
    const containerId = uid('c');
    doc.mutate('组合为容器', () => {
      doc.nodes.push({
        id: containerId,
        type: 'trefoil/container',
        x: box!.x - 32,
        y: box!.y - 32,
        width: box!.width + 64,
        height: box!.height + 64,
      });
      for (const n of nodes) {
        n.containerId = containerId;
      }
      doc.reindex();
    });
    return containerId;
  }

  /** 拆解容器为自由元素 */
  static decomposeContainer(doc: Document, containerId: string): string[] {
    const container = doc.getNode(containerId);
    if (!container || container.type !== 'trefoil/container') return [];
    const children = doc.containerChildren(containerId).map((n) => n.id);
    doc.mutate('拆解容器', () => {
      for (const id of children) {
        const n = doc.getNode(id);
        if (n) {
          n.containerId = null;
        }
      }
      doc.nodes = doc.nodes.filter((n) => n.id !== containerId);
      doc.edges = doc.edges.filter((e) => e.fromNode !== containerId && e.toNode !== containerId);
      doc.reindex();
      doc.selection.clear();
      for (const id of children) doc.selection.add(id);
      doc.events.emit('selection', undefined);
    });
    return children;
  }
}

// 独立导出：组合/拆解（积木式交互）
export const composeIntoContainer = Clipboard.composeIntoContainer.bind(Clipboard);
export const decomposeContainer = Clipboard.decomposeContainer.bind(Clipboard);
