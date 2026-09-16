import { beforeAll, describe, expect, it } from 'vitest';
import { parseInline } from '../src/core/mdInline';
import { _setMeasureCtxForTests, autoTextHeight, autoTextWidth, layoutText } from '../src/engine/textMeasure';
import { snapMove } from '../src/core/snap';
import { effectiveBackground, mergeSettings, textBorderDefaults, DEFAULT_SETTINGS, textStyleDefaults } from '../src/core/defaults';
import { Document } from '../src/core/Document';
import { darkenColor } from '../src/engine/palette';

// Node 环境无 Canvas：注入等宽近似测量（0.6em/字符）
beforeAll(() => {
  _setMeasureCtxForTests({
    set font(f: string) {
      void f;
    },
    get font() {
      return '';
    },
    measureText(text: string) {
      return { width: text.length * 16 * 0.6 };
    },
  });
});

describe('内联 Markdown 解析', () => {
  it('加粗', () => {
    const runs = parseInline('**bold** rest');
    expect(runs[0]).toHaveLength(2);
    expect(runs[0][0]).toMatchObject({ text: 'bold', bold: true });
    expect(runs[0][1]).toMatchObject({ text: ' rest', bold: false });
  });

  it('斜体 / 删除线 / 代码', () => {
    expect(parseInline('_it_')[0][0]).toMatchObject({ text: 'it', italic: true });
    expect(parseInline('~~s~~')[0][0]).toMatchObject({ text: 's', strike: true });
    expect(parseInline('`code`')[0][0]).toMatchObject({ text: 'code', code: true });
  });

  it('未成对定界符保持原样', () => {
    const text = parseInline('a_b and **x')[0].map((r) => r.text).join('');
    expect(text).toBe('a_b and **x');
  });

  it('单个 * 不吞并 **', () => {
    const text = parseInline('a ** b * c')[0].map((r) => r.text).join('');
    expect(text).toBe('a ** b * c');
  });

  it('多行解析', () => {
    const lines = parseInline('**a**\n_b_');
    expect(lines).toHaveLength(2);
    expect(lines[0][0].bold).toBe(true);
    expect(lines[1][0].italic).toBe(true);
  });

  it('嵌套样式 **_x_**', () => {
    const runs = parseInline('**_x_**');
    expect(runs[0][0]).toMatchObject({ text: 'x', bold: true, italic: true });
  });
});

describe('文本排版', () => {
  it('按宽度换行', () => {
    const layout = layoutText('aaaa bbbb cccc', 100, 16, 'monospace');
    expect(layout.lines.length).toBeGreaterThan(1);
  });

  it('CJK 逐字换行', () => {
    const layout = layoutText('一二三四五六七八九十', 60, 16, 'monospace');
    expect(layout.lines.length).toBeGreaterThan(1);
  });

  it('自动高度随行数增长', () => {
    const h1 = autoTextHeight('short', 400, 16, 'monospace');
    const h2 = autoTextHeight('a\nb\nc', 400, 16, 'monospace');
    expect(h2).toBeGreaterThan(h1);
  });

  it('自适应宽度贴合最宽行（多行取最宽，空文本给光标位）', () => {
    // 测试测量上下文：每字符 16 × 0.6 = 9.6px
    expect(autoTextWidth('ab', 16, 'monospace')).toBe(Math.ceil(2 * 9.6) + 12);
    expect(autoTextWidth('ab\nabcd', 16, 'monospace')).toBe(Math.ceil(4 * 9.6) + 12);
    expect(autoTextWidth('', 16, 'monospace')).toBe(12);
  });

  it('自适应宽度：可折行的长段落不超过上限，无法折行的长词整行保留', () => {
    // CJK 逐字成词：100 字在 468 内容宽内换行，框宽不超过 480 上限
    const wrapped = autoTextWidth('国'.repeat(100), 16, 'monospace');
    expect(wrapped).toBeLessThanOrEqual(480);
    expect(wrapped).toBeGreaterThan(400);
    // 单个超长词（如 URL）无法折行：框随之变宽，避免文字溢出框外
    const longWord = autoTextWidth('a'.repeat(200), 16, 'monospace');
    expect(longWord).toBe(Math.ceil(200 * 9.6) + 12);
  });
});

