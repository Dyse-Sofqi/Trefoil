/**
 * 覆盖层（屏幕坐标）：选择框/缩放手柄、框选、吸附参考线、橡皮擦预览、聚焦遮罩、容器悬停、绘制预览。
 * 全部为临时视觉元素，不进入数据与撤销栈。
 */
import Konva from 'konva';
import type { Rect, Vec } from '../core/geometry';
import type { ArrowHeadStyle } from '../core/types';
import type { Guide } from '../core/snap';
import type { Palette } from './palette';
import { arrowHeadParts, addHeadShapes } from './arrowHead';

export type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
/** 线类节点（直线/箭头/折线）的端点手柄 id：pt0 = 起点、pt1 = 终点 */
export type PointHandleId = `pt${number}`;
export type ToolHandleId = HandleId | PointHandleId;

export interface HandleHit {
  id: ToolHandleId;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface OverlayState {
  /** 世界坐标选择框 → 转屏幕 */
  selection: Rect[];
  /** 单选时的缩放手柄（屏幕坐标）；hideVertical = 高度自适应的节点（文本），上下中点手柄不参与缩放 */
  handles: (Rect & { hideVertical?: boolean }) | null;
  /** 单选线类节点（直线/箭头/折线）的端点手柄（世界坐标）：拖端点改形状，替代四角缩放手柄 */
  endpoints: Vec[] | null;
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
}

export class Overlay {
  private group = new Konva.Group({ listening: false });
  private handles: HandleHit[] = [];
  /** 端点手柄命中区（屏幕坐标），handleAt 时优先于缩放手柄 */
  private pointHandles: { id: PointHandleId; x: number; y: number }[] = [];
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
    let bestPt: { id: PointHandleId; x: number; y: number } | null = null;
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
        if (r.hideVertical && (id === 'n' || id === 's')) continue; // 高度自适应：上下中点手柄不出现
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
      const headParts = arrowHeadParts(a, b, 1.8, head);
      const tailParts = arrowHeadParts(b, a, 1.8, tail);
      const sa = tailParts ? tailParts.shaftEnd : a;
      const sb = headParts ? headParts.shaftEnd : b;
      g.add(
        new Konva.Line({
          points: [sa.x, sa.y, sb.x, sb.y],
          stroke: p.accent,
          strokeWidth: 1.8,
          lineCap: 'round',
          lineJoin: 'round',
          listening: false,
        }),
      );
      if (tailParts) addHeadShapes(g, tailParts, p.accent, 1.8, p.canvasBg);
      if (headParts) addHeadShapes(g, headParts, p.accent, 1.8, p.canvasBg);
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

    this.layer.batchDraw();
  }
}
