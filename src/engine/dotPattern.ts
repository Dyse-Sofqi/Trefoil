/**
 * 点阵背景的图块平铺数学：与 Konva / DOM 无关，便于单测。
 *
 * 思路：把「一个点」预渲染成边长为整数设备像素的图块，用 CanvasPattern 平铺整屏；
 * 图块的天然周期是整数像素，而点阵的屏幕步长 step = dotSpacing × scale 通常是小数，
 * 于是用 pattern.setTransform 的缩放分量 k 把周期精确还原成 step（否则每平铺一格就累积一次误差，
 * 几十格之后整片点阵会明显跑偏），平移分量则把世界原点对齐到格点。
 */

/** 取模（结果恒非负） */
export const mod = (v: number, m: number): number => ((v % m) + m) % m;

export interface DotPatternTransform {
  /** 图块缩放：把 tileSize 设备像素缩回精确周期 step */
  k: number;
  /** 平铺原点在屏幕坐标中的偏移（世界原点对齐到格点） */
  offX: number;
  offY: number;
}

export function dotPatternTransform(
  step: number,
  tileSize: number,
  vx: number,
  vy: number,
  scale: number,
): DotPatternTransform {
  // 点画在图块格心（避免平铺接缝切到点），所以平铺原点要再退半个周期，点心才落在世界格点上
  const half = step / 2;
  return {
    k: step / tileSize,
    offX: mod(-vx * scale - half, step),
    offY: mod(-vy * scale - half, step),
  };
}
