/**
 * 缩放的纯计算部分。
 *
 * 图片节点的缩放和普通节点/形状是两套语义：角手柄锁宽高比（等比）、边手柄自由拉伸。
 * 这里只放图片这一套，便于单测；形状/文本那套（含跨越对侧边翻转内容）在 SelectTool 里。
 * 线类端点拖拽（setLinePoint）也在这里：纯数据重算，方便单测。
 */
import type { Rect } from './geometry';
import type { CanvasNode } from './types';

export type ResizeHandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

/** 图片缩放的最小边长：较长边不低于该值（图不能缩成一个点） */
export const IMAGE_MIN_SIZE = 32;

export interface ImageResizeInput {
  handle: ResizeHandleId;
  /** 指针相对按下点的世界坐标位移 */
  dx: number;
  dy: number;
  /** 按下时的节点矩形 */
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 图片缩放结果矩形。
 *
 * 两个必须守住的性质（此前都错了，表现为「一按下手柄图片就飘走 / 翻转」）：
 * 1. **位移为 0 时必须是恒等变换**（返回按下时的矩形），否则第一帧就会跳。
 * 2. **锚点取手柄的对角**，且方向随手柄左右/上下而变；不能所有手柄都锚在左上。
 *
 * 宽高比取「按下时的当前形状」，而不是原图 fileSize：这样拖动全程连续，
 * 不会因为节点此前被边手柄自由拉伸过而突然弹回原始比例。
 */
export function resizeImageRect(inp: ImageResizeInput): Rect {
  const sw = Math.max(1, inp.width);
  const sh = Math.max(1, inp.height);
  const cw = inp.handle.includes('w') ? -1 : inp.handle.includes('e') ? 1 : 0;
  const ch = inp.handle.includes('n') ? -1 : inp.handle.includes('s') ? 1 : 0;

  if (cw !== 0 && ch !== 0) {
    // 角手柄：等比缩放。取位移更大的那一轴定缩放比例，另一轴跟随，
    // 避免斜向拖动时两轴各算一套、互相打架。
    const optA = cw * inp.dx;
    const optB = ch * inp.dy;
    const k = Math.abs(optA) >= Math.abs(optB) ? (sw + optA) / sw : (sh + optB) / sh;
    // 缩放下限：到最小尺寸就停住（图片不支持内容翻转，越过锚点若去镜像只会像"瞬移"）
    const minScale = Math.min(1, IMAGE_MIN_SIZE / Math.max(sw, sh));
    const scale = Math.max(k, minScale);
    const width = sw * scale;
    const height = sh * scale;
    return {
      // 锚点 = 对角：e/s 方向手柄锚在左/上边，w/n 方向手柄锚在右/下边
      x: cw > 0 ? inp.x : inp.x + sw - width,
      y: ch > 0 ? inp.y : inp.y + sh - height,
      width,
      height,
    };
  }

  // 边手柄：自由拉伸单边，不锁比例
  let left = inp.x;
  let right = inp.x + sw;
  let top = inp.y;
  let bottom = inp.y + sh;
  if (cw < 0) left = inp.x + inp.dx;
  else if (cw > 0) right = inp.x + sw + inp.dx;
  if (ch < 0) top = inp.y + inp.dy;
  else if (ch > 0) bottom = inp.y + sh + inp.dy;
  return {
    x: Math.min(left, right),
    y: Math.min(top, bottom),
    width: Math.max(1, Math.abs(right - left)),
    height: Math.max(1, Math.abs(bottom - top)),
  };
}

// ---------- 线类端点拖拽（直线/箭头/折线） ----------

/** 线类节点的折点（相对节点 x,y）；缺省为对角线两点，与 NodeView.pointsOf 保持一致 */
function linePointsOf(n: CanvasNode): number[][] {
  if (n.points && n.points.length >= 2) return n.points;
  return [
    [0, 0],
    [n.width, n.height],
  ];
}

/**
 * 把线类节点的第 index 个折点拖到世界坐标 (wx, wy)。
 * points 存的是相对节点 x,y 的局部坐标，端点越出原包围盒后必须整体重排：
 * 平移 x/y 使最小折点回到原点，width/height 取折点包围盒，其余折点保持世界位置不动。
 * 原地修改节点（与拖拽 live 语义一致）。
 */
export function setLinePoint(n: CanvasNode, index: number, wx: number, wy: number): void {
  const pts = linePointsOf(n).map(([px, py]) => [px + n.x, py + n.y]);
  const i = Math.max(0, Math.min(index, pts.length - 1));
  pts[i] = [wx, wy];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [px, py] of pts) {
    minX = Math.min(minX, px);
    minY = Math.min(minY, py);
    maxX = Math.max(maxX, px);
    maxY = Math.max(maxY, py);
  }
  n.x = minX;
  n.y = minY;
  n.width = Math.max(1, maxX - minX);
  n.height = Math.max(1, maxY - minY);
  n.points = pts.map(([px, py]) => [px - minX, py - minY]);
}

/**
 * 把线类节点的翻转状态烘进折点：镜像后的折点写回 points 并清除 flipX/flipY。
 * 视觉完全不变（镜像围绕节点包围盒，两端各自落到原视觉位置），
 * 之后端点拖拽/归一化都只需面对普通坐标。
 */
export function bakeLineFlip(n: CanvasNode): void {
  if (!n.flipX && !n.flipY) return;
  n.points = linePointsOf(n).map(([px, py]) => [n.flipX ? n.width - px : px, n.flipY ? n.height - py : py]);
  n.flipX = false;
  n.flipY = false;
}

/**
 * 线类节点包围盒归一：把 x/y/width/height 收紧到折点的实际范围（折点保持世界位置）。
 * 修复旧版本撤销不记 points 造成的「选中框比线大一圈 / 端点对不上」残留数据。
 * 注意：翻转状态下包围盒是镜像锚点，归一会改变视觉，这种节点交给 bakeLineFlip 处理，此处直接跳过。
 */
export function normalizeLineBBox(n: CanvasNode): void {
  if (n.flipX || n.flipY) return;
  const pts = n.points;
  if (!pts || pts.length < 2) return;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [px, py] of pts) {
    minX = Math.min(minX, px);
    minY = Math.min(minY, py);
    maxX = Math.max(maxX, px);
    maxY = Math.max(maxY, py);
  }
  if (!Number.isFinite(minX)) return;
  n.x += minX;
  n.y += minY;
  n.width = Math.max(1, maxX - minX);
  n.height = Math.max(1, maxY - minY);
  n.points = pts.map(([px, py]) => [px - minX, py - minY]);
}
