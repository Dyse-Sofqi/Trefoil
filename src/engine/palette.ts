/** 主题调色板：从 Obsidian/宿主 CSS 变量读取，保证深浅色模式适配 */
import type { BackgroundSettings, ThemeMode } from '../core/defaults';

export interface Palette {
  /**
   * 画布底色。**权威来源是 `BackgroundSettings.color`（按主题解析后的实际绘制色）**，
   * CanvasApp.resolveThemePalette 会用覆盖这里的取值 —— 变量只是无背景设置时的兜底。
   * 所有「垫底色」（关系描述小牌、容器名片、空心箭头内芯、缩略图底…）都读它来遮住身后的线条。
   */
  canvasBg: string;
  text: string;
  textMuted: string;
  accent: string;
  accentSoft: string;
  /** 新图形默认描边 */
  nodeStroke: string;
  edge: string;
  guide: string;
  danger: string;
  containerBorder: string;
  selectionFill: string;
  /** JSON Canvas 预设色 1-6 */
  presets: string[];
}

export function readPalette(root: HTMLElement = document.body): Palette {
  const css = getComputedStyle(root);
  const v = (name: string, fallback: string) => (css.getPropertyValue(name) || '').trim() || fallback;
  return {
    canvasBg: v('--trefoil-canvas-bg', '#ffffff'),
    text: v('--text-normal', '#1f1f1f'),
    textMuted: v('--text-muted', '#777777'),
    accent: v('--interactive-accent', '#4c8dff'),
    accentSoft: v('--interactive-accent-hsl', 'rgba(76,141,255,0.15)'),
    nodeStroke: v('--text-muted', '#5a5a5a'),
    edge: v('--text-faint', '#9a9a9a'),
    guide: '#ff4d4f',
    danger: v('--text-error', '#e05252'),
    containerBorder: v('--text-faint', '#a0a0a0'),
    selectionFill: 'rgba(76,141,255,0.08)',
    presets: [
      v('--canvas-color-1', '#ff6b6b'),
      v('--canvas-color-2', '#ffa94d'),
      v('--canvas-color-3', '#ffd43b'),
      v('--canvas-color-4', '#51cf66'),
      v('--canvas-color-5', '#4c8dff'),
      v('--canvas-color-6', '#b197fc'),
    ],
  };
}

/** 日间/夜间内置调色板：主题被强制覆盖（非跟随系统）时使用，不依赖宿主 CSS 变量 */
const LIGHT_PALETTE: Omit<Palette, 'presets'> = {
  canvasBg: '#ffffff',
  text: '#1f1f1f',
  textMuted: '#777777',
  accent: '#4c8dff',
  accentSoft: 'rgba(76, 141, 255, 0.15)',
  nodeStroke: '#5a5a5a',
  edge: '#9a9a9a',
  guide: '#ff4d4f',
  danger: '#e05252',
  containerBorder: '#a0a0a0',
  selectionFill: 'rgba(76, 141, 255, 0.08)',
};
const DARK_PALETTE: Omit<Palette, 'presets'> = {
  canvasBg: '#1e1e1e',
  text: '#d8d8d8',
  textMuted: '#8f8f8f',
  accent: '#4c8dff',
  accentSoft: 'rgba(76, 141, 255, 0.22)',
  nodeStroke: '#8f8f8f',
  edge: '#6e6e6e',
  guide: '#ff4d4f',
  danger: '#e05252',
  containerBorder: '#5a5a5a',
  selectionFill: 'rgba(76, 141, 255, 0.22)',
};

/** 按主题模式解析调色板：system 跟随宿主 CSS 变量，light/dark 用内置常量（预设色仍读主题变量） */
export function resolvePalette(mode: ThemeMode, root: HTMLElement = document.body): Palette {
  if (mode === 'system') return readPalette(root);
  const base = mode === 'dark' ? DARK_PALETTE : LIGHT_PALETTE;
  return { ...base, presets: readPalette(root).presets };
}

