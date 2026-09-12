/** 节点渲染视图：数据 → Konva 场景图。视觉字段变化时重建，位置尺寸变化时就地更新。 */
import Konva from 'konva';
import type { CanvasNode } from '../core/types';
import { rectContains, type Rect } from '../core/geometry';
import { isContainerNode, isFileNode, isLineLike, isShapeNode, isTextNode } from '../core/types';
import type { Palette } from './palette';
import { resolveColor } from './palette';
import { fontString, fontVerticalMetrics, layoutText } from './textMeasure';
import { ImageView } from './ImageView';
import type { ImageCache as ImageCacheApi } from './imageCache';
import { rawContext } from './rawContext';
import type { TextRasterCache } from './textRaster';

/** NodeView 实例序号：位图缓存按节点 id 索引，重建后的新实例必须与旧实例的缓存区分开 */
let NODE_VIEW_SEQ = 0;

/** 文本内边距（世界单位）：渲染与编辑覆盖层共用 */
export const TEXT_PADDING = 6;

/** 容器左上角名片（名称牌）：字号与相对容器上沿的间距 */
export const CONTAINER_PLATE_FONT = 12;
export const CONTAINER_PLATE_GAP = 4;
/** 「已折叠」小标签字号 */
const CONTAINER_TAG_FONT = 11;

/**
 * 文本 LOD 阈值（屏幕上的字号，px）：小于此值字形已无法辨读，
 * 改为绘制占位色块 —— 绘制开销约为逐字绘制的 1/4，深缩放时大量文本节点才不至于拖垮帧率。
 */
const TEXT_BLOCK_MIN_PX = 4.5;
/** 占位块透明度 */
const TEXT_BLOCK_ALPHA = 0.16;

/** 预排版的文本片段（重建时算好，绘制时零分配） */
interface TextSegDraw {
  text: string;
  x: number;
  w: number;
  font: string;
  fill: string;
  strike: boolean;
}

interface TextLineDraw {
  y: number;
  segs: TextSegDraw[];
}

interface TextDraw {
  fontSize: number;
  /** 行距（字号 × 1.5）：字形在行距槽内居中，行距不会全部堆到文字下方 */
  lineHeight: number;
  /** 竖直微调：抵消墨迹中心与 middle 基线的偏差（使文字视觉居中） */
  shift: number;
  width: number;
  height: number;
  hasText: boolean;
  color: string;
  lines: TextLineDraw[];
}

/** 影响渲染结果的字段（按节点类型区分）：逐字段比较代替序列化整条数据 */
const TEXT_VISUAL_FIELDS: readonly string[] = ['text', 'width', 'height', 'fontFamily', 'fontSize', 'fontWeight', 'color', 'hAlign'];
const CONTAINER_VISUAL_FIELDS: readonly string[] = ['text', 'width', 'height', 'collapsed'];
const FILE_VISUAL_FIELDS: readonly string[] = ['file', 'width', 'height'];
// 注意：points 按数组引用比较，调用方需整体替换数组（tools 均如此），不得原地 push
const SHAPE_VISUAL_FIELDS: readonly string[] = ['shape', 'fill', 'stroke', 'strokeSize', 'width', 'height', 'points', 'flipX', 'flipY'];

/** file 字段（库内路径）→ 可加载 URL；返回 null 表示宿主判定文件确实缺失 */
export type FileUrlResolver = (raw: string) => string | null | undefined;

export class NodeView {
  group: Konva.Group;
  node: CanvasNode;
  private palette: Palette;
  /** 图片节点渲染（file 节点） */
  private imageView: ImageView | null = null;
  /** 图片 URL 解析（库内路径 → 可加载 URL），由引擎注入 */
  private engineImageResolver: FileUrlResolver | null = null;
  /** 上一次重建时的视觉字段快照（拖拽时每次重同步都要比对，避免序列化开销） */
  private snap: Record<string, unknown> = {};
  private snapFields: readonly string[] = [];
  /** rebuild 期间的内容容器（翻转变换作用在它上面） */
  private inner: Konva.Group = new Konva.Group();
  /** 文本绘制数据（仅文本节点） */
  private textDraw: TextDraw | null = null;
  /** 容器名片（Konva 标签，宽度由 Konva 按文本自适应）与它的命中矩形（节点局部坐标） */
  private plateLabel: Konva.Label | null = null;
  private plateHit: Rect | null = null;
  /** 当前视口缩放（由引擎在视口变化时同步，用于 LOD 判定；绘制时读取，无需重建） */
  private scale = 1;
  /** 文本位图缓存（引擎注入）；未注入时逐帧矢量绘制 */
  private textRaster: TextRasterCache | null;
  /** 本实例的唯一年号 */
  private readonly uid = ++NODE_VIEW_SEQ;
  /** 文本视觉状态修订号：rebuild 时自增，作为位图缓存 key 的一部分 */
  private textRev = 0;

