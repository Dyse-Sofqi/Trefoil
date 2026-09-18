/** 节点渲染视图：数据 → Konva 场景图。视觉字段变化时重建，位置尺寸变化时就地更新。 */
import Konva from 'konva';
import type { CanvasNode } from '../core/types';
import { rectContains, rectCenter, rotatePoint, lineHitTolerance, type Rect } from '../core/geometry';
import { isContainerNode, isFileNode, isLineLike, isShapeNode, isTextNode } from '../core/types';
import { CONTAINER_DEFAULT_FILL_OPACITY, CONTAINER_DEFAULT_RADIUS } from '../core/defaults';
import type { Palette } from './palette';
import { resolveColor } from './palette';
import { arrowPaintShape } from './arrowPaint';
import { arrowCurve, cubicMidpoint, dashArray, linePolyline, polylineMidpoint, sampleCubic } from '../core/arrowLink';
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

/** 图片描述牌：字号与距图片下沿的间距（屏幕像素，随视口缩放反向缩放保持恒定） */
export const CAPTION_FONT = 12;
export const CAPTION_GAP = 6;

/** file 字段 → 默认描述（库路径 basename，去扩展名） */
export function fileCaption(file: string): string {
  return (file.split('/').pop() ?? '').replace(/\.[^.]+$/, '');
}

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

/** 文本框实体边框（border 开启时非空） */
interface TextBorder {
  color: string;
  /** 线宽（世界单位）；实际绘制时夹取到不超过框的短边 */
  width: number;
  /** 线型：solid 实线 / dashed 虚线 / dotted 点状（未知值按 solid 处理） */
  style: 'solid' | 'dashed' | 'dotted';
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
  /** 背景填充色（fill 未设置时为 null，背景透明） */
  fill: string | null;
  border: TextBorder | null;
  /** 背景/边框共用的圆角半径；实际绘制时夹取到框内可达的最大值 */
  cornerRadius: number;
}

