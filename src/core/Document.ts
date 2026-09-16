/**
 * 核心业务层 —— 白板文档模型。
 * - 内存中所有节点使用绝对坐标；容器子节点仅在文件序列化时转为相对坐标。
 * - 数组顺序 = Z-index（靠后在上）。
 * - mutate()：结构化修改 + 自动生成撤销命令（快照式）。
 * - live()：拖拽过程中的实时修改，不进撤销栈（结束后用 commitPositions 落栈）。
 */
import { Emitter } from './events';
import type { CanvasDoc, CanvasEdge, CanvasNode } from './types';
import { uid } from './id';
import type { Command } from './History';
import { freezeBoundArrows } from './arrowLink';

export interface DocEvents {
  changed: { live: boolean };
  selection: void;
  /** 恢复外部文件内容时触发 */
  reloaded: void;
}

export interface DocSnapshot {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

/** 缩放会话的起始尺寸记录（含可选翻转状态与线类折点，供撤销/重做还原） */
export interface ResizeStartRecord {
  x: number;
  y: number;
  width: number;
  height: number;
  flipX?: boolean;
  flipY?: boolean;
  /** 线类节点（直线/箭头/折线）的折点快照：端点拖拽/缩放后 bbox 与 points 必须一起回滚 */
  points?: number[][];
  /** 端点磁吸绑定快照：拖绑定端会解除绑定，撤销时需一并还原 */
  fromNode?: string | null;
  toNode?: string | null;
}

export class Document {
  nodes: CanvasNode[] = [];
  edges: CanvasEdge[] = [];
  selection = new Set<string>();

  readonly events = new Emitter<DocEvents>();

  private nodeIndex = new Map<string, CanvasNode>();
  private edgeIndex = new Map<string, CanvasEdge>();
  /** 历史管理器由外部注入（CanvasApp 持有） */
  history?: { push(cmd: Command): void };
  /** 进行中的连续样式调整（滑块/滚轮），见 liveStyle/commitStyle */
  private styleSession: { label: string; keys: (keyof CanvasNode)[]; before: Map<string, Partial<CanvasNode>> } | null = null;

  // ---------- 索引与查询 ----------

  reindex(): void {
    this.nodeIndex.clear();
    this.edgeIndex.clear();
    for (const n of this.nodes) this.nodeIndex.set(n.id, n);
    for (const e of this.edges) this.edgeIndex.set(e.id, e);
  }

  getNode(id: string): CanvasNode | undefined {
    return this.nodeIndex.get(id);
  }

  getEdge(id: string): CanvasEdge | undefined {
    return this.edgeIndex.get(id);
  }

  /** 与给定节点集合相连的所有边 */
  edgesTouching(nodeIds: Iterable<string>): CanvasEdge[] {
    const set = nodeIds instanceof Set ? nodeIds : new Set(nodeIds);
    return this.edges.filter((e) => set.has(e.fromNode) || set.has(e.toNode));
  }

  /** 容器的直接子节点 */
  containerChildren(containerId: string): CanvasNode[] {
    return this.nodes.filter((n) => n.containerId === containerId);
  }

  /** 展开 selection 到整组（绑定组整体操作） */
  expandSelectionToGroups(ids: Iterable<string>): Set<string> {
    const out = new Set<string>();
    for (const id of ids) {
      out.add(id);
      const gid = this.getNode(id)?.groupId;
      if (gid) {
        for (const n of this.nodes) if (n.groupId === gid) out.add(n.id);
      }
    }
    return out;
  }

  // ---------- 替换/加载 ----------

  replaceDoc(doc: CanvasDoc): void {
    this.nodes = doc.nodes;
    this.edges = doc.edges;
    this.reindex();
    this.selection.clear();
    this.events.emit('changed', { live: false });
    this.events.emit('reloaded', undefined);
  }

  snapshot(): DocSnapshot {
    return { nodes: this.nodes.map((n) => ({ ...n })), edges: this.edges.map((e) => ({ ...e })) };
  }