/**
 * 解析当前主题下的调色板：**画布底色强制取自背景设置**（`background.color`，即背景层实际绘制的颜色），
 * 覆盖 `resolvePalette` 从 CSS 变量读到的值。
 *
 * 为什么不能信 CSS 变量：`--trefoil-canvas-bg` 由宿主设在**视图内容元素**上（body 的子孙，
 * 见 TrefoilView.mountApp / main.ts rethemeViews），而调色板默认从 `document.body` 读 —— 读不到就
 * 静默回退成 `#ffffff`。结果夜间模式下画布是深色、而「垫底色」是白色：
 * 关系描述小牌变成白块（文字还是浅色，等于看不见）、容器名片/空心箭头内芯/缩略图底同样出错。
 */
export function resolveThemedPalette(mode: ThemeMode, background: BackgroundSettings, root?: HTMLElement): Palette {
  return { ...resolvePalette(mode, root), canvasBg: background.color };
}

/** 预设色 / #hex → 实际颜色 */
export function resolveColor(color: string | null | undefined, palette: Palette): string | undefined {
  if (!color) return undefined;
  if (/^#[0-9a-fA-F]{3,8}$/.test(color)) return color;
  const idx = parseInt(color, 10);
  if (Number.isFinite(idx) && idx >= 1 && idx <= 6) return palette.presets[idx - 1];
  return undefined;
}

/**
 * 颜色加深（降低 HSL 亮度）：在画布底色上派生可辨识的深色底（如容器名片）。
 * 亮度减量 = max(floor, L × fraction) —— 浅色按比例加深，深色保证最小落差。
 * 支持 #rgb/#rrggbb(/aa) 与 rgb()/rgba()，保留透明度；无法解析时原样返回。
 */
export function darkenColor(color: string, fraction = 0.1, floor = 0.06): string {
  const rgba = parseColor(color);
  if (!rgba) return color;
  const { h, s, l } = rgbToHsl(rgba[0], rgba[1], rgba[2]);
  const [r, g, b] = hslToRgb(h, s, Math.max(0, l - Math.max(floor, l * fraction)));
  const hex = (v: number) => Math.round(v).toString(16).padStart(2, '0');
  const a = rgba[3];
  return a < 1
    ? `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${Number(a.toFixed(3))})`
    : `#${hex(r)}${hex(g)}${hex(b)}`;
}

/** 颜色字符串 → [r, g, b, a]（0..255 / 0..1）；不支持的格式返回 null */
function parseColor(input: string): [number, number, number, number] | null {
  const c = input.trim().toLowerCase();
  let m = /^#([0-9a-f]{3,8})$/.exec(c);
  if (m) {
    const hex = m[1];
    if (hex.length === 3 || hex.length === 4) {
      const ch = [...hex].map((x) => parseInt(x + x, 16));
      return [ch[0], ch[1], ch[2], hex.length === 4 ? ch[3]! / 255 : 1];
    }
    if (hex.length === 6 || hex.length === 8) {
      return [
        parseInt(hex.slice(0, 2), 16),
        parseInt(hex.slice(2, 4), 16),
        parseInt(hex.slice(4, 6), 16),
        hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
      ];
    }
    return null;
  }
  m = /^rgba?\(([^)]+)\)$/.exec(c);
  if (m) {
    const parts = m[1].split(/[\s,]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const chan = (s: string): number | null => {
      const v = s.endsWith('%') ? (parseFloat(s) / 100) * 255 : parseFloat(s);
      return Number.isFinite(v) ? v : null;
    };
    const r = chan(parts[0]);
    const g = chan(parts[1]);
    const b = chan(parts[2]);
    if (r === null || g === null || b === null) return null;
    const a = parts[3] !== undefined ? parseFloat(parts[3]) : 1;
    return [r, g, b, Number.isFinite(a) ? Math.min(1, Math.max(0, a)) : 1];
  }
  return null;
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return { h, s, l };
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const conv = (t: number): number => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [conv(h + 1 / 3) * 255, conv(h) * 255, conv(h - 1 / 3) * 255];
}
