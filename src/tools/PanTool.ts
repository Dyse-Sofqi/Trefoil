/** 浏览模式平移工具：只读模式下唯一可用工具（左键拖拽平移） */
import { Tool, type PointerEvt } from './types';

export class PanTool extends Tool {
  readonly id = 'pan';
  private start: { sx: number; sy: number; vx: number; vy: number } | null = null;

  onActivate(): void {
    this.ctx.engine.overlayState.ports = [];
    this.ctx.setCursor('grab');
  }

  onPointerDown(e: PointerEvt): void {
    if (e.button !== 0) return;
    this.start = { sx: e.sx, sy: e.sy, vx: this.ctx.engine.vp.x, vy: this.ctx.engine.vp.y };
    this.ctx.setCursor('grabbing');
  }

  onPointerMove(e: PointerEvt): void {
    if (!this.start) return;
    const scale = this.ctx.engine.vp.scale;
    this.ctx.engine.setViewport({
      x: this.start.vx - (e.sx - this.start.sx) / scale,
      y: this.start.vy - (e.sy - this.start.sy) / scale,
      scale,
    });
  }

  onPointerUp(e: PointerEvt): void {
    void e;
    this.start = null;
    this.ctx.setCursor('grab');
  }

  onDeactivate(): void {
    this.start = null;
  }
}
