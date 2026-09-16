/**
 * 画布缩略图（Minimap）的纯计算部分：世界坐标 ↔ 缩略图坐标映射、节点着色。
 * 绘制与交互在 Minimap.svelte；这里保持无副作用，便于单元测试。
 */
import type { CanvasNode } from '../core/types';
import { isContainerNode, isFileNode, isLineLike, isShapeNode } from '../core/types';
import { resolveColor, type Palette } from '../engine/palette';
import { unionRect, type Rect } from '../core/geometry';
import { CONTAINER_DEFAULT_FILL_OPACITY } from '../core/defaults';

/** 缩略图画布逻辑尺寸（CSS px） */
export const MINIMAP_W = 176;
export const MINIMAP_H = 128;
/** 世界范围到缩略图边缘的留白 */
export const MINIMAP_PAD = 6;
/** 视口指示框最小边长：视口远大于内容时仍能看见 */
export const MIN_INDICATOR = 8;

export interface MinimapLayout {
  /** 参与映射的世界范围（内容 ∪ 视口） */
  bounds: Rect;
  /** 世界坐标 → 缩略图像素的缩放比 */
  scale: number;
  /** 世界范围 letterbox 居中后在缩略图内的左上偏移 */
  offsetX: number;
  offsetY: number;
}

/**
 * 计算世界 → 缩略图的映射。
 * 取「内容包围盒 ∪ 视口」作为映射范围：平移出内容之外时视口指示框也始终在缩略图内，
 * 同时内容的相对大小会如实反映当前缩放级别。
 */
export function computeMinimapLayout(
  content: Rect | null,
  view: Rect,
  boxW: number = MINIMAP_W,
  boxH: number = MINIMAP_H,
  pad: number = MINIMAP_PAD,
): MinimapLayout {
  const bounds = unionRect(content, view);
  const availW = Math.max(1, boxW - pad * 2);
  const availH = Math.max(1, boxH - pad * 2);
  const scale = Math.min(availW / Math.max(1e-6, bounds.width), availH / Math.max(1e-6, bounds.height));
  return {
    bounds,
    scale,
    offsetX: (boxW - bounds.width * scale) / 2,
    offsetY: (boxH - bounds.height * scale) / 2,
  };
}

/** 世界坐标 → 缩略图像素 */
export function worldToMap(l: MinimapLayout, x: number, y: number): { x: number; y: number } {
  return { x: l.offsetX + (x - l.bounds.x) * l.scale, y: l.offsetY + (y - l.bounds.y) * l.scale };
}

/** 缩略图像素 → 世界坐标（点击定位用） */
export function mapToWorld(l: MinimapLayout, x: number, y: number): { x: number; y: number } {
  return { x: l.bounds.x + (x - l.offsetX) / l.scale, y: l.bounds.y + (y - l.offsetY) / l.scale };
}

/** 视口在世界坐标下的可见矩形 */
export function viewWorldRect(vp: { x: number; y: number; scale: number }, stageW: number, stageH: number): Rect {
  return { x: vp.x, y: vp.y, width: stageW / vp.scale, height: stageH / vp.scale };
}

/** 视口指示框（缩略图像素坐标，含最小尺寸钳制） */
export function indicatorRect(l: MinimapLayout, view: Rect): Rect {
  const a = worldToMap(l, view.x, view.y);
  const b = worldToMap(l, view.x + view.width, view.y + view.height);
  const w = Math.max(MIN_INDICATOR, b.x - a.x);
  const h = Math.max(MIN_INDICATOR, b.y - a.y);
  return { x: (a.x + b.x) / 2 - w / 2, y: (a.y + b.y) / 2 - h / 2, width: w, height: h };
}

export interface MiniNodePaint {
  /** 填充或描边颜色 */
  color: string;
  alpha: number;
  /** true = 只描边不填充（容器、未指定填充的形状） */
  outline: boolean;
  dashed: boolean;
}

/**
 * 缩略图里单个节点的画法。缩略分辨率下不做精细形状区分，
 * 只用「实心块 / 描边框 / 半透明块」把类型与配色带出来。
 */
export function miniNodePaint(n: CanvasNode, palette: Palette): MiniNodePaint {
  if (isContainerNode(n)) {
    // 设了背景色 → 按背景色实心块（透明度跟随容器背景透明度）；否则维持虚线描边。
    // 缩略图是导航用的：容器默认背景透明度只有 10%，严格按比例画会几乎看不见，
    // 因此给一个可见度下限（与「文本节点用半透明块代表文字」是同一取舍）。
    const containerFill = resolveColor(n.fill, palette);
    if (containerFill) {
      const fo = Math.min(1, Math.max(0, n.fillOpacity ?? CONTAINER_DEFAULT_FILL_OPACITY));
      return { color: containerFill, alpha: Math.max(0.35, 0.9 * fo), outline: false, dashed: false };
    }
    return { color: palette.containerBorder, alpha: 0.9, outline: true, dashed: true };
  }
  if (isLineLike(n)) {
    return { color: resolveColor(n.stroke, palette) ?? palette.nodeStroke, alpha: 0.8, outline: false, dashed: false };
  }
  if (isShapeNode(n)) {
    const fill = resolveColor(n.fill, palette);
    if (fill) return { color: fill, alpha: 0.9, outline: false, dashed: false };
    return { color: resolveColor(n.stroke, palette) ?? palette.nodeStroke, alpha: 0.7, outline: true, dashed: false };
  }
  if (isFileNode(n)) {
    return { color: palette.accent, alpha: 0.45, outline: false, dashed: false };
  }
  // 文本节点：有背景按背景色实心显示（卡片感）；开了实体边框按边框色描边框（虚线/点状在缩略图上统一用虚线）；
  // 其余半透明实心块，反映排版密度
  const textFill = resolveColor(n.fill, palette);
  if (textFill) return { color: textFill, alpha: 0.9, outline: false, dashed: false };
  if (n.border) {
    return { color: resolveColor(n.stroke, palette) ?? palette.nodeStroke, alpha: 0.9, outline: true, dashed: n.borderStyle !== 'solid' };
  }
  return { color: palette.text, alpha: 0.3, outline: false, dashed: false };
}
