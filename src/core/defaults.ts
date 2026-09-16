/** 全局可调设置（仅视觉/交互辅助，不写入 .canvas 数据文件） */

import type { ArrowHeadStyle } from './types';

export type { ArrowHeadStyle };

export type BackgroundMode = 'solid' | 'dots' | 'grid';
export type DotShape = 'circle' | 'square' | 'diamond';
export type ViewMode = 'normal' | 'browse' | 'focus';

export type ThemeMode = 'light' | 'dark' | 'system';

/** 夜间模式默认配色（用户保持默认值时随主题切换，自定义过则尊重自定义） */
export const DARK_CANVAS_BG = '#1e1e1e';
export const DARK_DOT_COLOR = '#3f3f46';
export const DARK_GRID_COLOR = '#4a4a52';

export interface BackgroundSettings {
  mode: BackgroundMode;
  /** 纯色模式颜色 / 其他模式的底色（日间） */
  color: string;
  /** 夜间模式底色（独立于日间设置；状态栏主题切换时使用） */
  colorDark?: string;
  // 点阵
  dotSize: number; // 1-10 px
  dotShape: DotShape;
  dotColor: string; // 日间点色
  /** 夜间模式点色 */
  dotColorDark?: string;
  dotSpacing: number; // px，≥ 8
  // 网格（双层级）
  gridSpacing: number; // 小网格间距 px
  gridColor: string; // 日间网格色
  /** 夜间模式网格色 */
  gridColorDark?: string;
  gridMinorOpacity: number; // 0.15
  gridMajorOpacity: number; // 0.3
  gridMajorEvery: number; // N 格小网格 = 1 格大网格（默认 4）
}

export interface SnapSettings {
  enabled: boolean;
  gridSnap: boolean;
  objectSnap: boolean;
  /** 吸附阈值（屏幕 px） */
  threshold: number;
  /** 对齐参考线阈值（屏幕 px） */
  guideThreshold: number;
}

export interface LaserSettings {
  color: string;
  width: number;
  /** 消失延迟 ms；0 = 手动清除 */
  delayMs: number; // 1000 / 3000 / 5000 / 10000 / 0
}

export interface EraserSettings {
  radius: number; // 5-200
}

export interface TextSettings {
  fontFamily: string;
  fontSize: number;
  /** 字重：400 常规 / 700 加粗 */
  fontWeight: number;
  color: string;
  /** 已读取的系统字体列表（跨会话持久化） */
  availableFonts?: string[];
}

/** 属性面板/设置面板共用的内置字体预设 */
export const FONT_PRESETS = [
  'system-ui, sans-serif',
  'serif',
  'monospace',
  'Microsoft YaHei',
  'SimSun',
  'KaiTi',
  'SimHei',
  'Arial',
  'Georgia',
  'Times New Roman',
  'Courier New',
  'Consolas',
];

/**
 * 新建文本节点应从「文本默认」继承的样式字段（唯一真源）。
 * 各创建路径（文本工具/双击空白/右键添加文本）统一走这里，
 * 避免逐个手写字段时漏掉某一项（如字重）。
 */
export function textStyleDefaults(t: TextSettings): { fontSize: number; fontFamily: string; fontWeight: number; color?: string } {
  return {
    fontSize: t.fontSize,
    fontFamily: t.fontFamily,
    fontWeight: t.fontWeight,
    // 颜色等于全局默认时不烤进节点（渲染回退到调色板文字色，自动随主题日夜适配）
    color: t.color === DEFAULT_SETTINGS.text.color ? undefined : t.color,
  };
}

/**
 * 新建文本节点默认带的实体边框（卡片感默认开启，可在属性面板随时取消）。
 * 颜色/粗细跟随「新形状默认描边」，圆角 6、实线；与 textStyleDefaults 搭配展开。
 */
export function textBorderDefaults(shape: ShapeDefaults) {
  return { border: true, stroke: shape.stroke, strokeSize: shape.strokeSize, borderRadius: 6, borderStyle: 'solid' as const };
}

/**
 * 容器默认外观（`trefoil/container`）。
 *
 * 这两个值**不作为字段写进 .canvas**，而是「字段未设置时」的回退值 —— 所以
 * ① 已有容器（组合为容器时只写了几何字段）也会跟随；
 * ② 显式设过的值一律优先（含 `0`：`borderRadius: 0` / `fillOpacity: 0` 是合法取值，
 *    序列化不会因为 falsy 把 0 丢掉，见 data/jsonCanvas 的扩展字段过滤）；
 * ③ 以后想调默认值只改这一处。
 *
 * 用法：渲染与属性面板都必须经这两个常量取默认值，别各写一份 `?? 0` / `?? 1`。
 */
export const CONTAINER_DEFAULT_RADIUS = 10;
export const CONTAINER_DEFAULT_FILL_OPACITY = 0.1;

export interface ShapeDefaults {
  fill: string | null;
  stroke: string;
  strokeSize: number;
  /** 新建箭头/直线的终点（末端）样式默认值 */
  arrowHead: ArrowHeadStyle;
  /** 新建箭头/直线的起点样式默认值；非 none 即双向箭头 */
  arrowTail: ArrowHeadStyle;
}

/** 鼠标悬停在数值控件上滚轮微调的步进设置 */
export interface WheelStepSettings {
  /** 步进方式：auto = 按控件性质（透明度/浓度等比例类用百分比，其余用固定数值） */
  mode: 'auto' | 'value' | 'percent';
  /** 固定数值步进：每格增减的绝对量 */
  value: number;
  /** 百分比步进：每格按当前值增减的百分比 */
  percent: number;
}

