/**
 * ToolManager：注册/切换工具，统一分发指针/滚轮/键盘事件。
 * - 右键/中键拖拽 = 平移画布；右键单击（未拖动）= 激活绘图工具时回到选择工具，选择工具下为上下文菜单。
 * - 滚轮 = 以鼠标位置为中心缩放。
 * - 画布内快捷键：撤销/重做、删除、复制粘贴、工具切换、镭射清除等。
 *   走 window 上的 keydown 监听（而非 Obsidian 的 addCommand 默认热键）：画布快捷键绝不能
 *   占用 Mod+Z 这类全局热键，否则会吞掉编辑器的原生撤销（原因见 main.ts 里 undo 命令的注释）。
 */
import type Konva from 'konva';
import { TOOL_HOTKEYS, type ContextMenuInfo, type PointerEvt, type Tool, type ToolCtx } from './types';
import type { Engine } from '../engine/Engine';
import { clamp } from '../core/geometry';
import { isOwnClipboardText, readNodesFromSystemClipboard } from '../core/systemClipboard';
import { extensionForFile } from '../core/attachment';
import { isImageFileDrag } from '../core/dragDrop';

interface PanSession {
  button: number;
  sx: number;
  sy: number;
  vx: number;
  vy: number;
  moved: boolean;
}

export class ToolManager {
  tools = new Map<string, Tool>();
  private activeTool: Tool | null = null;
  private pan: PanSession | null = null;
  private dragging = false;
  /** 双击检测：上一次左键按下（时间 / 屏幕坐标）；原生 dblclick 在部分环境不可靠，自行合成 */
  private lastDown: { t: number; sx: number; sy: number } | null = null;
  /** 本次按下对已由指针序列合成过双击：随后到达的原生 dblclick 需去重跳过 */
  private pendingNativeDbl = false;
  private container: HTMLDivElement;
  private rectCache: DOMRect | null = null;
  private disposers: (() => void)[] = [];
  /** 空格按住 = 临时平移模式（左键拖拽平移画布） */
  private spacePan = false;
  /** 最近一次指针位置（世界坐标）及是否在画布内：粘贴落点用 */
  private lastPointerWorld: { x: number; y: number } | null = null;
  private pointerInCanvas = false;

  constructor(private stage: Konva.Stage, public ctx: ToolCtx) {
    this.container = stage.container();
    this.bindEvents();
  }

  register(tool: Tool): void {
    tool.ctx = this.ctx;
    this.tools.set(tool.id, tool);
  }

  registerAll(tools: Tool[]): void {
    for (const t of tools) this.register(t);
  }

  activate(id: string): void {
    const next = this.tools.get(id) ?? this.tools.get('select');
    if (!next || next === this.activeTool) return;
    this.activeTool?.onDeactivate?.();
    this.activeTool = next;
    next.onActivate?.();
    this.ctx.setCursor(this.spacePan ? 'grab' : cursorForTool(next.id));
  }

  activeId(): string {
    return this.activeTool?.id ?? 'select';
  }

  // ---------- 事件绑定 ----------

