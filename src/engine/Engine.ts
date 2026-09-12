/**
 * 渲染引擎层：Konva 分层渲染（背景 / 内容 / 覆盖 / 镭射笔）。
 * - 视口（平移/缩放）以世界坐标 + 缩放表示；内容层通过 world 组统一变换。
 - 手动拾取（不依赖 Konva hit graph），支持容器点击穿透规则。
 * - 视口裁剪 + batchDraw，保证 1000+ 元素流畅。
 */
import Konva from 'konva';
import type { Document } from '../core/Document';
import { isContainerNode } from '../core/types';
import { rectsIntersect, unionRect, type Rect, type Vec, nodeRect, rectContains } from '../core/geometry';
import type { BackgroundSettings, LaserSettings } from '../core/defaults';
import type { Palette } from './palette';
import { NodeView, hitTestNode, type FileUrlResolver } from './NodeView';
import { EdgeView } from './EdgeView';
import { BackgroundRenderer } from './BackgroundRenderer';
import { Overlay, type OverlayState } from './Overlay';
import { LaserRenderer } from './LaserRenderer';
import { createImageCache, type ImageLoadResult } from './imageCache';
import { TextRasterCache } from './textRaster';

export interface Viewport {
  x: number;
  y: number;
  scale: number;
}

/** 缩放范围：下限保证远景仍可辨读（也避免元素数随 1/scale² 增长压垮帧率），上限留出精细对齐余量 */
export const MIN_SCALE = 0.1;
export const MAX_SCALE = 5;

export type PickResult =
  | { kind: 'node'; nodeId: string }
  | { kind: 'container-band'; containerId: string }
  | { kind: 'canvas' };

export function emptyOverlayState(): OverlayState {
  return {
    selection: [],
    handles: null,
    marquee: null,
    guides: [],
    eraserCursor: null,
    erasePreview: [],
    focus: null,
    containerHover: null,
    draft: null,
    lineDraft: null,
    edgeDraft: null,
    ports: [],
  };
}

const CONTAINER_BAND = 14;

export class Engine {
  stage: Konva.Stage;
  doc: Document;
  palette: Palette;
  vp: Viewport = { x: -100, y: -100, scale: 1 };
  layers!: { bg: Konva.Layer; content: Konva.Layer; overlay: Konva.Layer; laser: Konva.Layer };
  world!: Konva.Group;
  private edgeGroup!: Konva.Group;
  private nodeGroup!: Konva.Group;
  background!: BackgroundRenderer;
  overlay!: Overlay;
  laser!: LaserRenderer;
  nodeViews = new Map<string, NodeView>();
  edgeViews = new Map<string, EdgeView>();
  /** 橡皮擦正在擦除的节点（视觉隐藏，笔划结束时统一落撤销栈） */
  erasedIds = new Set<string>();
  focusNodeId: string | null = null;
  hoverContainerId: string | null = null;
  overlayState: OverlayState = emptyOverlayState();
  /** 编辑中的节点由覆盖层文本框负责，画布内文本隐藏 */
  editingNodeId: string | null = null;
  /** 视口变化回调（平移/缩放后触发，供编辑覆盖层跟随） */
  onViewportChange: (() => void) | null = null;

  private containerEl: HTMLElement;
  private ro: ResizeObserver | null = null;

  /** file 节点图片缓存（默认加载器 = 浏览器 <img>，宿主可覆盖） */
  private cacheApi = createImageCache({
    loadImage: (url) => loadImageElement(url),
    notify: () => this.layers?.content.batchDraw(),
    reload: (u) => this.cacheApi.clear(),
  });
  /** file 字段（库内路径）→ 图片 URL 解析（由 CanvasApp 注入宿主实现） */
  private fileUrlResolver: FileUrlResolver | null = null;
  /** 文本节点位图缓存（跨节点共享，按像素预算限量；见 textRaster.ts） */
  private textRaster = new TextRasterCache();

  constructor(
    container: HTMLDivElement,
    doc: Document,
    palette: Palette,
    bg: BackgroundSettings,
    laserSettings: LaserSettings,
    fileUrlResolver: FileUrlResolver | null = null,
  ) {
    this.containerEl = container;
    // 数位板笔/触摸拖动默认会被浏览器接管为滚动手势（触发 pointercancel 中断笔迹），必须声明为应用自管
    container.style.touchAction = 'none';
    this.doc = doc;
    this.palette = palette;
    // 必须在首次 render 之前就位：NodeView 构造时即用它解析 file 节点 URL
    this.fileUrlResolver = fileUrlResolver;
    this.stage = new Konva.Stage({ container, width: container.clientWidth || 800, height: container.clientHeight || 600 });
    this.buildLayers(bg, laserSettings);
    doc.events.on('changed', () => this.render());
    this.observeResize();
    this.render();
  }

