/**
 * 应用组合根：装配 数据层(Document) / 历史层(History) / 渲染引擎(Engine) / 工具系统(ToolManager)，
 * 通过宿主适配器(H hostAdapter)实现持久化。Svelte 组件只与此类及 ui.svelte 状态通信。
 */
import { Document } from '../core/Document';
import { History } from '../core/History';
import { effectiveBackground, mergeSettings, remapThemeDefaultColors, textBorderDefaults, textStyleDefaults, type BackgroundSettings, type TrefoilSettings, type ViewMode } from '../core/defaults';
import { parseDoc, serializeDoc } from '../data/jsonCanvas';
import { Engine, type PickResult } from '../engine/Engine';
import type { Palette } from '../engine/palette';
import { resolveThemedPalette } from '../engine/palette';
import { autoTextHeight, autoTextWidth } from '../engine/textMeasure';
import { ToolManager, cursorForTool } from '../tools/ToolManager';
import { applyCursor } from './cursor';
import type { ToolCtx } from '../tools/types';
import { SelectTool } from '../tools/SelectTool';
import { ShapeTool, PolylineTool, TextTool } from '../tools/ShapeTool';
import { LaserTool, EraserTool } from '../tools/AnnotationTools';
import { PanTool } from '../tools/PanTool';
import { Clipboard, composeIntoContainer, decomposeContainer } from '../core/clipboard';
import { writeNodesToSystemClipboard } from '../core/systemClipboard';
import { computeArrange, arrangeTargets, resolveRingCenter, type ArrangeParams } from '../core/arrange';
import {
  addMapChild,
  addMapSibling,
  downgradeMapRoot as clearMapRoot,
  upgradeToMapRoot,
  type MapNodeStyle,
} from '../core/mindmap';
import { exportPng, exportSvg } from '../exporter';
import { bezierPath, inferSides, mindmapEdgeCurve, nodeRect, normalizeRotation, sideAnchor, type Rect } from '../core/geometry';
import { arrowCurve, cubicMidpoint, polylineMidpoint } from '../core/arrowLink';
import type { HostAdapter, DroppedImages } from './host';
import { buildContextMenu } from './contextMenu';
import { bumpRev, closeContextMenu, settings as uiSettings, ui, updateStatus } from './ui.svelte';
import { canRotate, type CanvasEdge, type CanvasNode } from '../core/types';
import { extensionForFile, pastedImageName } from '../core/attachment';
import { isImageFileDrag } from '../core/dragDrop';

