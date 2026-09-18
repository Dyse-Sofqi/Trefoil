/**
 * 覆盖层（屏幕坐标）：选择框/缩放手柄、框选、吸附参考线、橡皮擦预览、聚焦遮罩、容器悬停、绘制预览。
 * 全部为临时视觉元素，不进入数据与撤销栈。
 */
import Konva from 'konva';
import type { Rect, Vec } from '../core/geometry';
import type { ArrowHeadStyle } from '../core/types';
import type { Guide } from '../core/snap';
import type { Palette } from './palette';
import { arrowPaintShape } from './arrowPaint';

export type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
/** 线类节点（直线/箭头/折线）的端点手柄 id：pt0 = 起点、pt1 = 终点 */
export type PointHandleId = `pt${number}`;
/** 连线（Edge）的端点手柄 id：拖端点重新绑定 fromNode / toNode */
export type EdgeHandleId = 'edge-from' | 'edge-to';
/** 旋转手柄 id（单选块状元素顶部）：拖拽绕中心旋转 */
export type RotateHandleId = 'rotate';
export type ToolHandleId = HandleId | PointHandleId | EdgeHandleId | RotateHandleId;

export interface HandleHit {
  id: ToolHandleId;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 旋转手柄伸出长度（屏幕像素）：从旋转后顶部中点向上延伸，不随画布缩放变形 */
const ROTATE_HANDLE_LEN = 22;

export interface OverlayState {
  /** 世界坐标选择框 → 转屏幕 */
  selection: Rect[];
  /** 单选时的缩放手柄（屏幕坐标）；cornerOnly = 高度自适应的节点（文本），只保留四角手柄 */
  handles: (Rect & { cornerOnly?: boolean }) | null;
  /** 单选线类节点（直线/箭头/折线）的端点手柄（世界坐标）：拖端点改形状，替代四角缩放手柄 */
  endpoints: Vec[] | null;
  /**
   * 单选连线（Edge）的端点手柄（世界坐标）：拖端点重新绑定 fromNode / toNode
   */
  edgeEndpoints: { id: EdgeHandleId; pos: Vec }[] | null;
  /**
   * 单选块状元素的旋转手柄（世界坐标）：angle = 当前旋转角（度）、rect = 节点矩形、
   * center = 旋转中心、top = 旋转后顶部中点（手柄锚点）。旋转非零时选中框随角度画出。
   */
  rotation: { angle: number; rect: Rect; center: Vec; top: Vec } | null;
  marquee: Rect | null;
  guides: Guide[];
  /** 橡皮擦 */
  eraserCursor: { x: number; y: number; r: number } | null;
  erasePreview: Rect[];
  /** 聚焦模式 */
  focus: Rect | null;
  /** 容器悬停高亮（世界坐标） */
  containerHover: Rect | null;
  /** 绘制预览（世界坐标 + 形状） */
  draft: { rect: Rect; kind: 'rect' | 'ellipse' | 'diamond' | 'triangle' } | null;
  /** 直线/箭头绘制预览（世界坐标，跟随拖拽方向，可到任意象限；端点样式与最终节点一致） */
  lineDraft: { a: Vec; b: Vec; arrow: boolean; head?: ArrowHeadStyle; tail?: ArrowHeadStyle } | null;
  /** 连线预览（世界坐标点集） */
  edgeDraft: Vec[] | null;
  /** 选中线的曲线高亮：path 为世界坐标（连线/绑定箭头 = 4 控制点，bezier=true；普通折线 = 顶点，bezier=false） */
  edgeSelect: { path: number[]; bezier: boolean } | null;
  /** 箭头工具 Ports 提示（世界坐标锚点） */
  ports: Vec[];
  /** 当前端点磁吸目标锚点（世界坐标）：拖端点/绘图时悬停在可连接元素附近时高亮显示 */
  magnet: Vec | null;
}

export class Overlay {
  private group = new Konva.Group({ listening: false });
  private handles: HandleHit[] = [];
  /** 端点手柄命中区（屏幕坐标），handleAt 时优先于缩放手柄（pt* = 线类端点，edge-* = 连线端点，rotate = 旋转柄） */
  private pointHandles: { id: ToolHandleId; x: number; y: number }[] = [];
  private palette: Palette;

  constructor(private layer: Konva.Layer, palette: Palette) {
    this.palette = palette;
    layer.add(this.group);
  }

  setPalette(p: Palette): void {
    this.palette = p;
  }

