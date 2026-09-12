/**
 * 应用组合根：装配 数据层(Document) / 历史层(History) / 渲染引擎(Engine) / 工具系统(ToolManager)，
 * 通过宿主适配器(H hostAdapter)实现持久化。Svelte 组件只与此类及 ui.svelte 状态通信。
 */
import { Document } from '../core/Document';
import { History } from '../core/History';
import { mergeSettings, textStyleDefaults, type TrefoilSettings, type ViewMode } from '../core/defaults';
import { parseDoc, serializeDoc } from '../data/jsonCanvas';
import { Engine, type PickResult } from '../engine/Engine';
import type { Palette } from '../engine/palette';
import { readPalette } from '../engine/palette';
import { autoTextHeight, layoutText } from '../engine/textMeasure';
import { TEXT_PADDING } from '../engine/NodeView';
import { ToolManager, cursorForTool } from '../tools/ToolManager';
import type { ToolCtx } from '../tools/types';
import { SelectTool } from '../tools/SelectTool';
import { ShapeTool, PolylineTool, TextTool } from '../tools/ShapeTool';
import { LaserTool, EraserTool } from '../tools/AnnotationTools';
import { PanTool } from '../tools/PanTool';
import { Clipboard, composeIntoContainer, decomposeContainer } from '../core/clipboard';
import { writeNodesToSystemClipboard } from '../core/systemClipboard';
import { addChildNode, buildLayoutInput, fitContainerToChildren, toggleCollapse } from '../core/mindmap';
import { layoutAsync } from '../workers/layoutClient';
import { exportPng, exportSvg } from '../exporter';
import type { HostAdapter, DroppedImages } from './host';
import { buildContextMenu } from './contextMenu';
import { bumpRev, closeContextMenu, settings as uiSettings, ui, updateStatus } from './ui.svelte';
import type { CanvasEdge, CanvasNode } from '../core/types';
import { extensionForFile, pastedImageName } from '../core/attachment';
import { isImageFileDrag } from '../core/dragDrop';

/** 粘贴文本元素的行宽范围与行间距（世界 px） */
const PASTE_MIN_WIDTH = 60;
const PASTE_MAX_WIDTH = 480;
const PASTE_GAP = 8;

export class CanvasApp {
  doc = new Document();
  history = new History();
  engine!: Engine;
  tools!: ToolManager;
  clipboard = new Clipboard();
  settings: TrefoilSettings;
  adapter: HostAdapter;
  palette!: Palette;

  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private styleCommitTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSaved = '';
  private disposers: (() => void)[] = [];
  private lastTool = 'select';

  private constructor(adapter: HostAdapter, initial?: Partial<TrefoilSettings>) {
    this.adapter = adapter;
    this.settings = mergeSettings(initial);
    // 以 Svelte Runes 状态为唯一数据源：面板修改实时生效，并随视图关闭/防抖持久化
    Object.assign(uiSettings, JSON.parse(JSON.stringify(this.settings)));
    this.settings = uiSettings as TrefoilSettings;
    this.history.onChanged = () => bumpRev();
  }

  static async create(container: HTMLElement, adapter: HostAdapter, initial?: Partial<TrefoilSettings>): Promise<CanvasApp> {
    const app = new CanvasApp(adapter, initial);
    await app.init(container);
    return app;
  }

