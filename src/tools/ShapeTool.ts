/**
 * 绘图工具族：矩形 / 椭圆 / 菱形 / 三角（拖拽绘制，Shift 约束正形）
 * 直线 / 箭头（拖拽两点；从元素上起笔时创建拓扑连线 Edge）
 * 折线（点击加点，双击/Enter/Esc 结束）；文本（单击创建并编辑）
 */
import { Tool, type PointerEvt } from './types';
import { Document } from '../core/Document';
import type { ArrowHeadStyle, ShapeKind } from '../core/types';
import { rectFromPoints, normalizeRect, shapeRectFromDrag, inferSides, sideAnchor, type Vec } from '../core/geometry';
import { DEFAULT_SETTINGS, textBorderDefaults, textStyleDefaults } from '../core/defaults';
import { magnetAnchor } from '../core/arrowLink';

const LINE_LIKE: Set<string> = new Set(['line', 'arrow']);

/** 端点磁吸半径（屏幕 px）：落点在此距离内即吸附到元素边缘锚点并建立绑定 */
const MAGNET_PX = 14;

interface Magnet {
  id: string;
  x: number;
  y: number;
}

export class ShapeTool extends Tool {
  readonly id: string;
  readonly shape: ShapeKind;
  private draft: { start: Vec; cur: Vec } | null = null;
  private edgeFrom: string | null = null;
  /** 绘制期间的端点磁吸：起/终点吸附到的元素锚点（建立 fromNode/toNode 绑定） */
  private startMagnet: Magnet | null = null;
  private endMagnet: Magnet | null = null;

  constructor(id: string, shape: ShapeKind) {
    super();
    this.id = id;
    this.shape = shape;
  }

  /** 半径换世界单位后的磁吸查找（排除给定元素，避免首尾吸到同一元素成环） */
  private magnet(wx: number, wy: number, exclude?: string | null): Magnet | null {
    const { doc, engine } = this.ctx;
    return magnetAnchor(wx, wy, MAGNET_PX / engine.vp.scale, doc.nodes, (id) => !engine.isNodeHidden(id), exclude);
  }

  /** 本工具新建线形节点时的端点样式（读设置默认值；与形状自身默认一致的字段不写，保持文件干净） */
  private headTailStyles(): { headStyle?: ArrowHeadStyle; tailStyle?: ArrowHeadStyle } {
    const { arrowHead, arrowTail } = this.ctx.settings.shape;
    if (this.shape === 'arrow') {
      return {
        headStyle: arrowHead !== 'solid' ? arrowHead : undefined,
        tailStyle: arrowTail !== 'none' ? arrowTail : undefined,
      };
    }
    return {
      headStyle: arrowHead !== 'none' ? arrowHead : undefined,
      tailStyle: arrowTail !== 'none' ? arrowTail : undefined,
    };
  }

  onActivate(): void {
    this.ctx.engine.overlayState.draft = null;
    this.ctx.engine.overlayState.lineDraft = null;
    this.ctx.engine.overlayState.edgeDraft = null;
    this.ctx.engine.overlayState.ports = [];
    this.startMagnet = null;
    this.endMagnet = null;
  }

  onDeactivate(): void {
    this.ctx.engine.overlayState.draft = null;
    this.ctx.engine.overlayState.lineDraft = null;
    this.ctx.engine.overlayState.edgeDraft = null;
    this.ctx.engine.overlayState.ports = [];
    this.startMagnet = null;
    this.endMagnet = null;
    this.ctx.engine.applyOverlay();
  }

