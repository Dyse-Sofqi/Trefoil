/** Trefoil 核心数据模型 —— 所有节点共用同一套结构，数组顺序决定 Z-index。 */

export type ShapeKind =
  | 'rect'
  | 'ellipse'
  | 'diamond'
  | 'triangle'
  | 'line'
  | 'arrow'
  | 'polyline';

export type Side = 'top' | 'bottom' | 'left' | 'right';

export type HAlign = 'left' | 'center' | 'right' | 'justify';
export type VAlign = 'top' | 'middle' | 'bottom';

/** JSON Canvas 标准类型 */
export const NODE_TYPE_TEXT = 'text';
/** JSON Canvas 标准类型：指向库内文件的节点（图片等附件，遵循 Obsidian 附件约定） */
export const NODE_TYPE_FILE = 'file';
/** Trefoil 扩展类型（JSON Canvas 允许自定义类型，扩展字段使用 trefoil: 命名空间） */
export const NODE_TYPE_SHAPE = 'trefoil/shape';
export const NODE_TYPE_CONTAINER = 'trefoil/container';

export interface CanvasNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** 'text' | 'file' | 'trefoil/shape' | 'trefoil/container'（解析时保留未知类型） */
  type: string;
  /** text 节点内容，支持 Obsidian 内联 Markdown；容器节点为容器名称 */
  text?: string;
  /** file 节点（图片等附件）：库内相对路径，如 `attachments/Pasted image 20250101120000.png` */
  file?: string;
  /** JSON Canvas 预设色 "1".."6" 或 #hex */
  color?: string;
  // ---- trefoil 扩展字段（序列化时加 trefoil: 前缀） ----
  shape?: ShapeKind;
  fill?: string | null;
  stroke?: string | null;
  strokeSize?: number;
  /** 0..1 */
  opacity?: number;
  fontFamily?: string;
  fontSize?: number;
  /** 字重：1..900（400 常规，≥600 粗体语义），画布与 CSS font-weight 通用 */
  fontWeight?: number;
  hAlign?: HAlign;
  vAlign?: VAlign;
  /** 形状翻转（仅 trefoil/shape） */
  flipX?: boolean;
  flipY?: boolean;
  /** line/arrow/polyline 的折点，相对节点 x,y */
  points?: number[][];
  // ---- 图片 / 附件（file 节点） ----
  /** 图片原始像素尺寸 [宽, 高]：等比缩放与占位框用（NodeView 加载完成后回填） */
  fileSize?: [number, number];
  // ---- 思维导图容器 ----
  /** 所属容器 id（子节点；容器内部节点） */
  containerId?: string | null;
  /** 导图父节点 id */
  treeParent?: string | null;
  /** 容器节点：折叠状态 */
  collapsed?: boolean;
  /** 容器节点：布局方向 */
  layout?: 'horizontal' | 'vertical';
  // ---- 绑定组 ----
  groupId?: string | null;
}

export interface CanvasEdge {
  id: string;
  fromNode: string;
  toNode: string;
  fromSide?: Side;
  toSide?: Side;
  color?: string;
  label?: string;
  /** 'link'：元素间连接线；'mindmap'：容器内导图连线 */
  kind?: 'link' | 'mindmap';
}

export interface CanvasDoc {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

export const isTextNode = (n: CanvasNode) => n.type === NODE_TYPE_TEXT;
export const isFileNode = (n: CanvasNode) => n.type === NODE_TYPE_FILE;
export const isShapeNode = (n: CanvasNode) => n.type === NODE_TYPE_SHAPE;
export const isContainerNode = (n: CanvasNode) => n.type === NODE_TYPE_CONTAINER;
export const isLineLike = (n: CanvasNode) =>
  isShapeNode(n) && (n.shape === 'line' || n.shape === 'arrow' || n.shape === 'polyline');
