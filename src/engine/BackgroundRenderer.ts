/** 画布背景：纯色 / 点阵 / 双层级网格。仅视觉辅助，不参与数据存储与持久化。 */
import Konva from 'konva';
import type { BackgroundSettings, DotShape } from '../core/defaults';
import type { Viewport } from './Engine';
import { dotPatternTransform } from './dotPattern';

/** 点阵最小屏幕间距（px）：低于此值点阵过密（绘制量与视觉都无意义），整层跳过 */
const DOT_MIN_STEP = 6;

/**
 * 点阵图块边长上限（设备像素）。超过就改用逐点绘制：此时步长已经很大、点数很少，
 * 没必要为它建一张大画布（间距 120 + 5 倍缩放 + 2 倍像素比会到 1200px 见方，每帧重建不可接受）。
 */
const DOT_TILE_MAX = 192;

export class BackgroundRenderer {
  private shape: Konva.Shape;
  private layer: Konva.Layer;
  settings: BackgroundSettings;
  vp: Viewport = { x: 0, y: 0, scale: 1 };
  width = 800;
  height = 600;
  /** 导出时隐藏 */
  visible = true;
  /** 点阵图块缓存：同一 (步长, 半径, 像素比, 颜色, 形状) 只生成一次 */
  private dotTile: HTMLCanvasElement | null = null;
  private dotTileKey = '';

  constructor(layer: Konva.Layer, settings: BackgroundSettings) {
    this.layer = layer;
    this.settings = settings;
    this.shape = new Konva.Shape({
      sceneFunc: (ctx) => this.draw(ctx as unknown as CanvasRenderingContext2D),
      listening: false,
    });
    layer.add(this.shape);
  }

  setSettings(s: BackgroundSettings): void {
    this.settings = s;
    this.refresh();
  }

  refresh(): void {
    this.shape.getLayer()?.batchDraw();
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const s = this.settings;
    const { x: vx, y: vy, scale } = this.vp;
    const W = this.width;
    const H = this.height;
    ctx.save();
    ctx.fillStyle = s.color;
    ctx.fillRect(0, 0, W, H);
    if (!this.visible) {
      ctx.restore();
      return;
    }

    if (s.mode === 'dots') {
      this.drawDots(ctx, s, vx, vy, scale, W, H);
    } else if (s.mode === 'grid') {
      const spacing = Math.max(4, s.gridSpacing);
      const step = spacing * scale;
      if (step >= 3) {
        const majorEvery = Math.max(2, s.gridMajorEvery);
        // 小网格（更淡）
        this.drawGridLines(ctx, spacing, s.gridColor, s.gridMinorOpacity, W, H);
        // 大网格（更明显）：N 格小网格 = 1 格大网格
        if (step * majorEvery >= 6) {
          this.drawGridLines(ctx, spacing * majorEvery, s.gridColor, s.gridMajorOpacity, W, H);
        }
      }
    }
    ctx.restore();
  }

