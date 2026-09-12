/**
 * 绘图工具族：矩形 / 椭圆 / 菱形 / 三角（拖拽绘制，Shift 约束正形）
 * 直线 / 箭头（拖拽两点；从元素上起笔时创建拓扑连线 Edge）
 * 折线（点击加点，双击/Enter/Esc 结束）；文本（单击创建并编辑）
 */
import { Tool, type PointerEvt } from './types';
import { Document } from '../core/Document';
import type { ShapeKind } from '../core/types';
import { rectFromPoints, normalizeRect, inferSides, sideAnchor, type Vec } from '../core/geometry';
import { textStyleDefaults } from '../core/defaults';

const LINE_LIKE: Set<string> = new Set(['line', 'arrow']);

export class ShapeTool extends Tool {
  readonly id: string;
  readonly shape: ShapeKind;
  private draft: { start: Vec; cur: Vec } | null = null;
  private edgeFrom: string | null = null;

  constructor(id: string, shape: ShapeKind) {
    super();
    this.id = id;
    this.shape = shape;
  }

  onActivate(): void {
    this.ctx.engine.overlayState.draft = null;
    this.ctx.engine.overlayState.lineDraft = null;
    this.ctx.engine.overlayState.edgeDraft = null;
    this.ctx.engine.overlayState.ports = [];
  }

  onDeactivate(): void {
    this.ctx.engine.overlayState.draft = null;
    this.ctx.engine.overlayState.lineDraft = null;
    this.ctx.engine.overlayState.edgeDraft = null;
    this.ctx.engine.overlayState.ports = [];
    this.ctx.engine.applyOverlay();
  }

  onPointerDown(e: PointerEvt): void {
    if (e.button !== 0) return;
    // 从元素上起笔（箭头/直线）→ 连线模式
    if (e.pick.kind === 'node' && LINE_LIKE.has(this.shape)) {
      this.edgeFrom = e.pick.nodeId;
      const n = this.ctx.doc.getNode(e.pick.nodeId);
      if (n) {
        const anchor = sideAnchor({ x: n.x, y: n.y, width: n.width, height: n.height }, nearestSide(n, e.wx, e.wy));
        this.ctx.engine.overlayState.lineDraft = { a: anchor, b: { x: e.wx, y: e.wy }, arrow: this.shape === 'arrow' };
      }
      return;
    }
    this.draft = { start: { x: e.wx, y: e.wy }, cur: { x: e.wx, y: e.wy } };
  }

  onPointerMove(e: PointerEvt): void {
    const engine = this.ctx.engine;
    if (this.edgeFrom) {
      if (!(e.raw.buttons & 1)) {
        this.edgeFrom = null;
        engine.overlayState.lineDraft = null;
        engine.overlayState.edgeDraft = null;
        engine.overlayState.ports = [];
        engine.applyOverlay();
        return;
      }
      const a = engine.overlayState.lineDraft?.a ?? { x: e.wx, y: e.wy };
      engine.overlayState.lineDraft = { a, b: { x: e.wx, y: e.wy }, arrow: this.shape === 'arrow' };
      // 悬停目标 Ports
      const over = engine.pick(e.wx, e.wy);
      if (over.kind === 'node') {
        const n = this.ctx.doc.getNode(over.nodeId);
        engine.overlayState.ports = n ? portAnchors(n.x, n.y, n.width, n.height) : [];
      } else {
        engine.overlayState.ports = [];
      }
      engine.applyOverlay();
      return;
    }
    if (!this.draft) return;
    if (!(e.raw.buttons & 1)) {
      this.draft = null;
      engine.overlayState.draft = null;
      engine.overlayState.lineDraft = null;
      engine.applyOverlay();
      return;
    }
    this.draft.cur = { x: e.wx, y: e.wy };
    if (LINE_LIKE.has(this.shape)) {
      // 直线/箭头：预览为真实线段（箭头带头部），跟随拖拽方向可到任意象限
      const end = e.shift ? snapAngle(this.draft.start, this.draft.cur) : this.draft.cur;
      engine.overlayState.draft = null;
      engine.overlayState.lineDraft = { a: this.draft.start, b: end, arrow: this.shape === 'arrow' };
      engine.applyOverlay();
      return;
    }
    const rect = normalizeRect(rectFromPoints(this.draft.start, this.draft.cur));
    const kind = this.shape === 'rect' ? 'rect' : this.shape === 'ellipse' ? 'ellipse' : this.shape === 'diamond' ? 'diamond' : 'triangle';
    engine.overlayState.draft = { rect, kind };
    engine.applyOverlay();
  }

