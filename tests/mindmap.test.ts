import { describe, expect, it } from 'vitest';
import { Document } from '../src/core/Document';
import { History } from '../src/core/History';
import {
  MAP_LEVEL_GAP,
  MAP_SIBLING_GAP,
  addMapChild,
  addMapSibling,
  downgradeMapRoot,
  isMapMember,
  mapChildIds,
  mapParentId,
  upgradeToMapRoot,
} from '../src/core/mindmap';
import { parseDoc, serializeDoc } from '../src/data/jsonCanvas';
import { mindmapEdgeCurve } from '../src/core/geometry';
import type { CanvasNode } from '../src/core/types';

function makeDoc(): { doc: Document; history: History } {
  const doc = new Document();
  const history = new History();
  doc.history = history;
  return { doc, history };
}

function addNode(doc: Document, partial: Partial<CanvasNode> = {}): CanvasNode {
  const n = Document.newNode({ type: 'text', x: 0, y: 0, width: 120, height: 36, text: '', ...partial });
  doc.nodes.push(n);
  doc.reindex();
  return n;
}

describe('导图：升级 / 取消升级', () => {
  it('升级写入 mapRoot 标记并视为导图成员；重复升级不产生新撤销记录', () => {
    const { doc, history } = makeDoc();
    const root = addNode(doc);
    expect(isMapMember(doc, root.id)).toBe(false);

    upgradeToMapRoot(doc, root.id);
    expect(root.mapRoot).toBe(true);
    expect(isMapMember(doc, root.id)).toBe(true);
    expect(history.canUndo).toBe(true);

    upgradeToMapRoot(doc, root.id);
    expect(history.undoLabel).toBe('升级为导图主节点'); // 第二次为空操作，未入栈
  });

  it('取消升级：清除标记，子树内导图连线转为普通连线且连接保留', () => {
    const { doc } = makeDoc();
    const root = addNode(doc, { mapRoot: true });
    const child = addNode(doc, { x: 300, y: 0 });
    doc.edges.push({ id: 'e1', fromNode: root.id, toNode: child.id, kind: 'mindmap' });
    doc.reindex();

    downgradeMapRoot(doc, root.id);
    expect(root.mapRoot).toBe(false);
    expect(doc.edges).toHaveLength(1);
    expect(doc.edges[0].kind).toBeUndefined();
    expect(doc.edges[0].toNode).toBe(child.id); // 连接未丢失
    expect(isMapMember(doc, root.id)).toBe(false);
    expect(isMapMember(doc, child.id)).toBe(false);
  });

  it('取消升级只影响该主节点的子树，不动其它导图', () => {
    const { doc } = makeDoc();
    const rootA = addNode(doc, { mapRoot: true });
    const childA = addNode(doc);
    const rootB = addNode(doc, { mapRoot: true, y: 500 });
    const childB = addNode(doc, { y: 500, x: 300 });
    doc.edges.push(
      { id: 'ea', fromNode: rootA.id, toNode: childA.id, kind: 'mindmap' },
      { id: 'eb', fromNode: rootB.id, toNode: childB.id, kind: 'mindmap' },
    );
    doc.reindex();

    downgradeMapRoot(doc, rootA.id);
    expect(doc.edges.find((e) => e.id === 'ea')!.kind).toBeUndefined();
    expect(doc.edges.find((e) => e.id === 'eb')!.kind).toBe('mindmap');
    expect(rootB.mapRoot).toBe(true);
  });

  it('取消升级可撤销（快照式撤销恢复标记与 mindmap 边）', () => {
    const { doc, history } = makeDoc();
    const root = addNode(doc, { mapRoot: true });
    const child = addNode(doc);
    doc.edges.push({ id: 'e1', fromNode: root.id, toNode: child.id, kind: 'mindmap' });
    doc.reindex();

    downgradeMapRoot(doc, root.id);
    history.undo();
    // 快照式撤销会重建节点/边对象，需经索引重新取用
    expect(doc.getNode(root.id)!.mapRoot).toBe(true);
    expect(doc.edges[0].kind).toBe('mindmap');
  });
});

