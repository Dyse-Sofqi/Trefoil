/**
 * 镭射笔图层：临时标注，独立于所有永久图层之上。
 * - 笔迹不写入 JSON Canvas、不进撤销栈、不持久化（关闭画布即丢弃）。
 * - 释放后按设定延迟自动淡出；延迟期间新笔迹正常绘制互不干扰。
 */
import Konva from 'konva';
import type { LaserSettings } from '../core/defaults';

interface Stroke {
  line: Konva.Line;
  timer?: number;
  dead: boolean;
}

export class LaserRenderer {
  private strokes: Stroke[] = [];
  private layer: Konva.Layer;
  settings: LaserSettings;
  /** 导出时可选择是否包含 */
  visible = true;

  constructor(layer: Konva.Layer, settings: LaserSettings) {
    this.layer = layer;
    this.settings = settings;
  }

  get strokeCount(): number {
    return this.strokes.length;
  }

  setSettings(s: LaserSettings): void {
    this.settings = s;
  }

  beginStroke(sx: number, sy: number): void {
    const line = new Konva.Line({
      points: [sx, sy],
      stroke: this.settings.color,
      strokeWidth: this.settings.width,
      lineCap: 'round',
      lineJoin: 'round',
      tension: 0.35,
      opacity: 0.9,
      shadowColor: this.settings.color,
      shadowBlur: 10,
      listening: false,
    });
    this.layer.add(line);
    this.strokes.push({ line, dead: false });
    this.layer.batchDraw();
  }

  extendStroke(sx: number, sy: number): void {
    const s = this.strokes[this.strokes.length - 1];
    if (!s || s.dead) return;
    s.line.points([...s.line.points(), sx, sy]);
    this.layer.batchDraw();
  }

  endStroke(): void {
    const s = this.strokes[this.strokes.length - 1];
    if (!s) return;
    const delay = this.settings.delayMs;
    if (delay > 0) {
      s.timer = window.setTimeout(() => this.fadeOut(s), delay);
    }
  }

  private fadeOut(s: Stroke): void {
    if (s.dead) return;
    s.dead = true;
    const tween = new Konva.Tween({
      node: s.line,
      opacity: 0,
      duration: 0.45,
      easing: Konva.Easings.EaseOut,
      onFinish: () => {
        s.line.destroy();
        this.strokes = this.strokes.filter((x) => x !== s);
        this.layer.batchDraw();
      },
    });
    tween.play();
  }

  /** 清除全部笔迹（Esc / 命令） */
  clearAll(): void {
    for (const s of this.strokes) {
      if (s.timer) window.clearTimeout(s.timer);
      this.fadeOut(s);
    }
  }

  /** 立即移除（导出/销毁时） */
  destroy(): void {
    for (const s of this.strokes) {
      if (s.timer) window.clearTimeout(s.timer);
      s.line.destroy();
    }
    this.strokes = [];
    this.layer.batchDraw();
  }

  bounds(): { x: number; y: number; width: number; height: number } | null {
    let b: { x: number; y: number; width: number; height: number } | null = null;
    for (const s of this.strokes) {
      const pts = s.line.points();
      for (let i = 0; i < pts.length; i += 2) {
        const x = pts[i];
        const y = pts[i + 1];
        if (!b) b = { x, y, width: 0, height: 0 };
        else {
          b.x = Math.min(b.x, x);
          b.y = Math.min(b.y, y);
          b.width = Math.max(b.width, x - b.x);
          b.height = Math.max(b.height, y - b.y);
        }
      }
    }
    return b;
  }
}