  onPointerUp(e: PointerEvt): void {
    const { doc, settings, engine } = this.ctx;
    engine.overlayState.draft = null;
    engine.overlayState.lineDraft = null;
    engine.overlayState.edgeDraft = null;
    engine.overlayState.ports = [];

    // 连线模式结束
    if (this.edgeFrom) {
      const from = doc.getNode(this.edgeFrom);
      const over = engine.pick(e.wx, e.wy);
      if (from && over.kind === 'node' && over.nodeId !== this.edgeFrom) {
        const to = doc.getNode(over.nodeId)!;
        const sides = inferSides({ x: from.x, y: from.y, width: from.width, height: from.height }, { x: to.x, y: to.y, width: to.width, height: to.height });
        doc.addEdge(Document.newEdge({ fromNode: from.id, toNode: to.id, ...sides, kind: 'link' }));
      } else if (from) {
        // 落在空白 → 独立箭头/直线
        const start = sideAnchor({ x: from.x, y: from.y, width: from.width, height: from.height }, nearestSide(from, e.wx, e.wy));
        this.createLineNode(start, { x: e.wx, y: e.wy });
      }
      this.edgeFrom = null;
      engine.applyOverlay();
      return;
    }

    if (!this.draft) return;
    const start = this.draft.start;
    const cur = { x: e.wx, y: e.wy };
    this.draft = null;

    if (LINE_LIKE.has(this.shape)) {
      this.createLineNode(start, cur, e.shift);
      return;
    }

    let rect = normalizeRect(rectFromPoints(start, cur));
    if (e.shift) {
      const size = Math.max(rect.width, rect.height);
      rect = { ...rect, width: size, height: size };
    }
    if (rect.width < 6 || rect.height < 6) return; // 误触

    const node = Document.newNode({
      type: 'trefoil/shape',
      shape: this.shape,
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      fill: settings.shape.fill,
      stroke: settings.shape.stroke,
      strokeSize: settings.shape.strokeSize,
    });
    doc.addNodes([node]);
    this.ctx.setTool('select');
  }

  private createLineNode(start: Vec, end: Vec, constrain = false): void {
    const { doc, settings } = this.ctx;
    const snapped = constrain ? snapAngle(start, end) : end;
    const ex = snapped.x;
    const ey = snapped.y;
    if (Math.hypot(ex - start.x, ey - start.y) * this.ctx.engine.vp.scale < 4) return; // 误触
    const x = Math.min(start.x, ex);
    const y = Math.min(start.y, ey);
    const node = Document.newNode({
      type: 'trefoil/shape',
      shape: this.shape,
      x,
      y,
      width: Math.max(1, Math.abs(ex - start.x)),
      height: Math.max(1, Math.abs(ey - start.y)),
      points: [
        [start.x - x, start.y - y],
        [ex - x, ey - y],
      ],
      stroke: settings.shape.stroke,
      strokeSize: settings.shape.strokeSize,
      fill: null,
    });
    doc.addNodes([node]);
    this.ctx.setTool('select');
  }
}

/** 折线：点击加点，移动预览，双击 / Enter / Esc 结束 */
export class PolylineTool extends Tool {
  readonly id = 'polyline';
  private points: Vec[] = [];

