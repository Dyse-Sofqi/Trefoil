/**
 * 选择工具：点击/框选/拖拽移动、8 向缩放手柄、容器边带拖拽（整体移动）、
 * 双击空白创建文本、双击文本进入编辑。拖拽时应用吸附与智能参考线。
 */
import { Tool, type PointerEvt } from './types';
import { Document } from '../core/Document';
import type { ResizeStartRecord } from '../core/Document';
import { nodeRect, rectFromPoints, normalizeRect, unionRect, type Rect, type Vec } from '../core/geometry';
import { isFileNode, isLineLike } from '../core/types';
import { snapMove, type Guide } from '../core/snap';
import { resizeImageRect } from '../core/resize';
import type { HandleId } from '../engine/Overlay';
import { autoTextHeight } from '../engine/textMeasure';
import { textStyleDefaults } from '../core/defaults';

type Session =
  | { type: 'move'; startW: Vec; starts: Map<string, { x: number; y: number }>; moved: boolean }
  | {
      type: 'resize';
      handle: HandleId;
      startW: Vec;
      nodeId: string;
      startPos: { x: number; y: number };
      startSize: { width: number; height: number };
      startPoints: number[][];
      startFlipX: boolean;
      startFlipY: boolean;
    }
  | {
      type: 'image-resize';
      handle: HandleId;
      startW: Vec;
      nodeId: string;
      startPos: { x: number; y: number };
      startSize: { width: number; height: number };
    }
  | { type: 'marquee'; startW: Vec }
  | null;

export class SelectTool extends Tool {
  readonly id = 'select';
  private session: Session = null;
  private guides: Guide[] = [];

  onActivate(): void {
    this.ctx.engine.overlayState.ports = [];
  }

  onPointerDown(e: PointerEvt): void {
    const { doc, engine } = this.ctx;

    // 缩放手柄（单选时优先）
    const handle = engine.overlay.handleAt(e.sx, e.sy);
    const sel = doc.selectedNodes();
    if (handle && sel.length === 1 && !engine.isNodeHidden(sel[0].id)) {
      const n = sel[0];
      if (isFileNode(n)) {
        // 图片节点：等比缩放（角手柄锁宽高比，边手柄自由），anchor = 对角
        this.session = {
          type: 'image-resize',
          handle: handle.id,
          startW: { x: e.wx, y: e.wy },
          nodeId: n.id,
          startPos: { x: n.x, y: n.y },
          startSize: { width: n.width, height: n.height },
        };
        return;
      }
      this.session = {
        type: 'resize',
        handle: handle.id,
        startW: { x: e.wx, y: e.wy },
        nodeId: n.id,
        startPos: { x: n.x, y: n.y },
        startSize: { width: n.width, height: n.height },
        startPoints: n.points ? n.points.map((p) => [...p]) : [],
        startFlipX: !!n.flipX,
        startFlipY: !!n.flipY,
      };
      return;
    }

    if (e.pick.kind === 'node') {
      this.ctx.lastClickedNodeId = e.pick.nodeId;
      const expanded = doc.expandSelectionToGroups([e.pick.nodeId]);
      if (e.shift) {
        for (const id of expanded) doc.toggleSelection(id);
      } else {
        if (!doc.selection.has(e.pick.nodeId)) doc.setSelection(expanded);
        // Alt+拖动：先在原地复制一份（含组内成员与内部连线），拖动的是副本
        if (e.alt) {
          const ids = this.ctx.clipboard.duplicate(doc);
          if (ids.length) doc.setSelection(ids);
        }
      }
      this.startMove(e);
      return;
    }

    if (e.pick.kind === 'container-band') {
      this.ctx.lastClickedNodeId = undefined;
      const cid = e.pick.containerId;
      doc.setSelection([cid, ...doc.containerChildren(cid).map((c) => c.id)]);
      this.startMove(e);
      return;
    }

    // 空白处：框选
    this.ctx.lastClickedNodeId = undefined;
    if (!e.shift) doc.clearSelection();
    this.session = { type: 'marquee', startW: { x: e.wx, y: e.wy } };
  }

  private startMove(e: PointerEvt): void {
    const doc = this.ctx.doc;
    const starts = new Map<string, { x: number; y: number }>();
    for (const id of doc.selection) {
      const n = doc.getNode(id);
      if (n) starts.set(id, { x: n.x, y: n.y });
    }
    this.session = { type: 'move', startW: { x: e.wx, y: e.wy }, starts, moved: false };
  }

