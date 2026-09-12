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

/** 将插件默认设置注入白板（含背景底色跟随主题） */
export function trefoilSettingsFromPlugin(settings: TrefoilPluginSettings, dark: boolean): Partial<TrefoilSettings> {
  const s = structuredCloneSafe(settings.defaults);
  if (dark) {
    s.background.color = s.background.color === DEFAULT_SETTINGS.background.color ? '#1e1e22' : s.background.color;
  }
  return s;
}