  private bindEvents(): void {
    const c = this.container;
    const down = (e: PointerEvent) => {
      this.rectCache = c.getBoundingClientRect();
      try {
        c.setPointerCapture(e.pointerId);
      } catch {
        /* 合成事件或指针已释放时可能失败，忽略 */
      }
      this.dragging = true;
      if (e.button === 1 || e.button === 2) {
        this.pan = {
          button: e.button,
          sx: e.clientX - this.rectCache.left,
          sy: e.clientY - this.rectCache.top,
          vx: this.ctx.engine.vp.x,
          vy: this.ctx.engine.vp.y,
          moved: false,
        };
        this.ctx.setCursor('grabbing');
        e.preventDefault();
        return;
      }
      if (e.button !== 0) return;
      this.pendingNativeDbl = false;
      // 空格 + 左键拖拽 = 平移画布
      if (this.spacePan) {
        this.pan = {
          button: 0,
          sx: e.clientX - this.rectCache.left,
          sy: e.clientY - this.rectCache.top,
          vx: this.ctx.engine.vp.x,
          vy: this.ctx.engine.vp.y,
          moved: false,
        };
        this.ctx.setCursor('grabbing');
        e.preventDefault();
        return;
      }
      // 双击合成：两次左键按下间隔 <500ms、位移 <6px 即视为双击（本次按下不再分发 onPointerDown）。
      // 窗口必须覆盖操作系统允许的双击速度（Windows 默认 500ms，用户可调更慢）——
      // 曾用 400ms 导致正常偏慢的双击全部丢失、无法进入文本编辑；
      // 超出窗口的慢速双击由下方原生 dblclick 兜底（跟随操作系统设置），两路经 pendingNativeDbl 去重。
      const now = performance.now();
      const sx = e.clientX - this.rectCache.left;
      const sy = e.clientY - this.rectCache.top;
      if (this.lastDown && now - this.lastDown.t < 500 && Math.hypot(sx - this.lastDown.sx, sy - this.lastDown.sy) < 6) {
        this.lastDown = null;
        this.pendingNativeDbl = true;
        // 必须取消本次按下的默认动作：合成双击在这里就进入了编辑态（「双击空白新建文本」会在微任务里
        // 把焦点交给覆盖层的 textarea），而 pointerdown 之后浏览器还会执行 mousedown 的默认动作
        // （焦点移到 body / 最近的 focusable 祖先）——刚聚焦的 textarea 立刻被 blur，覆盖层 onblur
        // 提交空文本，新建的节点当场被删掉，表现为「双击毫无反应」。
        // 取消后 mousedown/mouseup 不再派发，但 click / dblclick 照常触发（下方去重逻辑不受影响）。
        e.preventDefault();
        this.activeTool?.onDoubleClick?.(this.makeEvt(e));
        return;
      }
      this.lastDown = { t: now, sx, sy };

      const evt = this.makeEvt(e);
      this.activeTool?.onPointerDown?.(evt);
    };
    const move = (e: PointerEvent) => {
      if (!this.rectCache) this.rectCache = c.getBoundingClientRect();
      // 记录指针位置与是否在画布内（粘贴落点用；面板上悬停时不算画布内）
      this.pointerInCanvas = e.target === c || (e.target instanceof Node && c.contains(e.target));
      this.lastPointerWorld = this.ctx.engine.screenToWorld(e.clientX - this.rectCache.left, e.clientY - this.rectCache.top);
      if (this.pan) {
        const sx = e.clientX - this.rectCache.left;
        const sy = e.clientY - this.rectCache.top;
        const dx = sx - this.pan.sx;
        const dy = sy - this.pan.sy;
        if (Math.abs(dx) + Math.abs(dy) > 3) this.pan.moved = true;
        if (this.pan.moved) {
          const scale = this.ctx.engine.vp.scale;
          this.ctx.engine.setViewport({
            x: this.pan.vx - dx / scale,
            y: this.pan.vy - dy / scale,
            scale,
          });
        }
        return;
      }
      if (!this.dragging && e.pointerType === 'mouse') {
        // 悬停也分发（橡皮擦光标、Ports 预览等）
        const evt = this.makeEvt(e);
        this.activeTool?.onPointerMove?.(evt);
        return;
      }
      const evt = this.makeEvt(e);
      this.activeTool?.onPointerMove?.(evt);
    };
    const up = (e: PointerEvent) => {
      this.dragging = false;
      if (this.pan) {
        const wasPan = this.pan;
        this.pan = null;
        this.ctx.setCursor(this.spacePan ? 'grab' : cursorForTool(this.activeId()));
        if (!wasPan.moved && wasPan.button === 2) {
          // 激活绘图工具时右键单击 = 回到默认选择工具（消费本次点击，不开菜单）；
          // 再按一次右键（此时已是选择工具）才是上下文菜单
          if (this.activeTool?.id !== 'select') {
            this.ctx.setTool('select');
            return;
          }
          const evt = this.makeEvt(e);
          this.ctx.openContextMenu({
            sx: evt.sx,
            sy: evt.sy,
            wx: evt.wx,
            wy: evt.wy,
            pick: this.ctx.engine.pick(evt.wx, evt.wy),
          });
        }
        return;
      }
      const evt = this.makeEvt(e);
      this.activeTool?.onPointerUp?.(evt);
    };
    // 原生 dblclick 兜底：操作系统判定为双击但超出合成窗口（>500ms）的慢速双击由这里接住；
    // 快速双击两条路径都会到，用 pendingNativeDbl 去重（合成已在 down 时触发过）
    const dbl = (e: MouseEvent) => {
      if (!this.rectCache) this.rectCache = c.getBoundingClientRect();
      if (e.button !== 0) return;
      if (this.pendingNativeDbl) {
        this.pendingNativeDbl = false;
        return;
      }
      this.activeTool?.onDoubleClick?.(this.makeEvt(e as unknown as PointerEvent));
    };
    const cancel = (e: PointerEvent) => {
      // 数位板笔/触摸被浏览器手势接管时触发（此时不会再有 pointerup）：视作强制抬笔，避免工具状态卡死
      this.dragging = false;
      if (this.pan) {
        this.pan = null;
        this.ctx.setCursor(this.spacePan ? 'grab' : cursorForTool(this.activeId()));
      }
      this.activeTool?.onPointerUp?.(this.makeEvt(e));
    };
    const paste = (e: ClipboardEvent) => {
      const el = e.target as HTMLElement | null;
      // 输入框 / 文本编辑覆盖层内交给浏览器默认粘贴
      if (el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.isContentEditable)) return;
      e.preventDefault();
      const dt = e.clipboardData;
      const at = this.pasteOrigin();
      // 0) 剪贴板里有图片（截图/复制的图片文件）→ 落盘到附件目录 + 图片节点（Obsidian 附件约定）
      const image = pickClipboardImage(dt);
      if (image) {
        void this.ctx.pasteImage(image.blob, image.fileName, at);
        return;
      }
      // 1) 剪贴板里是本应用的画布元素（复制时写入的标记）→ 按元素粘贴
      const nodes = readNodesFromSystemClipboard(dt);
      if (nodes && this.ctx.pasteNodes(nodes, at) > 0) return;
      const text = dt?.getData('text/plain') ?? '';
      // 2) 剪贴板里的纯文本正是自己刚写入的元素摘要（HTML 标记被剪贴板工具剥掉）→ 仍按元素粘贴
      if (isOwnClipboardText(text) && !this.ctx.clipboard.isEmpty()) {
        this.ctx.clipboard.paste(this.ctx.doc, 24, at);
        return;
      }
      // 3) 否则按文本粘贴（按行成文本元素）
      if (text.trim() && this.ctx.pasteText(text, at) > 0) return;
      // 4) 剪贴板里既没有元素也没有文本 → 用应用内剪贴板兜底
      this.ctx.clipboard.paste(this.ctx.doc, 24, at);
    };
    // dragover / dragenter 阶段 dataTransfer 处于保护模式：getData() 一律返回空串，
    // 只有 types/files 可读。所以「能否接收」交给宿主判断（Obsidian 内部拖拽的载荷在
    // app.dragManager.draggable 上，dataTransfer 里根本没有 File），
    // 且**必须** preventDefault —— 否则浏览器不会派发 drop，整个拖放静默失败。
    const canDrop = (e: DragEvent): boolean => {
      const host = this.ctx.canDropImages;
      return host ? host(e) : isImageFileDrag(e);
    };
    const acceptDrag = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const dragenter = (e: DragEvent) => {
      if (canDrop(e)) acceptDrag(e);
    };
    const dragover = (e: DragEvent) => {
      if (canDrop(e)) acceptDrag(e);
    };
    const drop = (e: DragEvent) => {
      if (!canDrop(e)) return;
      acceptDrag(e);
      const rect = c.getBoundingClientRect();
      const p = this.ctx.engine.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
      void this.ctx.dropImages(e, { x: Math.round(p.x), y: Math.round(p.y) });
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      if (!this.rectCache) this.rectCache = c.getBoundingClientRect();
      const sx = e.clientX - this.rectCache.left;
      const sy = e.clientY - this.rectCache.top;
      if (this.activeTool?.onWheel?.(e, sx, sy)) return;
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.008 : 0.0016));
      this.ctx.engine.zoomAt(sx, sy, factor);
      this.ctx.onViewportChanged?.();
    };
    const ctxMenu = (e: Event) => e.preventDefault();
    const leave = () => {
      this.pointerInCanvas = false;
      // 鼠标离开画布：清理悬停视觉
      this.ctx.engine.overlayState.eraserCursor = null;
      this.ctx.engine.overlayState.ports = [];
      this.ctx.engine.applyOverlay();
    };

    c.addEventListener('pointerdown', down);
    window.addEventListener('paste', paste);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', cancel);
    c.addEventListener('dblclick', dbl);
    c.addEventListener('wheel', wheel, { passive: false });
    c.addEventListener('contextmenu', ctxMenu);
    c.addEventListener('pointerleave', leave);
    c.addEventListener('dragenter', dragenter);
    c.addEventListener('dragover', dragover);
    c.addEventListener('drop', drop);

    this.disposers.push(() => {
      c.removeEventListener('pointerdown', down);
      window.removeEventListener('paste', paste);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      c.removeEventListener('pointercancel', cancel);
      c.removeEventListener('dblclick', dbl);
      c.removeEventListener('wheel', wheel);
      c.removeEventListener('contextmenu', ctxMenu);
      c.removeEventListener('pointerleave', leave);
      c.removeEventListener('dragenter', dragenter);
      c.removeEventListener('dragover', dragover);
      c.removeEventListener('drop', drop);
    });

    const keydown = (e: KeyboardEvent) => this.onKeyDown(e);
    window.addEventListener('keydown', keydown);
    const keyup = (e: KeyboardEvent) => this.onKeyUp(e);
    window.addEventListener('keyup', keyup);
    this.disposers.push(() => {
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('keyup', keyup);
    });
  }

  /** 粘贴落点：指针在画布内用指针位置；否则交给调用方按视口中心处理 */
  private pasteOrigin(): { x: number; y: number } | undefined {
    if (!this.pointerInCanvas || !this.lastPointerWorld) return undefined;
    return { x: Math.round(this.lastPointerWorld.x), y: Math.round(this.lastPointerWorld.y) };
  }

  private makeEvt(e: PointerEvent): PointerEvt {
    const rect = this.rectCache ?? this.container.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const w = this.ctx.engine.screenToWorld(sx, sy);
    return {
      sx,
      sy,
      wx: w.x,
      wy: w.y,
      button: e.button,
      shift: e.shiftKey,
      ctrl: e.ctrlKey || e.metaKey,
      alt: e.altKey,
      pick: this.ctx.engine.pick(w.x, w.y),
      raw: e,
    };
  }

  // ---------- 键盘 ----------

  private onKeyDown(e: KeyboardEvent): void {
    // 画布不在可见的前台时不响应键盘：切到后台标签页并不会卸载视图，
    // 否则在别的面板里按 Delete / Ctrl+A 会误改后台那张白板。
    if (!this.container.isConnected || this.container.getClientRects().length === 0) return;

    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.isContentEditable)) return;
    if (this.ctx.isEditing()) return;

    if (this.activeTool?.onKey?.(e)) return;

    const { doc, history, clipboard, settings } = this.ctx;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key;

    if (mod && key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) history.redo();
      else history.undo();
      return;
    }
    if (mod && key.toLowerCase() === 'y') {
      e.preventDefault();
      history.redo();
      return;
    }
    if (key === 'Delete' || key === 'Backspace') {
      e.preventDefault();
      this.deleteSelection();
      return;
    }
    if (mod && key.toLowerCase() === 'a') {
      e.preventDefault();
      doc.setSelection(doc.nodes.filter((n) => !this.ctx.engine.isNodeHidden(n.id)).map((n) => n.id));
      return;
    }
    if (mod && key.toLowerCase() === 'c') {
      // 复制同时写入系统剪贴板（带元素标记），Ctrl+V 才能优先按元素粘贴
      this.ctx.copySelection(false);
      return;
    }
    if (mod && key.toLowerCase() === 'x') {
      this.ctx.copySelection(true);
      return;
    }
    // Ctrl+V 交给 window 的 paste 事件处理：那里能同步读到系统剪贴板内容，
    // 且不需要剪贴板读取权限。
    if (mod && key.toLowerCase() === 'd') {
      e.preventDefault();
      clipboard.copy(doc);
      clipboard.paste(doc);
      return;
    }
    if (key === 'Escape') {
      if (this.ctx.engine.laser.strokeCount > 0) {
        this.ctx.engine.laser.clearAll();
        return;
      }
      if (this.ctx.engine.focusNodeId) {
        this.ctx.engine.focusNode(null);
        return;
      }
      doc.clearSelection();
      return;
    }
    if (key === ' ') {
      // 按住空格 = 临时平移模式
      if (!this.spacePan) {
        this.spacePan = true;
        this.ctx.setCursor('grab');
      }
      e.preventDefault();
      return;
    }
    if (key === '[' || key === ']') {
      const delta = key === '[' ? -4 : 4;
      settings.eraser.radius = clamp(settings.eraser.radius + delta, 5, 200);
      return;
    }
    // 方向键微移
    if (key.startsWith('Arrow') && doc.selection.size > 0) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      const dx = key === 'ArrowLeft' ? -step : key === 'ArrowRight' ? step : 0;
      const dy = key === 'ArrowUp' ? -step : key === 'ArrowDown' ? step : 0;
      const ids = [...doc.selection];
      doc.mutate('微移', () => {
        for (const id of ids) {
          const n = doc.getNode(id);
          if (n) {
            n.x += dx;
            n.y += dy;
          }
        }
      });
      return;
    }
    // 工具切换
    const toolId = TOOL_HOTKEYS[key.toLowerCase()];
    if (toolId && !mod && !e.altKey) {
      this.ctx.setTool(toolId);
    }
  }

  /** 松开空格：退出临时平移模式 */
  private onKeyUp(e: KeyboardEvent): void {
    if (e.key !== ' ' || !this.spacePan) return;
    this.spacePan = false;
    if (!this.pan) this.ctx.setCursor(cursorForTool(this.activeId()));
  }

  private deleteSelection(): void {
    const { doc } = this.ctx;
    if (doc.selection.size === 0) return;
    // 选中集合里可能含连线 id：节点/连线分别删除
    const nodeIds = [...doc.selection].filter((id) => doc.getNode(id));
    const edgeIds = [...doc.selection].filter((id) => doc.getEdge(id));
    if (nodeIds.length) doc.removeNodes(nodeIds);
    if (edgeIds.length) doc.removeEdges(edgeIds);
  }

  destroy(): void {
    for (const d of this.disposers) d();
    this.disposers = [];
  }
}