  /**
   * 点阵：把一个点预渲染成图块，再用 createPattern 一次 fillRect 平铺整屏。
   *
   * 旧实现按世界坐标逐点入路径，绘制量随 1/scale² 爆炸 —— 1600×1000 面板在 25% 缩放下约 4.5 万个点、
   * 22 万条路径指令，2560×1400 时到 50 万 —— 这正是 20%–50% 区间卡顿的主因。
   * 改成图块平铺后，每帧开销与缩放级别无关，恒为一次填充。
   */
  private drawDots(
    ctx: CanvasRenderingContext2D,
    s: BackgroundSettings,
    vx: number,
    vy: number,
    scale: number,
    W: number,
    H: number,
  ): void {
    const step = s.dotSpacing * scale;
    if (step < DOT_MIN_STEP || s.dotSpacing < 4) return;
    const r = Math.max(0.5, (s.dotSize * scale) / 2);
    // 间距越接近下限越淡：避免点阵在缩放过程中突然出现
    const alpha = Math.min(1, (step - DOT_MIN_STEP + 2) / 4);
    const ratio = this.ratioOf(ctx);
    // 图块边长取整设备像素；点画在格心，必须放得进一格，且图块本身不能过大（否则每帧重建大画布）
    const size = Math.max(2, Math.ceil(step * ratio));
    if (size > DOT_TILE_MAX || r * ratio * 2 > size) {
      // 此时步长已很大、点数很少（上限约 (W+H)²/尺寸²），逐点绘制反而更省
      this.drawDotsByPath(ctx, s, vx, vy, scale, W, H, r, alpha);
      return;
    }

    const pattern = ctx.createPattern(this.dotTileFor(size, r, ratio, s.dotColor, s.dotShape), 'repeat');
    if (!pattern || typeof pattern.setTransform !== 'function') {
      // 极老环境兜底：仍按世界坐标逐点绘制
      this.drawDotsByPath(ctx, s, vx, vy, scale, W, H, r, alpha);
      return;
    }
    // 图块边长是整数设备像素，用矩阵把周期精确还原成 step（否则每平铺一格累积一次误差，
    // 几十格后整片点阵会明显跑偏），平移量把世界原点对齐到格点。
    const { k, offX, offY } = dotPatternTransform(step, size, vx, vy, scale);
    pattern.setTransform({ a: k, b: 0, c: 0, d: k, e: offX, f: offY });
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = pattern;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  /**
   * 生成/复用点阵图块：点画在格心（而非四角），整点落在单张图块内 —— 平铺接缝不会切到点，
   * 避免相邻图块各画一半时在缝上重复混合出十字暗痕。
   */
  private dotTileFor(size: number, r: number, ratio: number, color: string, shape: DotShape): HTMLCanvasElement {
    const key = `${size}|${r.toFixed(3)}|${ratio.toFixed(2)}|${color}|${shape}`;
    if (this.dotTile && this.dotTileKey === key) return this.dotTile;
    // 复用同一个 canvas 元素：给 width 赋值会重置并清空位图，避免缩放过程中每帧新建元素
    const tile = this.dotTile ?? (this.dotTile = document.createElement('canvas'));
    tile.width = size;
    tile.height = size;
    const g = tile.getContext('2d');
    if (g) {
      g.fillStyle = color;
      this.addDotPath(g, size / 2, size / 2, r * ratio, shape);
      g.fill();
    }
    this.dotTileKey = key;
    return tile;
  }

  /** 兜底路径：逐点入路径后一次性填充（绘制量随 1/scale² 增长，仅在图块不可用时使用） */
  private drawDotsByPath(
    ctx: CanvasRenderingContext2D,
    s: BackgroundSettings,
    vx: number,
    vy: number,
    scale: number,
    W: number,
    H: number,
    r: number,
    alpha: number,
  ): void {
    const toScreenX = (wx: number) => (wx - vx) * scale;
    const toScreenY = (wy: number) => (wy - vy) * scale;
    const screenStep = s.dotSpacing * scale;
    const startX = Math.floor(vx / s.dotSpacing) * s.dotSpacing;
    const startY = Math.floor(vy / s.dotSpacing) * s.dotSpacing;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = s.dotColor;
    ctx.beginPath();
    for (let wx = startX; toScreenX(wx) <= W + screenStep; wx += s.dotSpacing) {
      for (let wy = startY; toScreenY(wy) <= H + screenStep; wy += s.dotSpacing) {
        const sx = toScreenX(wx);
        const sy = toScreenY(wy);
        if (sx < -screenStep || sy < -screenStep) continue;
        this.addDotPath(ctx, sx, sy, r, s.dotShape);
      }
    }
    ctx.fill();
    ctx.restore();
  }

  /**
   * 当前绘制目标的像素比。不能直接用图层画布的比例：导出走的是 Konva 的临时画布 + 更高像素比，
   * 图块按屏幕比例生成的话导出图上点阵会发虚。按实际画布宽度 / CSS 宽度反推最可靠。
   */
  private ratioOf(ctx: CanvasRenderingContext2D): number {
    const raw = (ctx as unknown as { _context?: CanvasRenderingContext2D })._context ?? ctx;
    const el = raw?.canvas;
    if (el && this.width > 0 && el.width > 0) {
      const r = el.width / this.width;
      if (Number.isFinite(r) && r > 0) return r;
    }
    const pr = this.layer.getCanvas().getPixelRatio();
    return typeof pr === 'number' && pr > 0 ? pr : 1;
  }

  private drawGridLines(
    ctx: CanvasRenderingContext2D,
    spacing: number,
    color: string,
    opacity: number,
    W: number,
    H: number,
  ): void {
    const { x: vx, y: vy, scale } = this.vp;
    const step = spacing * scale;
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const startX = Math.floor(vx / spacing) * spacing;
    const startY = Math.floor(vy / spacing) * spacing;
    for (let wx = startX; (wx - vx) * scale <= W + step; wx += spacing) {
      const sx = Math.round((wx - vx) * scale) + 0.5;
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, H);
    }
    for (let wy = startY; (wy - vy) * scale <= H + step; wy += spacing) {
      const sy = Math.round((wy - vy) * scale) + 0.5;
      ctx.moveTo(0, sy);
      ctx.lineTo(W, sy);
    }
    ctx.stroke();
    ctx.restore();
  }

  private addDotPath(ctx: CanvasRenderingContext2D, sx: number, sy: number, r: number, shape: DotShape): void {
    if (shape === 'circle') {
      ctx.moveTo(sx + r, sy);
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
    } else if (shape === 'square') {
      ctx.rect(sx - r, sy - r, r * 2, r * 2);
    } else {
      ctx.moveTo(sx, sy - r);
      ctx.lineTo(sx + r, sy);
      ctx.lineTo(sx, sy + r);
      ctx.lineTo(sx - r, sy);
      ctx.closePath();
    }
  }
}
