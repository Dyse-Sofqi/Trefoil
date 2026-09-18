/**
 * 线类节点（直线/箭头）的端点绑定：fromNode / toNode 指向被磁吸连接的元素 id。
 * - 绑定端随元素移动（每次渲染前 syncBoundArrow 把锚点写回折点与包围盒）；
 * - 双端绑定 → 渲染为三次贝塞尔曲线（arrowCurve，与拓扑连线同款曲线美学）；
 *   锚点选边与渲染同源（inferSides），包围盒覆盖曲线控制点 —— 折点/选中框与实体不分离；
 * - 被连接元素删除 → 端点冻结为直线（freezeBoundArrows）。
 * 只支持两点线（绑定仅在创建时的两点箭头/直线上产生，折线不参与）。
 */
import { bezierPath, inferSides, nodeRect, segmentIntersectsRect, sideAnchor, type Rect, type Vec } from './geometry';
import type { CanvasNode } from './types';

type NodeGetter = (id: string) => CanvasNode | undefined;

/** 端点磁吸半径（屏幕 px）：落点在此距离内即吸附到元素边缘锚点并建立绑定 */
export const MAGNET_PX = 14;

/** 可作为端点磁吸/重绑目标的元素：线类形状（直线/箭头/折线）不参与绑定 */
export function isLinkableTarget(n: CanvasNode): boolean {
  return !(n.type === 'trefoil/shape' && (n.shape === 'line' || n.shape === 'arrow' || n.shape === 'polyline'));
}

/** 两点线的世界坐标端点（不感知翻转；绑定与端点拖拽路径都已在无翻转状态下工作） */
function twoPointWorld(n: CanvasNode): [Vec, Vec] {
  const pts = n.points && n.points.length >= 2 ? n.points : [[0, 0], [n.width, n.height]];
  return [
    { x: n.x + pts[0]![0], y: n.y + pts[0]![1] },
    { x: n.x + pts[1]![0], y: n.y + pts[1]![1] },
  ];
}

/** 绑定端的锚点：取目标矩形上朝向另一端最近的边中点（端点随位置自动绕到最近的边） */
export function anchorToward(target: CanvasNode, toward: Vec): Vec {
  const r = nodeRect(target);
  const dl = Math.abs(toward.x - r.x);
  const dr = Math.abs(toward.x - (r.x + r.width));
  const dt = Math.abs(toward.y - r.y);
  const db = Math.abs(toward.y - (r.y + r.height));
  const min = Math.min(dl, dr, dt, db);
  const side = min === dl ? 'left' : min === dr ? 'right' : min === dt ? 'top' : 'bottom';
  return sideAnchor(r, side);
}

/**
 * 箭头的有效端点：绑定端取目标元素锚点，自由端取折点。
 * 双端绑定 → 与渲染端 arrowCurve 完全同源（inferSides 选边）：折点、包围盒、选中框
 * 必须与画出来的曲线严丝合缝，否则「实体和边框不在同一位置」。
 * 单端绑定 → 绑定端朝向自由端取最近边；绑定目标不存在时按自由端处理（自愈）。
 */
export function effectiveEndpoints(n: CanvasNode, get: NodeGetter): { a: Vec; b: Vec } {
  const [p0, p1] = twoPointWorld(n);
  const f = n.fromNode ? get(n.fromNode) : undefined;
  const t = n.toNode ? get(n.toNode) : undefined;
  if (f && t) {
    const fr = nodeRect(f);
    const tr = nodeRect(t);
    const sides = inferSides(fr, tr);
    return { a: sideAnchor(fr, sides.fromSide), b: sideAnchor(tr, sides.toSide) };
  }
  let a = p0;
  let b = p1;
  if (f) a = anchorToward(f, p1);
  if (t) b = anchorToward(t, p0);
  return { a, b };
}