  onPointerDown(e: PointerEvt): void {
    if (e.button !== 0) return;
    // 从元素上起笔（箭头/直线）→ 连线模式
    if (e.pick.kind === 'node' && LINE_LIKE.has(this.shape)) {
      this.edgeFrom = e.pick.nodeId;
      this.startMagnet = null;
      this.endMagnet = null;
      const n = this.ctx.doc.getNode(e.pick.nodeId);
      if (n) {
        const anchor = sideAnchor({ x: n.x, y: n.y, width: n.width, height: n.height }, nearestSide(n, e.wx, e.wy));
        this.ctx.engine.overlayState.lineDraft = { a: anchor, b: { x: e.wx, y: e.wy }, arrow: this.shape === 'arrow', ...this.headTailStyles() };
      }
      return;
    }
    this.startMagnet = null;
    this.endMagnet = null;
    // 空白起笔：靠近元素边缘时磁吸到锚点（绘制中预览吸附，松手建立绑定）
    const m = LINE_LIKE.has(this.shape) ? this.magnet(e.wx, e.wy) : null;
    this.startMagnet = m;
    this.draft = { start: m ? { x: m.x, y: m.y } : { x: e.wx, y: e.wy }, cur: { x: e.wx, y: e.wy } };
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
      engine.overlayState.lineDraft = { a, b: { x: e.wx, y: e.wy }, arrow: this.shape === 'arrow', ...this.headTailStyles() };
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
      // 直线/箭头：预览为真实线段（箭头带头部），跟随拖拽方向可到任意象限；
      // 终点靠近元素边缘时磁吸到锚点（优先于 Shift 角度吸附）
      this.endMagnet = this.magnet(e.wx, e.wy, this.startMagnet?.id);
      const magEnd = this.endMagnet ? { x: this.endMagnet.x, y: this.endMagnet.y } : null;
      const end = magEnd ?? (e.shift ? snapAngle(this.draft.start, this.draft.cur) : this.draft.cur);
      engine.overlayState.draft = null;
      engine.overlayState.lineDraft = { a: this.draft.start, b: end, arrow: this.shape === 'arrow', ...this.headTailStyles() };
      engine.applyOverlay();
      return;
    }
    // 形状：PS 规范辅助键 —— Shift 约束正形 / Alt 中心展开，预览实时跟随
    const rect = shapeRectFromDrag(this.draft.start, this.draft.cur, e.shift, e.alt);
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
        doc.addEdge(Document.newEdge({ fromNode: from.id, toNode: to.id, ...sides }));
      } else if (from) {
        // 落在空白 → 独立箭头/直线，起点保持绑定在该元素上；终点靠近其他元素则磁吸绑定
        const start = sideAnchor({ x: from.x, y: from.y, width: from.width, height: from.height }, nearestSide(from, e.wx, e.wy));
        const m = this.magnet(e.wx, e.wy, from.id);
        const end = m ? { x: m.x, y: m.y } : { x: e.wx, y: e.wy };
        this.createLineNode(start, end, false, { fromId: from.id, toId: m?.id });
      }
      this.edgeFrom = null;
      this.startMagnet = null;
      this.endMagnet = null;
      engine.applyOverlay();
      return;
    }

    if (!this.draft) return;
    const cur = { x: e.wx, y: e.wy };
    const startM = this.startMagnet;
    const endM = this.endMagnet;
    const start = startM ? { x: startM.x, y: startM.y } : this.draft.start;
    this.draft = null;
    this.startMagnet = null;
    this.endMagnet = null;

    if (LINE_LIKE.has(this.shape)) {
      const end = endM ? { x: endM.x, y: endM.y } : cur;
      this.createLineNode(start, end, endM ? false : e.shift, { fromId: startM?.id, toId: endM?.id });
      return;
    }

    // 与拖拽预览同一套辅助键几何（Shift 约束正形 / Alt 中心展开）
    const rect = shapeRectFromDrag(start, cur, e.shift, e.alt);
    if (rect.width < 6 || rect.height < 6) return; // 误触

    const node = Document.newNode({
      type: 'trefoil/shape',
      shape: this.shape,
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      fill: settings.shape.fill,
      stroke: settings.shape.stroke === DEFAULT_SETTINGS.shape.stroke ? undefined : settings.shape.stroke,
      strokeSize: settings.shape.strokeSize,
    });
    doc.addNodes([node]);
    this.ctx.setTool('select');
  }

  private createLineNode(start: Vec, end: Vec, constrain = false, bind?: { fromId?: string; toId?: string }): void {
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
      // 描边等于全局默认时不烤进节点（渲染回退到调色板描边色，随主题日夜适配）
      stroke: settings.shape.stroke === DEFAULT_SETTINGS.shape.stroke ? undefined : settings.shape.stroke,
      strokeSize: settings.shape.strokeSize,
      fill: null,
      // 端点磁吸绑定：端点锚在元素边缘并随其移动；双端绑定渲染为贝塞尔曲线
      ...(bind?.fromId ? { fromNode: bind.fromId } : {}),
      ...(bind?.toId ? { toNode: bind.toId } : {}),
      ...this.headTailStyles(),
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
      // 描边等于全局默认时不烤进节点（渲染回退到调色板描边色，随主题日夜适配）
      stroke: settings.shape.stroke === DEFAULT_SETTINGS.shape.stroke ? undefined : settings.shape.stroke,
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
        ...textBorderDefaults(this.ctx.settings.shape),
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