  onPointerMove(e: PointerEvt): void {
    const s = this.session;
    if (!s) return;
    if (s.type === 'move') {
      this.moveSession(e, s);
    } else if (s.type === 'resize') {
      this.resizeSession(e, s);
    } else if (s.type === 'image-resize') {
      this.imageResizeSession(e, s);
    } else if (s.type === 'marquee') {
      const st = this.ctx.engine.overlayState;
      st.marquee = rectFromPoints(s.startW, { x: e.wx, y: e.wy });
      // marquee 存屏幕坐标渲染更简单：转屏幕
      const a = this.ctx.engine.worldToScreen(st.marquee.x, st.marquee.y);
      st.marquee = { x: a.x, y: a.y, width: st.marquee.width * this.ctx.engine.vp.scale, height: st.marquee.height * this.ctx.engine.vp.scale };
      this.ctx.engine.applyOverlay();
    }
  }

  private moveSession(e: PointerEvt, s: Extract<Session, { type: 'move' }>): void {
    const { doc, engine, settings } = this.ctx;
    const dx0 = e.wx - s.startW.x;
    const dy0 = e.wy - s.startW.y;
    if (!s.moved && Math.hypot(dx0, dy0) * engine.vp.scale < 3) return;
    s.moved = true;

    // 计算移动包围盒（起始位置 + 位移）
    let movingBox: Rect | null = null;
    for (const [id, start] of s.starts) {
      const n = doc.getNode(id);
      if (!n) continue;
      movingBox = unionRect(movingBox, { x: start.x + dx0, y: start.y + dy0, width: n.width, height: n.height });
    }
    if (!movingBox) return;

    // 吸附（排除自身与隐藏节点）
    const selected = new Set(s.starts.keys());
    const others = doc.nodes.filter((n) => !selected.has(n.id) && !engine.isNodeHidden(n.id)).map((n) => nodeRect(n));
    let snap = { dx: 0, dy: 0, guides: [] as Guide[] };
    if (!e.alt && settings.snap.enabled && (settings.snap.objectSnap || settings.snap.gridSnap) && !e.ctrl) {
      snap = snapMove(movingBox, others, settings.snap, engine.vp.scale, settings.background.gridSpacing);
    }

    const dx = dx0 + snap.dx;
    const dy = dy0 + snap.dy;
    doc.live(() => {
      for (const [id, start] of s.starts) {
        const n = doc.getNode(id);
        if (n) {
          n.x = start.x + dx;
          n.y = start.y + dy;
        }
      }
    });
    this.guides = snap.guides;
    engine.overlayState.guides = snap.guides;
    engine.applyOverlay();
  }

  /**
   * 图片节点缩放：角手柄按当前形状的宽高比等比缩放（锚点 = 对角），
   * 边手柄自由拉伸。拖拽中实时生效，释放时整体落一条撤销记录。
   */
  private imageResizeSession(e: PointerEvt, s: Extract<Session, { type: 'image-resize' }>): void {
    const { doc, engine } = this.ctx;
    const n = doc.getNode(s.nodeId);
    if (!n) return;
    const r = resizeImageRect({
      handle: s.handle,
      dx: e.wx - s.startW.x,
      dy: e.wy - s.startW.y,
      x: s.startPos.x,
      y: s.startPos.y,
      width: s.startSize.width,
      height: s.startSize.height,
    });
    doc.live(() => {
      n.x = r.x;
      n.y = r.y;
      n.width = r.width;
      n.height = r.height;
    });
    engine.applyOverlay();
  }

