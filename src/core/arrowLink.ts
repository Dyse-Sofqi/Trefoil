/**
 * 线类节点（直线/箭头）的端点绑定：fromNode / toNode 指向被磁吸连接的元素 id。
 * - 绑定端随元素移动（每次渲染前 syncBoundArrow 把锚点写回折点与包围盒）；
 * - 双端绑定 → 渲染为三次贝塞尔曲线（arrowCurve，与拓扑连线同款曲线美学）；
 * - 被连接元素删除 → 端点冻结为直线（freezeBoundArrows）。
 * 只支持两点线（绑定仅在创建时的两点箭头/直线上产生，折线不参与）。
 */
import { bezierPath, inferSides, nodeRect, sideAnchor, type Rect, type Vec } from './geometry';
import type { CanvasNode } from './types';

type NodeGetter = (id: string) => CanvasNode | undefined;

/** 两点线的世界坐标端点（不感知翻转；绑定与端点拖拽路径都已在无翻转状态下工作） */
function twoPointWorld(n: CanvasNode): [Vec, Vec] {
  const pts = n.points && n.points.length >= 2 ? n.points : [[0, 0], [n.width, n.height]];
  return [
    { x: n.x + pts[0]![0], y: n.y + pts[0]![1] },
    { x: n.x + pts[1]![0], y: n.y + pts[1]![1] },
  ];
}

/** 绑定端的锚点：取目标矩形上朝向另一端最近的边中点（端点随位置自动绕到最近的边） */
function anchorToward(target: CanvasNode, toward: Vec): Vec {
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
 * 箭头的有效端点：绑定端取目标元素锚点（动态选边），自由端取折点。
 * 绑定指向的元素不存在时按自由端处理（自愈）。
 */
export function effectiveEndpoints(n: CanvasNode, get: NodeGetter): { a: Vec; b: Vec } {
  const [p0, p1] = twoPointWorld(n);
  let a = p0;
  let b = p1;
  if (n.fromNode) {
    const t = get(n.fromNode);
    if (t) a = anchorToward(t, p1);
  }
  if (n.toNode) {
    const t = get(n.toNode);
    if (t) b = anchorToward(t, p0);
  }
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
  const minX = Math.min(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  n.x = minX;
  n.y = minY;
  n.width = Math.max(1, Math.abs(a.x - b.x));
  n.height = Math.max(1, Math.abs(a.y - b.y));
  n.points = [
    [a.x - minX, a.y - minY],
    [b.x - minX, b.y - minY],
  ];
}

/**
 * 元素删除时冻结指向它的绑定：把当前锚点固化为直线折点并清除绑定字段，
 * 箭头变成一根停在原位的普通直线（不会跟着消失，也不会指向悬空 id）。
 */
export function freezeBoundArrows(candidates: CanvasNode[], get: NodeGetter, removed: Set<string>): void {
  for (const n of candidates) {
    if (!(n.fromNode || n.toNode)) continue;
    if (!(n.fromNode && removed.has(n.fromNode)) && !(n.toNode && removed.has(n.toNode))) continue;
    const { a, b } = effectiveEndpoints(n, get);
    const minX = Math.min(a.x, b.x);
    const minY = Math.min(a.y, b.y);
    n.x = minX;
    n.y = minY;
    n.width = Math.max(1, Math.abs(a.x - b.x));
    n.height = Math.max(1, Math.abs(a.y - b.y));
    n.points = [
      [a.x - minX, a.y - minY],
      [b.x - minX, b.y - minY],
    ];
    if (n.fromNode && removed.has(n.fromNode)) n.fromNode = undefined;
    if (n.toNode && removed.has(n.toNode)) n.toNode = undefined;
  }
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

/** 创建时端点磁吸：在 (wx,wy) 半径 r 内找最近的候选元素，返回其锚点与 id */
export function magnetAnchor(
  wx: number,
  wy: number,
  r: number,
  candidates: CanvasNode[],
  visible: (id: string) => boolean,
  exclude?: string | null,
): { id: string; x: number; y: number } | null {
  let best: { id: string; x: number; y: number } | null = null;
  let bestD = r;
  for (const t of candidates) {
    if (t.id === exclude || !visible(t.id)) continue;
    if (t.type === 'trefoil/shape' && (t.shape === 'line' || t.shape === 'arrow' || t.shape === 'polyline')) continue;
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
 * 三次贝塞尔末端回缩：截掉终点处约 dist 长度的一段（曲线形状不变），
 * 让线杆的圆头线帽藏进箭头端点内部 —— 否则圆帽从三角尖端冒出来，箭头看着像圆头。
 * 曲线总长不足回缩量的 1.2 倍时原样返回（不缩）。
 */
export function trimCubicEnd(path: number[], dist: number): number[] {
  if (dist <= 0) return path;
  const total = cubicLength(path);
  if (total < dist * 1.2) return path;
  // 数值求 t：末端剩余弧长 ≈ dist
  const s = sampleCubic(path, 48);
  let remaining = 0;
  let t = 1;
  const seg = total / 48;
  for (let i = 48; i > 0; i--) {
    remaining += seg;
    if (remaining >= dist) {
      t = i / 48;
      break;
    }
  }
  return cubicPrefix(path, t);
}

/** 三次贝塞尔起端回缩（对称） */
export function trimCubicStart(path: number[], dist: number): number[] {
  if (dist <= 0) return path;
  const total = cubicLength(path);
  if (total < dist * 1.2) return path;
  const s = sampleCubic(path, 48);
  let travelled = 0;
  let t = 0;
  const seg = total / 48;
  for (let i = 1; i <= 48; i++) {
    travelled += seg;
    if (travelled >= dist) {
      t = i / 48;
      break;
    }
  }
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
