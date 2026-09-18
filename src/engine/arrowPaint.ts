/**
 * 整支箭头（线杆 + 两端端点）的单次绘制。
 *
 * 用户反馈：线杆与箭头头此前拆成两个 Konva 图元拼接，箭头没能完全盖住线头，
 * 接缝处圆帽/描边互相叠压不丝滑。这里把线杆与两端端点放进同一个 sceneFunc 的
 * 一次绘制里画完（stroke 与 fill 共用同一上下文路径），不存在图元拼接接缝；
 * 端点始终精确叠压在按端点样式回缩后的线杆端上。
 */
import Konva from 'konva';
import type { ArrowHeadStyle } from '../core/types';
import type { Vec } from '../core/geometry';
import { arrowHeadParts, headRetract, type ArrowHeadParts } from './arrowHead';
import { dashArray, trimCubicEnd, trimCubicStart } from '../core/arrowLink';

export interface ArrowPaintInput {
  /** 线杆折点（目标坐标系：节点局部或世界坐标） */
  pts: Vec[];
  /** 三次贝塞尔（8 个扁平数，同一坐标系）；提供时优先于 pts 绘制线杆 */
  bezier?: number[] | null;
  /** 描边粗细（世界单位） */
  sw: number;
  /** 终点（箭头）样式 */
  head: ArrowHeadStyle;
  /** 起点（尾部）样式 */
  tail: ArrowHeadStyle;
  color: string;
  /** 背景色（空心端点的内衬，通常 = 画布底色） */
  bg: string;
  /** 线型（实线/虚线/点状） */
  strokeStyle?: string | undefined;
}

/** 端点件与线杆回缩的纯计算（不含绘制）：绘制与单测共用同一份逻辑 */
export interface ArrowLayout {
  /** 回缩后的线杆：bezier = 8 个扁平数；pts = 折线点（与输入同坐标系） */
  shaft: { kind: 'bezier'; path: number[] } | { kind: 'pts'; pts: Vec[] };
  head: ArrowHeadParts | null;
  tail: ArrowHeadParts | null;
}

/**
 * 算出两端端点件，并把线杆按端点回缩量截短 —— 端点件始终精确叠压在回缩后的杆端上。
 * 不变量（tests/arrowPaint.test.ts 守着）：杆端（连同圆帽两侧）必须落在端点件内部，
 * 任何角度下都不能从三角里冒出来（否则看着就是「线杆和箭头两块拼的」）。
 */
export function layoutArrow(inp: ArrowPaintInput): ArrowLayout {
  const { pts, sw, head, tail } = inp;
  if (inp.bezier && inp.bezier.length === 8) {
    const [x1, y1, cx1, cy1, cx2, cy2, x2, y2] = inp.bezier;
    const start = { x: x1, y: y1 };
    const tip = { x: x2, y: y2 };
    // 回缩量只与样式/线宽有关（与方向无关）→ 先按常量把线杆截短
    const retH = headRetract(sw, head);
    const retT = headRetract(sw, tail);
    let path = inp.bezier;
    if (retH > 0) path = trimCubicEnd(path, retH);
    if (retT > 0) path = trimCubicStart(path, retT);
    // 端点件用「回缩后的杆端 → 尖」定向：端点件与线杆严格同轴，圆帽一定藏在三角里。
    // 用解析切线（曲率大的地方能和杆端实际走向差十几度）会让端点件歪着贴在杆端上，像两块拼的。
    const headFrom = shifted(path[6]!, path[7]!, x2, y2) ? { x: path[6]!, y: path[7]! } : { x: cx2, y: cy2 };
    const tailFrom = shifted(path[0]!, path[1]!, x1, y1) ? { x: path[0]!, y: path[1]! } : { x: cx1, y: cy1 };
    return {
      shaft: { kind: 'bezier', path },
      head: arrowHeadParts(headFrom, tip, sw, head),
      tail: arrowHeadParts(tailFrom, start, sw, tail),
    };
  }
  const n = pts.length;
  if (n < 2) return { shaft: { kind: 'pts', pts: [] }, head: null, tail: null };
  const headParts = arrowHeadParts(pts[n - 2]!, pts[n - 1]!, sw, head);
  const tailParts = arrowHeadParts(pts[1]!, pts[0]!, sw, tail);
  const path = pts.map((p, i) =>
    i === n - 1 && headParts ? headParts.shaftEnd : i === 0 && tailParts ? tailParts.shaftEnd : p,
  );
  return { shaft: { kind: 'pts', pts: path }, head: headParts, tail: tailParts };
}