  /**
   * 注入 file 字段解析器（库内路径 → 可加载 URL；如 Obsidian app:// 资源地址）。
   * 同时把它挂到所有（含未来新建的）NodeView 上——NodeView 构造时即用。
   */
  setFileUrlResolver(fn: FileUrlResolver): void {
    this.fileUrlResolver = fn;
    for (const v of this.nodeViews.values()) v.setFileUrlResolver(fn);
  }

  /** 外部文件变更（重命名/删除/覆盖）后失效所有图片缓存并重建图片视图 */
  invalidateImages(): void {
    this.cacheApi.clear();
    // 重建所有 file 节点视图（URL 解析器变化时也要刷新）
    for (const n of this.doc.nodes) {
      const v = this.nodeViews.get(n.id);
      if (v && n.type === 'file') {
        v.group.destroy();
        this.nodeViews.delete(n.id);
      }
    }
    this.render();
  }

  private buildLayers(bg: BackgroundSettings, laserSettings: LaserSettings): void {
    const bgLayer = new Konva.Layer({ listening: false });
    const content = new Konva.Layer({ listening: false });
    const overlayLayer = new Konva.Layer({ listening: false });
    const laserLayer = new Konva.Layer({ listening: false });
    this.stage.add(bgLayer);
    this.stage.add(content);
    this.stage.add(laserLayer);
    this.stage.add(overlayLayer);
    this.layers = { bg: bgLayer, content, overlay: overlayLayer, laser: laserLayer };

    this.world = new Konva.Group({ listening: false });
    this.edgeGroup = new Konva.Group({ listening: false });
    this.nodeGroup = new Konva.Group({ listening: false });
    this.world.add(this.edgeGroup);
    this.world.add(this.nodeGroup);
    content.add(this.world);

    this.background = new BackgroundRenderer(bgLayer, bg);
    this.laser = new LaserRenderer(laserLayer, laserSettings);
    this.overlay = new Overlay(overlayLayer, this.palette);
  }

  private observeResize(): void {
    this.ro = new ResizeObserver(() => {
      const w = this.containerEl.clientWidth || 800;
      const h = this.containerEl.clientHeight || 600;
      this.stage.size({ width: w, height: h });
      this.background.width = w;
      this.background.height = h;
      this.background.refresh();
      this.applyOverlay();
      this.cull();
      // 容器尺寸变化也会改变可见世界范围：通知视口相关 UI（如缩略图）重绘
      this.onViewportChange?.();
    });
    this.ro.observe(this.containerEl);
    this.background.width = this.stage.width();
    this.background.height = this.stage.height();
  }

  // ---------- 坐标变换 ----------

  screenToWorld(sx: number, sy: number): Vec {
    return { x: sx / this.vp.scale + this.vp.x, y: sy / this.vp.scale + this.vp.y };
  }

  worldToScreen(wx: number, wy: number): Vec {
    return { x: (wx - this.vp.x) * this.vp.scale, y: (wy - this.vp.y) * this.vp.scale };
  }

  private syncTransform(): void {
    this.world.setAttrs({
      x: -this.vp.x * this.vp.scale,
      y: -this.vp.y * this.vp.scale,
      scaleX: this.vp.scale,
      scaleY: this.vp.scale,
    });
  }

  setViewport(vp: Viewport): void {
    this.vp = vp;
    this.syncTransform();
    this.background.vp = vp;
    this.background.refresh();
    this.cull();
    this.applyOverlay();
    this.onViewportChange?.();
  }

  zoomAt(sx: number, sy: number, factor: number): void {
    const clamped = Math.min(MAX_SCALE, Math.max(MIN_SCALE, this.vp.scale * factor));
    const world = this.screenToWorld(sx, sy);
    this.setViewport({ scale: clamped, x: world.x - sx / clamped, y: world.y - sy / clamped });
  }

  /** 将世界矩形居中显示（可选目标缩放上限） */
  centerOn(rect: Rect, maxScale = 1.2): void {
    const w = this.stage.width();
    const h = this.stage.height();
    const pad = 80;
    const fit = Math.min(w / Math.max(40, rect.width + pad * 2), h / Math.max(40, rect.height + pad * 2));
    const scale = Math.min(maxScale, Math.max(MIN_SCALE, fit));
    this.setViewport({
      scale,
      x: rect.x + rect.width / 2 - w / (2 * scale),
      y: rect.y + rect.height / 2 - h / (2 * scale),
    });
  }