export interface TrefoilSettings {
  /** 界面主题：日间 / 夜间 / 跟随系统（宿主 Obsidian 主题） */
  theme: ThemeMode;
  background: BackgroundSettings;
  snap: SnapSettings;
  laser: LaserSettings;
  eraser: EraserSettings;
  text: TextSettings;
  shape: ShapeDefaults;
  wheelStep: WheelStepSettings;
  viewMode: ViewMode;
}

export const DEFAULT_SETTINGS: TrefoilSettings = {
  theme: 'system',
  background: {
    mode: 'grid',
    color: '#ffffff',
    colorDark: DARK_CANVAS_BG,
    dotSize: 2,
    dotShape: 'circle',
    dotColor: '#c9c9c9',
    dotColorDark: DARK_DOT_COLOR,
    dotSpacing: 24,
    gridSpacing: 24,
    gridColor: '#8a8a8a',
    gridColorDark: DARK_GRID_COLOR,
    gridMinorOpacity: 0.15,
    gridMajorOpacity: 0.3,
    gridMajorEvery: 4,
  },
  snap: {
    enabled: true,
    gridSnap: false,
    objectSnap: true,
    threshold: 10,
    guideThreshold: 10,
  },
  laser: {
    color: '#ff3b30',
    width: 6,
    delayMs: 3000,
  },
  eraser: {
    radius: 20,
  },
  text: {
    fontFamily: 'system-ui, sans-serif',
    fontSize: 16,
    fontWeight: 400,
    color: '#1f1f1f',
    availableFonts: [],
  },
  shape: {
    fill: null,
    stroke: '#5a5a5a',
    strokeSize: 2,
    arrowHead: 'solid',
    arrowTail: 'none',
  },
  wheelStep: {
    mode: 'auto',
    value: 1,
    percent: 10,
  },
  viewMode: 'normal',
};

/**
 * 画布背景随主题适配：夜间模式使用「夜间」专用色（底色/点阵/网格各自独立设置，
 * 未设置时回退：日间默认值 → 夜间内置默认），日间模式使用「日间」专用色原样返回。
 * kind 由调用方解析（跟随系统时取决于宿主当前主题）。
 */
export function effectiveBackground(bg: BackgroundSettings, kind: 'dark' | 'light'): BackgroundSettings {
  if (kind !== 'dark') return bg;
  const out = { ...bg };
  out.color = bg.colorDark ?? (bg.color === DEFAULT_SETTINGS.background.color ? DARK_CANVAS_BG : bg.color);
  out.dotColor = bg.dotColorDark ?? (bg.dotColor === DEFAULT_SETTINGS.background.dotColor ? DARK_DOT_COLOR : bg.dotColor);
  out.gridColor = bg.gridColorDark ?? (bg.gridColor === DEFAULT_SETTINGS.background.gridColor ? DARK_GRID_COLOR : bg.gridColor);
  return out;
}

/** 元素默认色的主题映射：主题翻转时把沿用日间默认色的元素同步过去（自定义色不参与） */
export const THEME_DEFAULT_TEXT = { light: DEFAULT_SETTINGS.text.color, dark: '#d8d8d8' } as const;
export const THEME_DEFAULT_STROKE = { light: DEFAULT_SETTINGS.shape.stroke, dark: '#8f8f8f' } as const;

/**
 * 主题翻转时同步元素默认色：文字/连线等沿用「日间默认色」的节点翻转为夜间默认色，反之亦然。
 * 只精确匹配两个默认值 —— 用户自定义的颜色（包括恰好与默认相同的）在主题切换时保持不变以外的
 * 情况见下：与默认值相同的自定义色会被一并翻转，这是「默认色跟随主题」语义的代价。
 * 原地修改，配合 doc.live 使用（不进撤销栈，属界面适配而非内容编辑）。
 */
export function remapThemeDefaultColors(nodes: { color?: string | null; stroke?: string | null }[], to: 'dark' | 'light'): void {
  for (const n of nodes) {
    if (n.color === THEME_DEFAULT_TEXT.light && to === 'dark') n.color = THEME_DEFAULT_TEXT.dark;
    else if (n.color === THEME_DEFAULT_TEXT.dark && to === 'light') n.color = THEME_DEFAULT_TEXT.light;
    if (n.stroke === THEME_DEFAULT_STROKE.light && to === 'dark') n.stroke = THEME_DEFAULT_STROKE.dark;
    else if (n.stroke === THEME_DEFAULT_STROKE.dark && to === 'light') n.stroke = THEME_DEFAULT_STROKE.light;
  }
}

export function mergeSettings(partial?: Partial<TrefoilSettings> | null): TrefoilSettings {
  if (!partial) return structuredCloneSafe(DEFAULT_SETTINGS);
  const base = structuredCloneSafe(DEFAULT_SETTINGS);
  for (const key of Object.keys(base) as (keyof TrefoilSettings)[]) {
    const incoming = partial[key];
    if (incoming && typeof incoming === 'object') {
      (base[key] as object) = { ...(base[key] as object), ...(incoming as object) };
    } else if (incoming !== undefined) {
      (base[key] as unknown) = incoming;
    }
  }
  return base;
}

export function structuredCloneSafe<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}