/** 回缩是否真的生效（曲线太短时 trim 会原样返回） */
function shifted(x: number, y: number, ox: number, oy: number): boolean {
  return Math.abs(x - ox) > 1e-6 || Math.abs(y - oy) > 1e-6;
}

/** 把整支箭头画进给定 2D 上下文（线杆先 stroke、端点后 fill/stroke，同一上下文无接缝） */
export function paintArrowPath(g: CanvasRenderingContext2D, inp: ArrowPaintInput): void {
  const { sw, color, bg, strokeStyle: dash } = inp;
  const { shaft, head, tail } = layoutArrow(inp);

  if (shaft.kind === 'bezier') {
    const p = shaft.path;
    g.beginPath();
    g.moveTo(p[0]!, p[1]!);
    g.bezierCurveTo(p[2]!, p[3]!, p[4]!, p[5]!, p[6]!, p[7]!);
    strokeShaft(g, sw, color, dash);
    if (head) paintEnd(g, head, color, sw, bg);
    if (tail) paintEnd(g, tail, color, sw, bg);
    return;
  }

  const pts = shaft.pts;
  if (pts.length < 2) return;
  g.beginPath();
  g.moveTo(pts[0]!.x, pts[0]!.y);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i]!.x, pts[i]!.y);
  strokeShaft(g, sw, color, dash);
  if (head) paintEnd(g, head, color, sw, bg);
  if (tail) paintEnd(g, tail, color, sw, bg);
}

/** 包成 Konva.Shape：input 为惰性读取（EdgeView 复用同一实例、逐帧更新参数） */
export function arrowPaintShape(input: () => ArrowPaintInput): Konva.Shape {
  return new Konva.Shape({
    listening: false,
    sceneFunc: (ctx) => paintArrowPath(ctx as unknown as CanvasRenderingContext2D, input()),
  });
}

function strokeShaft(g: CanvasRenderingContext2D, sw: number, color: string, dash?: string | undefined): void {
  g.lineWidth = sw;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.strokeStyle = color;
  const d = dash ? dashArray(dash, sw) : undefined;
  g.setLineDash(d ? d : []);
  g.stroke();
}

function paintEnd(g: CanvasRenderingContext2D, parts: ArrowHeadParts, color: string, sw: number, bg: string): void {
  if (parts.triangle) {
    const [x0, y0, x1, y1, x2, y2] = parts.triangle;
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    g.lineTo(x2, y2);
    g.closePath();
    if (parts.hollowFill) {
      g.fillStyle = bg;
      g.fill();
      g.lineJoin = 'miter';
      g.lineWidth = Math.max(1, sw);
      g.strokeStyle = color;
      g.stroke();
    } else {
      g.fillStyle = color;
      g.fill();
    }
  } else if (parts.chevron && parts.chevron.length >= 6) {
    g.beginPath();
    g.moveTo(parts.chevron[0]!, parts.chevron[1]!);
    g.lineTo(parts.chevron[2]!, parts.chevron[3]!);
    g.lineTo(parts.chevron[4]!, parts.chevron[5]!);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.lineWidth = sw;
    g.strokeStyle = color;
    g.stroke();
  } else if (parts.circle) {
    g.beginPath();
    g.arc(parts.circle.x, parts.circle.y, parts.circle.r, 0, Math.PI * 2);
    if (parts.hollowFill) {
      g.fillStyle = bg;
      g.fill();
      g.lineWidth = Math.max(1, sw);
      g.strokeStyle = color;
      g.stroke();
    } else {
      g.fillStyle = color;
      g.fill();
    }
  }
}