  zoomToFit(): void {
    const bbox = this.contentBBox();
    if (!bbox) {
      this.setViewport({ x: -this.stage.width() / 2, y: -this.stage.height() / 2, scale: 1 });
      return;
    }
    this.centerOn(bbox, 2);
  }

  /** 缩放重置为 100%：以画布中心为锚点，视口中心保持不动（只改比例，不改变看的位置） */
  resetZoom(): void {
    this.zoomAt(this.stage.width() / 2, this.stage.height() / 2, 1 / this.vp.scale);
  }

  // ---------- 渲染同步 ----------

  render(): void {
    const doc = this.doc;
    // 节点视图同步
    for (const n of doc.nodes) {
      let v = this.nodeViews.get(n.id);
      if (!v) {
        // 解析器与文本位图缓存随构造注入：file 节点的首个视图就能解析出可加载 URL
        v = new NodeView(n, this.palette, this.cacheApi, this.fileUrlResolver, this.textRaster);
        this.nodeViews.set(n.id, v);
        this.nodeGroup.add(v.group);
      } else {
        // 视图更新：图片 URL 变化（外部文件重命名等）→ 缓存键变化，新 URL 自动重新加载
        v.update(n);
      }
    }
    for (const [id, v] of [...this.nodeViews]) {
      if (!doc.getNode(id)) {
        v.group.destroy();
        this.nodeViews.delete(id);
      }
    }
    // Z 顺序 = 数组顺序（节点组内部从 0 计数；edgeGroup 在 world 中位于 nodeGroup 之下）
    doc.nodes.forEach((n, i) => {
      const v = this.nodeViews.get(n.id);
      if (v && v.group.getZIndex() !== i) v.group.setZIndex(i);
    });

    // 边视图同步
    for (const e of doc.edges) {
      let v = this.edgeViews.get(e.id);
      if (!v) {
        v = new EdgeView(this.palette);
        this.edgeViews.set(e.id, v);
        this.edgeGroup.add(v.group);
      }
      const from = doc.getNode(e.fromNode);
      const to = doc.getNode(e.toNode);
      v.update(e, from ? nodeRect(from) : null, to ? nodeRect(to) : null);
    }
    for (const [id, v] of [...this.edgeViews]) {
      if (!doc.getEdge(id)) {
        v.group.destroy();
        this.edgeViews.delete(id);
      }
    }

    this.cull();
    this.applyOverlay();
    this.layers.content.batchDraw();
  }

  isNodeHidden(id: string): boolean {
    if (this.erasedIds.has(id)) return true;
    if (this.editingNodeId === id) return true;
    const n = this.doc.getNode(id);
    if (!n) return true;
    if (this.doc.isHiddenByCollapse(n)) return true;
    // 容器折叠隐藏全部内部节点
    if (n.containerId) {
      const c = this.doc.getNode(n.containerId);
      if (c?.collapsed) return true;
    }
    return false;
  }

  /** 视口裁剪：仅渲染可见区域 */
  cull(): void {
    const viewRect: Rect = {
      x: this.vp.x - 200,
      y: this.vp.y - 200,
      width: this.stage.width() / this.vp.scale + 400,
      height: this.stage.height() / this.vp.scale + 400,
    };
    const visibleIds = new Set<string>();
    for (const n of this.doc.nodes) {
      const v = this.nodeViews.get(n.id);
      if (!v) continue;
      v.setScale(this.vp.scale);
      const hidden = this.isNodeHidden(n.id) || !rectsIntersect(nodeRect(n), viewRect);
      v.setHidden(hidden);
      if (!hidden) visibleIds.add(n.id);
    }
    for (const [id, v] of this.edgeViews) {
      const e = this.doc.getEdge(id);
      if (!e) continue;
      const vis = visibleIds.has(e.fromNode) && visibleIds.has(e.toNode);
      if (v.group.visible() !== vis) v.group.visible(vis);
    }
  }

  // ---------- 拾取 ----------