/** 双端绑定是否成立（两端都指向现存元素）——成立时渲染为三次贝塞尔 */
export function isBoundCurve(n: CanvasNode, get: NodeGetter): boolean {
  return !!n.fromNode && !!n.toNode && !!get(n.fromNode!) && !!get(n.toNode!);
}

export interface ArrowCurve {
  /** [起点, 控制点1, 控制点2, 终点] 扁平数组（Konva.Line bezier / SVG cubic 直接可用） */
  path: number[];
  endTangent: Vec;
  startTangent: Vec;
}

/** 双端绑定的三次贝塞尔曲线（与拓扑连线同款：锚点在边缘中点，控制点沿法向张力 0.4） */
export function arrowCurve(n: CanvasNode, get: NodeGetter): ArrowCurve | null {
  if (!n.fromNode || !n.toNode) return null;
  const f = get(n.fromNode);
  const t = get(n.toNode);
  if (!f || !t) return null;
  const fr = nodeRect(f);
  const tr = nodeRect(t);
  const sides = inferSides(fr, tr);
  const a = sideAnchor(fr, sides.fromSide);
  const b = sideAnchor(tr, sides.toSide);
  const { path, endTangent } = bezierPath(a, sides.fromSide, b, sides.toSide);
  return {
    path: path.flatMap((p) => [p.x, p.y]),
    endTangent,
    startTangent: { x: path[1]!.x - path[0]!.x, y: path[1]!.y - path[0]!.y },
  };
}

/**
 * 渲染前同步：把绑定端的锚点写回折点，并把包围盒收紧到两端点（其余数据随两端重排）。
 * 单端绑定 → 折点记录直线两端；双端绑定 → 折点记录曲线两端弦（渲染仍走贝塞尔）。
 * 在渲染循环中调用（Document 变更后），不进撤销栈。
 */
export function syncBoundArrow(n: CanvasNode, get: NodeGetter): void {
  if (!n.fromNode && !n.toNode) return;
  // 悬空绑定自愈：元素已删却未被冻结（理论不可达），退化为自由端
  if (n.fromNode && !get(n.fromNode)) n.fromNode = undefined;
  if (n.toNode && !get(n.toNode)) n.toNode = undefined;
  if (!n.fromNode && !n.toNode) return;
  const { a, b } = effectiveEndpoints(n, get);
  // 双端绑定的贝塞尔会拱出弦包围盒：包围盒必须覆盖控制点（凸包性），
  // 否则多选选中框 / 框选范围只贴着两端锚点的连线，与画出来的弧线错位。
  const curve = arrowCurve(n, get);
  applyBoundBox(n, a, b, curve?.path ?? null);
}

/**
 * 把包围盒写回节点：范围取两端点 ∪ 曲线控制点（凸包性质保证包住整条弧线）。
 * points 记录两端点相对新原点的位置，端点世界坐标保持不变。
 */
function applyBoundBox(n: CanvasNode, a: Vec, b: Vec, path: number[] | null): void {
  let minX = Math.min(a.x, b.x);
  let minY = Math.min(a.y, b.y);
  let maxX = Math.max(a.x, b.x);
  let maxY = Math.max(a.y, b.y);
  if (path) {
    for (let i = 0; i + 1 < path.length; i += 2) {
      minX = Math.min(minX, path[i]!);
      maxX = Math.max(maxX, path[i]!);
      minY = Math.min(minY, path[i + 1]!);
      maxY = Math.max(maxY, path[i + 1]!);
    }
  }
  n.x = minX;
  n.y = minY;
  n.width = Math.max(1, maxX - minX);
  n.height = Math.max(1, maxY - minY);
  n.points = [
    [a.x - minX, a.y - minY],
    [b.x - minX, b.y - minY],
  ];
}

/** 把绑定端锚点固化为直线折点并重排包围盒；绑定字段的保留/清除由调用方决定 */
export function bakeBoundArrowEndpoints(n: CanvasNode, get: NodeGetter): void {
  const { a, b } = effectiveEndpoints(n, get);
  applyBoundBox(n, a, b, null);
}

