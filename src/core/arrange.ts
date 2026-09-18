/**
 * 多选元素排列（横向 / 纵向 / 矩阵）。纯函数，不依赖文档模型。
 *
 * 基准（anchor）决定间距的度量方式与整体锚定的参考点：
 * - 'top-left'：以元素左上角为基准 —— 间距 = 相邻元素包围盒边缘的间距；整体保持选中包围盒的左上角不动。
 * - 'center'：  以元素几何中心为基准 —— 间距 = 相邻元素几何中心的间距；整体保持选中包围盒的几何中心不动。
 *
 * 排序与选择顺序无关，按位置确定性排序：
 * - horizontal 按 x（并列按 y）；vertical / matrix 按 y（并列按 x），矩阵行优先（逐行从左到右）填充。
 * - 矩阵按列对齐：列宽 / 行高取该列 / 该行元素的最大值（top-left）；center 基准时元素落在（列中心 × 行中心）网格上。
 */

import type { Vec } from './geometry';
import { isLineLike } from './types';

export type ArrangeMode = 'horizontal' | 'vertical' | 'matrix' | 'ring';
export type ArrangeAnchor = 'top-left' | 'center';

/** 环形分布：even = 均分整圆（相邻角距 = 360°/n）；step = 固定角度间距 */
export type RingDistribute = 'even' | 'step';
/** 环上排序依据：angle = 当前围绕圆心的角度；x / y = 中心坐标；selection = 传入顺序 */
export type RingOrderBy = 'angle' | 'x' | 'y' | 'selection';

export interface RingOptions {
  /** 圆心（世界坐标）。缺省 = 当前所选元素包围盒的几何中心 */
  center?: Vec;
  /** 半径（圆心到元素几何中心） */
  radius: number;
  distribute: RingDistribute;
  /** 固定间距模式的相邻角距（度，均分模式忽略） */
  angleStep: number;
  /** 起始角（度，0 = 正上方，顺时针为正） */
  startAngle: number;
  /** true = 顺时针排布，false = 逆时针 */
  clockwise: boolean;
  orderBy: RingOrderBy;
}

export interface ArrangeBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ArrangeParams {
  mode: ArrangeMode;
  anchor: ArrangeAnchor;
  /** 横向间距（horizontal / matrix） */
  gapX: number;
  /** 纵向间距（vertical / matrix） */
  gapY: number;
  /** 矩阵每行元素数（≥1） */
  perRow: number;
  /** 环形排列参数（mode = 'ring' 时生效） */
  ring?: RingOptions;
}

export type ArrangePositions = Map<string, { x: number; y: number }>;

/**
 * 从选中集合里挑出「独立排位」的元素（其余按跟随者处理）：
 * - 线类节点（直线/箭头/折线）不占位：它们的包围盒不表示形状（对角线的盒子大半是空的），
 *   且绑定箭头的位置由两端元素推导 —— 让它们占环位/列位会把真实元素挤得七零八落；
 * - 容器与其子节点同时被选中时，子节点跟随容器平移，不独立占位（保持容器内部相对布局）。
 */
export function arrangeTargets<T extends { id: string; type: string; shape?: string; containerId?: string | null }>(nodes: T[]): T[] {
  const containers = new Set(nodes.filter((n) => n.type === 'trefoil/container').map((n) => n.id));
  return nodes.filter((n) => !isLineLike(n) && !(n.containerId && containers.has(n.containerId)));
}

