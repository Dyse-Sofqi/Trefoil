/** 镭射笔（临时高亮笔迹）与橡皮擦（动态半径、擦除可撤销） */
import { Tool, type PointerEvt } from './types';
import { circleRectIntersect, nodeRect, clamp } from '../core/geometry';
import { isContainerNode } from '../core/types';

export class LaserTool extends Tool {
  readonly id = 'laser';
  private drawing = false;

  onActivate(): void {
    this.ctx.setCursor('crosshair');
  }

  onPointerDown(e: PointerEvt): void {
    if (e.button !== 0) return;
    this.drawing = true;
    // 镭射笔迹仅追加绘制，不干扰其他元素的选中/拖拽
    this.ctx.engine.laser.beginStroke(e.sx, e.sy);
  }

  onPointerMove(e: PointerEvt): void {
    if (!this.drawing || !(e.raw.buttons & 1)) return;
    this.ctx.engine.laser.extendStroke(e.sx, e.sy);
  }

  onPointerUp(e: PointerEvt): void {
    if (!this.drawing) return;
    void e;
    this.drawing = false;
    this.ctx.engine.laser.endStroke();
  }

  onDeactivate(): void {
    if (this.drawing) {
      this.drawing = false;
      this.ctx.engine.laser.endStroke();
    }
  }
}

export class EraserTool extends Tool {
  readonly id = 'eraser';
  private erasing = false;

  onActivate(): void {
    this.ctx.setCursor('none');
  }

  onDeactivate(): void {
    const st = this.ctx.engine.overlayState;
    st.eraserCursor = null;
    st.erasePreview = [];
    this.ctx.engine.applyOverlay();
  }

  /** 世界坐标下的擦除半径（屏幕像素恒定） */
  private radiusWorld(): number {
    return this.ctx.settings.eraser.radius / this.ctx.engine.vp.scale;
  }

  private hitsAt(wx: number, wy: number): string[] {
    const { doc, engine } = this.ctx;
    const r = this.radiusWorld();
    const out: string[] = [];
    for (let i = doc.nodes.length - 1; i >= 0; i--) {
      const n = doc.nodes[i];
      if (engine.isNodeHidden(n.id)) continue;
      if (circleRectIntersect(wx, wy, r, nodeRect(n))) out.push(n.id);
    }
    return out;
  }

  private updateCursor(e: PointerEvt): void {
    const st = this.ctx.engine.overlayState;
    st.eraserCursor = { x: e.sx, y: e.sy, r: this.ctx.settings.eraser.radius };
  }

  private applyHits(e: PointerEvt, erase: boolean): void {
    const { doc, engine } = this.ctx;
    const hits = this.hitsAt(e.wx, e.wy);
    const rects = hits
      .map((id) => doc.getNode(id))
      .filter(Boolean)
      .map((n) => nodeRect(n!));
    this.ctx.engine.overlayState.erasePreview = rects;
    if (erase) {
      for (const id of hits) engine.erasedIds.add(id);
      engine.cull();
    }
  }

  onPointerDown(e: PointerEvt): void {
    if (e.button !== 0) return;
    this.erasing = true;
    this.applyHits(e, true);
  }

  onPointerMove(e: PointerEvt): void {
    this.updateCursor(e);
    if (this.erasing && e.raw.buttons & 1) {
      this.applyHits(e, true);
    } else {
      this.applyHits(e, false);
    }
    this.ctx.engine.applyOverlay();
  }

  onPointerUp(e: PointerEvt): void {
    void e;
    if (!this.erasing) return;
    this.erasing = false;
    const { doc, engine } = this.ctx;
    if (engine.erasedIds.size > 0) {
      // 一次性落撤销栈（可撤销）
      doc.removeNodes([...engine.erasedIds]);
      engine.erasedIds.clear();
    }
    engine.overlayState.erasePreview = [];
    engine.applyOverlay();
  }

  onWheel(e: WheelEvent, _sx: number, _sy: number): boolean {
    // 滚轮实时调整橡皮擦半径
    const delta = e.deltaY < 0 ? 4 : -4;
    this.ctx.settings.eraser.radius = clamp(this.ctx.settings.eraser.radius + delta, 5, 200);
    const st = this.ctx.engine.overlayState;
    if (st.eraserCursor) st.eraserCursor = { ...st.eraserCursor, r: this.ctx.settings.eraser.radius };
    this.ctx.engine.applyOverlay();
    return true;
  }

  onKey(e: KeyboardEvent): boolean {
    if (e.key === '[' || e.key === ']') {
      const delta = e.key === '[' ? -4 : 4;
      this.ctx.settings.eraser.radius = clamp(this.ctx.settings.eraser.radius + delta, 5, 200);
      return true;
    }
    return false;
  }
}

// 容器节点也可被擦除：仅移除容器本身，子节点转为自由元素（由 Document.removeNodes 处理孤儿子节点）
export const ERASES_CONTAINERS = isContainerNode;