describe('吸附系统', () => {
  const settings = { ...mergeSettings(DEFAULT_SETTINGS).snap, threshold: 10 };

  it('边缘对齐吸附并产生参考线', () => {
    const moving = { x: 104, y: 0, width: 50, height: 50 };
    const others = [{ x: 100, y: 200, width: 50, height: 50 }];
    const result = snapMove(moving, others, settings, 1, 24);
    expect(result.dx).toBeCloseTo(-4);
    expect(result.guides.length).toBeGreaterThan(0);
    expect(result.guides[0].axis).toBe('v');
  });

  it('中心对齐', () => {
    // 移动框中心 221，目标中心 225，差 4 ≤ 阈值 → 吸附 +4
    const moving = { x: 196, y: 0, width: 50, height: 50 };
    const others = [{ x: 200, y: 0, width: 50, height: 50 }];
    const result = snapMove(moving, others, settings, 1, 24);
    expect(result.dx).toBeCloseTo(4);
  });

  it('超阈值不吸附', () => {
    const result = snapMove({ x: 500, y: 500, width: 50, height: 50 }, [{ x: 0, y: 0, width: 50, height: 50 }], settings, 1, 24);
    expect(result.dx).toBe(0);
    expect(result.dy).toBe(0);
  });

  it('禁用吸附时无效果', () => {
    const result = snapMove({ x: 104, y: 0, width: 50, height: 50 }, [{ x: 100, y: 0, width: 50, height: 50 }], { ...settings, enabled: false }, 1, 24);
    expect(result.dx).toBe(0);
    expect(result.guides).toHaveLength(0);
  });
});

describe('设置合并', () => {
  it('部分覆盖保留默认', () => {
    const s = mergeSettings({ laser: { color: '#00ff00', width: 9, delayMs: 1000 } });
    expect(s.laser.color).toBe('#00ff00');
    expect(s.background.mode).toBe(DEFAULT_SETTINGS.background.mode);
    expect(s.eraser.radius).toBe(DEFAULT_SETTINGS.eraser.radius);
  });
});

describe('滚轮步进设置', () => {
  it('旧设置缺少 wheelStep 时回落到默认值', () => {
    const merged = mergeSettings({ text: { fontSize: 20, fontFamily: 'serif', fontWeight: 400, color: '#000' } });
    expect(merged.text.fontSize).toBe(20);
    expect(merged.wheelStep).toEqual(DEFAULT_SETTINGS.wheelStep);
  });

  it('已保存的 wheelStep 与默认值逐字段合并', () => {
    const merged = mergeSettings({ wheelStep: { mode: 'percent', percent: 25 } as never });
    expect(merged.wheelStep).toEqual({ mode: 'percent', value: 1, percent: 25 });
  });
});

describe('文本默认继承（新建文本样式）', () => {
  it('textStyleDefaults 覆盖字号/字体/字重/颜色', () => {
    const style = textStyleDefaults({ ...DEFAULT_SETTINGS.text, fontSize: 22, fontFamily: 'Georgia', fontWeight: 700, color: '#ff0000' });
    expect(style).toEqual({ fontSize: 22, fontFamily: 'Georgia', fontWeight: 700, color: '#ff0000' });
  });

  it('textBorderDefaults：新建文本默认带实线边框，颜色/粗细随形状默认', () => {
    const b = textBorderDefaults({ fill: null, stroke: '#5a5a5a', strokeSize: 3, arrowHead: 'solid', arrowTail: 'none' });
    expect(b).toEqual({ border: true, stroke: '#5a5a5a', strokeSize: 3, borderRadius: 6, borderStyle: 'solid' });
  });
});

describe('名片底色加深（darkenColor）', () => {
  it('浅色按比例加深', () => {
    expect(darkenColor('#ffffff')).toBe('#e6e6e6');
  });

  it('深色保证最小落差（深浅主题都可辨读）', () => {
    expect(darkenColor('#1e1e1e')).toBe('#0f0f0f');
  });

  it('支持 rgb/rgba 并保留透明度；无法解析时原样返回', () => {
    expect(darkenColor('rgb(255, 0, 0)')).toBe('#e00000');
    expect(darkenColor('rgba(255, 255, 255, 0.5)')).toBe('rgba(230, 230, 230, 0.5)');
    expect(darkenColor('rebeccapurple')).toBe('rebeccapurple');
  });
});

describe('画布背景主题适配（effectiveBackground）', () => {
  const base = { ...DEFAULT_SETTINGS.background };

  it('夜间模式：使用夜间专用底色/点阵/网格', () => {
    const out = effectiveBackground(base, 'dark');
    expect(out.color).toBe('#1e1e1e');
    expect(out.dotColor).toBe('#3f3f46');
    expect(out.gridColor).toBe('#4a4a52');
  });

  it('夜间模式：自定义夜间色优先，日间色不受影响', () => {
    const custom = { ...base, colorDark: '#112233', dotColorDark: '#445566', gridColor: '#654321' };
    const out = effectiveBackground(custom, 'dark');
    expect(out.color).toBe('#112233');
    expect(out.dotColor).toBe('#445566');
    // 夜间网格色未设置：回退「日间默认值 → 夜间默认」链
    expect(out.gridColor).toBe('#4a4a52');
    expect(custom.color).toBe('#ffffff');
  });

  it('日间模式原样返回（不修改）', () => {
    expect(effectiveBackground(base, 'light')).toBe(base);
  });
});
