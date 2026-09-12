import type { CanvasNode } from './types';
import { isContainerNode } from './types';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Vec {
  x: number;
  y: number;
}

export const rectFromPoints = (a: Vec, b: Vec): Rect => ({
  x: Math.min(a.x, b.x),
  y: Math.min(a.y, b.y),
  width: Math.abs(a.x - b.x),
  height: Math.abs(a.y - b.y),
});

/** 允许宽高为负的矩形归一化 */
export function normalizeRect(r: Rect): Rect {
  return {
    x: r.width < 0 ? r.x + r.width : r.x,
    y: r.height < 0 ? r.y + r.height : r.y,
    width: Math.abs(r.width),
    height: Math.abs(r.height),
  };
}

export function rectsIntersect(a: Rect, b: Rect, margin = 0): boolean {
  return (
    a.x - margin < b.x + b.width &&
    a.x + a.width + margin > b.x &&
    a.y - margin < b.y + b.height &&
    a.y + a.height + margin > b.y
  );
}

export function rectContains(r: Rect, p: Vec): boolean {
  return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
}

export function unionRect(a: Rect | null, b: Rect): Rect {
  if (!a) return { ...b };
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

export function rectCenter(r: Rect): Vec {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

export function inflateRect(r: Rect, n: number): Rect {
  return { x: r.x - n, y: r.y - n, width: r.width + n * 2, height: r.height + n * 2 };
}

/** 点到矩形的最近距离（0 表示点在矩形内） */
export function pointRectDistance(p: Vec, r: Rect): number {
  const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.width));
  const dy = Math.max(r.y - p.y, 0, p.y - (r.y + r.height));
  return Math.hypot(dx, dy);
}

/** 圆（橡皮擦）与矩形是否相交/接触 */
export function circleRectIntersect(cx: number, cy: number, radius: number, r: Rect): boolean {
  return pointRectDistance({ x: cx, y: cy }, r) <= radius;
}

/** 节点的世界坐标包围盒（Document 内统一存绝对坐标） */
export function nodeRect(n: CanvasNode): Rect {
  return { x: n.x, y: n.y, width: n.width, height: n.height };
}

/** line/arrow/polyline 等由 points 决定的包围盒 */
export function pointsBBox(points: number[][]): Rect {
  if (!points.length) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const [px, py] of points) {
    minX = Math.min(minX, px);
    minY = Math.min(minY, py);
    maxX = Math.max(maxX, px);
    maxY = Math.max(maxY, py);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** 矩形某一边上的锚点（连线 Ports） */
export function sideAnchor(r: Rect, side: 'top' | 'bottom' | 'left' | 'right'): Vec {
  const c = rectCenter(r);
  switch (side) {
    case 'top':
      return { x: c.x, y: r.y };
    case 'bottom':
      return { x: c.x, y: r.y + r.height };
    case 'left':
      return { x: r.x, y: c.y };
    case 'right':
      return { x: r.x + r.width, y: c.y };
  }
}

/** 根据两矩形相对位置推断默认连接边 */
export function inferSides(from: Rect, to: Rect): {
  fromSide: 'top' | 'bottom' | 'left' | 'right';
  toSide: 'top' | 'bottom' | 'left' | 'right';
} {
  const fc = rectCenter(from);
  const tc = rectCenter(to);
  const dx = tc.x - fc.x;
  const dy = tc.y - fc.y;
  if (Math.abs(dx) > Math.abs(dy)) {
    return { fromSide: dx > 0 ? 'right' : 'left', toSide: dx > 0 ? 'left' : 'right' };
  }
  return { fromSide: dy > 0 ? 'bottom' : 'top', toSide: dy > 0 ? 'top' : 'bottom' };
}

/** 贝塞尔连接线的路径点 + 终点切线（用于箭头） */
export function bezierPath(a: Vec, aSide: string, b: Vec, bSide: string): { path: Vec[]; endTangent: Vec } {
  const na = sideNormal(aSide);
  const nb = sideNormal(bSide);
  const dist = Math.max(24, Math.hypot(b.x - a.x, b.y - a.y) * 0.4);
  const c1 = { x: a.x + na.x * dist, y: a.y + na.y * dist };
  const c2 = { x: b.x + nb.x * dist, y: b.y + nb.y * dist };
  return { path: [a, c1, c2, b], endTangent: { x: b.x - c2.x, y: b.y - c2.y } };
}

function sideNormal(side: string): Vec {
  switch (side) {
    case 'top':
      return { x: 0, y: -1 };
    case 'bottom':
      return { x: 0, y: 1 };
    case 'left':
      return { x: -1, y: 0 };
    default:
      return { x: 1, y: 0 };
  }
}

export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export const round2 = (v: number) => Math.round(v * 100) / 100;

export function isContainer(n: CanvasNode | undefined): n is CanvasNode {
  return !!n && isContainerNode(n);
}
