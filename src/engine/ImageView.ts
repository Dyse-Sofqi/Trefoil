/**
 * 图片节点（JSON Canvas file 节点）的渲染：
 * - 图片内容按 cover 模式填满节点框（不变形，外部裁剪）；
 * - 加载中/缺失时绘制占位框（文件名 + 状态提示），与图片内容一致的浅描边。
 *
 * 绘制走原生 canvas 2D context：在 Konva sceneFunc 里平移/裁剪时
 * 直接操作底层 context（Konva 封装的 translate/clip 会污染其变换簿记）。
 */
import Konva from 'konva';
import type { Palette } from './palette';
import type { ImageCache as CacheApi } from './imageCache';
import { rawContext } from './rawContext';

export interface ImageNodeData {
  /** 图片 URL（已由宿主解析） */
  url: string;
  width: number;
  height: number;
  /** 占位框里显示的源名称（库路径的 basename） */
  label: string;
}

const FIT_BORDER = 'rgba(128,128,128,0.28)';

export class ImageView {
  private data: ImageNodeData | null = null;
  /** 折叠后的绘制数据（Konva 场景回调里读取，零分配） */
  private draw: {
    url: string;
    width: number;
    height: number;
    label: string;
    state: 'img' | 'pending' | 'broken';
  } | null = null;

  constructor(private shape: Konva.Shape, private api: CacheApi, private palette: Palette) {
    shape.listening(false);
    shape.sceneFunc((ctx) => this.drawSelf(ctx));
  }

  /** 主题变化：占位框着色刷新 */
  setPalette(p: Palette): void {
    this.palette = p;
    this.redraw();
  }

  setData(d: ImageNodeData): void {
    const prev = this.data;
    if (prev && prev.url === d.url && prev.width === d.width && prev.height === d.height && prev.label === d.label) {
      return;
    }
    this.data = d;
    this.draw = { ...d, state: 'pending' };
    this.redraw();
  }

  /** 强制重画（缓存就绪通知 / 外部文件刷新） */
  redraw(): void {
    this.shape.getLayer()?.batchDraw();
  }

  /** 读取缓存并更新状态；返回 true 表示状态已可确定（无需等待异步） */
  private probe(url: string): boolean {
    if (!this.draw) return true;
    const hit = this.api.get(url);
    if (hit === 'pending') {
      this.draw.state = 'pending';
      return false;
    }
    this.draw.state = hit === null ? 'broken' : 'img';
    return true;
  }

  private drawSelf(kctx: Konva.Context): void {
    this.probe(this.draw?.url ?? '');
    const d = this.draw;
    if (!d) return;
    const w = Math.max(1, d.width);
    const h = Math.max(1, d.height);
    const ctx = rawContext(kctx);

    const img = this.currentImage(d.url);
    if (img) {
      // cover：按节点框同比例缩放（取较大比例），居中裁剪；外沿一圈浅描边
      const iw = img.naturalWidth || img.width;
      const ih = img.naturalHeight || img.height;
      if (iw > 0 && ih > 0) {
        const scale = Math.max(w / iw, h / ih);
        const sw = iw * scale;
        const sh = ih * scale;
        ctx.save();
        ctx.strokeStyle = FIT_BORDER;
        ctx.lineWidth = 1;
        ctx.strokeRect(0, 0, w, h);
        ctx.beginPath();
        ctx.rect(0, 0, w, h);
        ctx.clip();
        ctx.drawImage(img, (w - sw) / 2, (h - sh) / 2, sw, sh);
        ctx.restore();
        return;
      }
    }

    // 占位：浅底 + 虚线框 + 文件名与状态提示
    ctx.save();
    ctx.fillStyle = this.palette.canvasBg;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = this.palette.textMuted;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
    ctx.setLineDash([]);
    const muted = this.palette.textMuted;
    ctx.strokeStyle = muted;
    ctx.fillStyle = muted;
    ctx.lineWidth = 1.5;
    const cx = w / 2;
    const cy = h / 2;
    // 简单图片图标
    ctx.beginPath();
    ctx.moveTo(cx - 14, cy - 12);
    ctx.lineTo(cx + 6, cy - 12);
    ctx.lineTo(cx + 14, cy - 4);
    ctx.lineTo(cx + 14, cy + 12);
    ctx.lineTo(cx - 14, cy + 12);
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx - 8, cy - 5, 2.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - 12, cy + 10);
    ctx.lineTo(cx - 4, cy + 2);
    ctx.lineTo(cx, cy + 6);
    ctx.lineTo(cx + 6, cy + 1);
    ctx.lineTo(cx + 12, cy + 10);
    ctx.stroke();
    const label = d.label && d.label !== 'null' ? d.label : '图片';
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.truncate(ctx, label, w - 12), cx, cy + 24);
    ctx.font = '400 10px system-ui, sans-serif';
    ctx.fillStyle = d.state === 'broken' ? this.palette.danger : muted;
    ctx.fillText(d.state === 'broken' ? '文件缺失或不可用' : d.state === 'pending' ? '加载中…' : '', cx, cy + 38);
    ctx.restore();
  }

  private currentImage(url: string): HTMLImageElement | null {
    const hit = this.api.get(url);
    return hit === 'pending' || hit === null ? null : hit;
  }

  private truncate(ctx: CanvasRenderingContext2D, s: string, maxW: number): string {
    if (maxW <= 12) return '';
    let t = s;
    while (t.length > 1 && ctx.measureText(t).width > maxW) t = t.slice(0, -2);
    return t.length < s.length ? `${t}…` : t;
  }
}