  private applySnapshot(s: DocSnapshot): void {
    this.nodes = s.nodes.map((n) => ({ ...n }));
    this.edges = s.edges.map((e) => ({ ...e }));
    this.reindex();
    for (const id of [...this.selection]) if (!this.nodeIndex.has(id)) this.selection.delete(id);
    this.events.emit('changed', { live: false });
  }

  // ---------- 变更 API ----------

  /** 结构化修改：自动生成快照式撤销命令 */
  mutate<T>(label: string, fn: () => T): T {
    const before = this.snapshot();
    const result = fn();
    const after = this.snapshot();
    if (JSON.stringify(before) === JSON.stringify(after)) return result;
    const doc = this;
    this.history?.push({
      label,
      undo: () => doc.applySnapshot(before),
      redo: () => doc.applySnapshot(after),
    });
    this.events.emit('changed', { live: false });
    return result;
  }

  /** 实时修改（拖拽中）：只发 changed{live:true}，不入撤销栈 */
  live(fn: () => void): void {
    fn();
    this.events.emit('changed', { live: true });
  }

  /**
   * 连续样式调整（滑块拖动 / 滚轮微调）：实时生效，commitStyle() 时合并为一条撤销记录。
   * 记录只包含本次涉及的节点与字段，不会连带回滚期间发生的其它改动；
   * 同时避免每走一步压一条撤销记录（滚轮连滚会瞬间冲掉整个撤销栈）。
   */
  liveStyle(patch: Partial<CanvasNode>, label: string): void {
    const ids = [...this.selection];
    if (!ids.length) return;
    const patches = new Map<string, Partial<CanvasNode>>();
    for (const id of ids) patches.set(id, patch);
    this.liveStyleMulti(patches, label);
  }

  /** liveStyle 的多目标版本：每个节点各有自己的补丁（如多选改字号时各自的框高不同） */
  liveStyleMulti(patches: Map<string, Partial<CanvasNode>>, label: string): void {
    if (!patches.size) return;
    const keys = [...new Set([...patches.values()].flatMap((p) => Object.keys(p)))] as (keyof CanvasNode)[];
    if (!keys.length) return;
    if (!this.styleSession) {
      const before = new Map<string, Partial<CanvasNode>>();
      for (const id of patches.keys()) {
        const n = this.getNode(id);
        if (n) before.set(id, pickProps(n, keys));
      }
      if (!before.size) return;
      this.styleSession = { label, keys, before };
    }
    this.live(() => {
      for (const [id, patch] of patches) {
        const n = this.getNode(id);
        if (n) Object.assign(n, patch);
      }
    });
  }

  /** 结束连续样式调整；期间没有实际变化则不入撤销栈 */
  commitStyle(): void {
    const s = this.styleSession;
    if (!s) return;
    this.styleSession = null;
    const after = new Map<string, Partial<CanvasNode>>();
    let changed = false;
    for (const [id, before] of s.before) {
      const n = this.getNode(id);
      const now = n ? pickProps(n, s.keys) : before;
      after.set(id, now);
      if (!sameProps(before, now)) changed = true;
    }
    if (!changed) return;
    const doc = this;
    this.history?.push({
      label: s.label,
      undo: () => doc.applyProps(s.before),
      redo: () => doc.applyProps(after),
    });
  }

  private applyProps(props: Map<string, Partial<CanvasNode>>): void {
    for (const [id, p] of props) {
      const n = this.nodeIndex.get(id);
      if (n) Object.assign(n, p);
    }
    this.events.emit('changed', { live: false });
  }

  /** 拖拽结束后将位移落入撤销栈（当前坐标即“后”状态）；尺寸记录可含翻转字段（缩放跨越翻转用） */
  commitPositions(
    label: string,
    start: Map<string, { x: number; y: number }>,
    resizeStart?: Map<string, ResizeStartRecord>,
  ): void {
    const starts = new Map(start);
    const sizes = resizeStart ? new Map(resizeStart) : undefined;
    if (starts.size === 0 && !sizes) return;
    this.history?.push(this.makePositionCommand(label, starts, sizes));
  }