  handleAt(sx: number, sy: number): HandleHit | null {
    // 端点手柄最优先：线类端点与四角缩放手柄本来就重叠（箭头两端 = 包围盒角点），
    // 端点语义（改形状）必须压过缩放语义，否则箭头两头永远抓不到
    let bestPt: { id: ToolHandleId; x: number; y: number } | null = null;
    let bestPtDist = Infinity;
    for (const p of this.pointHandles) {
      const d = Math.hypot(sx - p.x, sy - p.y);
      if (d <= 10 && d < bestPtDist) {
        bestPtDist = d;
        bestPt = p;
      }
    }
    if (bestPt) return { id: bestPt.id, x: bestPt.x - 4, y: bestPt.y - 4, w: 8, h: 8 };
    // 取「最近」而不是「先命中」：节点很小时相邻手柄的命中区（±4px 容差）会互相重叠，
    // 按数组顺序返回会让用户抓角手柄却抓到边手柄。
    let best: HandleHit | null = null;
    let bestDist = Infinity;
    for (const h of this.handles) {
      if (sx < h.x - 4 || sx > h.x + h.w + 4 || sy < h.y - 4 || sy > h.y + h.h + 4) continue;
      const d = Math.hypot(sx - (h.x + h.w / 2), sy - (h.y + h.h / 2));
      if (d < bestDist) {
        bestDist = d;
        best = h;
      }
    }
    return best;
  }

  clearHandles(): void {
    this.handles = [];
    this.pointHandles = [];
  }