/** 粘贴文本元素的行间距（世界 px） */
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
  /** 主题适配后的画布背景设置（Engine 构造与主题切换使用） */
  background!: BackgroundSettings;
  /** 画布宿主元素：既是 Konva Stage 的容器，也是读取宿主 CSS 变量（调色板）的根 */
  private hostEl: HTMLElement | null = null;
  /** 上一次应用的主题形态（dark/light）：检测翻转以同步元素默认色 */
  private appliedKind: 'dark' | 'light' | null = null;

  // 计时器句柄：统一走 window.setTimeout（Obsidian 弹窗窗口兼容），返回 DOM 的 number 而非 NodeJS.Timeout
  private saveTimer: number | null = null;
  private persistTimer: number | null = null;
  private styleCommitTimer: number | null = null;
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
    this.hostEl = container;
    this.resolveThemePalette();
    this.appliedKind = /theme-dark/.test(document.body.className) ? 'dark' : this.settings.theme === 'dark' ? 'dark' : 'light';
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
    this.engine = new Engine(host, this.doc, this.palette, this.background, this.settings.laser, resolveImageUrl);
    // 视口变化 → 状态栏缩放 + 编辑覆盖层跟随
    this.engine.onViewportChange = () => {
      ui.vpRev++;
      ui.labelEdit = null; // 关系描述编辑框挂在屏幕坐标上，视口变化即关闭
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
      beginLabelEdit: (kind, id) => this.beginLabelEdit(kind, id),
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
      setCursor: (c) => applyCursor(this.engine.stage.container(), c),
      toast: (msg) => this.adapter.toast?.(msg),
      onViewportChanged: () => updateStatus({ zoom: this.engine.vp.scale }),
      mapAddChild: (id) => this.addMapChildTo(id),
      mapAddSibling: (id) => this.addMapSiblingOf(id),
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
      // 选择变化 → 立即刷新覆盖层（选中框 / 线类端点手柄）；
      // 否则程序化选中（右键菜单、面板按钮等）后手柄要到下一次指针抬起才出现
      this.engine.applyOverlay();
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
    // 宽高都贴合内容：宽度取最宽行（超上限才折行），高度按该宽度重排
    const width = autoTextWidth(text, n.fontSize ?? 16, n.fontFamily ?? 'system-ui, sans-serif', n.fontWeight ?? 400);
    const height = autoTextHeight(text, width, n.fontSize ?? 16, n.fontFamily ?? 'system-ui, sans-serif', n.fontWeight ?? 400);
    this.doc.updateNode(nodeId, { text, width, height }, '编辑文本');
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
      ...textBorderDefaults(this.settings.shape),
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
   * 每行宽高贴合内容（超上限折行），多行左对齐堆叠，便于连续粘贴成的清单。
   */
  pasteTextAsNodes(text: string, at?: { x: number; y: number }): number {
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trimEnd())
      .filter((l) => l.trim().length > 0);
    if (!lines.length) return 0;
    const style = textStyleDefaults(this.settings.text);
    const boxes = lines.map((line) => {
      const width = autoTextWidth(line, style.fontSize, style.fontFamily, style.fontWeight);
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
      const node = Document.newNode({
        type: 'text',
        x: left,
        y,
        width: b.width,
        height: b.height,
        text: b.line,
        ...style,
        ...textBorderDefaults(this.settings.shape),
      });
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
    if (this.styleCommitTimer) window.clearTimeout(this.styleCommitTimer);
    this.styleCommitTimer = window.setTimeout(() => {
      this.styleCommitTimer = null;
      this.doc.commitStyle();
    }, 300);
  }

  /**
   * 一次性设置选中元素的旋转角（度）：重置按钮等离散操作。
   * 只作用于可旋转元素（块状），线类与容器会被自动过滤。
   */
  setSelectionRotation(deg: number, label = '旋转'): void {
    if (![...this.doc.selection].some((id) => { const n = this.doc.getNode(id); return n && canRotate(n); })) return;
    // 先结清进行中的样式会话：否则旋转的撤销记录会和样式会话的记录交叠
    this.commitSelectionStyle();
    this.updateSelectionProps({ rotation: normalizeRotation(deg) }, label);
  }

  /**
   * 连续调整旋转角（面板数字框输入中）：实时生效，停顿后合并为一条撤销记录。
   * 输入过程中不归一 —— 打 "270" 的中途不该被改写成 "-90"，归一留给 commitSelectionRotation。
   */
  liveSelectionRotation(deg: number): void {
    if (!this.doc.selection.size) return;
    this.liveSelectionProps({ rotation: deg }, '旋转');
  }

  /** 结束旋转输入（数字框失焦 / 回车）：按归一化角度落盘，并与进行中的样式会话合并为一条撤销记录 */
  commitSelectionRotation(deg: number): void {
    const nodes = [...this.doc.selection]
      .map((id) => this.doc.getNode(id))
      .filter((n): n is CanvasNode => !!n && canRotate(n));
    if (!nodes.length) return;
    const d = normalizeRotation(deg);
    if (nodes.some((n) => Math.abs((n.rotation ?? 0) - d) > 1e-6)) {
      // 这次归一化修正发生在样式会话窗口内 → commitStyle 会把它并进同一条撤销记录
      this.doc.live(() => {
        for (const n of nodes) n.rotation = d;
      });
    }
    this.commitSelectionStyle();
  }

  /** 连续调整的多目标版本：每个节点各自的补丁（多选改字号时框高各异） */
  liveSelectionPatches(patches: Map<string, Partial<CanvasNode>>, label = '修改样式'): void {
    if (!patches.size) return;
    this.doc.liveStyleMulti(patches, label);
    if (this.styleCommitTimer) window.clearTimeout(this.styleCommitTimer);
    this.styleCommitTimer = window.setTimeout(() => {
      this.styleCommitTimer = null;
      this.doc.commitStyle();
    }, 300);
  }

  /** 立即结束连续调整（滑块松手时不用等计时） */
  commitSelectionStyle(): void {
    if (this.styleCommitTimer) {
      window.clearTimeout(this.styleCommitTimer);
      this.styleCommitTimer = null;
    }
    this.doc.commitStyle();
  }

  // ---------- 多选排列 ----------

  /** 进行中的排列会话：起点快照（撤销 / 重作用），停顿后经 commitPositions 合并为一条撤销记录 */
  private arrangeStarts = new Map<string, { x: number; y: number }>();
  private arrangeTimer: number | null = null;
  /** 环形排列的圆心：进入环形模式时按当前布局拟合，之后沿用（见 resolveRingCenter） */
  private arrangeRingCenter: { x: number; y: number } | null = null;
  /** 上次环形排列的参与元素签名与半径：判断元素是否还待在原来的环上 */
  private ringFitIds = '';
  private ringFitRadius = 0;

  /**
   * 多选排列（横向 / 纵向 / 矩阵 / 环形）：实时生效，停顿 300ms 后合并为一条撤销记录。
   * 连续调用（拖动间距滑块）基于当前几何重算 —— 排列保持锚点（包围盒左上角或几何中心）不动、
   * 尺寸不变、顺序稳定，对自身幂等，无需保存会话前的基准几何。
   * 环形例外：圆心在会话内固定，否则元素上环后包围盒中心变化会让圆心跟着漂移。
   */
  arrangeSelection(p: ArrangeParams): void {
    const nodes = this.doc.selectedNodes();
    if (nodes.length < 2) return;
    if (!this.arrangeStarts.size) {
      for (const n of nodes) this.arrangeStarts.set(n.id, { x: n.x, y: n.y });
    }
    // 容器与其子节点同时被选中时，子节点跟随容器平移；线类节点（箭头/直线）也不占排位
    // —— 它们的包围盒不表示形状，绑定箭头的位置由两端元素推导（参与排位会把真实元素挤乱）
    const independent = arrangeTargets(nodes);
    const boxes = independent.map((n) => ({ id: n.id, x: n.x, y: n.y, width: n.width, height: n.height }));
    let params = p;
    if (p.mode === 'ring' && p.ring) {
      // 圆心：进入环形模式时按当前布局拟合；同一批元素还待在原环上就沿用，
      // 不重算 —— 元素上环后包围盒中心与环心不再重合（元素尺寸不同时必有偏移），
      // 每次点击都重算会把半径越推越大、环整体漂移。
      const sig = independent.map((n) => n.id).sort().join(',');
      this.arrangeRingCenter = resolveRingCenter(boxes, {
        radius: this.ringFitRadius,
        prevCenter: this.arrangeRingCenter,
        sameSet: sig === this.ringFitIds,
      });
      this.ringFitIds = sig;
      this.ringFitRadius = p.ring.radius;
      params = { ...p, ring: { ...p.ring, center: this.arrangeRingCenter ?? undefined } };
    } else {
      this.arrangeRingCenter = null;
      this.ringFitIds = '';
      this.ringFitRadius = 0;
    }
    const positions = computeArrange(boxes, params);
    this.doc.live(() => {
      for (const n of nodes) {
        const target = positions.get(n.id);
        if (target) {
          n.x = target.x;
          n.y = target.y;
          continue;
        }
        // 跟随者：累加选中链上各祖先容器的位移（嵌套容器逐级传递）
        let dx = 0;
        let dy = 0;
        let pid = n.containerId;
        const guard = new Set<string>();
        while (pid && !guard.has(pid)) {
          guard.add(pid);
          const parent = this.doc.getNode(pid);
          if (!parent) break;
          const pp = positions.get(parent.id);
          if (pp) {
            dx += pp.x - parent.x;
            dy += pp.y - parent.y;
          }
          pid = parent.containerId;
        }
        n.x += dx;
        n.y += dy;
      }
    });
    if (this.arrangeTimer) window.clearTimeout(this.arrangeTimer);
    this.arrangeTimer = window.setTimeout(() => {
      this.arrangeTimer = null;
      this.arrangeCommit();
    }, 300);
  }

  /** 结束排列会话：落一条撤销记录；与起点一致（无实际位移）不入栈 */
  private arrangeCommit(): void {
    const starts = this.arrangeStarts;
    this.arrangeStarts = new Map();
    if (!starts.size) return;
    let moved = false;
    for (const [id, s] of starts) {
      const n = this.doc.getNode(id);
      if (!n || n.x !== s.x || n.y !== s.y) {
        moved = true;
        break;
      }
    }
    if (moved) this.doc.commitPositions('排列', starts);
  }

  deleteSelection(): void {
    // 选中集合里可能含连线 id：节点/连线分别删除（删除容器时其子节点转为自由元素）
    const nodeIds = [...this.doc.selection].filter((id) => this.doc.getNode(id));
    const edgeIds = [...this.doc.selection].filter((id) => this.doc.getEdge(id));
    if (nodeIds.length) this.doc.removeNodes(nodeIds);
    if (edgeIds.length) this.doc.removeEdges(edgeIds);
    ui.labelEdit = null;
  }

  /**
   * 双击线段：在曲线/折线中点内联编辑关系描述（连线写 label 标准字段，线类形状写扩展字段）。
   * 编辑框挂在 ui.labelEdit，由 App 层渲染；视口变化时关闭（位置会失随）。
   */
  beginLabelEdit(kind: 'edge' | 'node', id: string): void {
    const mid = this.labelMidpoint(kind, id);
    if (!mid) return;
    const p = this.engine.worldToScreen(mid.x, mid.y);
    const current = kind === 'edge' ? this.doc.getEdge(id)?.label : this.doc.getNode(id)?.label;
    ui.propsOpen = true;
    ui.labelEdit = { kind, id, x: p.x, y: p.y, value: current ?? '' };
  }

  /** 提交关系描述（空串 = 清除） */
  commitLabelEdit(value: string): void {
    const le = ui.labelEdit;
    ui.labelEdit = null;
    if (!le) return;
    const v = value.trim();
    const cur = le.kind === 'edge' ? this.doc.getEdge(le.id)?.label ?? '' : this.doc.getNode(le.id)?.label ?? '';
    if (v === cur.trim()) return;
    if (le.kind === 'edge') this.doc.updateEdge(le.id, { label: v || undefined }, '编辑关系描述');
    else this.doc.updateNode(le.id, { label: v || undefined }, '编辑关系描述');
  }

  /** 线段中点（世界坐标）：双端绑定曲线取贝塞尔中点，折线按弧长取中点 */
  private labelMidpoint(kind: 'edge' | 'node', id: string): { x: number; y: number } | null {
    if (kind === 'edge') {
      const e = this.doc.getEdge(id);
      if (!e) return null;
      const from = this.doc.getNode(e.fromNode);
      const to = this.doc.getNode(e.toNode);
      if (!from || !to) return null;
      const flat = this.edgeCurve(e, nodeRect(from), nodeRect(to));
      return flat ? cubicMidpoint(flat) : null;
    }
    const n = this.doc.getNode(id);
    if (!n) return null;
    if (n.fromNode && n.toNode) {
      const f = this.doc.getNode(n.fromNode);
      const t = this.doc.getNode(n.toNode);
      if (f && t) {
        const curve = arrowCurve(n, (x) => this.doc.getNode(x));
        if (curve) return cubicMidpoint(curve.path);
      }
    }
    const pts = (n.points ?? [
      [0, 0],
      [n.width, n.height],
    ]) as Array<number[] | { x: number; y: number }>;
    return polylineMidpoint(pts.map((p) => (Array.isArray(p) ? { x: n.x + p[0]!, y: n.y + p[1]! } : p)));
  }

  private edgeCurve(e: { fromNode: string; toNode: string; fromSide?: string; toSide?: string; kind?: string }, from: Rect, to: Rect): number[] | null {
    if (e.kind === 'mindmap') return mindmapEdgeCurve(from, to).path.flatMap((p) => [p.x, p.y]);
    const sides = inferSides(from, to);
    const fromSide = (e.fromSide ?? sides.fromSide) as 'top' | 'bottom' | 'left' | 'right';
    const toSide = (e.toSide ?? sides.toSide) as 'top' | 'bottom' | 'left' | 'right';
    return bezierPath(sideAnchor(from, fromSide), fromSide, sideAnchor(to, toSide), toSide).path.flatMap((p) => [p.x, p.y]);
  }

  // ---------- 导图 ----------

  /** 升级为导图主节点（属性面板 / 右键菜单入口） */
  upgradeMapRoot(nodeId: string): void {
    upgradeToMapRoot(this.doc, nodeId);
  }

  /** 取消导图主节点：清除标记，子树内导图连线转为普通连线 */
  downgradeMapRoot(nodeId: string): void {
    clearMapRoot(this.doc, nodeId);
  }

  /** Tab：给选中的导图节点添加子节点（文本框）并进入编辑；返回是否已处理 */
  addMapChildTo(nodeId: string): boolean {
    const id = addMapChild(this.doc, nodeId, this.mapStyleFor(nodeId));
    if (!id) return false;
    this.doc.setSelection([id]);
    this.beginPathTextEdit(id);
    return true;
  }

  /** Enter：给选中的导图子节点添加同级节点（文本框）并进入编辑；返回是否已处理 */
  addMapSiblingOf(nodeId: string): boolean {
    const id = addMapSibling(this.doc, nodeId, this.mapStyleFor(nodeId));
    if (!id) return false;
    this.doc.setSelection([id]);
    this.beginPathTextEdit(id);
    return true;
  }

  /** 导图新节点的文字样式：继承参考节点，缺省回落到全局文本默认 */
  private mapStyleFor(nodeId: string): MapNodeStyle {
    const n = this.doc.getNode(nodeId);
    return {
      fontSize: n?.fontSize ?? this.settings.text.fontSize,
      fontFamily: n?.fontFamily ?? this.settings.text.fontFamily,
      fontWeight: n?.fontWeight ?? this.settings.text.fontWeight,
      color: n?.color ?? this.settings.text.color,
    };
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
    if (this.persistTimer) window.clearTimeout(this.persistTimer);
    this.persistTimer = window.setTimeout(() => {
      this.persistTimer = null;
      void this.adapter.saveDefaults?.(JSON.parse(JSON.stringify(this.settings)));
    }, 800);
  }

  private scheduleSave(): void {
    if (this.saveTimer) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.flushSave(), 400);
  }

  async flushSave(): Promise<void> {
    if (this.saveTimer) {
      window.clearTimeout(this.saveTimer);
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
    this.applyTheme();
  }

  /** 当前生效的日夜形态：强制模式直接取，跟随系统按宿主 body 主题类判断 */
  themeKind(): 'dark' | 'light' {
    if (this.settings.theme === 'dark') return 'dark';
    if (this.settings.theme === 'light') return 'light';
    return /theme-dark/.test(document.body.className) ? 'dark' : 'light';
  }

  /**
   * 解析当前主题下的调色板与画布背景。两者必须同源：`palette.canvasBg` 是「垫底色」——
   * 关系描述小牌、容器名片、空心箭头内芯、缩略图底、缺图占位等都拿它去遮住身后的线条/点阵，
   * 必须等于背景层真正绘制出来的颜色（`background.color`，见 BackgroundRenderer.draw）。
   * 取值与理由见 resolveThemedPalette。
   */
  private resolveThemePalette(): void {
    this.background = effectiveBackground(this.settings.background, this.themeKind());
    this.palette = resolveThemedPalette(this.settings.theme, this.background, this.hostEl ?? undefined);
  }

  /** 按设置的主题模式解析调色板并整体重绘；主题翻转时同步元素默认色 */
  applyTheme(): void {
    this.resolveThemePalette();
    const kind = this.themeKind();
    if (this.appliedKind && this.appliedKind !== kind) {
      // 沿用「日间默认色」的文字/描边随主题翻转（用户自定义色不参与），实时生效不进撤销栈
      const to = kind;
      this.doc.live(() => remapThemeDefaultColors(this.doc.nodes, to));
    }
    this.appliedKind = kind;
    this.engine.retheme(this.palette);
    this.applyBackground();
    // 调色板已替换：通知 UI 侧重绘（缩略图等直接读取 palette 的派生渲染）
    bumpRev();
  }

  /** 画布背景/点阵/网格随主题适配（仅默认值切换，自定义颜色保留），推送到渲染层 */
  applyBackground(): void {
    this.background = effectiveBackground(this.settings.background, this.themeKind());
    this.engine.background.setSettings(this.background);
    this.engine.setCanvasBgColor(this.background.color);
  }

  /** 状态栏主题切换入口：夜间 → 跟随系统 → 日间 → 夜间 */
  cycleTheme(): void {
    this.settings.theme = this.settings.theme === 'dark' ? 'system' : this.settings.theme === 'system' ? 'light' : 'dark';
    this.applyTheme();
    this.persistSettingsSoon();
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
    if (this.arrangeTimer) {
      window.clearTimeout(this.arrangeTimer);
      this.arrangeTimer = null;
    }
    this.arrangeCommit();
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