describe('导图：添加子节点（Tab）', () => {
  it('新建文本框节点 + mindmap 边，位于父节点右侧一层', () => {
    const { doc } = makeDoc();
    const parent = addNode(doc, { mapRoot: true, x: 100, y: 200, width: 200, height: 40, fontSize: 18, color: '1' });

    const id = addMapChild(doc, parent.id, {});
    expect(id).not.toBeNull();
    const child = doc.getNode(id!)!;
    expect(child.type).toBe('text');
    expect(child.text).toBe('');
    expect(child.x).toBe(parent.x + parent.width + MAP_LEVEL_GAP);
    expect(child.y).toBe(parent.y + parent.height / 2 - 18); // 首个子节点与父节点垂直居中
    expect(child.fontSize).toBe(18); // 继承父节点样式
    expect(child.color).toBe('1');

    expect(mapParentId(doc, child.id)).toBe(parent.id);
    expect(mapChildIds(doc, parent.id)).toEqual([child.id]);
    expect(isMapMember(doc, child.id)).toBe(true);
  });

  it('再次添加子节点：纵向排在现有子节点最下方，不重叠', () => {
    const { doc } = makeDoc();
    const parent = addNode(doc, { mapRoot: true });
    const c1 = doc.getNode(addMapChild(doc, parent.id, {})!)!;
    const c2 = doc.getNode(addMapChild(doc, parent.id, {})!)!;
    expect(c2.y).toBe(c1.y + c1.height + MAP_SIBLING_GAP);
    expect(c2.x).toBe(c1.x);
    expect(mapChildIds(doc, parent.id)).toEqual([c1.id, c2.id]);
  });

  it('非导图成员上返回 null；操作可一步撤销', () => {
    const { doc, history } = makeDoc();
    const plain = addNode(doc);
    expect(addMapChild(doc, plain.id, {})).toBeNull();

    const root = addNode(doc, { mapRoot: true });
    const id = addMapChild(doc, root.id, {})!;
    expect(doc.nodes.some((n) => n.id === id)).toBe(true);
    history.undo();
    expect(doc.nodes.some((n) => n.id === id)).toBe(false);
    expect(doc.edges).toHaveLength(0);
  });
});

describe('导图：添加同级节点（Enter）', () => {
  it('新建文本框在参考节点正下方，连到同一个父节点，样式框形继承', () => {
    const { doc } = makeDoc();
    const parent = addNode(doc, { mapRoot: true, fontSize: 20 });
    const ref = doc.getNode(addMapChild(doc, parent.id, {})!)!;
    ref.width = 160;
    ref.height = 44;

    const id = addMapSibling(doc, ref.id, {});
    expect(id).not.toBeNull();
    const sib = doc.getNode(id!)!;
    expect(sib.type).toBe('text');
    expect(sib.x).toBe(ref.x);
    expect(sib.y).toBe(ref.y + ref.height + MAP_SIBLING_GAP);
    expect(sib.width).toBe(160);
    expect(sib.height).toBe(44);
    expect(sib.fontSize).toBe(20); // 继承父链样式（调用方传父节点样式）
    expect(mapParentId(doc, sib.id)).toBe(parent.id);
    expect(mapChildIds(doc, parent.id)).toEqual([ref.id, sib.id]);
  });

  it('主节点 / 游离节点没有同级：返回 null', () => {
    const { doc } = makeDoc();
    const root = addNode(doc, { mapRoot: true });
    const orphan = addNode(doc);
    expect(addMapSibling(doc, root.id, {})).toBeNull();
    expect(addMapSibling(doc, orphan.id, {})).toBeNull();
  });
});

describe('导图：序列化（JSON Canvas 扩展字段）', () => {
  it('mapRoot 与 mindmap 边经 trefoil: 前缀往返保留', () => {
    const { doc } = makeDoc();
    const root = addNode(doc, { mapRoot: true });
    addMapChild(doc, root.id, {});
    addMapChild(doc, root.id, {});

    const parsed = parseDoc(serializeDoc(doc));
    expect(parsed.nodes.find((n) => n.id === root.id)?.mapRoot).toBe(true);
    expect(parsed.edges.filter((e) => e.kind === 'mindmap')).toHaveLength(2);

    // 往返后结构不变：父/子关系依旧成立
    const restored = new Document();
    restored.nodes = parsed.nodes;
    restored.edges = parsed.edges;
    restored.reindex();
    expect(mapChildIds(restored, root.id)).toHaveLength(2);
  });
});