/**
 * 整体冻结一条绑定箭头：锚点固化为折点并清除全部绑定（用于“拖动绑定箭头本体”时
 * 解除磁吸，否则渲染循环的 syncBoundArrow 会把它吸回元素上，表现为拖不动）。
 */
export function freezeBoundArrow(n: CanvasNode, get: NodeGetter): void {
  bakeBoundArrowEndpoints(n, get);
  n.fromNode = undefined;
  n.toNode = undefined;
}

/**
 * 元素删除时冻结所有指向被删元素的绑定箭头：只清除被删一侧的绑定，
 * 另一侧若仍绑定则保留（箭头变直线但仍跟随幸存元素）。
 */
export function freezeBoundArrows(candidates: CanvasNode[], get: NodeGetter, removed: Set<string>): void {
  for (const n of candidates) {
    if (!(n.fromNode || n.toNode)) continue;
    if (!(n.fromNode && removed.has(n.fromNode)) && !(n.toNode && removed.has(n.toNode))) continue;
    bakeBoundArrowEndpoints(n, get);
    if (n.fromNode && removed.has(n.fromNode)) n.fromNode = undefined;
    if (n.toNode && removed.has(n.toNode)) n.toNode = undefined;
  }
}

/**
 * 线类节点的世界坐标折线（= 渲染出来的实体）：
 * - 双端绑定 → 贝塞尔曲线采样（命中/框选都必须按拱起的弧线，而不是弦）；
 * - 直线/箭头/折线 → 折点（过翻转镜像：视觉线是翻转后的那条）。
 * 点选容差与框选判定都以它为唯一几何来源，避免"选中的范围"和"看到的线"对不上。
 */
export function linePolyline(n: CanvasNode, get?: NodeGetter, steps = 24): Vec[] {
  if (get && n.fromNode && n.toNode) {
    const curve = arrowCurve(n, get);
    if (curve) {
      const s = sampleCubic(curve.path, steps);
      const pts: Vec[] = [];
      for (let i = 0; i + 1 < s.length; i += 2) pts.push({ x: s[i]!, y: s[i + 1]! });
      return pts;
    }
  }
  const raw = n.points && n.points.length >= 2 ? n.points : [[0, 0], [n.width, n.height]];
  return raw.map(([px, py]) => ({
    x: n.x + (n.flipX ? n.width - px : px),
    y: n.y + (n.flipY ? n.height - py : py),
  }));
}

/** 线类节点是否落在框选矩形内：按实体折线判定，斜线的包围盒留白不算（否则会凭空选中） */
export function lineHitsRect(n: CanvasNode, r: Rect, get?: NodeGetter): boolean {
  const path = linePolyline(n, get);
  for (let i = 0; i < path.length - 1; i++) {
    if (segmentIntersectsRect(path[i]!, path[i + 1]!, r)) return true;
  }
  return false;
}

/** 三次贝塞尔采样（t 均匀）：命中测试用折线近似曲线 */
export function sampleCubic(path: number[], steps = 12): number[] {
  const [x1, y1, cx1, cy1, cx2, cy2, x2, y2] = path;
  const out: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    const w0 = u * u * u;
    const w1 = 3 * u * u * t;
    const w2 = 3 * u * t * t;
    const w3 = t * t * t;
    out.push(w0 * x1! + w1 * cx1! + w2 * cx2! + w3 * x2!, w0 * y1! + w1 * cy1! + w2 * cy2! + w3 * y2!);
  }
  return out;
}