/** 角度约定：0° = 正上方，顺时针为正，归一化到 [0, 360) */
function mod360(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

function angleAround(b: ArrangeBox, center: Vec): number {
  return mod360((Math.atan2(b.x + b.width / 2 - center.x, -(b.y + b.height / 2 - center.y)) * 180) / Math.PI);
}

function boxesCenter(boxes: ArrangeBox[]): Vec {
  const minX = Math.min(...boxes.map((b) => b.x));
  const minY = Math.min(...boxes.map((b) => b.y));
  const maxX = Math.max(...boxes.map((b) => b.x + b.width));
  const maxY = Math.max(...boxes.map((b) => b.y + b.height));
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

/**
 * 元素是否仍全待在「以 center 为圆心、radius 为半径」的环上（容差含半径取整误差）。
 * 用于判断重排时能否沿用原圆心：元素被拖走 / 换了一批元素 → false。
 */
export function onRing(boxes: ArrangeBox[], center: Vec, radius: number, tol = 2): boolean {
  if (!boxes.length) return false;
  return boxes.every(
    (b) => Math.abs(Math.hypot(b.x + b.width / 2 - center.x, b.y + b.height / 2 - center.y) - radius) <= tol,
  );
}

/**
 * 环形排列的圆心：同一批元素还待在原环上 → 沿用旧圆心（保证重复排列幂等）；
 * 否则按当前布局重新拟合（包围盒中心）。
 *
 * 必须沿用而不是每次重算：元素上环后，「元素包围盒中心」与环心只在尺寸完全对称时才重合，
 * 尺寸不同就会偏开一段 —— 用偏移过的参考点重算半径，半径会被越推越大（连续点「环形」的失控增长）。
 */
export function resolveRingCenter(
  boxes: ArrangeBox[],
  opts: { radius: number; prevCenter: Vec | null; sameSet: boolean; tol?: number },
): Vec | null {
  if (!boxes.length) return opts.prevCenter;
  const { prevCenter, sameSet, radius, tol } = opts;
  if (prevCenter && sameSet && onRing(boxes, prevCenter, radius, tol)) return prevCenter;
  return boxesCenter(boxes);
}

/**
 * 环形半径拟合：元素几何中心到「包围盒中心」的最大距离（下限 min），
 * 用于首次进入环形模式时贴合现有位置。
 * 只在进入模式时算一次 —— 对已排好的环重算，会因尺寸不对称（环心 ≠ 包围盒中心）逐次放大半径。
 */
export function fitRingRadius(boxes: ArrangeBox[], min = 40): number {
  if (!boxes.length) return min;
  const c = boxesCenter(boxes);
  let maxDist = min;
  for (const b of boxes) maxDist = Math.max(maxDist, Math.hypot(b.x + b.width / 2 - c.x, b.y + b.height / 2 - c.y));
  return Math.round(maxDist);
}

export function computeArrange(boxes: ArrangeBox[], p: ArrangeParams): ArrangePositions {
  const out: ArrangePositions = new Map();
  if (!boxes.length) return out;

  if (p.mode === 'ring') {
    const ring = p.ring;
    if (!ring) return out;
    const center = ring.center ?? boxesCenter(boxes);
    const ordered = [...boxes];
    if (ring.orderBy === 'x') ordered.sort((a, b) => a.x + a.width / 2 - (b.x + b.width / 2));
    else if (ring.orderBy === 'y') ordered.sort((a, b) => a.y + a.height / 2 - (b.y + b.height / 2));
    else if (ring.orderBy === 'angle') ordered.sort((a, b) => angleAround(a, center) - angleAround(b, center));
    // 'selection'：保持传入顺序
    const step = ring.distribute === 'even' ? 360 / ordered.length : ring.angleStep;
    const dirSign = ring.clockwise ? 1 : -1;
    ordered.forEach((b, i) => {
      const deg = mod360(ring.startAngle + dirSign * step * i);
      const rad = (deg * Math.PI) / 180;
      // 0° 指向正上方，顺时针为正：x = cx + r·sin，y = cy − r·cos
      const cx = center.x + ring.radius * Math.sin(rad);
      const cy = center.y - ring.radius * Math.cos(rad);
      out.set(b.id, { x: cx - b.width / 2, y: cy - b.height / 2 });
    });
    return out;
  }

  const items = [...boxes];
  if (p.mode === 'horizontal') items.sort((a, b) => a.x - b.x || a.y - b.y);
  else items.sort((a, b) => a.y - b.y || a.x - b.x);

  const minX = Math.min(...items.map((b) => b.x));
  const minY = Math.min(...items.map((b) => b.y));
  const maxX = Math.max(...items.map((b) => b.x + b.width));
  const maxY = Math.max(...items.map((b) => b.y + b.height));
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const gapX = Math.max(0, p.gapX);
  const gapY = Math.max(0, p.gapY);

  if (p.mode === 'horizontal') {
    if (p.anchor === 'center') {
      // 中心依次相距 gapX，再整体平移使包围盒中心与原中心重合
      const centers = items.map((_, i) => i * gapX);
      let left = Infinity;
      let right = -Infinity;
      items.forEach((b, i) => {
        left = Math.min(left, centers[i] - b.width / 2);
        right = Math.max(right, centers[i] + b.width / 2);
      });
      const shift = centerX - (left + right) / 2;
      items.forEach((b, i) => out.set(b.id, { x: centers[i] + shift - b.width / 2, y: centerY - b.height / 2 }));
    } else {
      let cursor = minX;
      for (const b of items) {
        out.set(b.id, { x: cursor, y: minY });
        cursor += b.width + gapX;
      }
    }
    return out;
  }

  if (p.mode === 'vertical') {
    if (p.anchor === 'center') {
      const centers = items.map((_, i) => i * gapY);
      let top = Infinity;
      let bottom = -Infinity;
      items.forEach((b, i) => {
        top = Math.min(top, centers[i] - b.height / 2);
        bottom = Math.max(bottom, centers[i] + b.height / 2);
      });
      const shift = centerY - (top + bottom) / 2;
      items.forEach((b, i) => out.set(b.id, { x: centerX - b.width / 2, y: centers[i] + shift - b.height / 2 }));
    } else {
      let cursor = minY;
      for (const b of items) {
        out.set(b.id, { x: minX, y: cursor });
        cursor += b.height + gapY;
      }
    }
    return out;
  }

  // 矩阵：行优先填充，每行 cols 个
  const cols = Math.max(1, Math.min(Math.floor(p.perRow) || 1, items.length));
  if (p.anchor === 'center') {
    // 单元格中心网格：列中心距 gapX、行中心距 gapY，元素以几何中心落格；整体平移使包围盒中心不动
    const centers = items.map((_, i) => ({ cx: (i % cols) * gapX, cy: Math.floor(i / cols) * gapY }));
    let left = Infinity;
    let right = -Infinity;
    let top = Infinity;
    let bottom = -Infinity;
    items.forEach((b, i) => {
      left = Math.min(left, centers[i].cx - b.width / 2);
      right = Math.max(right, centers[i].cx + b.width / 2);
      top = Math.min(top, centers[i].cy - b.height / 2);
      bottom = Math.max(bottom, centers[i].cy + b.height / 2);
    });
    const sx = centerX - (left + right) / 2;
    const sy = centerY - (top + bottom) / 2;
    items.forEach((b, i) =>
      out.set(b.id, { x: centers[i].cx + sx - b.width / 2, y: centers[i].cy + sy - b.height / 2 }),
    );
  } else {
    // 列对齐网格：列宽 / 行高取该列 / 该行的最大值
    const colW: number[] = [];
    const rowH: number[] = [];
    items.forEach((b, i) => {
      const c = i % cols;
      const r = Math.floor(i / cols);
      colW[c] = Math.max(colW[c] ?? 0, b.width);
      rowH[r] = Math.max(rowH[r] ?? 0, b.height);
    });
    const colX: number[] = [];
    let x = minX;
    for (let c = 0; c < cols; c++) {
      colX[c] = x;
      x += (colW[c] ?? 0) + gapX;
    }
    const rowY: number[] = [];
    let y = minY;
    for (let r = 0; r < rowH.length; r++) {
      rowY[r] = y;
      y += (rowH[r] ?? 0) + gapY;
    }
    items.forEach((b, i) => out.set(b.id, { x: colX[i % cols], y: rowY[Math.floor(i / cols)] }));
  }
  return out;
}
