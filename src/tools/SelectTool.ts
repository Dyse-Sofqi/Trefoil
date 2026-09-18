/**
 * 选择工具：点击/框选/拖拽移动、8 向缩放手柄、容器边带拖拽（整体移动）、
 * 双击空白创建文本、双击文本进入编辑。拖拽时应用吸附与智能参考线。
 */
import { Tool, type PointerEvt } from './types';
import { Document, type ResizeStartRecord } from '../core/Document';
import { nodeRect, rectFromPoints, rectCenter, normalizeRect, normalizeRotation, unionRect, inferSides, sideAnchors, type Rect, type Vec } from '../core/geometry';
import { canRotate, isContainerNode, isFileNode, isLineLike } from '../core/types';
import type { CanvasNode, Side } from '../core/types';
import { snapMove, type Guide } from '../core/snap';
import { bakeLineFlip, resizeImageRect, setLinePoint } from '../core/resize';
import { magnetAnchor, MAGNET_PX, isLinkableTarget, freezeBoundArrow, lineHitsRect } from '../core/arrowLink';
import type { HandleId } from '../engine/Overlay';
import { autoTextHeight } from '../engine/textMeasure';
import { textBorderDefaults, textStyleDefaults } from '../core/defaults';
import { isMapMember } from '../core/mindmap';

type Session =
  | { type: 'move'; startW: Vec; starts: Map<string, { x: number; y: number }>; moved: boolean; bound: Map<string, ResizeStartRecord> }
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
  /** 线类端点拖拽：直接改折点（包围盒随 setLinePoint 重排）；拖绑定端会解除该端绑定 */
  | { type: 'point'; startW: Vec; nodeId: string; index: number; startPos: { x: number; y: number }; startSize: { width: number; height: number }; startPoints: number[][]; startFromNode?: string; startToNode?: string }
  /** 连线（Edge）端点拖拽：把一端改连到其它元素（四向磁吸，拖拽中实时跟随目标） */
  | {
      type: 'edge-point';
      edgeId: string;
      side: 'from' | 'to';
      startW: Vec;
      moved: boolean;
      startFrom: string;
      startTo: string;
      startFromSide?: Side;
      startToSide?: Side;
    }
  | {
      type: 'image-resize';
      handle: HandleId;
      startW: Vec;
      nodeId: string;
      startPos: { x: number; y: number };
      startSize: { width: number; height: number };
    }
  /** 旋转手柄拖拽：指针绕节点中心的极角变化量 → rotation（度），中心与尺寸不变 */
  | { type: 'rotate'; startW: Vec; nodeId: string; center: Vec; startAng: number; startRot: number; moved: boolean }
  | { type: 'marquee'; startW: Vec }
  | null;

export class SelectTool extends Tool {
  readonly id = 'select';
  private session: Session = null;
  private guides: Guide[] = [];

  onActivate(): void {
    this.ctx.engine.overlayState.ports = [];
    this.ctx.engine.overlayState.magnet = null;
  }

