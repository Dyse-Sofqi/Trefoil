/** 主题调色板：从 Obsidian/宿主 CSS 变量读取，保证深浅色模式适配 */

export interface Palette {
  /** 画布底色（背景纯色模式默认值） */
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

/** 预设色 / #hex → 实际颜色 */
export function resolveColor(color: string | null | undefined, palette: Palette): string | undefined {
  if (!color) return undefined;
  if (/^#[0-9a-fA-F]{3,8}$/.test(color)) return color;
  const idx = parseInt(color, 10);
  if (Number.isFinite(idx) && idx >= 1 && idx <= 6) return palette.presets[idx - 1];
  return undefined;
}