  constructor(
    node: CanvasNode,
    palette: Palette,
    private imageCache: ImageCacheApi,
    fileUrlResolver: FileUrlResolver | null = null,
    textRaster: TextRasterCache | null = null,
  ) {
    this.node = node;
    this.palette = palette;
    // 解析器必须在首次 rebuild 之前就位：否则 file 节点会拿库内原始相对路径去加载，直接判为缺失
    this.engineImageResolver = fileUrlResolver;
    this.textRaster = textRaster;
    this.group = new Konva.Group({ id: node.id, x: node.x, y: node.y, listening: false });
    this.rebuild();
  }

  private visualFieldsOf(n: CanvasNode): readonly string[] {
    if (isTextNode(n)) return TEXT_VISUAL_FIELDS;
    if (isFileNode(n)) return FILE_VISUAL_FIELDS;
    if (isContainerNode(n)) return CONTAINER_VISUAL_FIELDS;
    return SHAPE_VISUAL_FIELDS;
  }

  private visualChanged(n: CanvasNode): boolean {
    const fields = this.visualFieldsOf(n);
    if (fields !== this.snapFields) return true;
    const src = n as unknown as Record<string, unknown>;
    let changed = false;
    for (const f of fields) {
      const v = src[f];
      if (this.snap[f] !== v) {
        changed = true;
        this.snap[f] = v;
      }
    }
    return changed;
  }

  private snapshot(n: CanvasNode): void {
    this.snapFields = this.visualFieldsOf(n);
    const src = n as unknown as Record<string, unknown>;
    const snap: Record<string, unknown> = {};
    for (const f of this.snapFields) snap[f] = src[f];
    this.snap = snap;
  }

  update(node: CanvasNode): void {
    this.node = node;
    if (this.visualChanged(node)) {
      this.rebuild();
    }
    const g = this.group;
    const opacity = node.opacity ?? 1;
    // 拖拽时绝大多数节点只是被重新同步一次，位置/透明度未变就不碰 Konva 属性
    if (g.x() !== node.x || g.y() !== node.y || g.opacity() !== opacity) {
      g.setAttrs({ x: node.x, y: node.y, opacity });
    }
  }

  /** 视口缩放同步：LOD 在绘制时读取，跨阈值时无需重建场景图 */
  setScale(scale: number): void {
    this.scale = scale;
    this.plateLabel?.visible(scale * CONTAINER_PLATE_FONT >= TEXT_BLOCK_MIN_PX);
  }

  setHidden(hidden: boolean): void {
    if (this.group.visible() === !hidden) return;
    this.group.visible(!hidden);
  }

  private rebuild(): void {
    this.snapshot(this.node);
    this.textRev++;
    this.group.destroyChildren();
    this.textDraw = null;
    this.plateLabel = null;
    this.plateHit = null;
    this.imageView = null;
    const n = this.node;
    // 形状/图片翻转：子元素装入内层组，缩放 -1 并平移回包围盒内（镜像直观且无损）
    const flip = (isShapeNode(n) || isFileNode(n)) && (n.flipX || n.flipY);
    const inner = new Konva.Group();
    this.inner = inner;
    this.group.add(inner);
    if (isTextNode(n)) this.buildText(n);
    else if (isFileNode(n)) this.buildFile(n);
    else if (isContainerNode(n)) this.buildContainer(n);
    else if (isShapeNode(n)) this.buildShape(n);
    if (flip) {
      if (n.flipX) {
        inner.scaleX(-1);
        inner.x(n.width);
      }
      if (n.flipY) {
        inner.scaleY(-1);
        inner.y(n.height);
      }
    }
    this.group.setAttrs({ x: n.x, y: n.y, opacity: n.opacity ?? 1 });
  }

  // ---------- 文本（内联 Markdown 富文本） ----------

