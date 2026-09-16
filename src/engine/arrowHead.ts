/**
 * 箭头端点（arrowhead）几何与绘制：节点渲染、绘制预览（Overlay）共用。
 * 端点始终位于线杆终点上，尺寸随描边粗细缩放；
 * 实心/空心端点会把线杆回缩（shaftEnd），避免杆头圆帽从尖端冒出来（旧版箭头"圆头"的根源）。
 */
import Konva from 'konva';
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

/** 计算 from→to 方向上、落在 to 处的端点绘制件；style 为 none 时返回 null */
export function arrowHeadParts(from: Vec, to: Vec, sw: number, style: ArrowHeadStyle): ArrowHeadParts | null {
  if (style === 'none') return null;
  const ang = Math.atan2(to.y - from.y, to.x - from.x);
  const ux = Math.cos(ang);
  const uy = Math.sin(ang);
  const nx = -uy;
  const ny = ux; // 左法向
  const back = (d: number): Vec => ({ x: to.x - ux * d, y: to.y - uy * d });
  const parts: ArrowHeadParts = { shaftEnd: to, hollowFill: false };

  if (style === 'solid' || style === 'hollow') {
    const len = headLength(sw);
    const half = len * 0.44;
    const b = back(len);
    parts.triangle = [to.x, to.y, b.x + nx * half, b.y + ny * half, b.x - nx * half, b.y - ny * half];
    parts.hollowFill = style === 'hollow';
    // 实心：回缩到三角内部即可挡住圆帽；空心：底边有描边且内部垫底色，回缩更深
    parts.shaftEnd = back(style === 'hollow' ? len : len * 0.6);
  } else if (style === 'chevron') {
    const len = headLength(sw);
    const half = len * 0.52;
    const b = back(len);
    parts.chevron = [b.x + nx * half, b.y + ny * half, to.x, to.y, b.x - nx * half, b.y - ny * half];
    // V 形尖端是开放的，杆稍微回缩避免圆帽盖过尖点
    parts.shaftEnd = back(len * 0.25);
  } else {
    const r = headRadius(sw);
    parts.circle = { x: to.x, y: to.y, r };
    parts.hollowFill = style === 'hollow-dot';
    parts.shaftEnd = back(r * 0.6);
  }
  return parts;
}

/** 把一组端点绘制件画进 Konva 组（坐标已在目标坐标系内） */
export function addHeadShapes(
  group: Konva.Group,
  parts: ArrowHeadParts,
  color: string,
  sw: number,
  bgColor: string,
): void {
  if (parts.triangle) {
    group.add(
      new Konva.Line({
        closed: true,
        points: parts.triangle,
        fill: parts.hollowFill ? bgColor : color,
        // 空心三角：底色填充 + 描边勾勒轮廓（圆角连接会让尖端发钝，保持默认尖角）
        stroke: parts.hollowFill ? color : undefined,
        strokeWidth: parts.hollowFill ? Math.max(1, sw) : undefined,
        listening: false,
      }),
    );
  }
  if (parts.chevron) {
    group.add(
      new Konva.Line({
        points: parts.chevron,
        stroke: color,
        strokeWidth: sw,
        lineCap: 'round',
        lineJoin: 'round',
        listening: false,
      }),
    );
  }
  if (parts.circle) {
    group.add(
      new Konva.Circle({
        x: parts.circle.x,
        y: parts.circle.y,
        radius: parts.circle.r,
        fill: parts.hollowFill ? bgColor : color,
        stroke: parts.hollowFill ? color : undefined,
        strokeWidth: parts.hollowFill ? Math.max(1, sw) : undefined,
        listening: false,
      }),
    );
  }
}
