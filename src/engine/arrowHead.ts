/**
 * 箭头端点（arrowhead）几何：节点渲染、绘制预览（Overlay）、单形状绘制（arrowPaint）共用。
 * 端点始终位于线杆终点上，尺寸随描边粗细缩放；
 * 实心/空心端点会把线杆回缩（shaftEnd），避免杆头圆帽从尖端冒出来（旧版箭头"圆头"的根源）。
 */
import type { ArrowHeadStyle } from '../core/types';
import type { Vec } from '../core/geometry';

/** 三角/线段型端点长度（世界单位） */
export function headLength(sw: number): number {
  return Math.max(11, sw * 3.6);
}

/** 圆点型端点半径 */
export function headRadius(sw: number): number {
  return Math.max(3.5, sw * 1.8);
}

export interface ArrowHeadParts {
  /** 线杆应回缩到的点（沿端点方向往回退），'none' 之外样式必非原终点 */
  shaftEnd: Vec;
  /** 实心/空心三角（closed 多边形顶点） */
  triangle?: number[];
  /** 线段型端点（开放式 V 形折线顶点） */
  chevron?: number[];
  /** 圆点型端点 */
  circle?: { x: number; y: number; r: number };
  /** true = 三角/圆点内部需先垫画布底色遮住线杆（空心系列） */
  hollowFill: boolean;
}

/**
 * 端点件把线杆往回缩的距离（世界单位）：只与样式/线宽有关，与方向无关。
 * 线杆据此回缩后，圆头线帽才能藏进端点件内部（不缩 → 圆帽从尖里冒出来）。
 */
export function headRetract(sw: number, style: ArrowHeadStyle): number {
  if (style === 'none') return 0;
  const len = headLength(sw);
  if (style === 'hollow') return len;
  if (style === 'solid') return len * 0.6;
  if (style === 'chevron') return len * 0.25;
  return headRadius(sw) * 0.6; // dot / hollow-dot
}

/** 计算 from→to 方向上、落在 to 处的端点绘制件；style 为 none 时返回 null */
export function arrowHeadParts(from: Vec, to: Vec, sw: number, style: ArrowHeadStyle): ArrowHeadParts | null {
  if (style === 'none') return null;
  const ang = Math.atan2(to.y - from.y, to.x - from.x);
  const ux = Math.cos(ang);
  const uy = Math.sin(ang);
  const nx = -uy;
  const ny = ux; // 左法向
  const back = (d: number): Vec => ({ x: to.x - ux * d, y: to.y - uy * d });
  const parts: ArrowHeadParts = { shaftEnd: back(headRetract(sw, style)), hollowFill: false };

  if (style === 'solid' || style === 'hollow') {
    const len = headLength(sw);
    const half = len * 0.44;
    const b = back(len);
    parts.triangle = [to.x, to.y, b.x + nx * half, b.y + ny * half, b.x - nx * half, b.y - ny * half];
    parts.hollowFill = style === 'hollow';
  } else if (style === 'chevron') {
    const len = headLength(sw);
    const half = len * 0.52;
    const b = back(len);
    parts.chevron = [b.x + nx * half, b.y + ny * half, to.x, to.y, b.x - nx * half, b.y - ny * half];
  } else {
    const r = headRadius(sw);
    parts.circle = { x: to.x, y: to.y, r };
    parts.hollowFill = style === 'hollow-dot';
  }
  return parts;
}