  onActivate(): void {
    this.points = [];
    this.ctx.engine.overlayState.edgeDraft = null;
  }

  onDeactivate(): void {
    this.finalize();
  }

  onPointerDown(e: PointerEvt): void {
    if (e.button !== 0) return;
    const last = this.points[this.points.length - 1];
    if (!last || Math.hypot(e.wx - last.x, e.wy - last.y) * this.ctx.engine.vp.scale > 3) {
      this.points.push({ x: e.wx, y: e.wy });
    }
  }

  onPointerMove(e: PointerEvt): void {
    if (!this.points.length) return;
    this.ctx.engine.overlayState.edgeDraft = [...this.points, { x: e.wx, y: e.wy }];
    this.ctx.engine.applyOverlay();
  }

  onDoubleClick(e: PointerEvt): void {
    void e;
    // 双击的最后一下会先触发一次 onPointerDown，去重后结束
    this.finalize();
  }

  onKey(e: KeyboardEvent): boolean {
    if (e.key === 'Enter' || e.key === 'Escape') {
      e.preventDefault();
      this.finalize();
      return true;
    }
    return false;
  }

  private finalize(): void {
    const { doc, engine, settings } = this.ctx;
    engine.overlayState.edgeDraft = null;
    const pts = this.points;
    this.points = [];
    if (pts.length < 2) {
      engine.applyOverlay();
      return;
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    const node = Document.newNode({
      type: 'trefoil/shape',
      shape: 'polyline',
      x: minX,
      y: minY,
      width: Math.max(1, maxX - minX),
      height: Math.max(1, maxY - minY),
      points: pts.map((p) => [p.x - minX, p.y - minY]),
      stroke: settings.shape.stroke,
      strokeSize: settings.shape.strokeSize,
      fill: null,
    });
    doc.addNodes([node]);
    this.ctx.setTool('select');
  }
}

/** 文本工具：单击空白创建并进入编辑 */
export class TextTool extends Tool {
  readonly id = 'text';

  onPointerDown(e: PointerEvt): void {
    if (e.button !== 0) return;
    if (e.pick.kind === 'canvas') {
      const node = Document.newNode({
        type: 'text',
        x: e.wx,
        y: e.wy - 18,
        width: 200,
        height: 36,
        text: '',
        ...textStyleDefaults(this.ctx.settings.text),
      });
      this.ctx.doc.addNodes([node]);
      this.ctx.setTool('select');
      this.ctx.beginTextEdit(node.id);
    } else {
      this.ctx.setTool('select');
    }
  }
}

/** 45° 角度吸附：以 start 为圆心，把 end 吸到最近的 45° 方向 */
function snapAngle(start: Vec, end: Vec): Vec {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const ang = Math.atan2(dy, dx);
  const snapped = Math.round(ang / (Math.PI / 4)) * (Math.PI / 4);
  const len = Math.hypot(dx, dy);
  return { x: start.x + Math.cos(snapped) * len, y: start.y + Math.sin(snapped) * len };
}

function nearestSide(n: { x: number; y: number; width: number; height: number }, wx: number, wy: number): 'top' | 'bottom' | 'left' | 'right' {
  const dl = Math.abs(wx - n.x);
  const dr = Math.abs(wx - (n.x + n.width));
  const dt = Math.abs(wy - n.y);
  const db = Math.abs(wy - (n.y + n.height));
  const min = Math.min(dl, dr, dt, db);
  if (min === dl) return 'left';
  if (min === dr) return 'right';
  if (min === dt) return 'top';
  return 'bottom';
}

function portAnchors(x: number, y: number, width: number, height: number): Vec[] {
  const r = { x, y, width, height };
  return [sideAnchor(r, 'top'), sideAnchor(r, 'bottom'), sideAnchor(r, 'left'), sideAnchor(r, 'right')];
}