describe('导图：边框继承', () => {
  const bordered = {
    border: true,
    stroke: '#ff8800',
    strokeSize: 3,
    borderStyle: 'dashed' as const,
    borderRadius: 8,
  };

  it('带边框节点新建的子节点继承同款边框', () => {
    const { doc } = makeDoc();
    const parent = addNode(doc, { mapRoot: true, ...bordered });
    const child = doc.getNode(addMapChild(doc, parent.id, {})!)!;
    expect(child.border).toBe(true);
    expect(child.stroke).toBe('#ff8800');
    expect(child.strokeSize).toBe(3);
    expect(child.borderStyle).toBe('dashed');
    expect(child.borderRadius).toBe(8);
  });

  it('带边框节点的同级节点同样继承', () => {
    const { doc } = makeDoc();
    const parent = addNode(doc, { mapRoot: true });
    const ref = doc.getNode(addMapChild(doc, parent.id, {})!)!;
    doc.updateNode(ref.id, bordered, '加边框');
    const sib = doc.getNode(addMapSibling(doc, ref.id, {})!)!;
    expect(sib.border).toBe(true);
    expect(sib.stroke).toBe('#ff8800');
    expect(sib.borderStyle).toBe('dashed');
  });

  it('无边框节点的新建子节点不带边框字段（不种入未生效参数）', () => {
    const { doc } = makeDoc();
    const parent = addNode(doc, { mapRoot: true, stroke: '#123456', strokeSize: 4 }); // 有描边参数但边框未开启
    const child = doc.getNode(addMapChild(doc, parent.id, {})!)!;
    expect(child.border).toBeUndefined();
    expect(child.stroke).toBeUndefined();
    expect(child.strokeSize).toBeUndefined();
    expect(child.borderStyle).toBeUndefined();
    expect(child.borderRadius).toBeUndefined();
  });
});

describe('导图连线：三次贝塞尔曲线', () => {
  const parent = { x: 0, y: 0, width: 100, height: 40 }; // 右缘中点 (100, 20)，中心 (50, 20)
  const child = (x: number, y: number) => ({ x, y, width: 80, height: 40 });

  it('子节点在右侧：父右缘中点出发、水平切线进入子左缘中点，张力 = 边缘间距的一半', () => {
    const { path } = mindmapEdgeCurve(parent, child(300, 200)); // 边缘间距 = 300 - 100 = 200
    const [p0, c1, c2, p1] = path;
    expect(p0).toEqual({ x: 100, y: 20 });
    expect(p1).toEqual({ x: 300, y: 220 });
    expect(c1).toEqual({ x: 200, y: 20 });
    expect(c2).toEqual({ x: 200, y: 220 });
  });

  it('子节点在左侧：镜像为父左缘出、子右缘入', () => {
    const { path } = mindmapEdgeCurve(parent, child(-300, -100)); // 边缘间距 = -220 - 0 = 220
    const [p0, c1, c2, p1] = path;
    expect(p0).toEqual({ x: 0, y: 20 });
    expect(p1).toEqual({ x: -220, y: -80 });
    expect(c1).toEqual({ x: -110, y: 20 });
    expect(c2).toEqual({ x: -110, y: -80 });
  });

  it('子节点上下移动时切线始终水平：曲线随位置连续变化，不发生贴边换向跳变', () => {
    for (const y of [-2000, -500, 0, 500, 2000]) {
      const { path } = mindmapEdgeCurve(parent, child(300, y));
      const [, c1, , c2] = path;
      expect(c1.y).toBe(20); // 起点切线水平
      expect(c2.y).toBe(y + 20); // 终点切线水平
    }
  });

  it('控制点收在两节点之间的中线上：真贝塞尔渲染下为平滑 S 形，无回折', () => {
    // 标准导图布局的 80px 层级间距 + 大垂直偏移
    const { path } = mindmapEdgeCurve(parent, child(180, 600));
    const [p0, c1, c2, p1] = path;
    expect(p0).toEqual({ x: 100, y: 20 });
    expect(p1).toEqual({ x: 180, y: 620 });
    expect(c1).toEqual({ x: 140, y: 20 });
    expect(c2).toEqual({ x: 140, y: 620 });
  });
});