  draw(state: OverlayState, vp: { x: number; y: number; scale: number }, stageW: number, stageH: number): void {
    const g = this.group;
    g.destroyChildren();
    this.handles = [];
    this.pointHandles = [];
    const p = this.palette;
    const toSX = (w: number) => (w - vp.x) * vp.scale;
    const toSY = (w: number) => (w - vp.y) * vp.scale;
    const scale = vp.scale;

    // 选择框
    for (const r of state.selection) {
      g.add(
        new Konva.Rect({
          x: toSX(r.x) - 1,
          y: toSY(r.y) - 1,
          width: r.width * scale + 2,
          height: r.height * scale + 2,
          stroke: p.accent,
          strokeWidth: 1.5,
          listening: false,
        }),
      );
    }

    // 缩放手柄（单选）
    if (state.handles) {
      const r = state.handles;
      const sx = toSX(r.x);
      const sy = toSY(r.y);
      const sw = r.width * scale;
      const sh = r.height * scale;
      const defs: [HandleId, number, number][] = [
        ['nw', sx, sy],
        ['n', sx + sw / 2, sy],
        ['ne', sx + sw, sy],
        ['e', sx + sw, sy + sh / 2],
        ['se', sx + sw, sy + sh],
        ['s', sx + sw / 2, sy + sh],
        ['sw', sx, sy + sh],
        ['w', sx, sy + sh / 2],
      ];
      for (const [id, hx, hy] of defs) {
        // 文本：高度由内容自适应、宽度随手柄拖动，只保留四角手柄（两侧中点手柄不出现）
        if (r.cornerOnly && (id === 'n' || id === 's' || id === 'e' || id === 'w')) continue;
        const size = 8;
        g.add(
          new Konva.Rect({
            x: hx - size / 2,
            y: hy - size / 2,
            width: size,
            height: size,
            fill: '#ffffff',
            stroke: p.accent,
            strokeWidth: 1.2,
            cornerRadius: 2,
            listening: false,
          }),
        );
        this.handles.push({ id, x: hx - size / 2, y: hy - size / 2, w: size, h: size });
      }
    }

    // 旋转手柄（单选块状元素顶部）：柄从旋转后的顶部中点伸出（屏幕恒定长度）。
    // 已旋转的元素选中框随角度重画（与此前的 axis-aligned 框一致，不再画两条框）。
    if (state.rotation) {
      const rt = state.rotation;
      const c = { x: toSX(rt.center.x), y: toSY(rt.center.y) };
      const t = { x: toSX(rt.top.x), y: toSY(rt.top.y) };
      if (rt.angle !== 0) {
        g.add(
          new Konva.Rect({
            x: c.x,
            y: c.y,
            offsetX: (rt.rect.width * scale) / 2,
            offsetY: (rt.rect.height * scale) / 2,
            width: rt.rect.width * scale,
            height: rt.rect.height * scale,
            rotation: rt.angle,
            stroke: p.accent,
            strokeWidth: 1.5,
            listening: false,
          }),
        );
      }
      let dx = t.x - c.x;
      let dy = t.y - c.y;
      const len = Math.hypot(dx, dy) || 1;
      dx /= len;
      dy /= len;
      const hx = t.x + dx * ROTATE_HANDLE_LEN;
      const hy = t.y + dy * ROTATE_HANDLE_LEN;
      g.add(
        new Konva.Line({
          points: [t.x, t.y, hx, hy],
          stroke: p.accent,
          strokeWidth: 1.5,
          listening: false,
        }),
      );
      g.add(
        new Konva.Circle({
          x: hx,
          y: hy,
          radius: 6,
          fill: '#ffffff',
          stroke: p.accent,
          strokeWidth: 1.4,
          listening: false,
        }),
      );
      this.pointHandles.push({ id: 'rotate', x: hx, y: hy });
    }

    // 线类端点手柄（单选直线/箭头/折线）：圆点样式，拖动直接改折点（包围盒跟随重排）
    for (const [i, ep] of (state.endpoints ?? []).entries()) {
      const hx = toSX(ep.x);
      const hy = toSY(ep.y);
      const r = 4.5;
      g.add(
        new Konva.Circle({
          x: hx,
          y: hy,
          radius: r,
          fill: '#ffffff',
          stroke: p.accent,
          strokeWidth: 1.4,
          listening: false,
        }),
      );
      this.pointHandles.push({ id: `pt${i}`, x: hx, y: hy });
    }

    // 连线端点手柄（单选连线）：圆点样式，拖端点重新绑定 fromNode / toNode（与 pt 手柄同优先级）
    for (const ep of state.edgeEndpoints ?? []) {
      const hx = toSX(ep.pos.x);
      const hy = toSY(ep.pos.y);
      const r = 5;
      g.add(
        new Konva.Circle({
          x: hx,
          y: hy,
          radius: r,
          fill: '#ffffff',
          stroke: p.accent,
          strokeWidth: 1.6,
          listening: false,
        }),
      );
      this.pointHandles.push({ id: ep.id, x: hx, y: hy });
    }

    // 框选
    if (state.marquee) {
      const m = state.marquee;
      g.add(
        new Konva.Rect({
          x: Math.min(m.x, m.x + m.width),
          y: Math.min(m.y, m.y + m.height),
          width: Math.abs(m.width),
          height: Math.abs(m.height),
          fill: p.selectionFill,
          stroke: p.accent,
          strokeWidth: 1,
          listening: false,
        }),
      );
    }

    // 吸附参考线（红虚线 + 间距标注）
    for (const gd of state.guides) {
      const p1 = gd.axis === 'v' ? { x: gd.pos, y: gd.from } : { x: gd.from, y: gd.pos };
      const p2 = gd.axis === 'v' ? { x: gd.pos, y: gd.to } : { x: gd.to, y: gd.pos };
      g.add(
        new Konva.Line({
          points: [toSX(p1.x), toSY(p1.y), toSX(p2.x), toSY(p2.y)],
          stroke: p.guide,
          strokeWidth: 1,
          dash: [4, 4],
          listening: false,
        }),
      );
      if (gd.label) {
        const mx = toSX((p1.x + p2.x) / 2);
        const my = toSY((p1.y + p2.y) / 2);
        const label = new Konva.Label({ x: mx, y: my - 22, listening: false });
        label.add(new Konva.Tag({ fill: p.guide, cornerRadius: 3, opacity: 0.9 }));
        label.add(new Konva.Text({ text: `${gd.label}px`, fontSize: 10, padding: 3, fill: '#fff', fontFamily: 'system-ui' }));
        g.add(label);
      }
    }

    // 橡皮擦预览：将擦除的元素红框
    for (const r of state.erasePreview) {
      g.add(
        new Konva.Rect({
          x: toSX(r.x) - 2,
          y: toSY(r.y) - 2,
          width: r.width * scale + 4,
          height: r.height * scale + 4,
          stroke: p.guide,
          strokeWidth: 2,
          dash: [5, 3],
          listening: false,
        }),
      );
    }

    // 橡皮擦光标
    if (state.eraserCursor) {
      const e = state.eraserCursor;
      g.add(
        new Konva.Circle({
          x: e.x,
          y: e.y,
          radius: e.r,
          stroke: p.textMuted,
          strokeWidth: 1,
          fill: 'rgba(128,128,128,0.08)',
          listening: false,
        }),
      );
      g.add(new Konva.Circle({ x: e.x, y: e.y, radius: 1.5, fill: p.textMuted, listening: false }));
    }

    // 聚焦模式遮罩（四块半透明）
    if (state.focus) {
      const f = state.focus;
      const fx = toSX(f.x);
      const fy = toSY(f.y);
      const fw = f.width * scale;
      const fh = f.height * scale;
      const dim = 'rgba(0,0,0,0.35)';
      const rects = [
        { x: 0, y: 0, w: stageW, h: Math.max(0, fy) },
        { x: 0, y: fy + fh, w: stageW, h: Math.max(0, stageH - fy - fh) },
        { x: 0, y: fy, w: Math.max(0, fx), h: fh },
        { x: fx + fw, y: fy, w: Math.max(0, stageW - fx - fw), h: fh },
      ];
      for (const r of rects) {
        if (r.w > 0 && r.h > 0) g.add(new Konva.Rect({ ...r, fill: dim, listening: false }));
      }
      g.add(
        new Konva.Rect({
          x: fx - 2,
          y: fy - 2,
          width: fw + 4,
          height: fh + 4,
          stroke: p.accent,
          strokeWidth: 1.5,
          listening: false,
        }),
      );
    }

    // 容器悬停
    if (state.containerHover) {
      const c = state.containerHover;
      g.add(
        new Konva.Rect({
          x: toSX(c.x),
          y: toSY(c.y),
          width: c.width * scale,
          height: c.height * scale,
          stroke: p.accent,
          strokeWidth: 1.5,
          dash: [5, 4],
          listening: false,
        }),
      );
    }

    // 形状绘制预览
    if (state.draft) {
      const d = state.draft;
      const x = toSX(d.rect.x);
      const y = toSY(d.rect.y);
      const w = d.rect.width * scale;
      const h = d.rect.height * scale;
      if (d.kind === 'rect') {
        g.add(new Konva.Rect({ x, y, width: w, height: h, stroke: p.accent, strokeWidth: 1.5, dash: [5, 3], listening: false }));
      } else if (d.kind === 'ellipse') {
        g.add(new Konva.Ellipse({ x: x + w / 2, y: y + h / 2, radiusX: Math.abs(w / 2), radiusY: Math.abs(h / 2), stroke: p.accent, strokeWidth: 1.5, dash: [5, 3], listening: false }));
      } else {
        const pts =
          d.kind === 'diamond'
            ? [x + w / 2, y, x + w, y + h / 2, x + w / 2, y + h, x, y + h / 2]
            : [x + w / 2, y, x + w, y + h, x, y + h];
        g.add(new Konva.Line({ points: pts, closed: true, stroke: p.accent, strokeWidth: 1.5, dash: [5, 3], listening: false }));
      }
    }

    // 直线/箭头预览（与最终节点一致：端点样式随设置，两端回缩；预览为固定屏幕线宽，几何直接在屏幕坐标算）
    if (state.lineDraft) {
      const ld = state.lineDraft;
      const a = { x: toSX(ld.a.x), y: toSY(ld.a.y) };
      const b = { x: toSX(ld.b.x), y: toSY(ld.b.y) };
      const head = ld.arrow ? (ld.head ?? 'solid') : 'none';
      const tail = ld.arrow ? (ld.tail ?? 'none') : 'none';
      g.add(
        arrowPaintShape(() => ({
          pts: [a, b],
          sw: 1.8,
          head,
          tail,
          color: p.accent,
          bg: p.canvasBg,
        })),
      );
    }

    // 选中线高亮（与原路径同曲线模式，贴合线身）
    if (state.edgeSelect) {
      const es = state.edgeSelect;
      const pts: number[] = [];
      for (let i = 0; i < es.path.length; i += 2) pts.push(toSX(es.path[i]!), toSY(es.path[i + 1]!));
      g.add(
        new Konva.Line({
          points: pts,
          bezier: es.bezier,
          stroke: p.accent,
          strokeWidth: 6,
          opacity: 0.25,
          lineCap: 'round',
          lineJoin: 'round',
          listening: false,
        }),
      );
      const n = pts.length;
      for (const [px, py] of [[pts[0]!, pts[1]!], [pts[n - 2]!, pts[n - 1]!]]) {
        g.add(new Konva.Circle({ x: px, y: py, radius: 3.5, fill: p.accent, listening: false }));
      }
    }

    // 连线/箭头预览
    if (state.edgeDraft && state.edgeDraft.length >= 2) {
      const pts = state.edgeDraft.flatMap((v) => [toSX(v.x), toSY(v.y)]);
      g.add(new Konva.Line({ points: pts, stroke: p.accent, strokeWidth: 1.8, listening: false }));
    }

    // Ports 提示
    for (const port of state.ports) {
      g.add(
        new Konva.Circle({
          x: toSX(port.x),
          y: toSY(port.y),
          radius: 4,
          fill: '#fff',
          stroke: p.accent,
          strokeWidth: 1.5,
          listening: false,
        }),
      );
    }

    // 当前磁吸目标锚点（高亮）：松手会吸附到的确切位置，随指针就近切换上/下/左/右
    if (state.magnet) {
      const mx = toSX(state.magnet.x);
      const my = toSY(state.magnet.y);
      g.add(
        new Konva.Circle({
          x: mx,
          y: my,
          radius: 7,
          fill: p.accent,
          stroke: '#ffffff',
          strokeWidth: 2,
          opacity: 0.9,
          listening: false,
        }),
      );
      g.add(
        new Konva.Circle({
          x: mx,
          y: my,
          radius: 2.5,
          fill: '#ffffff',
          listening: false,
        }),
      );
    }

    this.layer.batchDraw();
  }
}
