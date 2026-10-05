/**
 * 容器包裹模式（wrapMode）：几何推导、嵌套贴合顺序、序列化与撤销完整性。
 * 全部走核心层（Document / wrap / jsonCanvas），不依赖 Konva 渲染。
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { Document } from '../src/core/Document';
import { History } from '../src/core/History';
import { CONTAINER_DEFAULT_WRAP_PAD } from '../src/core/defaults';
import {
  collectWrapContainers,
  fitWrapAround,
  isWrapContainer,
  wrapBoxFor,
  wrapPadOf,
  wrapStartRecords,
} from '../src/core/wrap';
import { parseDoc, serializeDoc } from '../src/data/jsonCanvas';
import type { CanvasNode } from '../src/core/types';

let doc: Document;
let history: History;

beforeEach(() => {
  doc = new Document();
  history = new History();
  doc.history = history;
});

const container = (patch: Partial<CanvasNode> = {}): CanvasNode => ({
  id: 'c1',
  type: 'trefoil/container',
  x: 0,
  y: 0,
  width: 200,
  height: 100,
  ...patch,
});

const child = (id: string, x: number, y: number, w = 50, h = 40, patch: Partial<CanvasNode> = {}): CanvasNode => ({
  id,
  type: 'text',
  x,
  y,
  width: w,
  height: h,
  containerId: 'c1',
  ...patch,
});

describe('wrapBoxFor 包裹几何推导', () => {
  it('子元素包围盒外扩 pad', () => {
    // a(10,20,50,40) ∪ b(100,60,50,40) = (10,20,140,80)；外扩 8 → (2,12,156,96)
    const box = wrapBoxFor([child('a', 10, 20, 50, 40), child('b', 100, 60)], 8);
    expect(box).toEqual({ x: 2, y: 12, width: 156, height: 96 });
  });

  it('无子元素返回 null（空容器不参与包裹）', () => {
    expect(wrapBoxFor([], 8)).toBeNull();
  });

  it('wrapPadOf：未设置 → 默认内边距；非法值 → 默认内边距', () => {
    expect(wrapPadOf(container())).toBe(CONTAINER_DEFAULT_WRAP_PAD);
    expect(wrapPadOf(container({ wrapPadding: 0 }))).toBe(0);
    expect(wrapPadOf(container({ wrapPadding: NaN }))).toBe(CONTAINER_DEFAULT_WRAP_PAD);
    expect(wrapPadOf(container({ wrapPadding: -5 }))).toBe(CONTAINER_DEFAULT_WRAP_PAD);
  });

  it('isWrapContainer 仅对开启 wrapMode 的容器为真', () => {
    expect(isWrapContainer(container({ wrapMode: true }))).toBe(true);
    expect(isWrapContainer(container())).toBe(false);
    expect(isWrapContainer(child('a', 0, 0, 1, 1, { wrapMode: true }))).toBe(false);
  });
});

describe('collectWrapContainers 嵌套收集与排序', () => {
  it('沿 containerId 链收集包裹祖先，深度降序（内层先于外层）', () => {
    doc.nodes = [
      container({ id: 'outer', wrapMode: true, x: 0, y: 0, width: 500, height: 400 }),
      container({ id: 'mid', wrapMode: true, x: 32, y: 32, width: 200, height: 100, containerId: 'outer' }),
      container({ id: 'plain', x: 0, y: 0, width: 50, height: 50 }), // 未开包裹：跳过
      child('leaf', 40, 40, 10, 10),
    ];
    doc.nodes[3]!.containerId = 'mid';
    doc.reindex();
    const ids = collectWrapContainers(doc, ['leaf']).map((n) => n.id);
    expect(ids).toEqual(['mid', 'outer']);
  });

  it('不含自身（节点自身的移动由调用方处理，只有祖先需要贴合）', () => {
    doc.nodes = [container({ id: 'c1', wrapMode: true }), child('a', 10, 10)];
    doc.reindex();
    expect(collectWrapContainers(doc, ['c1']).map((n) => n.id)).toEqual([]);
  });
});

describe('fitWrapAround 贴合', () => {
  beforeEach(() => {
    doc.nodes = [
      container({ id: 'c1', wrapMode: true, x: 0, y: 0, width: 200, height: 100 }),
      child('a', 32, 32, 50, 40),
    ];
    doc.reindex();
  });

  it('子元素移动后容器跟随，边缘保持内边距', () => {
    doc.live(() => {
      const n = doc.getNode('a')!;
      n.x = 300;
      n.y = 200;
      fitWrapAround(doc, ['a']);
    });
    const c = doc.getNode('c1')!;
    expect(c).toMatchObject({ x: 300 - CONTAINER_DEFAULT_WRAP_PAD, y: 200 - CONTAINER_DEFAULT_WRAP_PAD });
    expect(c.width).toBe(50 + CONTAINER_DEFAULT_WRAP_PAD * 2);
    expect(c.height).toBe(40 + CONTAINER_DEFAULT_WRAP_PAD * 2);
  });

  it('自定义内边距生效', () => {
    doc.updateNode('c1', { wrapPadding: 10 });
    doc.live(() => {
      const n = doc.getNode('a')!;
      n.x = 100;
      fitWrapAround(doc, ['a']);
    });
    expect(doc.getNode('c1')).toMatchObject({ x: 90, y: 22, width: 70, height: 60 });
  });

  it('嵌套容器由深到浅贴合：外层吃到内层贴合后的新几何', () => {
    doc.nodes = [
      container({ id: 'outer', wrapMode: true, wrapPadding: 10, x: 0, y: 0, width: 500, height: 400 }),
      container({ id: 'inner', wrapMode: true, wrapPadding: 5, x: 50, y: 50, width: 100, height: 80, containerId: 'outer' }),
      child('leaf', 60, 60, 20, 20),
    ];
    doc.nodes[2]!.containerId = 'inner';
    doc.reindex();
    doc.live(() => {
      const n = doc.getNode('leaf')!;
      n.x = 400;
      n.y = 300;
      fitWrapAround(doc, ['leaf']);
    });
    // 内层先贴合：leaf(400,300,20,20) + pad5 → inner(395,295,30,30)
    expect(doc.getNode('inner')).toMatchObject({ x: 395, y: 295, width: 30, height: 30 });
    // 外层按 inner 新几何 + pad10
    expect(doc.getNode('outer')).toMatchObject({ x: 385, y: 285, width: 50, height: 50 });
  });

  it('关闭包裹的容器不再跟随', () => {
    doc.updateNode('c1', { wrapMode: false });
    doc.live(() => {
      const n = doc.getNode('a')!;
      n.x = 500;
      fitWrapAround(doc, ['a']);
    });
    expect(doc.getNode('c1')).toMatchObject({ x: 0, y: 0, width: 200, height: 100 });
  });
});

describe('撤销完整性', () => {
  beforeEach(() => {
    doc.nodes = [
      container({ id: 'c1', wrapMode: true, x: 0, y: 0, width: 200, height: 100 }),
      child('a', 32, 32, 50, 40),
    ];
    doc.reindex();
  });

  it('拖拽贴合（commitPositions 合并容器几何）→ 一步撤销', () => {
    const starts = new Map([
      ['a', { x: 32, y: 32 }],
      ['c1', { x: 0, y: 0 }],
    ]);
    const sizes = new Map([['c1', { x: 0, y: 0, width: 200, height: 100 }]]);
    doc.live(() => {
      const n = doc.getNode('a')!;
      n.x = 400;
      n.y = 300;
      fitWrapAround(doc, ['a']);
    });
    doc.commitPositions('移动', starts, sizes);
    expect(doc.getNode('c1')).toMatchObject({ x: 400 - CONTAINER_DEFAULT_WRAP_PAD, y: 300 - CONTAINER_DEFAULT_WRAP_PAD });
    history.undo();
    // 子元素与容器几何一起还原
    expect(doc.getNode('a')).toMatchObject({ x: 32, y: 32 });
    expect(doc.getNode('c1')).toMatchObject({ x: 0, y: 0, width: 200, height: 100 });
    history.redo();
    expect(doc.getNode('c1')).toMatchObject({ x: 400 - CONTAINER_DEFAULT_WRAP_PAD, y: 300 - CONTAINER_DEFAULT_WRAP_PAD });
  });

  it('样式会话改内边距（liveStyleMulti + commitStyle）→ 撤销同时还原字段与几何', () => {
    doc.liveStyleMulti(new Map([['c1', { wrapPadding: 8 }]]), '包裹内边距');
    expect(doc.getNode('c1')).toMatchObject({ x: 32 - 8, y: 32 - 8, width: 50 + 16, height: 40 + 16 });
    doc.commitStyle();
    history.undo();
    expect(doc.getNode('c1')!.wrapPadding).toBeUndefined();
    expect(doc.getNode('c1')).toMatchObject({ x: 0, y: 0, width: 200, height: 100 });
    history.redo();
    expect(doc.getNode('c1')).toMatchObject({ wrapPadding: 8, x: 24, y: 24, width: 66, height: 56 });
  });

  it('删除部分子元素 → 容器围绕剩余内容缩水并入同一条撤销记录', () => {
    doc.nodes = [
      container({ id: 'c1', wrapMode: true, x: 0, y: 0, width: 200, height: 100 }),
      child('a', 32, 32, 50, 40),
      child('b', 120, 32, 50, 40),
    ];
    doc.reindex();
    doc.removeNodes(['b']);
    // 剩余 a(32,32,50,40) + pad32 → (0,0,114,104)
    expect(doc.getNode('c1')).toMatchObject({ x: 0, y: 0, width: 114, height: 104 });
    history.undo();
    expect(doc.getNode('b')).toMatchObject({ x: 120, y: 32 });
    expect(doc.getNode('c1')).toMatchObject({ x: 0, y: 0, width: 200, height: 100 });
  });

  it('删除全部子元素 → 空容器不参与包裹，保持当前几何', () => {
    doc.removeNodes(['a']);
    expect(doc.getNode('c1')).toMatchObject({ x: 0, y: 0, width: 200, height: 100 });
    history.undo();
    expect(doc.getNode('a')).toMatchObject({ x: 32, y: 32 });
    expect(doc.getNode('c1')).toMatchObject({ x: 0, y: 0, width: 200, height: 100 });
  });

  it('文本编辑重排（mutate 内贴合）→ 一步撤销', () => {
    // commitText（CanvasApp）在 mutate 内做同样的贴合；这里验证快照式撤销的等价行为
    doc.mutate('编辑文本', () => {
      Object.assign(doc.getNode('a')!, { text: '很长很长的一段文字内容', width: 400, height: 60 });
      fitWrapAround(doc, ['a']);
    });
    expect(doc.getNode('c1')!.width).toBe(400 + CONTAINER_DEFAULT_WRAP_PAD * 2);
    history.undo();
    expect(doc.getNode('c1')).toMatchObject({ width: 200, height: 100 });
  });
});

describe('wrapStartRecords 快照', () => {
  it('记录包裹祖先的起始几何（不含自身）', () => {
    doc.nodes = [
      container({ id: 'c1', wrapMode: true, x: 5, y: 6, width: 100, height: 50 }),
      child('a', 32, 32),
    ];
    doc.reindex();
    const recs = wrapStartRecords(doc, ['a']);
    expect(recs.get('c1')).toEqual({ x: 5, y: 6, width: 100, height: 50 });
    expect(recs.has('a')).toBe(false);
  });
});

describe('序列化', () => {
  it('wrapMode / wrapPadding 走 trefoil 扩展字段；false 与未设置不落盘', () => {
    doc.nodes = [container({ id: 'c1', wrapMode: true, wrapPadding: 24 }), container({ id: 'c2', wrapPadding: 0 })];
    const parsed = parseDoc(serializeDoc(doc));
    expect(parsed.nodes.find((n) => n.id === 'c1')).toMatchObject({ wrapMode: true, wrapPadding: 24 });
    // 0 是合法内边距，必须保留；wrapMode 未设置不落盘
    const c2 = parsed.nodes.find((n) => n.id === 'c2')!;
    expect(c2.wrapPadding).toBe(0);
    expect(c2.wrapMode).toBeUndefined();
  });
});