/** 创建/重绑时端点磁吸：在 (wx,wy) 半径 r 内找最近的候选元素，返回其锚点与 id（四向最近边） */
export function magnetAnchor(
  wx: number,
  wy: number,
  r: number,
  candidates: CanvasNode[],
  visible: (id: string) => boolean,
  exclude?: string | Iterable<string> | null,
): { id: string; x: number; y: number } | null {
  const excluded = exclude == null ? null : new Set(typeof exclude === 'string' ? [exclude] : exclude);
  let best: { id: string; x: number; y: number } | null = null;
  let bestD = r;
  for (const t of candidates) {
    if (excluded?.has(t.id) || !visible(t.id) || !isLinkableTarget(t)) continue;
    const rect: Rect = { x: t.x, y: t.y, width: t.width, height: t.height };
    const a = anchorToward(t, { x: wx, y: wy });
    const d = Math.hypot(a.x - wx, a.y - wy);
    if (d <= bestD) {
      bestD = d;
      best = { id: t.id, x: a.x, y: a.y };
    }
  }
  return best;
}

// ---------- 线型（实线/虚线/点状线） ----------

/** 线型对应的 Konva/SVG dash 数组：随描边粗细缩放；solid 返回 undefined（不设 dash） */
export function dashArray(style: string | undefined, sw: number): number[] | undefined {
  if (style === 'dashed') return [Math.max(8, sw * 4), Math.max(6, sw * 2.8)];
  if (style === 'dotted') return [1, Math.max(4, sw * 2.4)];
  return undefined;
}

// ---------- 曲线杆端回缩 / 中点 / 连线命中 ----------

/** 三次贝塞尔 de Casteljau 细分：取 [0,t] 段的 4 个新控制点（形状不变） */
function cubicPrefix(path: number[], t: number): number[] {
  const [x0, y0, x1, y1, x2, y2, x3, y3] = path;
  const ax = x0! + (x1! - x0!) * t, ay = y0! + (y1! - y0!) * t;
  const bx = x1! + (x2! - x1!) * t, by = y1! + (y2! - y1!) * t;
  const cx = x2! + (x3! - x2!) * t, cy = y2! + (y3! - y2!) * t;
  const dx = ax + (bx - ax) * t, dy = ay + (by - ay) * t;
  const ex = bx + (cx - bx) * t, ey = by + (cy - by) * t;
  const fx = dx + (ex - dx) * t, fy = dy + (ey - dy) * t;
  return [x0!, y0!, ax, ay, dx, dy, fx, fy];
}

function cubicSuffix(path: number[], t: number): number[] {
  const rev = [path[6]!, path[7]!, path[4]!, path[5]!, path[2]!, path[3]!, path[0]!, path[1]!];
  const pre = cubicPrefix(rev, 1 - t);
  return [pre[6]!, pre[7]!, pre[4]!, pre[5]!, pre[2]!, pre[3]!, pre[0]!, pre[1]!];
}

function cubicLength(path: number[], steps = 24): number {
  const s = sampleCubic(path, steps);
  let len = 0;
  for (let i = 2; i < s.length; i += 2) len += Math.hypot(s[i]! - s[i - 2]!, s[i + 1]! - s[i - 1]!);
  return len;
}

/**
 * 按弧长求参数 t：fromEnd = true 时从终点往回量 dist，否则从起点往前量。
 * 采样密度跟随曲线长度（约 2px 一段，32..512 段）并在段内线性插值 ——
 * 固定份数的粗采样（旧实现 48 份）在长曲线上一次就跳过一整段，
 * 十几像素的端点回缩会被整段忽略，线杆圆帽于是留在箭头尖上（观感：线杆与箭头两块拼的）。
 */
function tAtArc(path: number[], dist: number, fromEnd: boolean): { t: number; total: number } {
  const steps = Math.max(32, Math.min(512, Math.ceil(cubicLength(path) / 2)));
  const s = sampleCubic(path, steps);
  const cum: number[] = new Array<number>(steps + 1);
  cum[0] = 0;
  for (let i = 1; i <= steps; i++) {
    cum[i] = cum[i - 1]! + Math.hypot(s[i * 2]! - s[(i - 1) * 2]!, s[i * 2 + 1]! - s[(i - 1) * 2 + 1]!);
  }
  const total = cum[steps]!;
  const target = fromEnd ? total - dist : dist;
  if (target <= 0) return { t: fromEnd ? 1 : 0, total };
  if (target >= total) return { t: fromEnd ? 0 : 1, total };
  let i = 1;
  while (i < steps && cum[i]! < target) i++;
  const segLen = cum[i]! - cum[i - 1]!;
  const frac = segLen > 0 ? (target - cum[i - 1]!) / segLen : 0;
  return { t: (i - 1 + frac) / steps, total };
}