  private async init(container: HTMLElement): Promise<void> {
    this.palette = this.adapter.palette?.() ?? readPalette();
    const json = await this.adapter.load();
    const parsed = json ? parseDoc(json) : { nodes: [], edges: [] };
    this.doc.nodes = parsed.nodes;
    this.doc.edges = parsed.edges;
    this.doc.reindex();
    this.doc.history = this.history;
    this.lastSaved = json ?? '';

    const host = container as HTMLDivElement;
    // file 节点（图片附件）渲染：库内路径 → 图片 URL。
    // 必须在 Engine 构造时传入——首次 render 会立刻为 file 节点解析 URL，
    // 晚一步注入会让图片先按原始相对路径加载失败、被判定为「缺失」。
    // 宿主未实现 resolveImageUrl 时传 null，NodeView 按原始值处理（开发测试台用 data/https URL）。
    const resolveImageUrl = this.adapter.resolveImageUrl?.bind(this.adapter) ?? null;
    this.engine = new Engine(host, this.doc, this.palette, this.settings.background, this.settings.laser, resolveImageUrl);
    // 视口变化 → 状态栏缩放 + 编辑覆盖层跟随
    this.engine.onViewportChange = () => {
      ui.vpRev++;
      updateStatus({ zoom: this.engine.vp.scale });
    };
    // 初始视口：内容居中
    const bbox = this.engine.contentBBox();
    if (bbox) {
      this.engine.centerOn(bbox, 1);
    } else {
      this.engine.setViewport({ x: -host.clientWidth / 2, y: -host.clientHeight / 2, scale: 1 });
    }

    const ctx: ToolCtx = {
      engine: this.engine,
      doc: this.doc,
      history: this.history,
      settings: this.settings,
      clipboard: this.clipboard,
      setTool: (id) => this.setTool(id),
      activeToolId: () => this.tools.activeId(),
      beginTextEdit: (id) => this.beginPathTextEdit(id),
      renameContainer: (id) => this.renameContainer(id),
      copySelection: (cut) => this.copySelection(cut),
      pasteText: (text, at) => this.pasteTextAsNodes(text, at),
      pasteNodes: (data, at) => this.pasteNodes(data, at),
      pasteImage: (blob, name, at) => this.pasteImageBlob(blob, name, at),
      canDropImages: (e) => this.acceptsImageDrop(e),
      dropImages: (e, at) => this.handleImageDrop(e, at),
      isEditing: () => ui.editingNodeId != null,
      openContextMenu: (info) => {
        ui.contextMenu = { sx: info.sx, sy: info.sy, items: buildContextMenu(this, info) };
      },
      setCursor: (c) => (this.engine.stage.container().style.cursor = c),
      toast: (msg) => this.adapter.toast?.(msg),
      onViewportChanged: () => updateStatus({ zoom: this.engine.vp.scale }),
    };
    this.tools = new ToolManager(this.engine.stage, ctx);
    this.tools.registerAll([
      new SelectTool(),
      new ShapeTool('rect', 'rect'),
      new ShapeTool('ellipse', 'ellipse'),
      new ShapeTool('diamond', 'diamond'),
      new ShapeTool('triangle', 'triangle'),
      new ShapeTool('arrow', 'arrow'),
      new ShapeTool('line', 'line'),
      new PolylineTool(),
      new TextTool(),
      new LaserTool(),
      new EraserTool(),
      new PanTool(),
    ]);
    this.setTool('select');

    // 数据变化 → 保存 + UI 刷新（防抖）
    this.disposers.push(
      this.doc.events.on('changed', () => {
        bumpRev();
        updateStatus({ elementCount: this.doc.nodes.length, selectionCount: this.doc.selection.size });
        this.scheduleSave();
      }),
    );
    this.disposers.push(this.doc.events.on('selection', () => {
      bumpRev();
      updateStatus({ selectionCount: this.doc.selection.size });
    }));

    // 主题变化 → 重新着色
    this.adapter.onThemeChange?.(() => this.retheme());

    updateStatus({
      zoom: this.engine.vp.scale,
      elementCount: this.doc.nodes.length,
      selectionCount: 0,
      viewMode: this.settings.viewMode,
      activeTool: 'select',
    });
    ui.ready = true;
  }

  // ---------- 工具与视图模式 ----------

  setTool(id: string): void {
    if (ui.viewMode === 'browse' && id !== 'pan') return;
    this.tools.activate(id);
    ui.activeTool = this.tools.activeId();
    if (id !== 'pan') this.lastTool = id;
  }

