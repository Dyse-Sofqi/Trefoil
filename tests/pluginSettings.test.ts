/** trefoilSettingsFromPlugin：挂载时背景底色随主题适配（绝不污染 color） */
import { describe, expect, it } from 'vitest';
import { trefoilSettingsFromPlugin, type TrefoilPluginSettings } from '../src/obsidian/pluginSettings';
import { DEFAULT_SETTINGS, effectiveBackground, structuredCloneSafe, type TrefoilSettings } from '../src/core/defaults';

function pluginSettings(over: Partial<TrefoilSettings> = {}): TrefoilPluginSettings {
  return { defaults: structuredCloneSafe({ ...structuredCloneSafe(DEFAULT_SETTINGS), ...over }), newFileFolder: '' };
}

function bg(over: Partial<TrefoilSettings['background']> = {}): TrefoilSettings['background'] {
  return { ...structuredCloneSafe(DEFAULT_SETTINGS.background), ...over };
}

describe('trefoilSettingsFromPlugin：背景底色随主题适配', () => {
  it('默认设置：不写任何值，color 保持日间默认、colorDark 保持内置夜间底色', () => {
    const out = trefoilSettingsFromPlugin(pluginSettings()) as TrefoilSettings;
    expect(out.background.color).toBe('#ffffff');
    expect(out.background.colorDark).toBe(DEFAULT_SETTINGS.background.colorDark);
    // effectiveBackground 两侧都可正确还原：夜间取 colorDark、日间取 color
    expect(effectiveBackground(out.background, 'dark').color).toBe(DEFAULT_SETTINGS.background.colorDark);
    expect(effectiveBackground(out.background, 'light').color).toBe('#ffffff');
  });

  it('自定义夜间底色：原样保留（夜间观感由用户控制）', () => {
    const out = trefoilSettingsFromPlugin(pluginSettings({ background: bg({ colorDark: '#112233' }) })) as TrefoilSettings;
    expect(out.background.color).toBe('#ffffff');
    expect(out.background.colorDark).toBe('#112233');
    expect(effectiveBackground(out.background, 'dark').color).toBe('#112233');
    expect(effectiveBackground(out.background, 'light').color).toBe('#ffffff');
  });

  it('自定义底色：不动（自定义色不随主题翻转）', () => {
    const out = trefoilSettingsFromPlugin(pluginSettings({ background: bg({ color: '#ffeedd' }) })) as TrefoilSettings;
    expect(out.background.color).toBe('#ffeedd');
    expect(out.background.colorDark).toBe(DEFAULT_SETTINGS.background.colorDark);
  });

  it('迁移：旧版本写进 color 的 #1e1e22 → 还原为日间默认', () => {
    const out = trefoilSettingsFromPlugin(pluginSettings({ background: bg({ color: '#1e1e22' }) })) as TrefoilSettings;
    expect(out.background.color).toBe('#ffffff');
    expect(out.background.colorDark).toBe(DEFAULT_SETTINGS.background.colorDark);
    // 迁移后日间背景能正确还原为浅色（本次问题场景的直接验证）
    expect(effectiveBackground(out.background, 'light').color).toBe('#ffffff');
  });

  it('迁移：color=#1e1e22 且已有自定义 colorDark → color 还原，既有夜间底色保留', () => {
    const out = trefoilSettingsFromPlugin(
      pluginSettings({ background: bg({ color: '#1e1e22', colorDark: '#112233' }) }),
    ) as TrefoilSettings;
    expect(out.background.color).toBe('#ffffff');
    expect(out.background.colorDark).toBe('#112233');
  });
});