  private resizeSession(e: PointerEvt, s: Extract<Session, { type: 'resize' }>): void {
    const { doc, engine } = this.ctx;
    const n = doc.getNode(s.nodeId);
    if (!n) return;
    const dx = e.wx - s.startW.x;
    const dy = e.wy - s.startW.y;
    const h = s.handle;
    // 四条边独立跟随手柄：越过对侧边即翻转（内容镜像），而非停在原地
    let left = s.startPos.x;
    let right = s.startPos.x + s.startSize.width;
    let top = s.startPos.y;
    let bottom = s.startPos.y + s.startSize.height;
    // 文本框高度由内容自适应：上下方向不参与缩放（拖角/边只改宽度，文本框不位移）
    const fixedHeight = n.type === 'text';
    if (h.includes('w')) left = s.startPos.x + dx;
    if (h.includes('e')) right = s.startPos.x + s.startSize.width + dx;
    if (!fixedHeight) {
      if (h.includes('n')) top = s.startPos.y + dy;
      if (h.includes('s')) bottom = s.startPos.y + s.startSize.height + dy;
    }

    const crossedX = right < left;
    const crossedY = bottom < top;
    const x = Math.min(left, right);
    const y = fixedHeight ? s.startPos.y : Math.min(top, bottom);
    let width = Math.max(1, Math.abs(right - left));
    let height = Math.max(1, Math.abs(bottom - top));

    // 线类：等比缩放折点（翻转由 flipX/flipY 呈现，点本身不镜像）
    let points: number[][] | undefined;
    if (isLineLike(n) && s.startPoints.length >= 2) {
      const fx = width / Math.max(1, s.startSize.width);
      const fy = height / Math.max(1, s.startSize.height);
      points = s.startPoints.map(([px, py]) => [px * fx, py * fy]);
    }

    // 文本：高度始终贴合内容（跟随换行），不随拖拽改变
    if (fixedHeight) {
      height = autoTextHeight(n.text ?? '', width, n.fontSize ?? 16, n.fontFamily ?? 'system-ui, sans-serif', n.fontWeight ?? 400);
    }

    // 翻转状态 = 起始翻转 XOR 本次跨越（仅形状支持内容镜像）
    const isShape = n.type === 'trefoil/shape';
    const flipX = isShape ? s.startFlipX !== crossedX : undefined;
    const flipY = isShape ? s.startFlipY !== crossedY : undefined;

    doc.live(() => {
      n.x = x;
      n.y = y;
      n.width = width;
      n.height = height;
      if (points) n.points = points;
      if (flipX !== undefined) n.flipX = flipX;
      if (flipY !== undefined) n.flipY = flipY;
    });
    engine.applyOverlay();
  }

  onPointerUp(e: PointerEvt): void {
    const s = this.session;
    if (!s) return;
    const { doc, engine } = this.ctx;
    if (s.type === 'move') {
      if (s.moved) doc.commitPositions('移动', s.starts);
      engine.overlayState.guides = [];
      engine.applyOverlay();
    } else if (s.type === 'resize') {
      const n = doc.getNode(s.nodeId);
      if (n) {
        const starts = new Map([[s.nodeId, { x: s.startPos.x, y: s.startPos.y }]]);
        const rec: ResizeStartRecord = {
          x: s.startPos.x,
          y: s.startPos.y,
          width: s.startSize.width,
          height: s.startSize.height,
        };
        if (n.type === 'trefoil/shape') {
          rec.flipX = s.startFlipX;
          rec.flipY = s.startFlipY;
        }
        const sizes = new Map([[s.nodeId, rec]]);
        doc.commitPositions('调整大小', starts, sizes);
      }
    } else if (s.type === 'image-resize') {
      const n = doc.getNode(s.nodeId);
      if (n) {
        const starts = new Map([[s.nodeId, { x: s.startPos.x, y: s.startPos.y }]]);
        const sizes = new Map([
          [s.nodeId, { x: s.startPos.x, y: s.startPos.y, width: s.startSize.width, height: s.startSize.height }],
        ]);
        doc.commitPositions('调整大小', starts, sizes);
      }
    } else if (s.type === 'marquee') {
      const worldRect = normalizeRect(rectFromPoints(s.startW, { x: e.wx, y: e.wy }));
      const hits = doc.nodes
        .filter((n) => !engine.isNodeHidden(n.id) && n.type !== 'trefoil/container')
        .filter((n) => rectsIntersect(worldRect, nodeRect(n)))
        .map((n) => n.id);
      doc.setSelection(hits, e.shift);
      engine.overlayState.marquee = null;
      engine.applyOverlay();
    }
    this.session = null;
  }

  onDoubleClick(e: PointerEvt): void {
    const doc = this.ctx.doc;
    if (e.pick.kind === 'container-band') {
      // 双击容器左上角名片 → 重命名
      this.ctx.renameContainer?.(e.pick.containerId);
      return;
    }
    if (e.pick.kind === 'node') {
      const n = doc.getNode(e.pick.nodeId);
      if (n && n.type === 'text') {
        this.ctx.beginTextEdit(n.id);
      }
      return;
    }
    if (e.pick.kind === 'canvas') {
      this.createTextAt(e.wx, e.wy);
    }
  }

  /** 双击空白：创建可编辑文本节点 */
  createTextAt(wx: number, wy: number): void {
    const { doc, settings } = this.ctx;
    const node = Document.newNode({
      type: 'text',
      x: wx,
      y: wy - 18,
      width: 200,
      height: 36,
      text: '',
      ...textStyleDefaults(settings.text),
    });
    doc.addNodes([node]);
    this.ctx.beginTextEdit(node.id);
  }

  onKey(e: KeyboardEvent): boolean {
    // Enter/Space 等由全局处理
    void e;
    return false;
  }
}

// rectsIntersect 需要处理负宽高（marquee 转换后已归一化）
function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}