  setViewMode(mode: ViewMode): void {
    this.settings.viewMode = mode;
    ui.viewMode = mode;
    if (mode === 'browse') {
      this.tools.activate('pan');
      ui.activeTool = 'pan';
    } else if (mode === 'focus') {
      const sel = this.doc.selectedNodes()[0] ?? this.doc.nodes[this.doc.nodes.length - 1];
      if (sel) {
        this.engine.focusNode(sel.id);
      } else {
        this.setViewMode('normal');
        return;
      }
      this.tools.activate('pan');
      ui.activeTool = this.lastTool;
    } else {
      this.engine.focusNode(null);
      this.tools.activate(this.lastTool);
      ui.activeTool = this.lastTool;
    }
  }

  exitFocus(): void {
    if (ui.viewMode === 'focus') this.setViewMode('normal');
  }

  // ---------- 文本编辑 ----------

  beginPathTextEdit(nodeId: string): void {
    this.engine.editingNodeId = nodeId;
    ui.editingNodeId = nodeId;
    this.engine.render();
  }

  commitText(nodeId: string, text: string): void {
    const n = this.doc.getNode(nodeId);
    this.engine.editingNodeId = null;
    ui.editingNodeId = null;
    if (!n) {
      this.engine.render();
      return;
    }
    // 空内容退出编辑 → 自动删除该元素
    if (!text.trim()) {
      this.doc.removeNodes([nodeId]);
      return;
    }
    const height = autoTextHeight(text, n.width, n.fontSize ?? 16, n.fontFamily ?? 'system-ui, sans-serif', n.fontWeight ?? 400);
    this.doc.updateNode(nodeId, { text, height }, '编辑文本');
    // 文本未变化时 mutate 不发 changed 事件，仍需结束编辑态的隐藏并重渲染
    this.engine.render();
  }

  cancelText(): void {
    this.engine.editingNodeId = null;
    ui.editingNodeId = null;
    this.engine.render();
  }

  quickAddText(wx: number, wy: number): void {
    const node = Document.newNode({
      type: 'text',
      x: wx,
      y: wy - 18,
      width: 200,
      height: 36,
      text: '',
      ...textStyleDefaults(this.settings.text),
    });
    this.doc.addNodes([node]);
    this.beginPathTextEdit(node.id);
  }

  /** 复制选中元素：同时写入系统剪贴板（带元素标记），Ctrl+V 才能优先按元素粘贴 */
  copySelection(cut = false): void {
    if (cut) this.clipboard.cut(this.doc);
    else this.clipboard.copy(this.doc);
    const data = this.clipboard.snapshot();
    if (data) writeNodesToSystemClipboard(data);
  }

  /** 粘贴系统剪贴板里的画布元素（跨白板/跨会话复制用），返回新建数量 */
  pasteNodes(data: { nodes: CanvasNode[]; edges: CanvasEdge[] }, at?: { x: number; y: number }): number {
    return this.clipboard.pasteData(this.doc, data, 24, at).length;
  }