  private makePositionCommand(
    label: string,
    starts: Map<string, { x: number; y: number }>,
    sizes?: Map<string, ResizeStartRecord>,
  ): Command {
    const doc = this;
    const end: Map<string, ResizeStartRecord> = new Map();
    for (const id of starts.keys()) {
      const n = doc.getNode(id);
      if (n) {
        end.set(id, {
          x: n.x,
          y: n.y,
          width: n.width,
          height: n.height,
          flipX: n.flipX,
          flipY: n.flipY,
          points: n.points ? n.points.map((p) => [...p]) : undefined,
          fromNode: n.fromNode,
          toNode: n.toNode,
        });
      }
    }
    return {
      label,
      undo: () =>
        doc.live(() => {
          for (const [id, s] of starts) {
            const n = doc.getNode(id);
            if (!n) continue;
            n.x = s.x;
            n.y = s.y;
            const sz = sizes?.get(id);
            if (sz) {
              n.width = sz.width;
              n.height = sz.height;
              if (sz.flipX !== undefined) n.flipX = sz.flipX;
              if (sz.flipY !== undefined) n.flipY = sz.flipY;
              if (sz.points) n.points = sz.points.map((p) => [...p]);
              if (sz.fromNode !== undefined) n.fromNode = sz.fromNode ?? undefined;
              if (sz.toNode !== undefined) n.toNode = sz.toNode ?? undefined;
            }
          }
        }),
      redo: () =>
        doc.live(() => {
          for (const [id, e] of end) {
            const n = doc.getNode(id);
            if (!n) continue;
            n.x = e.x;
            n.y = e.y;
            n.width = e.width;
            n.height = e.height;
            if (e.flipX !== undefined) n.flipX = e.flipX;
            if (e.flipY !== undefined) n.flipY = e.flipY;
            if (e.points) n.points = e.points.map((p) => [...p]);
            if (e.fromNode !== undefined) n.fromNode = e.fromNode || undefined;
            if (e.toNode !== undefined) n.toNode = e.toNode || undefined;
          }
        }),
    };
  }

  addNodes(nodes: CanvasNode[], edges: CanvasEdge[] = [], select = true): void {
    this.mutate('添加', () => {
      this.nodes.push(...nodes);
      this.edges.push(...edges);
      this.reindex();
      if (select) {
        this.selection = new Set(nodes.filter((n) => !n.containerId).map((n) => n.id));
      }
    });
  }

  removeNodes(ids: Iterable<string>): void {
    const set = new Set(ids);
    this.mutate('删除', () => {
      const removedContainers = new Set(
        this.nodes.filter((n) => set.has(n.id) && n.type === 'trefoil/container').map((n) => n.id),
      );
      // 指向被删元素的绑定箭头先冻结为普通直线（锚点固化、绑定清除）
      freezeBoundArrows(this.nodes, (id) => this.nodeIndex.get(id), set);
      this.nodes = this.nodes.filter((n) => !set.has(n.id));
      this.edges = this.edges.filter((e) => !set.has(e.fromNode) && !set.has(e.toNode));
      // 被删除容器的子节点转为自由元素
      if (removedContainers.size) {
        for (const n of this.nodes) {
          if (n.containerId && removedContainers.has(n.containerId)) {
            n.containerId = null;
          }
        }
      }
      this.reindex();
      for (const id of set) this.selection.delete(id);
    });
  }

  updateNodes(patches: Map<string, Partial<CanvasNode>>, label = '修改'): void {
    this.mutate(label, () => {
      for (const [id, patch] of patches) {
        const n = this.nodeIndex.get(id);
        if (n) Object.assign(n, patch);
      }
    });
  }

  updateNode(id: string, patch: Partial<CanvasNode>, label = '修改'): void {
    this.updateNodes(new Map([[id, patch]]), label);
  }

  addEdge(edge: CanvasEdge): void {
    this.mutate('连线', () => {
      this.edges.push(edge);
      this.reindex();
    });
  }

