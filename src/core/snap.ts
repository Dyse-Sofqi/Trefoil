/**
 * 吸附系统：网格吸附（边缘贴格）+ 吸附至对象（边缘/中心）+ 智能参考线（对齐虚线 + 间距数值）。
 * 阈值单位为屏幕像素，内部换算为世界坐标，只作用于对象吸附。
 */
import type { Rect } from './geometry';
import { rectCenter } from './geometry';
import type { SnapSettings } from './defaults';

export interface Guide {
  /** v：垂直线（对齐 X），h：水平线（对齐 Y） */
  axis: 'v' | 'h';
  /** 世界坐标位置 */
  pos: number;
  from: number;
  to: number;
  /** 间距标注文本（世界 px） */
  label?: string;
}

export interface SnapResult {
  dx: number;
  dy: number;
  guides: Guide[];
}

interface AxisCandidate {
  /** 边或中心坐标 */
  value: number;
  kind: 'edge' | 'center';
}

export function snapMove(
  moving: Rect,
  others: Rect[],
  settings: SnapSettings,
  scale: number,
  gridSpacing: number,
): SnapResult {
  const guides: Guide[] = [];
  if (!settings.enabled) return { dx: 0, dy: 0, guides };
  const threshold = settings.threshold / Math.max(scale, 0.01);

  const target = { x: moving.x, y: moving.y };
  let bestX: { delta: number; guide: Guide | null } | null = null;
  let bestY: { delta: number; guide: Guide | null } | null = null;

  const movXs = xCandidates(moving);
  const movYs = yCandidates(moving);

  if (settings.objectSnap) {
    for (const o of others) {
      // X 轴候选（垂直对齐线）
      for (const ox of xCandidates(o)) {
        for (const mx of movXs) {
          const delta = ox.value - mx.value;
          if (Math.abs(delta) <= threshold && (!bestX || Math.abs(delta) < Math.abs(bestX.delta))) {
            bestX = {
              delta,
              guide: {
                axis: 'v',
                pos: ox.value,
                from: Math.min(moving.y, o.y),
                to: Math.max(moving.y + moving.height, o.y + o.height),
              },
            };
          }
        }
      }
      // Y 轴候选（水平对齐线）
      for (const oy of yCandidates(o)) {
        for (const my of movYs) {
          const delta = oy.value - my.value;
          if (Math.abs(delta) <= threshold && (!bestY || Math.abs(delta) < Math.abs(bestY.delta))) {
            bestY = {
              delta,
              guide: {
                axis: 'h',
                pos: oy.value,
                from: Math.min(moving.x, o.x),
                to: Math.max(moving.x + moving.width, o.x + o.width),
              },
            };
          }
        }
      }
    }
  }

  // 网格吸附：左/上边缘取整到最近格线，对象吸附未命中的轴才兜底。
  // 不做阈值判定——网格是可见线条，边缘允许停在"差几像素没贴上"的位置比直接落格更别扭；
  // 需要自由微调时用方向键或按住 Alt 拖动。
  if (settings.gridSnap && gridSpacing > 0) {
    if (!bestX) bestX = { delta: quantize(moving.x, gridSpacing) - moving.x, guide: null };
    if (!bestY) bestY = { delta: quantize(moving.y, gridSpacing) - moving.y, guide: null };
  }

  const dx = bestX?.delta ?? 0;
  const dy = bestY?.delta ?? 0;
  if (bestX?.guide) guides.push(bestX.guide);
  if (bestY?.guide) guides.push(bestY.guide);

  // 智能参考线：显示与最近邻元素边缘的精确距离
  if (settings.objectSnap && guides.length < 4) {
    appendDistanceGuides(guides, moving, others, dx, dy);
  }

  return { dx, dy, guides };
}

function appendDistanceGuides(guides: Guide[], moving: Rect, others: Rect[], dx: number, dy: number): void {
  const m = { ...moving, x: moving.x + dx, y: moving.y + dy };
  // 水平方向：找左右最近的边缘距离
  let leftGap: { gap: number; from: number; to: number } | null = null;
  let rightGap: { gap: number; from: number; to: number } | null = null;
  let topGap: { gap: number; from: number; to: number } | null = null;
  let bottomGap: { gap: number; from: number; to: number } | null = null;
  for (const o of others) {
    // 左侧距离
    if (o.x + o.width <= m.x + 1) {
      const gap = m.x - (o.x + o.width);
      if (!leftGap || Math.abs(gap) < Math.abs(leftGap.gap)) leftGap = { gap, from: o.x + o.width, to: m.x };
    }
    if (o.x >= m.x + m.width - 1) {
      const gap = o.x - (m.x + m.width);
      if (!rightGap || Math.abs(gap) < Math.abs(rightGap.gap)) rightGap = { gap, from: m.x + m.width, to: o.x };
    }
    if (o.y + o.height <= m.y + 1) {
      const gap = m.y - (o.y + o.height);
      if (!topGap || Math.abs(gap) < Math.abs(topGap.gap)) topGap = { gap, from: o.y + o.height, to: m.y };
    }
    if (o.y >= m.y + m.height - 1) {
      const gap = o.y - (m.y + m.height);
      if (!bottomGap || Math.abs(gap) < Math.abs(bottomGap.gap)) bottomGap = { gap, from: m.y + m.height, to: o.y };
    }
  }
  const cy = m.y + m.height / 2;
  const cx = m.x + m.width / 2;
  if (leftGap && Math.abs(leftGap.gap) < 600)
    guides.push({ axis: 'h', pos: cy, from: leftGap.from, to: leftGap.to, label: `${Math.round(Math.abs(leftGap.gap))}` });
  if (rightGap && Math.abs(rightGap.gap) < 600)
    guides.push({ axis: 'h', pos: cy, from: rightGap.from, to: rightGap.to, label: `${Math.round(Math.abs(rightGap.gap))}` });
  if (topGap && Math.abs(topGap.gap) < 600)
    guides.push({ axis: 'v', pos: cx, from: topGap.from, to: topGap.to, label: `${Math.round(Math.abs(topGap.gap))}` });
  if (bottomGap && Math.abs(bottomGap.gap) < 600)
    guides.push({ axis: 'v', pos: cx, from: bottomGap.from, to: bottomGap.to, label: `${Math.round(Math.abs(bottomGap.gap))}` });
}

/** 取整到最近的格线 */
function quantize(value: number, spacing: number): number {
  return Math.round(value / spacing) * spacing;
}

function xCandidates(r: Rect): AxisCandidate[] {
  return [
    { value: r.x, kind: 'edge' },
    { value: r.x + r.width, kind: 'edge' },
    { value: rectCenter(r).x, kind: 'center' },
  ];
}

function yCandidates(r: Rect): AxisCandidate[] {
  return [
    { value: r.y, kind: 'edge' },
    { value: r.y + r.height, kind: 'edge' },
    { value: rectCenter(r).y, kind: 'center' },
  ];
}
