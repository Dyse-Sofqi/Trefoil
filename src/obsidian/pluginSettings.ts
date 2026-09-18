/** Obsidian 插件设置：作为新白板的默认设置；视觉设置本体在白板内设置面板调整 */
import { mergeSettings, DEFAULT_SETTINGS, structuredCloneSafe, type TrefoilSettings } from '../core/defaults';
import type { Plugin } from 'obsidian';

export interface TrefoilPluginSettings {
  /** 新白板的默认视觉/交互设置 */
  defaults: TrefoilSettings;
  /** 新建 .canvas 文件所在目录（空 = 库根目录） */
  newFileFolder: string;
}

export const DEFAULT_PLUGIN_SETTINGS: TrefoilPluginSettings = {
  defaults: structuredCloneSafe(DEFAULT_SETTINGS),
  newFileFolder: '',
};

export async function loadPluginSettings(plugin: Plugin): Promise<TrefoilPluginSettings> {
  const raw = (await plugin.loadData()) as Partial<TrefoilPluginSettings> | null;
  const settings: TrefoilPluginSettings = {
    defaults: mergeSettings(raw?.defaults ?? undefined),
    newFileFolder: typeof raw?.newFileFolder === 'string' ? raw.newFileFolder : '',
  };
  return settings;
}

export async function savePluginSettings(plugin: Plugin, settings: TrefoilPluginSettings): Promise<void> {
  await plugin.saveData(settings);
}

/** 主题适配的深色画布底色（Obsidian 风格近黑；旧版本曾把它直接写进 color 造成污染） */
const LEGACY_BAKED_DARK_BG = '#1e1e22';

/**
 * 将插件默认设置注入白板（含背景底色随主题适配）。
 *
 * 夜间配色由「夜间专用底色」background.colorDark 承担 —— DEFAULT_SETTINGS 已内置
 * DARK_CANVAS_BG，无需在这里改写任何值。本函数**绝不覆盖 background.color**：
 * 画布底色在日间模式下原样采用 color（见 effectiveBackground），把深色写进 color 会把
 * 「日间默认值」污染成「自定义深色」，造成「夜间挂载后切回日间，背景永远停在深色」。
 */
export function trefoilSettingsFromPlugin(settings: TrefoilPluginSettings): Partial<TrefoilSettings> {
  const s = structuredCloneSafe(settings.defaults);
  // 迁移：旧版本曾把 #1e1e22 直接写进 color（默认值被污染）→ 还原为日间默认
  //（夜间底色走 colorDark，缺省时 effectiveBackground 兜底 DARK_CANVAS_BG，深色观感不变）
  if (s.background.color === LEGACY_BAKED_DARK_BG) {
    s.background.color = DEFAULT_SETTINGS.background.color;
  }
  return s;
}
