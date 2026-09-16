import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveThemedPalette } from '../src/engine/palette';
import { DARK_CANVAS_BG, DEFAULT_SETTINGS, effectiveBackground } from '../src/core/defaults';

/**
 * 画布底色（palette.canvasBg）是「垫底色」：关系描述小牌、容器名片、空心箭头内芯、缩略图底
 * 都拿它去遮住身后的线条/点阵。它必须等于背景层真正绘制的颜色，否则就会露出一块异色方块。
 *
 * 这里锁死的是那个只在 Obsidian 夜间模式下暴露的回归：`--trefoil-canvas-bg` 由宿主设在
 * 视图内容元素上（body 的子孙），调色板从 document.body 读不到 → 静默回退成 #ffffff，
 * 于是深色画布上出现白色小牌（而小牌文字还是浅色，等于看不见）。
 */
describe('画布底色必须来自背景设置，而不是宿主 CSS 变量', () => {
  afterEach(() => vi.unstubAllGlobals());

  /** 宿主把变量设在「视图内容元素」上时，从 body 读只会拿到空串（这里用替身模拟） */
  const stubHostCss = (vars: Record<string, string>) =>
    vi.stubGlobal('getComputedStyle', () => ({
      getPropertyValue: (name: string) => vars[name] ?? '',
    }));

  const root = {} as HTMLElement;

  it('夜间：底色取 background.color，而不是变量回退出来的 #ffffff', () => {
    // 宿主变量读不到（空串）→ readPalette 会回退成 #ffffff；修复前这里就会拿到 #ffffff
    stubHostCss({ '--text-normal': '#e6e6e6' });
    const bg = effectiveBackground(DEFAULT_SETTINGS.background, 'dark');

    const p = resolveThemedPalette('system', bg, root);

    expect(bg.color).toBe(DARK_CANVAS_BG);
    expect(p.canvasBg).toBe(DARK_CANVAS_BG);
    expect(p.canvasBg).not.toBe('#ffffff');
    // 文字仍来自宿主变量（浅色），与深色底形成对比
    expect(p.text).toBe('#e6e6e6');
  });

  it('日间：底色为背景设置的浅色', () => {
    stubHostCss({ '--text-normal': '#1f1f1f' });
    const bg = effectiveBackground(DEFAULT_SETTINGS.background, 'light');

    const p = resolveThemedPalette('system', bg, root);

    expect(p.canvasBg).toBe(bg.color);
    expect(p.canvasBg).toBe('#ffffff');
  });

  it('自定义底色：即使宿主变量给出别的颜色，也以背景设置为准', () => {
    // 宿主变量给白色（正是修复前那个错误来源），背景设置给自定义色
    stubHostCss({ '--trefoil-canvas-bg': '#ffffff' });
    const bg = { ...DEFAULT_SETTINGS.background, color: '#123456' };

    const p = resolveThemedPalette('system', bg, root);

    expect(p.canvasBg).toBe('#123456');
  });

  it('强制日间/夜间模式（不走宿主变量）时同样以背景设置为准', () => {
    stubHostCss({ '--trefoil-canvas-bg': '#ffffff' });
    const bg = effectiveBackground(DEFAULT_SETTINGS.background, 'dark');

    expect(resolveThemedPalette('dark', bg, root).canvasBg).toBe(DARK_CANVAS_BG);
    expect(resolveThemedPalette('light', { ...bg, color: '#eeeeee' }, root).canvasBg).toBe('#eeeeee');
  });
});
