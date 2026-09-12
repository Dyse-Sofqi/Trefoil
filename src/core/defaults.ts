/** 全局可调设置（仅视觉/交互辅助，不写入 .canvas 数据文件） */

export type BackgroundMode = 'solid' | 'dots' | 'grid';
export type DotShape = 'circle' | 'square' | 'diamond';
export type ViewMode = 'normal' | 'browse' | 'focus';

export interface BackgroundSettings {
  mode: BackgroundMode;
  /** 纯色模式颜色 / 其他模式的底色 */
  color: string;
  // 点阵
  dotSize: number; // 1-10 px
  dotShape: DotShape;
  dotColor: string;
  dotSpacing: number; // px，≥ 8
  // 网格（双层级）
  gridSpacing: number; // 小网格间距 px
  gridColor: string;
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
 * 各创建路径（文本工具/双击空白/右键添加文本/导图子节点）统一走这里，
 * 避免逐个手写字段时漏掉某一项（如字重）。
 */
export function textStyleDefaults(t: TextSettings): { fontSize: number; fontFamily: string; fontWeight: number; color: string } {
  return { fontSize: t.fontSize, fontFamily: t.fontFamily, fontWeight: t.fontWeight, color: t.color };
}

export interface ShapeDefaults {
  fill: string | null;
  stroke: string;
  strokeSize: number;
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
  background: {
    mode: 'grid',
    color: '#ffffff',
    dotSize: 2,
    dotShape: 'circle',
    dotColor: '#c9c9c9',
    dotSpacing: 24,
    gridSpacing: 24,
    gridColor: '#8a8a8a',
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
  },
  wheelStep: {
    mode: 'auto',
    value: 1,
    percent: 10,
  },
  viewMode: 'normal',
};

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