  pick(wx: number, wy: number): PickResult {
    const nodes = this.doc.nodes;
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      if (isContainerNode(n)) continue;
      if (this.isNodeHidden(n.id)) continue;
      if (hitTestNode(n, wx, wy, this.palette)) return { kind: 'node', nodeId: n.id };
    }
    // 容器边带（内部空白穿透）+ 左上角名片
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      if (!isContainerNode(n)) continue;
      if (this.isNodeHidden(n.id)) continue;
      const view = this.nodeViews.get(n.id);
      if (inContainerBand(n, wx, wy) || view?.hitsPlate(wx, wy)) {
        return { kind: 'container-band', containerId: n.id };
      }
    }
    return { kind: 'canvas' };
  }

  /** 容器内部命中（含空白），用于双击等交互 */
  containerAt(wx: number, wy: number): string | null {
    const nodes = this.doc.nodes;
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      if (!isContainerNode(n) || this.isNodeHidden(n.id)) continue;
      if (rectContains(nodeRect(n), { x: wx, y: wy })) return n.id;
    }
    return null;
  }

  // ---------- 覆盖层 ----------

  applyOverlay(): void {
    const st = this.overlayState;
    // 编辑中的节点隐藏选中框/手柄，保证编辑态与渲染态视觉一致
    const selected = this.doc.selectedNodes().filter((n) => !this.isNodeHidden(n.id) && n.id !== this.editingNodeId);
    st.selection = selected.map((n) => nodeRect(n));
    st.handles = null;
    if (st.selection.length === 1 && !st.erasePreview.length && selected[0]) {
      // 文本框高度由内容自适应：拖拽上下无法改变高度，不提供上下中点手柄
      st.handles = selected[0].type === 'text' ? { ...st.selection[0], hideVertical: true } : st.selection[0];
    }
    if (this.focusNodeId) {
      const f = this.doc.getNode(this.focusNodeId);
      st.focus = f ? nodeRect(f) : null;
      if (!f) this.focusNodeId = null;
    } else {
      st.focus = null;
    }
    st.containerHover = this.hoverContainerId
      ? (() => {
          const c = this.doc.getNode(this.hoverContainerId!);
          return c ? nodeRect(c) : null;
        })()
      : null;
    this.overlay.draw(st, this.vp, this.stage.width(), this.stage.height());
  }

  // ---------- 视图辅助 ----------

  contentBBox(includeLaser = false): Rect | null {
    let box: Rect | null = null;
    for (const n of this.doc.nodes) {
      if (this.erasedIds.has(n.id)) continue;
      box = unionRect(box, nodeRect(n));
    }
    if (includeLaser) {
      const lb = this.laser.bounds();
      if (lb) {
        box = unionRect(box, this.screenToWorldWorldRect(lb));
      }
    }
    return box;
  }

  private screenToWorldWorldRect(r: Rect): Rect {
    const a = this.screenToWorld(r.x, r.y);
    const b = this.screenToWorld(r.x + r.width, r.y + r.height);
    return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
  }

  focusNode(id: string | null): void {
    this.focusNodeId = id;
    if (id) {
      const n = this.doc.getNode(id);
      if (n) this.centerOn(nodeRect(n), 1.1);
    }
    this.applyOverlay();
  }

  /** 主题变化：整体重建视图着色 */
  retheme(palette: Palette): void {
    this.palette = palette;
    this.overlay.setPalette(palette);
    // 文本颜色随主题变，旧位图全部作废
    this.textRaster.clear();
    for (const [id, v] of [...this.nodeViews]) {
      v.group.destroy();
      this.nodeViews.delete(id);
    }
    for (const [id, v] of [...this.edgeViews]) {
      v.group.destroy();
      this.edgeViews.delete(id);
    }
    this.render();
  }

  destroy(): void {
    this.ro?.disconnect();
    this.textRaster.clear();
    this.laser.destroy();
    this.stage.destroy();
  }
}

function inContainerBand(n: Rect & { width: number; height: number }, wx: number, wy: number): boolean {
  const band = CONTAINER_BAND;
  const inside = wx >= n.x && wx <= n.x + n.width && wy >= n.y && wy <= n.y + n.height;
  if (!inside) return false;
  const nearLeft = wx <= n.x + band;
  const nearRight = wx >= n.x + n.width - band;
  const nearTop = wy <= n.y + band;
  const nearBottom = wy >= n.y + n.height - band;
  return nearLeft || nearRight || nearTop || nearBottom;
}

/** 浏览器默认图片加载器：<img> + onload/onerror。SVG 会污染导出画布，按缺失处理。 */
function loadImageElement(url: string): Promise<ImageLoadResult> {
  if (/\.svg(\?|$)/i.test(url)) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = /^https?:/i.test(url) ? 'anonymous' : null;
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}
