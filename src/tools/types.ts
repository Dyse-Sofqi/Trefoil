/** 工具系统类型：所有工具独立成类，通过 ToolManager 注册 */
import type Konva from 'konva';
import type { Engine, PickResult } from '../engine/Engine';
import type { Document } from '../core/Document';
import type { History } from '../core/History';
import type { TrefoilSettings } from '../core/defaults';
import type { Clipboard } from '../core/clipboard';
import type { CanvasEdge, CanvasNode } from '../core/types';

export interface PointerEvt {
  sx: number;
  sy: number;
  wx: number;
  wy: number;
  button: number;
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
  pick: PickResult;
  raw: PointerEvent;
}

export interface ContextMenuInfo {
  sx: number;
  sy: number;
  wx: number;
  wy: number;
  pick: PickResult;
}

export interface ToolCtx {
  engine: Engine;
  doc: Document;
  history: History;
  settings: TrefoilSettings;
  clipboard: Clipboard;
  /** 复制/剪切选中元素（同时写入系统剪贴板，供跨白板粘贴） */
  copySelection(cut: boolean): void;
  /** 粘贴系统剪贴板文本：按行拆成文本元素添加到画布，返回新建数量；at 为落点（世界坐标） */
  pasteText(text: string, at?: { x: number; y: number }): number;
  /** 粘贴系统剪贴板里的画布元素（带元素标记时），返回新建数量；at 为落点（世界坐标） */
  pasteNodes(data: { nodes: CanvasNode[]; edges: CanvasEdge[] }, at?: { x: number; y: number }): number;
  /** 粘贴剪贴板图片 blob → 附件到库 + file 节点，返回新建节点 id（失败 null） */
  pasteImage(blob: Blob, fileName: string, at?: { x: number; y: number }): Promise<string | null>;
  /**
   * dragover/dragenter 阶段判断能否接收拖放。
   * 此时 dataTransfer 处于保护模式，getData() 取不到载荷，必须由宿主依据
   * dataTransfer.types/files 与自身拖拽状态（Obsidian 的 dragManager.draggable）判断。
   */
  canDropImages?(e: DragEvent): boolean;
  /** 拖放图片到画布（宿主解析拖放来源 → 库内图片直接引用 / 新图片落盘 + 建节点），返回新建数量 */
  dropImages(e: DragEvent, at: { x: number; y: number }): Promise<number>;
  /** 最近一次点击命中的节点 id（导图 Tab/Enter 语义依赖） */
  lastClickedNodeId?: string;
  setTool(id: string): void;
  activeToolId(): string;
  beginTextEdit(nodeId: string): void;
  /** 重命名容器：选中它并聚焦属性面板的名称输入框（双击名片触发） */
  renameContainer?(containerId: string): void;
  isEditing(): boolean;
  openContextMenu(info: ContextMenuInfo): void;
  setCursor(cursor: string): void;
  toast(msg: string): void;
  onViewportChanged?(): void;
}

export abstract class Tool {
  abstract readonly id: string;
  ctx!: ToolCtx;

  onActivate?(): void;
  onDeactivate?(): void;
  onPointerDown?(e: PointerEvt): void;
  onPointerMove?(e: PointerEvt): void;
  onPointerUp?(e: PointerEvt): void;
  onDoubleClick?(e: PointerEvt): void;
  /** 返回 true 表示已处理（不再走全局快捷键） */
  onKey?(e: KeyboardEvent): boolean;
  /** 返回 true 表示已处理（阻止缩放） */
  onWheel?(e: WheelEvent, sx: number, sy: number): boolean;
}

/** 工具快捷键映射 */
export const TOOL_HOTKEYS: Record<string, string> = {
  v: 'select',
  '1': 'select',
  r: 'rect',
  '2': 'rect',
  c: 'ellipse',
  '3': 'ellipse',
  d: 'diamond',
  '4': 'diamond',
  '5': 'triangle',
  '6': 'arrow',
  '7': 'polyline',
  t: 'text',
  '8': 'text',
  l: 'laser',
  '9': 'laser',
  e: 'eraser',
  '0': 'eraser',
};