  /**
   * 整个文本节点用单个 Konva.Shape 绘制（而不是每个片段一个 Konva.Text）：
   * 富文本片段数量与 Konva 逐形状开销（变换、save/restore、属性读取）在此都是主要成本，
   * 合批到一个 sceneFunc 后视觉效果不变、绘制耗时约为原来的 1/4。
   */
  private buildText(n: CanvasNode): void {
    const fontSize = n.fontSize ?? 16;
    const family = n.fontFamily ?? 'system-ui, sans-serif';
    const baseWeight = n.fontWeight ?? 400;
    const layout = layoutText(n.text ?? '', Math.max(20, n.width - TEXT_PADDING * 2), fontSize, family, baseWeight);
    const color = resolveColor(n.color, this.palette) ?? this.palette.text;
    const align = n.hAlign ?? 'left';
    // 垂直方向恒为居中：文本框高度本就贴合内容（autoTextHeight），上下留白对称
    const startY = Math.max(TEXT_PADDING, (n.height - layout.height) / 2);

    const lines: TextLineDraw[] = [];
    let y = startY;
    for (const line of layout.lines) {
      const lineX =
        align === 'left' || align === 'justify'
          ? TEXT_PADDING
          : align === 'right'
            ? n.width - TEXT_PADDING - line.width
            : (n.width - line.width) / 2;
      const segs: TextSegDraw[] = [];
      for (const seg of line.segs) {
        segs.push({
          text: seg.text,
          x: lineX + seg.x,
          w: seg.w,
          font: fontString(seg.run, fontSize, family, baseWeight),
          fill: seg.run.code ? this.palette.accent : color,
          strike: !!seg.run.strike,
        });
      }
      lines.push({ y, segs });
      y += layout.lineHeight;
    }

    // 墨迹中心相对 middle 基线的偏移：抵消后文字才在行距槽里视觉居中
    const baseFont = fontString({ text: '', bold: false, italic: false, code: false, strike: false }, fontSize, family, baseWeight);
    const shift = -fontVerticalMetrics(baseFont).inkCenterOffset;

    this.textDraw = {
      fontSize,
      lineHeight: layout.lineHeight,
      shift,
      width: Math.max(1, n.width),
      height: Math.max(1, n.height),
      hasText: (n.text ?? '').trim().length > 0,
      color,
      lines,
    };
    this.inner.add(
      new Konva.Shape({
        listening: false,
        sceneFunc: (ctx) => this.drawText(ctx),
      }),
    );
  }

  private drawText(ctx: Konva.Context): void {
    const d = this.textDraw;
    if (!d || !d.hasText) return;
    const g = rawContext(ctx);
    // 深缩放：字形已不可辨读，绘制占位块（比位图更省，且视觉上没差别）
    if (d.fontSize * this.scale < TEXT_BLOCK_MIN_PX) {
      g.save();
      g.globalAlpha = TEXT_BLOCK_ALPHA * this.group.opacity();
      g.fillStyle = d.color;
      g.fillRect(0, 0, d.width, d.height);
      g.restore();
      return;
    }
    // 位图优先：命中缓存时每帧只剩一次 drawImage，节点数再多也不怕
    const raster = this.textRaster?.get(
      this.node.id,
      `${this.uid}:${this.textRev}`,
      this.scale * this.drawRatio(g),
      d.width,
      d.height,
      (target, k) => this.paintText(target, k, d),
    );
    if (raster) {
      g.drawImage(raster.canvas, 0, 0, raster.canvas.width / raster.scale, raster.canvas.height / raster.scale);
      return;
    }
    this.paintText(g, 1, d);
  }

  /**
   * 当前绘制目标的像素比。不能直接用 window.devicePixelRatio：导出走的是 Konva 的临时画布 +
   * 更高像素比，按屏幕比例光栅化会让导出图上的文字发虚。用「画布宽度 / 舞台 CSS 宽度」反推最可靠。
   */
  private drawRatio(g: CanvasRenderingContext2D): number {
    const stageW = this.group.getStage()?.width() ?? 0;
    if (stageW > 0 && g.canvas.width > 0) {
      const r = g.canvas.width / stageW;
      if (Number.isFinite(r) && r > 0) return r;
    }
    return typeof window !== 'undefined' && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
  }