export function cursorForTool(id: string): string {
  switch (id) {
    case 'select':
      return 'default';
    case 'text':
      return 'text';
    case 'eraser':
      return 'none';
    case 'laser':
      return 'crosshair';
    default:
      return 'crosshair';
  }
}

// ---------- 剪贴板 / 拖放图片 → blob ----------

/** 从 paste 事件剪贴板取图片（依次：files → 旧式 bitmap getData('image/png')） */
function pickClipboardImage(dt: DataTransfer | null): { blob: Blob; fileName: string } | null {
  if (!dt) return null;
  if (dt.files?.length) {
    for (const f of Array.from(dt.files)) {
      if (f.type.startsWith('image/') && !f.type.includes('svg')) {
        return { blob: f, fileName: f.name || `Pasted image.${extensionForFile(f.name, f.type)}` };
      }
    }
  }
  // 旧实现（Windows 剪贴板最老的 bitmap 路径）：getData('image/png') 返回 dataURL
  const legacy = dt.getData('image/png');
  if (legacy && legacy.startsWith('data:image/')) {
    const m = /^data:(image\/[a-z+.-]+);base64,/.exec(legacy);
    const mime = m ? m[1] : 'image/png';
    const b64 = legacy.split(',')[1] ?? '';
    if (b64) {
      try {
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return { blob: new Blob([bytes], { type: mime }), fileName: `Pasted image.${extensionForFile('', mime)}` };
      } catch {
        /* 损坏的 base64：忽略 */
      }
    }
  }
  return null;
}