/** 影响渲染结果的字段（按节点类型区分）：逐字段比较代替序列化整条数据 */
const TEXT_VISUAL_FIELDS: readonly string[] = [
  'text',
  'width',
  'height',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'color',
  'hAlign',
  'fill',
  'border',
  'borderStyle',
  'stroke',
  'strokeSize',
  'borderRadius',
];
const CONTAINER_VISUAL_FIELDS: readonly string[] = ['text', 'width', 'height', 'fill', 'fillOpacity', 'borderRadius'];
const FILE_VISUAL_FIELDS: readonly string[] = ['file', 'width', 'height', 'caption'];
// 注意：points 按数组引用比较，调用方需整体替换数组（tools 均如此），不得原地 push
const SHAPE_VISUAL_FIELDS: readonly string[] = ['shape', 'fill', 'stroke', 'strokeSize', 'width', 'height', 'points', 'flipX', 'flipY', 'headStyle', 'tailStyle', 'fromNode', 'toNode', 'label', 'strokeStyle'];

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
  /** 容器名片（按 1/视口缩放反向缩放的组）与内部文字标签、底色块（节点局部坐标） */
  private plateGroup: Konva.Group | null = null;
  /** 图片描述牌（同样按 1/视口缩放反向缩放，挂在图片下沿） */
  private captionGroup: Konva.Group | null = null;
  private plateTag: Konva.Tag | null = null;
  private plateSize: { width: number; height: number } | null = null;
  /** 当前视口缩放（由引擎在视口变化时同步，用于 LOD 与名片反向缩放） */
  private scale = 1;
  /** 节点变换（位置/旋转/透明度）快照 key：与上次一致时不碰 Konva 属性（避免逐帧 setAttrs） */
  private transformKey = '';
  /** 文本位图缓存（引擎注入）；未注入时逐帧矢量绘制 */
  private textRaster: TextRasterCache | null;
  /** 本实例的唯一年号 */
  private readonly uid = ++NODE_VIEW_SEQ;
  /** 文本视觉状态修订号：rebuild 时自增，作为位图缓存 key 的一部分 */
  private textRev = 0;
  /** 双端绑定的贝塞尔路径（世界坐标扁平数组，由 Engine 在渲染时传入）；无绑定为 null */
  private curve: number[] | null = null;
  private curveKey = '';

  constructor(
    node: CanvasNode,
    palette: Palette,
    private imageCache: ImageCacheApi,
    fileUrlResolver: FileUrlResolver | null = null,
    textRaster: TextRasterCache | null = null,
    private getPlateBg: (() => string) | null = null,
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

  update(node: CanvasNode, opts: { curve?: number[] | null } = {}): void {
    this.node = node;
    // 曲线在视觉字段之外（由绑定元素的当前位置推导），单独比较决定是否重建
    const curveKey = opts.curve ? opts.curve.map((v) => Math.round(v * 100)).join(',') : '';
    const curveChanged = curveKey !== this.curveKey;
    this.curveKey = curveKey;
    this.curve = opts.curve ?? null;
    if (curveChanged || this.visualChanged(node)) {
      this.rebuild();
    }
    // 拖拽时绝大多数节点只是被重新同步一次，变换未变就不碰 Konva 属性
    this.syncTransform(false);
  }

  /**
   * 节点变换：未旋转时以 (x,y) 为原点；旋转时绕节点中心（offset 平移补偿），
   * 位置/尺寸变化会实时反映到旋转中心上。
   */
  private syncTransform(force: boolean): void {
    const g = this.group;
    const n = this.node;
    const rot = n.rotation ?? 0;
    const tx = rot === 0 ? n.x : n.x + n.width / 2;
    const ty = rot === 0 ? n.y : n.y + n.height / 2;
    const tox = rot === 0 ? 0 : n.width / 2;
    const toy = rot === 0 ? 0 : n.height / 2;
    const opacity = n.opacity ?? 1;
    const key = `${tx.toFixed(3)}|${ty.toFixed(3)}|${rot.toFixed(3)}|${tox.toFixed(3)}|${toy.toFixed(3)}|${opacity.toFixed(3)}`;
    if (!force && key === this.transformKey) return;
    this.transformKey = key;
    g.setAttrs({ x: tx, y: ty, rotation: rot, offsetX: tox, offsetY: toy, opacity });
  }

  /** 视口缩放同步：LOD 在绘制时读取；容器名片按 1/scale 反向缩放，屏幕尺寸保持恒定 */
  setScale(scale: number): void {
    this.scale = scale;
    const inv = 1 / scale;
    const g = this.plateGroup;
    if (g) {
      if (Math.abs(g.scaleX() - inv) > 1e-9) g.scale({ x: inv, y: inv });
    }
    const c = this.captionGroup;
    if (c) {
      if (Math.abs(c.scaleX() - inv) > 1e-9) c.scale({ x: inv, y: inv });
      // 水平居中：子坐标在「屏幕像素」单位下，图片中线 = 世界宽度一半 × 缩放
      const label = c.getChildren()[0] as Konva.Label | undefined;
      label?.x((this.node.width * scale) / 2);
    }
  }

  /** 画布底色变化（设置面板改色）：只更新名片底色，无需重建 */
  setPlateBg(color: string): void {
    this.plateTag?.fill(color);
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
    this.plateGroup = null;
    this.captionGroup = null;
    this.plateTag = null;
    this.plateSize = null;
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
    this.syncTransform(true);
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
    // 背景/实体边框：颜色与粗细和形状描边共用字段；未显式设置时回落到新形状默认描边
    const fill = n.fill ? (resolveColor(n.fill, this.palette) ?? null) : null;
    const border: TextBorder | null = n.border
      ? {
          color: resolveColor(n.stroke, this.palette) ?? this.palette.nodeStroke,
          width: Math.max(1, n.strokeSize ?? 2),
          style: n.borderStyle === 'dashed' || n.borderStyle === 'dotted' ? n.borderStyle : 'solid',
        }
      : null;
    const cornerRadius = Math.max(0, n.borderRadius ?? 0);
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
      fill,
      border,
      cornerRadius,
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
    // 空文本且无背景/边框：不画任何东西（空白节点在画布上不可见，保持原有行为）
    if (!d || (!d.hasText && !d.border && !d.fill)) return;
    const g = rawContext(ctx);
    // 深缩放：字形已不可辨读，画占位块（比位图更省）；背景/边框廉价，保持矢量绘制不消失
    if (d.fontSize * this.scale < TEXT_BLOCK_MIN_PX) {
      paintFrame(g, d);
      if (d.hasText) {
        g.save();
        g.globalAlpha = TEXT_BLOCK_ALPHA * this.group.opacity();
        g.fillStyle = d.color;
        g.fillRect(0, 0, d.width, d.height);
        g.restore();
      }
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
    // 背景与边框先画，压在文字下方；与文本一起进入位图缓存（textRev 随 rebuild 自增，改样式即失效重画）
    paintFrame(g, d);
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

    // 图片描述牌：图片下沿，内容 = 自定义 caption（空串隐藏）缺省文件名；
    // 与容器名片同款反向缩放 —— 屏幕上大小恒定，不随画布缩放变形
    const capText = (n.caption !== undefined ? n.caption : fileCaption(n.file ?? '')).trim();
    if (capText) {
      const g = new Konva.Group({ y: n.height, listening: false });
      const cap = new Konva.Label({ listening: false, y: CAPTION_GAP });
      cap.add(new Konva.Tag({ fill: this.getPlateBg?.() ?? this.palette.canvasBg, cornerRadius: 4, opacity: 0.92, listening: false }));
      cap.add(new Konva.Text({ text: capText, fontSize: CAPTION_FONT, fontFamily: 'system-ui, sans-serif', fill: this.palette.text, padding: 3, listening: false }));
      cap.x((n.width * this.scale) / 2);
      cap.offsetX(cap.width() / 2);
      g.add(cap);
      g.scale({ x: 1 / this.scale, y: 1 / this.scale });
      this.inner.add(g);
      this.captionGroup = g;
    }
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
    // 圆角：填充与虚线边框共用同一半径（绘制时不再夹取 —— 半径超过短边一半时 Konva
    // 自己会退化成胶囊形，视觉上等价于「最大可达圆角」）。未设置过 → 用容器默认圆角。
    const cornerRadius = Math.max(0, n.borderRadius ?? CONTAINER_DEFAULT_RADIUS);
    // 背景填充：整个容器组会被下移到自己的内容之下（见 core/zorder.paintOrder），
    // 因此填充不会盖住容器里的节点。透明度用 fillOpacity 而不是节点级 opacity
    // —— 后者会连容器名片上的文字一起变淡。未设置过 → 用容器默认背景透明度。
    const fill = n.fill ? (resolveColor(n.fill, this.palette) ?? null) : null;
    if (fill) {
      this.inner.add(
        new Konva.Rect({
          x: 0,
          y: 0,
          width: n.width,
          height: n.height,
          fill,
          cornerRadius,
          opacity: Math.min(1, Math.max(0, n.fillOpacity ?? CONTAINER_DEFAULT_FILL_OPACITY)),
          listening: false,
        }),
      );
    }
    // 虚线边框：颜色跟随主题（不可自定义），压在填充之上
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
        cornerRadius,
        opacity: 0.85,
        listening: false,
      }),
    );
    // 左上角名片：显示容器名称（未命名时给灰色占位）。无边框，底色为画布底色加深；
    // 名片按 1/视口缩放反向缩放（见 setScale），屏幕尺寸恒定、缩放时大小同步跟随；
    // 名片区域可点选/拖动整个容器，双击可重命名（见 SelectTool / Engine.pick）。
    const name = (n.text ?? '').trim();
    const label = new Konva.Label({ listening: false });
    this.plateTag = new Konva.Tag({
      fill: this.getPlateBg?.() ?? this.palette.canvasBg,
      cornerRadius: 4,
    });
    label.add(this.plateTag);
    label.add(
      new Konva.Text({
        text: name || '容器',
        fontSize: CONTAINER_PLATE_FONT,
        padding: 5,
        fontFamily: 'system-ui, sans-serif',
        fill: name ? this.palette.text : this.palette.textMuted,
      }),
    );
    const plateW = label.getWidth();
    const plateH = label.getHeight();
    label.y(-(CONTAINER_PLATE_GAP + plateH));
    const plate = new Konva.Group({ listening: false });
    plate.add(label);
    plate.scale({ x: 1 / this.scale, y: 1 / this.scale });
    this.inner.add(plate);
    this.plateGroup = plate;
    this.plateSize = { width: plateW, height: plateH };
  }

  /** 世界坐标点是否落在容器名片上（名片世界尺寸 = 屏幕尺寸 / 视口缩放，随缩放反向换算） */
  hitsPlate(wx: number, wy: number): boolean {
    const p = this.plateSize;
    if (!p) return false;
    const inv = 1 / this.scale;
    return rectContains(
      {
        x: this.node.x,
        y: this.node.y - (CONTAINER_PLATE_GAP + p.height) * inv,
        width: p.width * inv,
        height: p.height * inv,
      },
      { x: wx, y: wy },
    );
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
            dash: dashArray(n.strokeStyle, sw),
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

    // 线类：关系描述文本画在线段中点（曲线取贝塞尔中点，折线按弧长中点）。
    // 底牌用 destination-out 镂空线杆：完全遮住身后的线，同时保留背景点阵/方格透视。
    // 必须在杆/端点之后入组 —— 文字盖过穿过其区域的线杆，文字才可读
    if (isLineLike(n) && (n.label ?? '').trim()) {
      const mid = this.curve
        ? cubicMidpoint(this.curve.map((v, i) => (i % 2 === 0 ? v - n.x : v - n.y)))
        : polylineMidpoint(pointsOf(n));
      const g = new Konva.Group({ listening: false, x: mid.x, y: mid.y });
      const txt = new Konva.Text({
        text: n.label!.trim(),
        fontSize: 13,
        fontFamily: 'system-ui, sans-serif',
        fill: this.palette.text,
        padding: 4,
        listening: false,
      });
      const w = txt.width();
      const h = txt.height();
      const erase = new Konva.Rect({
        x: -w / 2,
        y: -h / 2,
        width: w,
        height: h,
        cornerRadius: 5,
        fill: '#000',
        globalCompositeOperation: 'destination-out',
        listening: false,
      });
      g.add(erase);
      txt.position({ x: -w / 2, y: -h / 2 });
      g.add(txt);
      this.inner.add(g);
    }
  }

  private buildArrow(n: CanvasNode, stroke: string, sw: number): void {
    const pts = pointsOf(n).map(([x, y]) => ({ x, y }));
    // 端点样式：未显式设置时按形状给默认（arrow = 实心终点，line/polyline = 无）
    const head = n.headStyle ?? (n.shape === 'arrow' ? 'solid' : 'none');
    const tail = n.tailStyle ?? 'none';
    // 双端绑定：曲线是世界坐标，节点组内须转为节点局部坐标（减去节点原点）
    const bezier = this.curve ? this.curve.map((v, i) => (i % 2 === 0 ? v - n.x : v - n.y)) : null;
    // 线杆 + 两端端点单形状一次绘制：箭头头完全盖住回缩的线杆端，无拼接接缝
    this.inner.add(
      arrowPaintShape(() => ({
        pts,
        bezier,
        sw,
        head,
        tail,
        color: stroke,
        bg: this.palette.canvasBg,
        strokeStyle: n.strokeStyle,
      })),
    );
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

/** 追迹左上角 (x0,y0)、尺寸 w×h 的圆角矩形路径；r > 0 时走圆角，否则直角矩形 */
function traceRoundRect(g: CanvasRenderingContext2D, x0: number, y0: number, w: number, h: number, r: number): void {
  const x1 = x0 + w;
  const y1 = y0 + h;
  g.beginPath();
  if (r > 0) {
    g.moveTo(x0 + r, y0);
    g.arcTo(x1, y0, x1, y1, r);
    g.arcTo(x1, y1, x0, y1, r);
    g.arcTo(x0, y1, x0, y0, r);
    g.arcTo(x0, y0, x1, y0, r);
    g.closePath();
  } else {
    g.rect(x0, y0, w, h);
  }
}

/**
 * 文本框背景与实体边框：背景先画、压在边框与文字下方。
 * 开边框时二者共用「内缩线宽一半」的圆角矩形几何（与 CSS 边框一致，节点边界即视觉边界，
 * 同时避免位图缓存按包围盒裁掉居中描边的外半圈）；无边框时背景铺满包围盒。
 * 线宽与圆角都夹取到框内可达的最大值；虚线/点状的 dash 按线宽取比例，
 * 光栅化（g 已按倍率缩放）与深缩放（Konva 变换）下间距随线宽同步缩放，观感一致。
 */
function paintFrame(g: CanvasRenderingContext2D, d: TextDraw): void {
  const b = d.border;
  if (!d.fill && !b) return;
  const w = d.width;
  const h = d.height;
  const sw = b ? Math.max(0.5, Math.min(b.width, w, h)) : 0;
  const inset = sw / 2;
  const r = Math.min(d.cornerRadius, Math.max(0, Math.min(w, h) / 2 - inset));
  const x0 = inset;
  const y0 = inset;
  const rw = Math.max(0, w - sw);
  const rh = Math.max(0, h - sw);
  if (d.fill) {
    traceRoundRect(g, x0, y0, rw, rh, r);
    g.fillStyle = d.fill;
    g.fill();
  }
  if (!b) return;
  g.save();
  traceRoundRect(g, x0, y0, rw, rh, r);
  g.strokeStyle = b.color;
  g.lineWidth = sw;
  if (b.style === 'dashed') {
    g.setLineDash([sw * 4, sw * 3]);
  } else if (b.style === 'dotted') {
    // 圆头 + 近零短划 = 直径与线宽一致的圆点序列
    g.lineCap = 'round';
    g.setLineDash([0.01, sw * 1.9]);
  }
  g.stroke();
  g.restore();
}

/** 判断世界坐标点是否命中节点（用于手动拾取）。scale = 视口缩放，容差换算成屏幕距离 */
export function hitTestNode(n: CanvasNode, wx: number, wy: number, palette: Palette, scale = 1, get?: (id: string) => CanvasNode | undefined): boolean {
  // 线类：命中范围严格限定在线段/曲线实体 ± 小范围包边容差，不按包围盒判定——
  // 1) 包围盒粗筛会把“点空大片空白也选中”的错觉排除：空白处一律不中；
  // 2) 容差贴着线实体（约 ±4 屏幕像素）：箭头/连线不该比可拖动的实体本身更好点中。
  if (isLineLike(n)) {
    const maxDist = lineHitTolerance(n.strokeSize, scale);
    // 几何取自 linePolyline（与渲染同源）：双端绑定走贝塞尔采样，其余走折点（过翻转镜像）
    const path = linePolyline(n, get);
    for (let i = 0; i < path.length - 1; i++) {
      if (segDist({ x: wx, y: wy }, path[i]!, path[i + 1]!) <= maxDist) return true;
    }
    return false;
  }
  // 非线类（形状/文本/图片）：包围盒内即命中。旋转节点先把指针变换回未旋转的
  // 局部坐标系再判定 —— 不然旋转后的元素会按轴对齐包围盒误命中大片空白。
  const tol = Math.max(4, 6 / scale);
  let px = wx;
  let py = wy;
  const rot = n.rotation ?? 0;
  if (rot !== 0) {
    const p = rotatePoint({ x: wx, y: wy }, rectCenter({ x: n.x, y: n.y, width: n.width, height: n.height }), -rot);
    px = p.x;
    py = p.y;
  }
  if (px < n.x - tol || px > n.x + n.width + tol || py < n.y - tol || py > n.y + n.height + tol) {
    return false;
  }
  return true;
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