  /** 把预排版的文本画到任意 2D 上下文；k = 光栅倍率（1 = 按世界坐标直绘） */
  private paintText(g: CanvasRenderingContext2D, k: number, d: TextDraw): void {
    g.save();
    if (k !== 1) g.scale(k, k);
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    const half = d.lineHeight / 2 + d.shift; // 墨迹居中对齐行距槽（此前按字号取半，行距全落在文字下方）
    // 同一节点内绝大多数片段共用字体与颜色，只在变化时赋值 —— 设置 font 会触发字体解析，不便宜
    let font = '';
    let fill = '';
    for (const line of d.lines) {
      for (const seg of line.segs) {
        if (!seg.text) continue;
        if (seg.font !== font) g.font = font = seg.font;
        if (seg.fill !== fill) g.fillStyle = fill = seg.fill;
        g.fillText(seg.text, seg.x, line.y + half);
      }
      for (const seg of line.segs) {
        if (!seg.strike) continue;
        // 删除线挂在字形中心下方（与旧几何相对关系一致）
        const sy = line.y + d.lineHeight / 2 + d.shift + d.fontSize * 0.22;
        g.beginPath();
        g.strokeStyle = seg.fill;
        g.lineWidth = 1;
        g.moveTo(seg.x, sy);
        g.lineTo(seg.x + seg.w, sy);
        g.stroke();
      }
    }
    g.restore();
  }

  // ---------- 图片 / 附件（file 节点） ----------

  private buildFile(n: CanvasNode): void {
    const url = this.resolveFileUrl(n.file ?? '');
    const label = (n.file ?? '').split('/').pop() ?? '';
    const shape = new Konva.Shape({ listening: false });
    this.imageView = new ImageView(shape, this.imageCache, this.palette);
    // 图片就绪（含失败）后重绘本节点所在层
    this.imageView.setData({ url, width: Math.max(1, n.width), height: Math.max(1, n.height), label });
    this.inner.add(shape);
  }

  /** 引擎注入的 file 字段解析器（库内路径 → 可加载 URL）；解析器变化后 file 节点需按新 URL 重建 */
  setFileUrlResolver(fn: FileUrlResolver): void {
    if (this.engineImageResolver === fn) return;
    this.engineImageResolver = fn;
    if (isFileNode(this.node)) this.rebuild();
  }

  /**
   * file 字段（库内路径或 https/data/blob URL）→ 可直接加载的 URL。
   * 宿主未注入解析器时按原始值处理（开发测试台）；宿主解析器返回 null 表示文件确实缺失，
   * 返回空串让画布直接画缺失占位，避免再对无效路径发一次注定失败的请求。
   */
  private resolveFileUrl(raw: string): string {
    const resolver = this.engineImageResolver;
    if (!resolver) return raw;
    return resolver(raw) ?? '';
  }

  private buildContainer(n: CanvasNode): void {
    this.inner.add(
      new Konva.Rect({
        x: 0,
        y: 0,
        width: n.width,
        height: n.height,
        stroke: this.palette.containerBorder,
        strokeWidth: 1.5,
        dash: [7, 5],
        fillEnabled: false,
        opacity: 0.85,
        listening: false,
      }),
    );
    // 左上角名片：显示容器名称（未命名时给灰色占位），宽度由 Konva 按文本自适应；
    // 名片区域可点选/拖动整个容器，双击可重命名（见 SelectTool / Engine.pick）。
    const name = (n.text ?? '').trim();
    const label = new Konva.Label({ listening: false });
    label.add(
      new Konva.Tag({
        fill: this.palette.canvasBg,
        stroke: this.palette.containerBorder,
        strokeWidth: 1,
        cornerRadius: 4,
      }),
    );
    label.add(
      new Konva.Text({
        text: name || '容器',
        fontSize: CONTAINER_PLATE_FONT,
        padding: 5,
        fontFamily: 'system-ui, sans-serif',
        fill: name ? this.palette.text : this.palette.textMuted,
      }),
    );
    const labelW = label.getWidth();
    const labelH = label.getHeight();
    const plateY = -CONTAINER_PLATE_GAP - labelH;
    label.y(plateY);
    let hitW = labelW;
    if (n.collapsed) {
      const tag = new Konva.Label({ x: labelW + 6, listening: false });
      tag.add(new Konva.Tag({ fill: this.palette.accent, cornerRadius: 4 }));
      tag.add(new Konva.Text({ text: '已折叠', fontSize: CONTAINER_TAG_FONT, padding: 4, fill: '#ffffff', fontFamily: 'system-ui, sans-serif' }));
      tag.y(plateY + Math.max(0, (labelH - tag.getHeight()) / 2));
      this.inner.add(tag);
      hitW += 6 + tag.getWidth();
    }
    this.inner.add(label);
    this.plateLabel = label;
    this.plateHit = { x: 0, y: plateY, width: hitW, height: labelH };
    label.visible(this.scale * CONTAINER_PLATE_FONT >= TEXT_BLOCK_MIN_PX);
  }