  onPointerDown(e: PointerEvt): void {
    const { doc, engine } = this.ctx;

    // 手柄（单选时优先）：端点手柄（线类）改形状，四角/边手柄改大小
    const handle = engine.overlay.handleAt(e.sx, e.sy);
    // 连线端点手柄（单选连线时出现）：拖动重新绑定 fromNode / toNode
    if (handle && (handle.id === 'edge-from' || handle.id === 'edge-to')) {
      const edgeIds = [...doc.selection].filter((id) => doc.getEdge(id));
      if (edgeIds.length === 1) {
        const edge = doc.getEdge(edgeIds[0]!);
        if (edge) {
          this.session = {
            type: 'edge-point',
            edgeId: edge.id,
            side: handle.id === 'edge-from' ? 'from' : 'to',
            startW: { x: e.wx, y: e.wy },
            moved: false,
            startFrom: edge.fromNode,
            startTo: edge.toNode,
            startFromSide: edge.fromSide,
            startToSide: edge.toSide,
          };
          return;
        }
      }
    }
    const sel = doc.selectedNodes();
    if (handle && sel.length === 1 && !engine.isNodeHidden(sel[0].id)) {
      const n = sel[0];
      // 旋转手柄：绕过最近命中逻辑直接接管（块状元素单选时始终显示在顶部）
      if (handle.id === 'rotate') {
        if (!canRotate(n)) return;
        const c = rectCenter(nodeRect(n));
        this.session = {
          type: 'rotate',
          startW: { x: e.wx, y: e.wy },
          nodeId: n.id,
          center: c,
          startAng: Math.atan2(e.wy - c.y, e.wx - c.x),
          startRot: n.rotation ?? 0,
          moved: false,
        };
        return;
      }
      if (handle.id.startsWith('pt')) {
        const index = Number(handle.id.slice(2));
        // 翻转状态先烘进折点（视觉不变）：之后端点拖拽与包围盒重排都在普通坐标下进行，
        // 不用到处做镜像换算（镜像锚点是包围盒，拖拽中 bbox 一直变，边拖边换算必然漂移）
        if (n.flipX || n.flipY) doc.live(() => bakeLineFlip(n));
        // 拖绑定端 = 解除该端磁吸绑定（端点从此自由）；绑定快照必须在解绑前捕获
        const startFromNode = n.fromNode;
        const startToNode = n.toNode;
        if (index === 0 && n.fromNode) doc.live(() => (n.fromNode = undefined));
        if (index === (n.points?.length ?? 2) - 1 && n.toNode) doc.live(() => (n.toNode = undefined));
        this.session = {
          type: 'point',
          startW: { x: e.wx, y: e.wy },
          nodeId: n.id,
          index,
          startPos: { x: n.x, y: n.y },
          startSize: { width: n.width, height: n.height },
          // points 缺省时按渲染回退值物化（setLinePoint 会写出 points，撤销需要能回到等价状态）
          startPoints: (n.points ?? [
            [0, 0],
            [n.width, n.height],
          ]).map((p) => [...p]),
          startFromNode,
          startToNode,
        };
        return;
      }
      if (isFileNode(n)) {
        // 图片节点：等比缩放（角手柄锁宽高比，边手柄自由），anchor = 对角
        this.session = {
          type: 'image-resize',
          handle: handle.id as HandleId,
          startW: { x: e.wx, y: e.wy },
          nodeId: n.id,
          startPos: { x: n.x, y: n.y },
          startSize: { width: n.width, height: n.height },
        };
        return;
      }
      this.session = {
        type: 'resize',
        handle: handle.id as HandleId,
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

    if (e.pick.kind === 'edge') {
      // 连线可选中（高亮曲线，可删除/编辑关系描述）；不能拖拽移动
      if (e.shift) doc.toggleSelection(e.pick.edgeId);
      else doc.setSelection([e.pick.edgeId]);
      return;
    }

    if (e.pick.kind === 'node') {
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
      // 单击容器 → 选中其内容（不含容器框）：排列等批量操作直接作用于内容。
      // 整体搬走的手势不变：只有从容器边带本身发起拖拽时容器框才跟随内容一起移动
      //（见 startMove 的 fromBand）。从内容元素发起拖拽时容器框不跟随。
      // 空容器没有内容可选 → 选中容器本身（否则空容器永远点不中）。
      const cid = e.pick.containerId;
      const ids = doc.containerChildren(cid).map((c) => c.id);
      doc.setSelection(ids.length ? ids : [cid], e.shift);
      this.startMove(e, true);
      return;
    }

    // 空白处：框选
    if (!e.shift) doc.clearSelection();
    this.session = { type: 'marquee', startW: { x: e.wx, y: e.wy } };
  }

  /**
   * 开始移动会话。fromBand = 拖拽是否从容器边带本身发起：
   * 仅此时容器框才随内容一起平移（点住容器拖走 = 整体搬家，含撤销还原，嵌套容器逐层补齐）。
   * 从元素上发起拖拽时，即使容器内全部子元素都被选中，也只移动所选元素，容器框不动。
   */
  private startMove(e: PointerEvt, fromBand = false): void {
    const doc = this.ctx.doc;
    const starts = new Map<string, { x: number; y: number }>();
    for (const id of doc.selection) {
      const n = doc.getNode(id);
      if (n) starts.set(id, { x: n.x, y: n.y });
    }
    if (fromBand) {
      // 容器跟随：某容器的直接子元素全部在移动集合里而容器本身不在 → 容器框一起平移。
      // 嵌套容器逐层补齐：内层框加入后，外层框若内容也随之齐全则同样跟随。
      let added = true;
      while (added) {
        added = false;
        for (const n of doc.nodes) {
          if (!isContainerNode(n) || starts.has(n.id)) continue;
          const children = doc.containerChildren(n.id);
          if (children.length > 0 && children.every((ch) => starts.has(ch.id))) {
            starts.set(n.id, { x: n.x, y: n.y });
            added = true;
          }
        }
      }
    }
    // 绑定箭头被整体拖动时会冻结绑定（锚点固化）：捕获快照，撤销时还原磁吸关系。
    // 但绑定端元素也在这次移动里时保持绑定（箭头由 syncBoundArrow 跟随），无需快照。
    const bound = new Map<string, ResizeStartRecord>();
    for (const id of starts.keys()) {
      const n = doc.getNode(id);
      if (n && isLineLike(n) && (n.fromNode || n.toNode) && !this.movesWithBinding(n, starts)) {
        bound.set(id, {
          x: n.x,
          y: n.y,
          width: n.width,
          height: n.height,
          points: n.points ? n.points.map((p) => [...p]) : undefined,
          fromNode: n.fromNode,
          toNode: n.toNode,
        });
      }
    }
    this.session = { type: 'move', startW: { x: e.wx, y: e.wy }, starts, moved: false, bound };
  }

  /**
   * 绑定端是否有元素也在这次移动里。
   * 是 → 连线随元素一起走，保持绑定（不冻结，否则多选拖动会把连线扯成独立箭头）；
   * 否 → 拖的是箭头本体（或与它无关的组合），冻结解绑，允许自由移动。
   */
  private movesWithBinding(n: CanvasNode, moving: { has(id: string): boolean }): boolean {
    return (!!n.fromNode && moving.has(n.fromNode)) || (!!n.toNode && moving.has(n.toNode));
  }

  onPointerMove(e: PointerEvt): void {
    const s = this.session;
    if (!s) return;
    if (s.type === 'move') {
      this.moveSession(e, s);
    } else if (s.type === 'resize') {
      this.resizeSession(e, s);
    } else if (s.type === 'point') {
      this.pointSession(e, s);
    } else if (s.type === 'edge-point') {
      this.edgePointSession(e, s);
    } else if (s.type === 'image-resize') {
      this.imageResizeSession(e, s);
    } else if (s.type === 'rotate') {
      this.rotateSession(e, s);
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
          // 绑定箭头：绑定元素也在这批移动里 → 保持绑定（位置由 syncBoundArrow 从锚点推导，
          // 这里的位移只对单端绑定的自由端生效）；否则冻结绑定（本体拖动 = 解除磁吸，
          // 不冻结的话渲染时 syncBoundArrow 会把它吸回被连元素上，表现为拖不动）
          if (isLineLike(n) && (n.fromNode || n.toNode) && !this.movesWithBinding(n, s.starts)) {
            freezeBoundArrow(n, (gid) => doc.getNode(gid));
          }
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

  /**
   * 线类端点拖拽：把折点直接跟到指针位置（包围盒由 setLinePoint 整体重排，
   * 其余折点世界位置不动）。与旧的四角缩放语义不同：改形状，而不是等比拉伸。
   */
  private pointSession(e: PointerEvt, s: Extract<Session, { type: 'point' }>): void {
    if (Math.hypot(e.wx - s.startW.x, e.wy - s.startW.y) * this.ctx.engine.vp.scale < 3) return;
    const n = this.ctx.doc.getNode(s.nodeId);
    if (!n) return;
    this.ctx.doc.live(() => setLinePoint(n, s.index, e.wx, e.wy));
    // 磁吸提示：紧贴可连接元素时显示四向锚点 + 高亮当前会吸附到的那个锚点
    const other = s.index === 0 ? (n.toNode ?? null) : (n.fromNode ?? null);
    this.previewMagnet(e.wx, e.wy, other);
    this.ctx.engine.applyOverlay();
  }

  /**
   * 连线端点拖拽：把一端改连到其它元素（四向磁吸），拖拽中实时跟随悬停目标；
   * 松手停在空白 → 恢复原绑定（连线始终有效，不悬空）。
   */
  private edgePointSession(e: PointerEvt, s: Extract<Session, { type: 'edge-point' }>): void {
    const { doc, engine } = this.ctx;
    const edge = doc.getEdge(s.edgeId);
    if (!edge) return;
    if (!s.moved && Math.hypot(e.wx - s.startW.x, e.wy - s.startW.y) * engine.vp.scale < 3) return;
    s.moved = true;
    // 磁吸提示：以真实磁吸距离判定（而非指针是否已进入元素内），贴近即提示、稳定不闪烁
    this.previewMagnet(e.wx, e.wy, [s.startFrom, s.startTo]);
    // 排除用「拖拽前」绑定（整段拖拽中恒定）：当前端已被实时改连，若排除当前状态
    // 会把悬停目标自己也排除掉 → 磁吸失效、松手回弹
    const m = this.magnetTarget(e.wx, e.wy, [s.startFrom, s.startTo]);
    doc.live(() => {
      if (m) {
        // 实时跟随：另一端绑定保持，当前端改连到悬停目标
        if (s.side === 'from') edge.fromNode = m.id;
        else edge.toNode = m.id;
        const a = doc.getNode(edge.fromNode);
        const b = doc.getNode(edge.toNode);
        if (a && b && edge.fromNode !== edge.toNode) {
          // 按两元素相对位置刷新连接方向（上下左右均可连接）
          const sides = inferSides(nodeRect(a), nodeRect(b));
          edge.fromSide = sides.fromSide;
          edge.toSide = sides.toSide;
        }
      } else {
        // 悬停空白：恢复拖拽前绑定
        edge.fromNode = s.startFrom;
        edge.toNode = s.startTo;
        edge.fromSide = s.startFromSide;
        edge.toSide = s.startToSide;
      }
    });
  }

  /**
   * 旋转拖拽：指针绕中心（按下时固定）的极角增量 → 节点 rotation（度，顺时针为正）。
   * Shift 吸附 15° 增量；角度归一化到 [-180, 180)，序列化干净且视觉等价。
   */
  private rotateSession(e: PointerEvt, s: Extract<Session, { type: 'rotate' }>): void {
    const { doc, engine } = this.ctx;
    const n = doc.getNode(s.nodeId);
    if (!n) return;
    if (!s.moved && Math.hypot(e.wx - s.startW.x, e.wy - s.startW.y) * engine.vp.scale < 3) return;
    s.moved = true;
    const ang = Math.atan2(e.wy - s.center.y, e.wx - s.center.x);
    let deg = s.startRot + ((ang - s.startAng) * 180) / Math.PI;
    if (e.shift) deg = Math.round(deg / 15) * 15;
    deg = normalizeRotation(deg);
    doc.live(() => {
      n.rotation = Math.round(deg * 10) / 10;
    });
    engine.applyOverlay();
  }

  /** 端点磁吸（四向最近边）：exclude 为排除的元素 id（防自环/防重复绑定），过滤线类目标 */
  private magnetTarget(wx: number, wy: number, exclude: string | Iterable<string> | null): { id: string; x: number; y: number } | null {
    const { engine, doc } = this.ctx;
    return magnetAnchor(wx, wy, MAGNET_PX / engine.vp.scale, doc.nodes, (id) => !engine.isNodeHidden(id), exclude);
  }

  /** 磁性提示：指针贴近可连接元素（磁吸半径内）→ 显示该元素四向锚点端口，
   * 并在松手会吸附到的那个锚点上高亮磁吸标记；远离则全部清空。
   * 由 magnetTarget 驱动（而非 hitTest），提示范围 == 真实吸附范围，稳定可预期。 */
  private previewMagnet(wx: number, wy: number, exclude: string | Iterable<string> | null): void {
    const { engine, doc } = this.ctx;
    const m = this.magnetTarget(wx, wy, exclude);
    if (m) {
      const t = doc.getNode(m.id);
      engine.overlayState.ports = t && isLinkableTarget(t) ? sideAnchors(nodeRect(t)) : [];
      engine.overlayState.magnet = { x: m.x, y: m.y };
    } else {
      engine.overlayState.ports = [];
      engine.overlayState.magnet = null;
    }
  }

  onPointerUp(e: PointerEvt): void {
    const s = this.session;
    if (!s) return;
    const { doc, engine } = this.ctx;
    if (s.type === 'move') {
      if (s.moved) doc.commitPositions('移动', s.starts, s.bound.size ? s.bound : undefined);
      engine.overlayState.guides = [];
      engine.applyOverlay();
    } else if (s.type === 'point') {
      const n = doc.getNode(s.nodeId);
      const moved = Math.hypot(e.wx - s.startW.x, e.wy - s.startW.y) * engine.vp.scale >= 3;
      if (n) {
        // 未拖动（点按即松）：还原被解除的绑定，不落撤销记录
        if (!moved && s.startFromNode && !n.fromNode) doc.live(() => (n.fromNode = s.startFromNode));
        if (!moved && s.startToNode && !n.toNode) doc.live(() => (n.toNode = s.startToNode));
        if (moved) {
          // 重新链接：松手时端点靠近其它元素（四向磁吸）→ 绑定该端；否则保持自由端
          const twoPoint = n.shape === 'arrow' || n.shape === 'line';
          const last = (n.points?.length ?? 2) - 1;
          if (twoPoint && (s.index === 0 || s.index === last)) {
            const other = s.index === 0 ? (n.toNode ?? null) : (n.fromNode ?? null);
            const m = this.magnetTarget(e.wx, e.wy, other);
            if (m) {
              doc.live(() => {
                if (s.index === 0) n.fromNode = m.id;
                else n.toNode = m.id;
                setLinePoint(n, s.index, m.x, m.y);
              });
            }
          }
          const starts = new Map([[s.nodeId, { x: s.startPos.x, y: s.startPos.y }]]);
          const rec: ResizeStartRecord = {
            x: s.startPos.x,
            y: s.startPos.y,
            width: s.startSize.width,
            height: s.startSize.height,
            points: s.startPoints,
            fromNode: s.startFromNode,
            toNode: s.startToNode,
          };
          doc.commitPositions('调整箭头', starts, new Map([[s.nodeId, rec]]));
        }
      }
      engine.overlayState.ports = [];
      engine.overlayState.magnet = null;
      engine.applyOverlay();
    } else if (s.type === 'edge-point') {
      const edge = doc.getEdge(s.edgeId);
      if (edge && s.moved) {
        // 同上：排除拖拽前绑定，避免把实时改连的目标自己排除掉
        const m = this.magnetTarget(e.wx, e.wy, [s.startFrom, s.startTo]);
        if (m) {
          doc.live(() => {
            if (s.side === 'from') edge.fromNode = m.id;
            else edge.toNode = m.id;
            const a = doc.getNode(edge.fromNode);
            const b = doc.getNode(edge.toNode);
            if (a && b && edge.fromNode !== edge.toNode) {
              const sides = inferSides(nodeRect(a), nodeRect(b));
              edge.fromSide = sides.fromSide;
              edge.toSide = sides.toSide;
            }
          });
          // start 为拖拽前快照：撤销还原原连接，重做恢复新连接
          doc.commitEdgeRelink(edge.id, {
            fromNode: s.startFrom,
            toNode: s.startTo,
            fromSide: s.startFromSide,
            toSide: s.startToSide,
          });
        } else {
          // 松手在空白：恢复原绑定，不产生撤销记录
          doc.live(() => {
            edge.fromNode = s.startFrom;
            edge.toNode = s.startTo;
            edge.fromSide = s.startFromSide;
            edge.toSide = s.startToSide;
          });
        }
      }
      engine.overlayState.ports = [];
      engine.overlayState.magnet = null;
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
    } else if (s.type === 'rotate') {
      const n = doc.getNode(s.nodeId);
      // 实际旋转过才落撤销记录（点按即松 / 角度未变 → 无记录）
      if (n && s.moved && Math.abs((n.rotation ?? 0) - s.startRot) > 1e-6) {
        const starts = new Map([[s.nodeId, { x: n.x, y: n.y }]]);
        const rec: ResizeStartRecord = { x: n.x, y: n.y, width: n.width, height: n.height, rotation: s.startRot };
        doc.commitPositions('旋转', starts, new Map([[s.nodeId, rec]]));
      }
      engine.applyOverlay();
    } else if (s.type === 'marquee') {
      const worldRect = normalizeRect(rectFromPoints(s.startW, { x: e.wx, y: e.wy }));
      const get = (id: string) => doc.getNode(id);
      const hits = doc.nodes
        .filter((n) => !engine.isNodeHidden(n.id) && n.type !== 'trefoil/container')
        // 线类按实体（折线/绑定曲线）判定：斜线的包围盒大半是空白，用盒子框选会凭空选中
        .filter((n) => (isLineLike(n) ? lineHitsRect(n, worldRect, get) : rectsIntersect(worldRect, nodeRect(n))))
        .map((n) => n.id);
      doc.setSelection(hits, e.shift);
      engine.overlayState.marquee = null;
      engine.applyOverlay();
    }
    this.session = null;
  }

  onDoubleClick(e: PointerEvt): void {
    const doc = this.ctx.doc;
    // 双击旋转手柄 → 旋转归零（与属性面板的重置按钮同效）；手柄命中优先于元素命中
    // （手柄悬在元素上缘之外，pick 到的多半是画布/别的元素，不能走下面的分支）
    if (this.ctx.engine.overlay.handleAt(e.sx, e.sy)?.id === 'rotate') {
      const nodes = doc.selectedNodes().filter(canRotate).filter((n) => (n.rotation ?? 0) !== 0);
      if (nodes.length) {
        const patches = new Map<string, Partial<CanvasNode>>(nodes.map((n) => [n.id, { rotation: 0 }]));
        doc.updateNodes(patches, '重置旋转');
      }
      this.ctx.engine.applyOverlay();
      return;
    }
    if (e.pick.kind === 'container-band') {
      // 双击容器左上角名片 → 重命名
      this.ctx.renameContainer?.(e.pick.containerId);
      return;
    }
    if (e.pick.kind === 'edge') {
      // 双击连线 → 内联编辑关系描述（与右键菜单一致）
      this.ctx.beginLabelEdit('edge', e.pick.edgeId);
      return;
    }
    if (e.pick.kind === 'node') {
      const n = doc.getNode(e.pick.nodeId);
      if (!n) return;
      if (n.type === 'text') {
        this.ctx.beginTextEdit(n.id);
      } else if (isLineLike(n)) {
        // 双击线类形状（line/arrow/polyline）→ 编辑关系描述
        this.ctx.beginLabelEdit('node', n.id);
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
      ...textBorderDefaults(settings.shape),
    });
    doc.addNodes([node]);
    this.ctx.beginTextEdit(node.id);
  }

  onKey(e: KeyboardEvent): boolean {
    // 导图快捷键：Tab 添加子节点、Enter 添加同级节点（仅单选导图成员时接管，
    // 其余按键交还全局处理；PolylineTool 的 Enter 结束折线在更早的分发里已消费）
    if (e.key !== 'Tab' && e.key !== 'Enter') return false;
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return false;
    const doc = this.ctx.doc;
    if (doc.selection.size !== 1) return false;
    const n = doc.selectedNodes()[0];
    if (!n || !isMapMember(doc, n.id)) return false;
    const handled = e.key === 'Tab' ? this.ctx.mapAddChild(n.id) : this.ctx.mapAddSibling(n.id);
    if (!handled) return false;
    e.preventDefault();
    return true;
  }
}

// rectsIntersect 需要处理负宽高（marquee 转换后已归一化）
function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}