  removeEdges(ids: Iterable<string>): void {
    const set = new Set(ids);
    if (!set.size) return;
    this.mutate('删除连线', () => {
      this.edges = this.edges.filter((e) => !set.has(e.id));
      this.reindex();
      for (const id of set) this.selection.delete(id);
    });
  }

  /** 连线字段更新（如关系描述 label） */
  updateEdge(id: string, patch: Partial<CanvasEdge>, label = '修改连线'): void {
    this.mutate(label, () => {
      const e = this.edgeIndex.get(id);
      if (e) Object.assign(e, patch);
    });
  }

  // ---------- 图层顺序 ----------

  bringToFront(selIds: string[]): void {
    // 置于顶层：选中节点移到数组末尾
    this.mutate('置于顶层', () => {
      const selected = new Set(selIds);
      const selNodes = this.nodes.filter((n) => selected.has(n.id));
      this.nodes = [...this.nodes.filter((n) => !selected.has(n.id)), ...selNodes];
      this.reindex();
    });
  }

  sendToBack(selIds: string[]): void {
    this.mutate('置于底层', () => {
      const selected = new Set(selIds);
      const selNodes = this.nodes.filter((n) => selected.has(n.id));
      this.nodes = [...selNodes, ...this.nodes.filter((n) => !selected.has(n.id))];
      this.reindex();
    });
  }

  bringForward(selIds: string[]): void {
    this.mutate('上移一层', () => {
      const order = this.nodes;
      for (let i = order.length - 2; i >= 0; i--) {
        if (selIds.includes(order[i].id) && !selIds.includes(order[i + 1].id)) {
          [order[i], order[i + 1]] = [order[i + 1], order[i]];
        }
      }
      this.reindex();
    });
  }

  sendBackward(selIds: string[]): void {
    this.mutate('下移一层', () => {
      const order = this.nodes;
      for (let i = 1; i < order.length; i++) {
        if (selIds.includes(order[i].id) && !selIds.includes(order[i - 1].id)) {
          [order[i], order[i - 1]] = [order[i - 1], order[i]];
        }
      }
      this.reindex();
    });
  }

  // ---------- 选择 ----------

  setSelection(ids: Iterable<string>, additive = false): void {
    const next = additive ? new Set(this.selection) : new Set<string>();
    for (const id of ids) next.add(id);
    this.selection = next;
    this.events.emit('selection', undefined);
  }

  toggleSelection(id: string): void {
    if (this.selection.has(id)) this.selection.delete(id);
    else this.selection.add(id);
    this.events.emit('selection', undefined);
  }

  clearSelection(): void {
    if (this.selection.size === 0) return;
    this.selection.clear();
    this.events.emit('selection', undefined);
  }

  selectedNodes(): CanvasNode[] {
    return [...this.selection].map((id) => this.nodeIndex.get(id)!).filter(Boolean);
  }

  // ---------- 新建节点工厂 ----------

  static newNode(partial: Partial<CanvasNode> & Pick<CanvasNode, 'type'>): CanvasNode {
    return {
      id: uid('n'),
      x: 0,
      y: 0,
      width: 200,
      height: 60,
      ...partial,
    };
  }

  static newEdge(partial: Partial<CanvasEdge> & Pick<CanvasEdge, 'fromNode' | 'toNode'>): CanvasEdge {
    return {
      id: uid('e'),
      ...partial,
    };
  }
}

/** 取节点上的指定字段（连续样式调整的撤销记录只保存涉及的字段） */
function pickProps(n: CanvasNode, keys: (keyof CanvasNode)[]): Partial<CanvasNode> {
  const out: Partial<CanvasNode> = {};
  for (const k of keys) (out as Record<string, unknown>)[k as string] = n[k];
  return out;
}

function sameProps(a: Partial<CanvasNode>, b: Partial<CanvasNode>): boolean {
  for (const k of Object.keys(a) as (keyof CanvasNode)[]) {
    if (a[k] !== b[k]) return false;
  }
  return true;
}
