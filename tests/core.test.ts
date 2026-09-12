import { beforeAll, describe, expect, it } from 'vitest';
import { parseInline } from '../src/core/mdInline';
import { _setMeasureCtxForTests, autoTextHeight, layoutText } from '../src/engine/textMeasure';
import { snapMove } from '../src/core/snap';
import { mergeSettings, DEFAULT_SETTINGS, textStyleDefaults } from '../src/core/defaults';
import { Document } from '../src/core/Document';
import { addChildNode, addSiblingNode } from '../src/core/mindmap';

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

  it('导图子节点继承字重与字体', () => {
    const doc = new Document();
    doc.nodes.push({ id: 'c1', type: 'trefoil/container', x: 0, y: 0, width: 300, height: 200 });
    doc.reindex();
    const id = addChildNode(doc, 'c1', null, { fontSize: 18, fontFamily: 'Georgia', fontWeight: 700, color: '#123456' });
    expect(id).toBeTruthy();
    expect(doc.getNode(id!)).toMatchObject({ fontSize: 18, fontFamily: 'Georgia', fontWeight: 700, color: '#123456' });
  });

  it('导图兄弟节点继承字重，缺省时回退参考节点', () => {
    const doc = new Document();
    doc.nodes.push(
      { id: 'c1', type: 'trefoil/container', x: 0, y: 0, width: 300, height: 200 },
      { id: 'p1', type: 'text', x: 10, y: 10, width: 120, height: 36, text: 'root', containerId: 'c1', treeParent: null, fontWeight: 600 },
    );
    doc.reindex();
    const withDefaults = addSiblingNode(doc, 'c1', 'p1', { fontWeight: 700, fontFamily: 'Georgia' });
    expect(doc.getNode(withDefaults!)).toMatchObject({ fontWeight: 700, fontFamily: 'Georgia' });
    const fallback = addSiblingNode(doc, 'c1', 'p1', {});
    expect(doc.getNode(fallback!)).toMatchObject({ fontWeight: 600 });
  });
});