  /**
   * 粘贴系统剪贴板文本：按行拆成独立文本元素，整体居中堆叠在视口中央（一次撤销）。
   * 每行按自然宽度成框（超宽换行），多行左对齐堆叠，便于连续粘贴成的清单。
   */
  pasteTextAsNodes(text: string, at?: { x: number; y: number }): number {
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trimEnd())
      .filter((l) => l.trim().length > 0);
    if (!lines.length) return 0;
    const style = textStyleDefaults(this.settings.text);
    const boxes = lines.map((line) => {
      const natural = layoutText(line, 100000, style.fontSize, style.fontFamily, style.fontWeight).lines[0]?.width ?? 0;
      const width = Math.max(PASTE_MIN_WIDTH, Math.min(PASTE_MAX_WIDTH, Math.ceil(natural + TEXT_PADDING * 2)));
      const height = autoTextHeight(line, width, style.fontSize, style.fontFamily, style.fontWeight);
      return { line, width, height };
    });
    const blockW = Math.max(...boxes.map((b) => b.width));
    const blockH = boxes.reduce((sum, b) => sum + b.height, 0) + PASTE_GAP * (boxes.length - 1);
    // 落点：给了位置（鼠标处）就以它为整块左上角；否则整块居中于视口
    const center = this.engine.screenToWorld(this.engine.stage.width() / 2, this.engine.stage.height() / 2);
    const left = Math.round(at ? at.x : center.x - blockW / 2);
    let y = Math.round(at ? at.y : center.y - blockH / 2);
    const nodes = boxes.map((b) => {
      const node = Document.newNode({ type: 'text', x: left, y, width: b.width, height: b.height, text: b.line, ...style });
      y += b.height + PASTE_GAP;
      return node;
    });
    this.doc.addNodes(nodes);
    return nodes.length;
  }

  // ---------- 图片 / 附件（粘贴、拖放 → file 节点） ----------

  /**
   * 粘贴的图片 blob → 附件到库（遵循 Obsidian 附件目录约定）→ 新建 file 节点。
   * 落点在鼠标处；无落点时居中于视口。返回新建节点 id（失败 null）。
   */
  async pasteImageBlob(blob: Blob, fileName: string, at?: { x: number; y: number }): Promise<string | null> {
    if (!blob || blob.size === 0) return null;
    const src = await this.savePastedImage(blob, fileName);
    if (!src) return null;
    const center = this.engine.screenToWorld(this.engine.stage.width() / 2, this.engine.stage.height() / 2);
    return this.addFileNode(src, at ? { x: at.x, y: at.y } : { x: Math.round(center.x - 180), y: Math.round(center.y - 120) });
  }

  /** 粘贴图片保存：宿主按附件约定落盘；宿主不支持时内嵌 data URL（浏览器测试台）。 */
  async savePastedImage(blob: Blob, fileName: string): Promise<string | null> {
    if (this.adapter.saveAttachment) {
      return this.adapter.saveAttachment(blob, fileName);
    }
    // 浏览器回退：data URL（内存中，不落盘 —— dev 测试台专用）
    return readBlobAsDataUrl(blob).catch(() => null);
  }

  /**
   * 拖入的图片 → file 节点（水平排开）。
   * - `paths`：库内已有图片，直接建节点引用 —— 不复制文件（拖一张已在库里的图进来不该多出一份副本）；
   * - `files`：系统文件管理器拖入的新图片，按附件约定落盘后再建节点。
   * at 为第一张的落点（世界坐标）。
   */
  async dropImages(dropped: DroppedImages, at?: { x: number; y: number }): Promise<number> {
    const { paths, files } = dropped;
    if (!paths.length && !files.length) return 0;
    const center = this.engine.screenToWorld(this.engine.stage.width() / 2, this.engine.stage.height() / 2);
    let x = at ? Math.round(at.x) : Math.round(center.x - 180);
    const y = at ? Math.round(at.y) : Math.round(center.y - 120);
    const ids: string[] = [];
    const place = async (src: string | null): Promise<void> => {
      if (!src) return;
      const n = await this.addFileNode(src, { x, y });
      if (!n) return;
      ids.push(n);
      x += 240; // 批量落盘时水平排开，避免互相压住
    };
    for (const p of paths) await place(p);
    for (const f of files) await place(await this.savePastedImage(f.blob, f.fileName));
    if (ids.length) this.doc.setSelection(ids);
    return ids.length;
  }

  /**
   * 拖拽悬停时能否接管这次拖放。
   * 宿主未实现 `pickDroppedImages` 时一律返回 false —— 否则会在 dragover 阶段
   * preventDefault 掉一次自己处理不了的拖放，把它静默吞掉。
   */
  private acceptsImageDrop(e: DragEvent): boolean {
    if (!this.adapter.pickDroppedImages) return false;
    return this.adapter.canDropImages?.(e) ?? isImageFileDrag(e);
  }

  /**
   * 拖放图片到画布：宿主解析拖放来源（系统文件 / Obsidian 内部拖拽）→ 建 file 节点。
   */
  async handleImageDrop(e: DragEvent, at: { x: number; y: number }): Promise<number> {
    const pick = this.adapter.pickDroppedImages;
    if (!pick) return 0;
    try {
      const dropped = await pick.call(this.adapter, e);
      return await this.dropImages(dropped, at);
    } catch {
      this.adapter.toast?.('解析拖入的图片失败');
      return 0;
    }
  }

  /** 用库内路径/URL 新建图片节点；加载到图片后按原始宽高比成形（最大边 420）。 */
  async addFileNode(src: string, at: { x: number; y: number }): Promise<string | null> {
    const node: CanvasNode = Document.newNode({
      type: 'file',
      file: src,
      x: at.x,
      y: at.y,
      width: 360,
      height: 240,
    });
    this.doc.addNodes([node]);
    this.loadFileNodeMetrics(node);
    return node.id;
  }

  /** 异步读取图片原始尺寸 → 等比成形（最大边 420px），并回填 fileSize 供等比缩放 */
  private async loadFileNodeMetrics(node: CanvasNode): Promise<void> {
    const url = this.adapter.resolveImageUrl?.(node.file ?? '') ?? node.file ?? '';
    if (!url) return;
    try {
      const size = await probeImageSize(url);
      if (!size) return;
      const cur = this.doc.getNode(node.id);
      if (!cur || cur.file !== node.file) return; // 节点已被删/换图
      const max = 420;
      let w = size[0];
      let h = size[1];
      if (w > max || h > max) {
        const k = max / Math.max(w, h);
        w = Math.round(w * k);
        h = Math.round(h * k);
      }
      this.doc.updateNode(node.id, { width: w, height: h, fileSize: size }, '插入图片');
    } catch {
      /* 尺寸探测失败：保留默认框 */
    }
  }

  /** 翻转形状（水平/垂直）：默认作用于当前选中，可显式指定目标集合（如右键单击的元素） */
  flipSelection(axis: 'x' | 'y', ids?: string[]): void {
    const targets = ids ?? [...this.doc.selection];
    const patches = new Map<string, Partial<CanvasNode>>();
    for (const id of targets) {
      const n = this.doc.getNode(id);
      if (!n || n.type !== 'trefoil/shape') continue;
      patches.set(id, axis === 'x' ? { flipX: !n.flipX } : { flipY: !n.flipY });
    }
    if (patches.size) {
      this.doc.updateNodes(patches, axis === 'x' ? '水平翻转' : '垂直翻转');
    }
  }

  // ---------- 属性修改 ----------

  updateSelectionProps(patch: Partial<CanvasNode>, label = '修改样式'): void {
    const ids = [...this.doc.selection];
    if (!ids.length) return;
    const patches = new Map<string, Partial<CanvasNode>>();
    for (const id of ids) patches.set(id, patch);
    this.doc.updateNodes(patches, label);
  }

  /**
   * 连续调整选中项样式（滑块拖动 / 滚轮微调）：实时生效，停止后合并为一条撤销记录。
   * 每次调用都会重置计时，所以一次连续操作只留一条撤销记录。
   */
  liveSelectionProps(patch: Partial<CanvasNode>, label = '修改样式'): void {
    if (!this.doc.selection.size) return;
    this.doc.liveStyle(patch, label);
    if (this.styleCommitTimer) clearTimeout(this.styleCommitTimer);
    this.styleCommitTimer = setTimeout(() => {
      this.styleCommitTimer = null;
      this.doc.commitStyle();
    }, 300);
  }

  /** 连续调整的多目标版本：每个节点各自的补丁（多选改字号时框高各异） */
  liveSelectionPatches(patches: Map<string, Partial<CanvasNode>>, label = '修改样式'): void {
    if (!patches.size) return;
    this.doc.liveStyleMulti(patches, label);
    if (this.styleCommitTimer) clearTimeout(this.styleCommitTimer);
    this.styleCommitTimer = setTimeout(() => {
      this.styleCommitTimer = null;
      this.doc.commitStyle();
    }, 300);
  }

  /** 立即结束连续调整（滑块松手时不用等计时） */
  commitSelectionStyle(): void {
    if (this.styleCommitTimer) {
      clearTimeout(this.styleCommitTimer);
      this.styleCommitTimer = null;
    }
    this.doc.commitStyle();
  }

  deleteSelection(): void {
    const ids = new Set<string>();
    for (const id of this.doc.selection) {
      const n = this.doc.getNode(id);
      if (!n) continue;
      ids.add(id);
      if (n.containerId || n.type === 'trefoil/container') {
        const collect = (nid: string) => {
          for (const c of this.doc.nodes.filter((x) => x.treeParent === nid)) {
            ids.add(c.id);
            collect(c.id);
          }
        };
        collect(id);
      }
    }
    this.doc.removeNodes([...ids]);
  }

  // ---------- 思维导图容器 ----------

  addChildTo(containerOrNodeId: string): void {
    const n = this.doc.getNode(containerOrNodeId);
    if (!n) return;
    const containerId = n.type === 'trefoil/container' ? n.id : (n.containerId ?? null);
    const treeParent = n.type === 'trefoil/container' ? null : n.id;
    if (!containerId) return;
    const id = addChildNode(this.doc, containerId, treeParent, textStyleDefaults(this.settings.text));
    if (id) {
      this.doc.setSelection([id]);
      this.beginPathTextEdit(id);
    }
  }

  async layoutContainer(containerId: string, direction: 'horizontal' | 'vertical'): Promise<void> {
    const container = this.doc.getNode(containerId);
    if (!container) return;
    // 以容器的第一个树根（或第一个子节点）为根整理整棵树
    const children = this.doc.containerChildren(containerId);
    if (!children.length) return;
    const roots = children.filter((c) => !c.treeParent);
    const rootId = (roots[0] ?? children[0]).id;
    const input = buildLayoutInput(this.doc, rootId, direction, container.x + 60, container.y + 60);
    const positions = await layoutAsync(input);
    // 布局结果为相对 root 的绝对坐标（rootX/rootY 已含容器原点）
    this.doc.mutate('自动布局', () => {
      for (const [id, p] of Object.entries(positions)) {
        const n = this.doc.getNode(id);
        if (n) {
          n.x = p.x;
          n.y = p.y;
        }
      }
      fitContainerToChildren(this.doc, containerId);
    });
  }

  toggleContainerCollapse(containerId: string): void {
    toggleCollapse(this.doc, containerId);
  }

  /** 重命名容器：只选中该容器并聚焦属性面板的名称输入框（双击名片 / 右键菜单触发） */
  renameContainer(containerId: string): void {
    const n = this.doc.getNode(containerId);
    if (!n || n.type !== 'trefoil/container') return;
    this.doc.setSelection([containerId]);
    ui.propsOpen = true;
    ui.renameTarget = containerId;
    this.engine.applyOverlay();
  }

  // ---------- 积木化：组 / 组合拆解 ----------

  bindGroup(): void {
    const ids = [...this.doc.selection];
    if (ids.length < 2) return;
    const gid = `g${Date.now().toString(36)}`;
    this.doc.mutate('绑定组', () => {
      for (const id of ids) {
        const n = this.doc.getNode(id);
        if (n) n.groupId = gid;
      }
    });
  }

  /** 解绑这些组（一次撤销；选中项可能跨多个组） */
  unbindGroups(groupIds: Iterable<string>): void {
    const set = new Set(groupIds);
    if (!set.size) return;
    this.doc.mutate('解绑组', () => {
      for (const n of this.doc.nodes) {
        if (n.groupId && set.has(n.groupId)) n.groupId = null;
      }
    });
  }

  unbindGroup(groupId: string): void {
    this.unbindGroups([groupId]);
  }

  composeSelection(): void {
    const ids = [...this.doc.selection];
    if (ids.length < 1) return;
    const cid = composeIntoContainer(this.doc, ids);
    if (cid) this.doc.setSelection([cid, ...this.doc.containerChildren(cid).map((c) => c.id)]);
  }

  decomposeContainer(containerId: string): void {
    decomposeContainer(this.doc, containerId);
  }

  // ---------- 上下文菜单 ----------

  openContextMenuAt(sx: number, sy: number, wx: number, wy: number, pick: PickResult): void {
    ui.contextMenu = { sx, sy, items: buildContextMenu(this, { sx, sy, wx, wy, pick }) };
  }

  closeContextMenu(): void {
    closeContextMenu();
  }

  // ---------- 保存 ----------

  /** 设置面板修改后防抖持久化（宿主默认值） */
  persistSettingsSoon(): void {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      void this.adapter.saveDefaults?.(JSON.parse(JSON.stringify(this.settings)));
    }, 800);
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flushSave(), 400);
  }

  async flushSave(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    const text = serializeDoc(this.doc);
    if (text === this.lastSaved) return;
    this.lastSaved = text;
    try {
      await this.adapter.save(text);
    } catch (err) {
      console.error('[Trefoil] 保存失败', err);
      this.adapter.toast?.('保存失败：' + (err instanceof Error ? err.message : String(err)));
    }
  }

  /** 外部修改了文件 → 重新加载（保留视口） */
  reloadFrom(text: string): void {
    if (text === this.lastSaved) return;
    this.lastSaved = text;
    const vp = { ...this.engine.vp };
    const parsed = parseDoc(text);
    this.doc.replaceDoc(parsed);
    this.history.clear();
    this.engine.setViewport(vp);
  }

  retheme(): void {
    this.palette = this.adapter.palette?.() ?? readPalette();
    this.engine.retheme(this.palette);
    // 调色板已替换：通知 UI 侧重绘（缩略图等直接读取 palette 的派生渲染）
    bumpRev();
  }

  // ---------- 导出 ----------

  async exportPng(opts: { transparent: boolean; includeLaser: boolean }): Promise<void> {
    const dataUrl = exportPng(this, opts);
    if (!dataUrl) {
      this.adapter.toast?.('画布为空，无法导出');
      return;
    }
    const name = (this.adapter.fileName ?? 'trefoil') + '.png';
    if (this.adapter.saveFile) {
      await this.adapter.saveFile(name, dataUrl, 'image/png');
    } else {
      downloadDataUrl(dataUrl, name);
    }
  }

  async exportSvg(): Promise<void> {
    const svg = await exportSvg(this);
    if (!svg) {
      this.adapter.toast?.('画布为空，无法导出');
      return;
    }
    const name = (this.adapter.fileName ?? 'trefoil') + '.svg';
    if (this.adapter.saveFile) {
      await this.adapter.saveFile(name, svg, 'image/svg+xml');
    } else {
      downloadDataUrl('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg), name);
    }
  }

  // ---------- 生命周期 ----------

  destroy(): void {
    this.commitSelectionStyle();
    this.flushSave();
    for (const d of this.disposers) d();
    this.disposers = [];
    this.tools?.destroy();
    this.engine?.destroy();
  }
}

function downloadDataUrl(dataUrl: string, name: string): void {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = name;
  a.click();
}

/** 探测图片像素尺寸（World：先用 Image 元素拿 naturalWidth/Height） */
export function probeImageSize(url: string): Promise<[number, number] | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve([img.naturalWidth || img.width, img.naturalHeight || img.height]);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error('read blob failed'));
    r.readAsDataURL(blob);
  });
}

export { cursorForTool };