/**
 * 三次贝塞尔末端回缩：截掉终点处约 dist 弧长的一段（曲线形状不变），
 * 让线杆的圆头线帽藏进箭头端点内部 —— 否则圆帽从三角尖端冒出来，箭头看着像圆头。
 * 曲线总长不足回缩量的 1.2 倍时原样返回（不缩）。
 */
export function trimCubicEnd(path: number[], dist: number): number[] {
  if (dist <= 0) return path;
  const { t, total } = tAtArc(path, dist, true);
  if (total < dist * 1.2) return path;
  return cubicPrefix(path, t);
}

/** 三次贝塞尔起端回缩（对称） */
export function trimCubicStart(path: number[], dist: number): number[] {
  if (dist <= 0) return path;
  const { t, total } = tAtArc(path, dist, false);
  if (total < dist * 1.2) return path;
  return cubicSuffix(path, t);
}

/** 三次贝塞尔中点（t = 0.5） */
export function cubicMidpoint(path: number[]): Vec {
  const [x0, y0, x1, y1, x2, y2, x3, y3] = path;
  return {
    x: 0.125 * x0! + 0.375 * x1! + 0.375 * x2! + 0.125 * x3!,
    y: 0.125 * y0! + 0.375 * y1! + 0.375 * y2! + 0.125 * y3!,
  };
}

/** 折线按弧长取中点（接受 [x,y] 数组或 {x,y} 数组） */
export function polylineMidpoint(pts: (number[] | { x: number; y: number })[]): Vec {
  const P = pts.map((p) => (Array.isArray(p) ? { x: p[0]!, y: p[1]! } : p));
  let total = 0;
  const lens: number[] = [];
  for (let i = 1; i < P.length; i++) {
    const l = Math.hypot(P[i]!.x - P[i - 1]!.x, P[i]!.y - P[i - 1]!.y);
    lens.push(l);
    total += l;
  }
  let acc = 0;
  for (let i = 0; i < lens.length; i++) {
    if (acc + lens[i]! >= total / 2 && lens[i]! > 0) {
      const t = (total / 2 - acc) / lens[i]!;
      return { x: P[i]!.x + (P[i + 1]!.x - P[i]!.x) * t, y: P[i]!.y + (P[i + 1]!.y - P[i]!.y) * t };
    }
    acc += lens[i];
  }
  return { x: P[0]!.x, y: P[0]!.y };
}

/**
 * 连线（Edge）的曲线几何：与 EdgeView 渲染完全同源（普通连线三次贝塞尔 / 导图专用曲线），
 * 供命中测试与选中高亮使用。任一端元素缺失返回 null。
 */
export function edgeCurvePath(
  edge: { fromNode: string; toNode: string; fromSide?: string; toSide?: string; kind?: string },
  from: Rect,
  to: Rect,
  bezierPathFn: (a: Vec, aSide: string, b: Vec, bSide: string) => { path: Vec[] },
  mindmapFn: (from: Rect, to: Rect) => { path: Vec[] },
): number[] | null {
  let path: Vec[];
  if (edge.kind === 'mindmap') {
    path = mindmapFn(from, to).path;
  } else {
    const sides = inferSides(from, to);
    path = bezierPathFn(sideAnchor(from, (edge.fromSide ?? sides.fromSide) as never), (edge.fromSide ?? sides.fromSide) as never, sideAnchor(to, (edge.toSide ?? sides.toSide) as never), (edge.toSide ?? sides.toSide) as never).path;
  }
  return path.flatMap((p) => [p.x, p.y]);
}
