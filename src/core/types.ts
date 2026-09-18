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

/** 文本框实体边框线型 */
export type BorderStyle = 'solid' | 'dashed' | 'dotted';

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
  /** 形状填充 / 文本框背景色 / 容器背景色（trefoil/shape、text、trefoil/container 通用；null = 无填充） */
  fill?: string | null;
  /**
   * 填充的不透明度 0..1（缺省 1 = 不透明）。目前用于容器背景：
   * 容器的背景常需要半透明才能看清底下的点阵/网格，同时又不遮挡内部内容
   * （内部内容绘制在容器之上，见 core/zorder.paintOrder）。
   * 与节点级 opacity 区分：opacity 会连容器名片文字一起变淡。
   */
  fillOpacity?: number;
  /** 形状描边 / 文本框实体边框颜色（trefoil/shape 与 text 通用） */
  stroke?: string | null;
  /** 形状描边粗细 / 文本框实体边框粗细 */
  strokeSize?: number;
  /** 文本框实体边框开关（仅 text 节点）：开启后按 stroke/strokeSize 在框内描出边框 */
  border?: boolean;
  /** 文本框边框线型（仅 text 节点；缺省 solid 实线） */
  borderStyle?: BorderStyle;
  /** 文本框背景/边框的圆角半径（仅 text 节点；0 = 直角，渲染时夹取到框内可达的最大值） */
  borderRadius?: number;
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
  /** 旋转角（度，缺省 0 = 不旋转）：绕节点中心顺时针旋转；块状元素（文本/图片/非线类形状）支持 */
  rotation?: number;
  /** line/arrow/polyline 的折点，相对节点 x,y */
  points?: number[][];
  /** 箭头终点（末端）样式；缺省 arrow = solid、line/polyline = none */
  headStyle?: ArrowHeadStyle;
  /** 箭头起点样式；缺省 none，设置后即为双向箭头 */
  tailStyle?: ArrowHeadStyle;
  /** 端点磁吸绑定（仅两点直线/箭头）：起点/终点吸附到的元素 id，端点随元素移动；双端绑定渲染为贝塞尔曲线 */
  fromNode?: string;
  toNode?: string;
  /** 关系描述文本（线类形状）：画在线段中点，双击线段编辑 */
  label?: string;
  /** 线型（线类形状）：实线 solid（缺省）/ 虚线 dashed / 点状线 dotted */
  strokeStyle?: 'solid' | 'dashed' | 'dotted';
  // ---- 图片 / 附件（file 节点） ----
  /** 图片原始像素尺寸 [宽, 高]：等比缩放与占位框用（NodeView 加载完成后回填） */
  fileSize?: [number, number];
  /** 图片描述（显示在图片下方，屏幕恒定大小）：缺省显示文件名；空串 = 隐藏 */
  caption?: string;
  // ---- 容器归属 ----
  /** 所属容器 id（容器内部节点；删除容器时转为自由元素） */
  containerId?: string | null;
  // ---- 绑定组 ----
  groupId?: string | null;
  // ---- 导图 ----
  /** 导图主节点（可 Tab/Enter 快捷增删子/同级节点；成员资格由 mindmap 边决定） */
  mapRoot?: boolean;
}

/**
 * 箭头端点样式（line/arrow/polyline 形状节点）：
 * solid 实心三角 / hollow 空心三角 / chevron 线段（开放式 V 形）/ dot 实心圆点 / hollow-dot 空心圆点
 */
export type ArrowHeadStyle = 'none' | 'solid' | 'hollow' | 'chevron' | 'dot' | 'hollow-dot';

export type EdgeKind = 'link' | 'mindmap';

export interface CanvasEdge {
  id: string;
  fromNode: string;
  toNode: string;
  fromSide?: Side;
  toSide?: Side;
  color?: string;
  label?: string;
  /** 边类型：缺省为普通连线（带箭头）；mindmap 为导图分支线（无箭头、主题色） */
  kind?: EdgeKind;
}

export interface CanvasDoc {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

export const isTextNode = (n: CanvasNode) => n.type === NODE_TYPE_TEXT;
export const isFileNode = (n: CanvasNode) => n.type === NODE_TYPE_FILE;
export const isShapeNode = (n: CanvasNode) => n.type === NODE_TYPE_SHAPE;
export const isContainerNode = (n: CanvasNode) => n.type === NODE_TYPE_CONTAINER;
/** 线类节点（直线/箭头/折线）：几何由 points 决定，不是由包围盒决定的「块状元素」 */
export const isLineLike = (n: { type: string; shape?: string }) =>
  n.type === NODE_TYPE_SHAPE && (n.shape === 'line' || n.shape === 'arrow' || n.shape === 'polyline');

/**
 * 块状元素（文本/图片/非线类形状）可旋转：围绕自身中心，内容整体跟随。
 * 线类由 points 决定几何、容器包含子节点（子节点是独立顶层元素，不会跟着转），都不支持旋转。
 */
export const canRotate = (n: CanvasNode): boolean => !isContainerNode(n) && !isLineLike(n);