  /** 世界坐标点是否落在容器名片上（含折叠标记） */
  hitsPlate(wx: number, wy: number): boolean {
    const p = this.plateHit;
    return !!p && rectContains({ x: this.node.x + p.x, y: this.node.y + p.y, width: p.width, height: p.height }, { x: wx, y: wy });
  }

  // ---------- 形状 ----------

  private buildShape(n: CanvasNode): void {
    const fill = resolveColor(n.fill, this.palette) ?? null;
    const stroke = resolveColor(n.stroke, this.palette) ?? this.palette.nodeStroke;
    const sw = n.strokeSize ?? 2;
    const w = Math.max(1, n.width);
    const h = Math.max(1, n.height);
    const common = { fill: fill ?? undefined, stroke, strokeWidth: sw, listening: false };

    switch (n.shape) {
      case 'ellipse':
        this.inner.add(
          new Konva.Ellipse({
            x: w / 2,
            y: h / 2,
            radiusX: w / 2,
            radiusY: h / 2,
            ...common,
          }),
        );
        break;
      case 'diamond':
        this.inner.add(
          new Konva.Line({
            closed: true,
            points: [w / 2, 0, w, h / 2, w / 2, h, 0, h / 2],
            ...common,
          }),
        );
        break;
      case 'triangle':
        this.inner.add(
          new Konva.Line({
            closed: true,
            points: [w / 2, 0, w, h, 0, h],
            ...common,
          }),
        );
        break;
      case 'line':
      case 'polyline':
        this.inner.add(
          new Konva.Line({
            points: flatPoints(pointsOf(n)),
            stroke,
            strokeWidth: sw,
            lineCap: 'round',
            lineJoin: 'round',
            listening: false,
          }),
        );
        break;
      case 'arrow':
        this.buildArrow(n, stroke, sw);
        break;
      case 'rect':
      default:
        this.inner.add(new Konva.Rect({ x: 0, y: 0, width: w, height: h, ...common }));
        break;
    }
  }

  private buildArrow(n: CanvasNode, stroke: string, sw: number): void {
    const pts = pointsOf(n);
    this.inner.add(
      new Konva.Line({
        points: flatPoints(pts),
        stroke,
        strokeWidth: sw,
        lineCap: 'round',
        lineJoin: 'round',
        listening: false,
      }),
    );
    // 箭头头部
    if (pts.length >= 2) {
      const [x1, y1] = pts[pts.length - 2];
      const [x2, y2] = pts[pts.length - 1];
      this.inner.add(
        new Konva.Line({
          closed: true,
          points: arrowHeadPoints({ x: x1, y: y1 }, { x: x2, y: y2 }, sw),
          fill: stroke,
          listening: false,
        }),
      );
    }
  }
}

export function pointsOf(n: CanvasNode): number[][] {
  if (n.points && n.points.length >= 2) return n.points;
  return [
    [0, 0],
    [n.width, n.height],
  ];
}

function flatPoints(pts: number[][]): number[] {
  const out: number[] = [];
  for (const [x, y] of pts) {
    out.push(x, y);
  }
  return out;
}

/** 箭头头部三角（世界/屏幕坐标通用），供渲染与绘制预览共用 */
export function arrowHeadPoints(from: { x: number; y: number }, to: { x: number; y: number }, sw: number): number[] {
  const ang = Math.atan2(to.y - from.y, to.x - from.x);
  const len = Math.max(10, sw * 3.5);
  const spread = 0.42;
  return [
    to.x,
    to.y,
    to.x - len * Math.cos(ang - spread),
    to.y - len * Math.sin(ang - spread),
    to.x - len * Math.cos(ang + spread),
    to.y - len * Math.sin(ang + spread),
  ];
}

/** 判断世界坐标点是否命中节点（用于手动拾取） */
export function hitTestNode(n: CanvasNode, wx: number, wy: number, palette: Palette): boolean {
  const tol = 4;
  if (wx < n.x - tol || wx > n.x + n.width + tol || wy < n.y - tol || wy > n.y + n.height + tol) {
    return false;
  }
  if (!isLineLike(n)) return true;
  // 线类：精确到线段距离
  const pts = pointsOf(n).map(([px, py]) => ({ x: n.x + px, y: n.y + py }));
  const maxDist = Math.max(8, (n.strokeSize ?? 2) * 2);
  for (let i = 0; i < pts.length - 1; i++) {
    if (segDist({ x: wx, y: wy }, pts[i], pts[i + 1]) <= maxDist) return true;
  }
  return false;
}

function segDist(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
