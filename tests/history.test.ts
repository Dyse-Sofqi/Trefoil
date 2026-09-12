import { describe, expect, it, beforeEach } from 'vitest';
import { Document } from '../src/core/Document';
import { History } from '../src/core/History';

let doc: Document;
let history: History;

beforeEach(() => {
  doc = new Document();
  history = new History();
  doc.history = history;
});

describe('Document 撤销/重做', () => {
  it('添加 → 撤销 → 重做', () => {
    doc.addNodes([{ id: 'a', type: 'text', x: 0, y: 0, width: 10, height: 10 }]);
    expect(doc.nodes).toHaveLength(1);
    history.undo();
    expect(doc.nodes).toHaveLength(0);
    history.redo();
    expect(doc.nodes).toHaveLength(1);
  });

  it('删除 → 撤销恢复节点与关联边', () => {
    doc.addNodes([
      { id: 'a', type: 'text', x: 0, y: 0, width: 10, height: 10 },
      { id: 'b', type: 'text', x: 50, y: 0, width: 10, height: 10 },
    ]);
    doc.addEdge({ id: 'e1', fromNode: 'a', toNode: 'b' });
    doc.removeNodes(['a']);
    expect(doc.nodes).toHaveLength(1);
    expect(doc.edges).toHaveLength(0);
    history.undo();
    expect(doc.nodes).toHaveLength(2);
    expect(doc.edges).toHaveLength(1);
  });

  it('位移提交 commitPositions 撤销/重做', () => {
    doc.addNodes([{ id: 'a', type: 'text', x: 0, y: 0, width: 10, height: 10 }]);
    doc.live(() => {
      const n = doc.getNode('a')!;
      n.x = 100;
      n.y = 50;
    });
    doc.commitPositions('移动', new Map([['a', { x: 0, y: 0 }]]));
    history.undo();
    expect(doc.getNode('a')).toMatchObject({ x: 0, y: 0 });
    history.redo();
    expect(doc.getNode('a')).toMatchObject({ x: 100, y: 50 });
  });

  it('图层顺序：置顶/置底', () => {
    doc.addNodes([
      { id: 'a', type: 'text', x: 0, y: 0, width: 10, height: 10 },
      { id: 'b', type: 'text', x: 0, y: 0, width: 10, height: 10 },
      { id: 'c', type: 'text', x: 0, y: 0, width: 10, height: 10 },
    ]);
    doc.bringToFront(['a']);
    expect(doc.nodes.map((n) => n.id)).toEqual(['b', 'c', 'a']);
    doc.sendToBack(['a']);
    expect(doc.nodes.map((n) => n.id)).toEqual(['a', 'b', 'c']);
    // 撤销置底 → 恢复置顶后顺序
    history.undo();
    expect(doc.nodes.map((n) => n.id)).toEqual(['b', 'c', 'a']);
  });

  it('删除容器时子节点转为自由元素', () => {
    doc.addNodes([
      { id: 'c', type: 'trefoil/container', x: 0, y: 0, width: 100, height: 100 },
      { id: 'k', type: 'text', x: 10, y: 10, width: 10, height: 10, containerId: 'c' },
    ]);
    doc.removeNodes(['c']);
    expect(doc.nodes).toHaveLength(1);
    expect(doc.nodes[0].containerId).toBeNull();
    history.undo();
    expect(doc.nodes[1].containerId).toBe('c');
  });

  it('无实际变化的 mutate 不进撤销栈', () => {
    doc.addNodes([{ id: 'a', type: 'text', x: 0, y: 0, width: 10, height: 10 }]);
    history.clear();
    doc.updateNode('a', { x: 0 }, '无变化');
    expect(history.canUndo).toBe(false);
  });
});

describe('History 栈行为', () => {
  it('undo 后 push 清空 redo', () => {
    doc.addNodes([{ id: 'a', type: 'text', x: 0, y: 0, width: 10, height: 10 }]);
    doc.updateNode('a', { x: 5 }, '改');
    history.undo();
    expect(history.canRedo).toBe(true);
    doc.addNodes([{ id: 'b', type: 'text', x: 9, y: 9, width: 1, height: 1 }]);
    expect(history.canRedo).toBe(false);
  });

  it('栈上限 200', () => {
    for (let i = 0; i < 250; i++) {
      doc.updateNode('x', { x: i }, `op${i}`);
    }
    let count = 0;
    while (history.undo()) count++;
    expect(count).toBeLessThanOrEqual(200);
  });
});

describe('连续样式调整（滚轮/滑块）', () => {
  it('liveStyle 实时生效但不入撤销栈，commitStyle 后合并为一条记录', () => {
    doc.addNodes([{ id: 'a', type: 'text', x: 0, y: 0, width: 10, height: 10, fontSize: 16 }]);
    doc.setSelection(['a']);
    const depth = () => history.undoLabel;
    const base = depth();

    for (const size of [17, 18, 19]) doc.liveStyle({ fontSize: size }, '字号');
    expect(doc.getNode('a')!.fontSize).toBe(19);
    expect(history.undoLabel).toBe(base); // 尚未入栈

    doc.commitStyle();
    expect(history.undoLabel).toBe('字号');
    history.undo();
    expect(doc.getNode('a')!.fontSize).toBe(16); // 一次撤销回到手势起点
    history.redo();
    expect(doc.getNode('a')!.fontSize).toBe(19);
  });

  it('期间没有实际变化时不入撤销栈', () => {
    doc.addNodes([{ id: 'a', type: 'text', x: 0, y: 0, width: 10, height: 10, fontSize: 16 }]);
    doc.setSelection(['a']);
    const before = history.undoLabel; // 添加节点留下的记录
    doc.liveStyle({ fontSize: 16 }, '字号');
    doc.commitStyle();
    expect(history.undoLabel).toBe(before);
  });

  it('撤销记录只含涉及的字段，不波及期间发生的其它改动', () => {
    doc.addNodes([{ id: 'a', type: 'text', x: 0, y: 0, width: 10, height: 10, fontSize: 16 }]);
    doc.setSelection(['a']);
    doc.liveStyle({ fontSize: 24 }, '字号');
    // 期间发生别的改动（移动节点）
    doc.mutate('移动', () => {
      doc.getNode('a')!.x = 500;
    });
    doc.commitStyle();
    history.undo(); // 撤字号
    expect(doc.getNode('a')!.fontSize).toBe(16);
    expect(doc.getNode('a')!.x).toBe(500); // 位移保留
  });
});
