/** 箭头端点样式：几何、命中容差与序列化 */
import { describe, expect, it, vi } from 'vitest';

// konva 的 node 入口依赖原生 canvas 包，本测试只走几何/数据层，直接替换成空壳
vi.mock('konva', () => ({ default: {} }));

import { arrowHeadParts, headLength, headRadius } from '../src/engine/arrowHead';
import { hitTestNode } from '../src/engine/NodeView';
import type { Palette } from '../src/engine/palette';
import type { CanvasNode } from '../src/core/types';
import { parseDoc, serializeDoc } from '../src/data/jsonCanvas';
import { DEFAULT_SETTINGS, mergeSettings } from '../src/core/defaults';
import { bakeLineFlip, normalizeLineBBox, setLinePoint } from '../src/core/resize';
import { shapeRectFromDrag } from '../src/core/geometry';
import { effectiveEndpoints, isBoundCurve, arrowCurve, sampleCubic, magnetAnchor, syncBoundArrow, trimCubicEnd, trimCubicStart, cubicMidpoint, polylineMidpoint, dashArray } from '../src/core/arrowLink';
import { Document } from '../src/core/Document';

const palette = {} as Palette;

const arrowNode = (patch: Partial<CanvasNode> = {}): CanvasNode => ({
  id: 'n1',
  type: 'trefoil/shape',
  shape: 'arrow',
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  points: [
    [0, 0],
    [100, 100],
  ],
  ...patch,
});

describe('arrowHeadParts 端点几何', () => {
  const from = { x: 0, y: 0 };
  const to = { x: 100, y: 0 }; // 水平向右
  const sw = 2;

  it('none 返回 null（不画端点）', () => {
    expect(arrowHeadParts(from, to, sw, 'none')).toBeNull();
  });

  it('实心：三角尖端在终点，线杆沿方向回缩', () => {
    const p = arrowHeadParts(from, to, sw, 'solid')!;
    expect(p.triangle).toBeDefined();
    expect(p.triangle![0]).toBe(to.x);
    expect(p.triangle![1]).toBe(to.y);
    expect(p.shaftEnd.x).toBeLessThan(to.x);
    expect(p.shaftEnd.y).toBeCloseTo(to.y);
    expect(p.hollowFill).toBe(false);
    // 回缩量在三角长度之内（圆帽不会从尖端冒出）
    expect(to.x - p.shaftEnd.x).toBeLessThan(headLength(sw));
  });

  it('空心：垫底色遮线杆，回缩更深', () => {
    const solid = arrowHeadParts(from, to, sw, 'solid')!;
    const hollow = arrowHeadParts(from, to, sw, 'hollow')!;
    expect(hollow.hollowFill).toBe(true);
    expect(hollow.shaftEnd.x).toBeLessThan(solid.shaftEnd.x);
  });

  it('线段（V 形）：开放式折线，不闭合成三角', () => {
    const p = arrowHeadParts(from, to, sw, 'chevron')!;
    expect(p.chevron).toBeDefined();
    expect(p.chevron).toHaveLength(6); // 3 点 V 形
    expect(p.triangle).toBeUndefined();
    // 两个翼点对称张开（水平方向上 y 对称、x 相同），尖端在终点
    expect(p.chevron![1]).toBeCloseTo(-p.chevron![5]!);
    expect(p.chevron![0]).toBeCloseTo(p.chevron![4]!);
    expect(p.chevron![2]).toBeCloseTo(to.x);
  });

  it('圆点 / 空心圆点：圆心在终点，半径随描边缩放', () => {
    const dot = arrowHeadParts(from, to, sw, 'dot')!;
    const hollowDot = arrowHeadParts(from, to, sw, 'hollow-dot')!;
    expect(dot.circle).toEqual({ x: to.x, y: to.y, r: headRadius(sw) });
    expect(dot.hollowFill).toBe(false);
    expect(hollowDot.hollowFill).toBe(true);
    expect(dot.shaftEnd.x).toBeLessThan(to.x);
  });

  it('端点尺寸随描边粗细缩放', () => {
    expect(headLength(4)).toBeGreaterThan(headLength(2));
    expect(headRadius(4)).toBeGreaterThan(headRadius(2));
  });

  it('斜向方向：回缩沿方向进行', () => {
    const p = arrowHeadParts({ x: 0, y: 0 }, { x: 60, y: 80 }, 2, 'solid')!;
    const d = Math.hypot(60 - p.shaftEnd.x, 80 - p.shaftEnd.y);
    expect(d).toBeGreaterThan(0);
    expect(p.shaftEnd.x / 60).toBeCloseTo(p.shaftEnd.y / 80, 5);
  });
});

describe('hitTestNode 线类命中容差（缩放感知）', () => {
  const n = arrowNode({ strokeSize: 2 });

  it('贴线必命中', () => {
    expect(hitTestNode(n, 50, 50, palette, 1)).toBe(true);
  });

  it('低缩放下容差放大：屏幕 6px 内的世界偏移仍可命中', () => {
    // 对角线上偏移 14 → 真实垂距 ≈ 9.9
    // scale 0.5 → 容差 max(8, 12) = 12，应命中
    expect(hitTestNode(n, 50, 64, palette, 0.5)).toBe(true);
    // scale 1 → 容差 8，不命中
    expect(hitTestNode(n, 50, 64, palette, 1)).toBe(false);
  });

  it('远离线的点不命中（不因容差放大而误吞大片区域）', () => {
    expect(hitTestNode(n, 10, 90, palette, 0.5)).toBe(false);
  });

  it('非线类形状包围盒内即命中', () => {
    const rect = arrowNode({ shape: 'rect', points: undefined });
    expect(hitTestNode(rect, 80, 20, palette, 1)).toBe(true);
  });
});

describe('端点样式序列化（trefoil: 命名空间）', () => {
  it('显式样式写入并读回', () => {
    const doc = {
      nodes: [arrowNode({ headStyle: 'hollow', tailStyle: 'dot' })],
      edges: [],
    };
    const parsed = parseDoc(serializeDoc(doc as never));
    expect(parsed.nodes[0]!.headStyle).toBe('hollow');
    expect(parsed.nodes[0]!.tailStyle).toBe('dot');
  });

  it('未设置时不写入字段', () => {
    const doc = { nodes: [arrowNode()], edges: [] };
    const json = serializeDoc(doc as never);
    expect(json).not.toContain('headStyle');
    expect(json).not.toContain('tailStyle');
  });
});

describe('箭头默认设置', () => {
  it('默认：终点实心、起点无（单向）', () => {
    expect(DEFAULT_SETTINGS.shape.arrowHead).toBe('solid');
    expect(DEFAULT_SETTINGS.shape.arrowTail).toBe('none');
  });

  it('mergeSettings 保留旧配置文件的端点默认并补全缺省', () => {
    const merged = mergeSettings({ shape: { stroke: '#ff0000' } as never });
    expect(merged.shape.stroke).toBe('#ff0000');
    expect(merged.shape.arrowHead).toBe('solid');
    expect(merged.shape.arrowTail).toBe('none');
  });
});

describe('setLinePoint 线类端点拖拽', () => {
  it('端点越出包围盒后 x/y/width/height 重排，另一端世界位置不动', () => {
    const n: CanvasNode = {
      id: 'n1',
      type: 'trefoil/shape',
      shape: 'arrow',
      x: 100,
      y: 100,
      width: 100,
      height: 100,
      points: [
        [0, 0],
        [100, 100],
      ],
    };
    // 把起点拖到 (50, 260)：越过原包围盒左侧与下方
    setLinePoint(n, 0, 50, 260);
    // 终点世界位置保持 (200, 200)
    expect(n.points![1]).toEqual([150, 0]);
    // 包围盒收得刚好
    expect(n.x).toBe(50);
    expect(n.y).toBe(200);
    expect(n.width).toBe(150);
    expect(n.height).toBe(60);
    // 起点在世界 (50, 260) → 相对坐标 (0, 60)
    expect(n.points![0]).toEqual([0, 60]);
  });

  it('缺省 points 的线节点按对角线回退值参与计算', () => {
    const n: CanvasNode = {
      id: 'n2',
      type: 'trefoil/shape',
      shape: 'line',
      x: 10,
      y: 20,
      width: 30,
      height: 40,
    };
    setLinePoint(n, 1, 100, 20);
    expect(n.points).toBeDefined();
    expect(n.points![0]).toEqual([0, 0]);
    expect(n.points![1]).toEqual([90, 0]);
    expect(n.height).toBe(1); // 水平线：高度夹取到最小 1
  });
});

describe('缩放/端点撤销记录带折点', () => {
  it('commitPositions 记录 points，undo 还原折点与包围盒', () => {
    const doc = new Document();
    const cmds: unknown[] = [];
    doc.history = { push: (c) => cmds.push(c) };
    const n = Document.newNode({
      type: 'trefoil/shape',
      shape: 'arrow',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      points: [
        [0, 0],
        [100, 100],
      ],
    });
    doc.addNodes([n]);
    // 模拟端点拖拽后的落栈：当前状态 = 拖过的形状
    setLinePoint(n, 1, 200, 50);
    doc.commitPositions('调整箭头', new Map([[n.id, { x: 0, y: 0 }]]), new Map([
      [n.id, { x: 0, y: 0, width: 100, height: 100, points: [[0, 0], [100, 100]] }],
    ]));
    const cmd = cmds[1] as { undo(): void; redo(): void }; // cmds[0] 是 addNodes 的记录
    cmd.undo();
    expect(n.x).toBe(0);
    expect(n.width).toBe(100);
    expect(n.points).toEqual([[0, 0], [100, 100]]);
    cmd.redo();
    expect(n.points![1]).toEqual([200, 50]);
  });
});

describe('翻转箭头的端点（bakeLineFlip / normalizeLineBBox）', () => {
  const base = { id: 'nf', type: 'trefoil/shape' as const, shape: 'arrow' as const };

  it('bakeLineFlip：翻转烘进折点后视觉端点位置不变', () => {
    // flipX：TL→BR 的折点视觉上变成 TR→BL
    const n: CanvasNode = { ...base, x: 0, y: 0, width: 100, height: 100, points: [[0, 0], [100, 100]], flipX: true };
    bakeLineFlip(n);
    expect(n.flipX).toBe(false);
    expect(n.points).toEqual([[100, 0], [0, 100]]);
  });

  it('bakeLineFlip：双向翻转等价于坐标双向镜像', () => {
    const n: CanvasNode = { ...base, x: 10, y: 10, width: 80, height: 60, points: [[0, 0], [80, 60]], flipX: true, flipY: true };
    bakeLineFlip(n);
    expect(n.points).toEqual([[80, 60], [0, 0]]);
    expect(n.flipX).toBe(false);
    expect(n.flipY).toBe(false);
  });

  it('normalizeLineBBox：包围盒收紧到折点范围，折点世界位置不动', () => {
    // 旧数据残留：bbox 100×100，折点只占 [0,0]..[60,40]
    const n: CanvasNode = { ...base, x: 50, y: 50, width: 100, height: 100, points: [[0, 0], [60, 40]] };
    normalizeLineBBox(n);
    expect(n.x).toBe(50);
    expect(n.y).toBe(50);
    expect(n.width).toBe(60);
    expect(n.height).toBe(40);
    expect(n.points).toEqual([[0, 0], [60, 40]]);
  });

  it('normalizeLineBBox：折点带偏移时 x/y 前移、折点归零基准', () => {
    const n: CanvasNode = { ...base, x: 0, y: 0, width: 200, height: 200, points: [[30, 20], [100, 150]] };
    normalizeLineBBox(n);
    expect(n.x).toBe(30);
    expect(n.y).toBe(20);
    expect(n.width).toBe(70);
    expect(n.height).toBe(130);
    expect(n.points).toEqual([[0, 0], [70, 130]]);
  });

  it('normalizeLineBBox：翻转节点跳过（包围盒是镜像锚点，归一会改变视觉）', () => {
    const n: CanvasNode = { ...base, x: 0, y: 0, width: 100, height: 100, points: [[0, 0], [60, 40]], flipY: true };
    normalizeLineBBox(n);
    expect(n.width).toBe(100);
    expect(n.height).toBe(100);
    expect(n.flipY).toBe(true);
  });

  it('parseDoc：加载旧文件时自动归一线类包围盒', () => {
    const json = JSON.stringify({
      nodes: [{
        id: 'n1',
        type: 'trefoil/shape',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        'trefoil:shape': 'arrow',
        'trefoil:points': [[0, 0], [60, 40]],
      }],
      edges: [],
    });
    const parsed = parseDoc(json);
    expect(parsed.nodes[0]!.width).toBe(60);
    expect(parsed.nodes[0]!.height).toBe(40);
    expect(parsed.nodes[0]!.points).toEqual([[0, 0], [60, 40]]);
  });
});

describe('翻转箭头的命中测试（hitTestNode 感知翻转）', () => {
  it('flipX 后视觉线是镜像对角线：点视觉线命中、点原始对角线不命中', () => {
    // 折点 TL→BR，flipX 后视觉为 TR→BL
    const n: CanvasNode = {
      id: 'nflip',
      type: 'trefoil/shape',
      shape: 'arrow',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      points: [[0, 0], [100, 100]],
      flipX: true,
    };
    // 视觉线中点 (50,50)（两对角线交点）必命中
    expect(hitTestNode(n, 50, 50, palette, 1)).toBe(true);
    // 视觉线上的点 (25,75)（未翻转对角线上没有的点）必须命中 —— 旧实现漏掉
    expect(hitTestNode(n, 25, 75, palette, 1)).toBe(true);
    // 视觉端点 (100,0) 与 (0,100) 命中
    expect(hitTestNode(n, 100, 0, palette, 1)).toBe(true);
    expect(hitTestNode(n, 0, 100, palette, 1)).toBe(true);
    // 原始对角线上但不在视觉线上的点 (25,25)：距视觉线 ~35，不命中
    expect(hitTestNode(n, 25, 25, palette, 1)).toBe(false);
  });
});

describe('端点磁吸绑定（arrowLink）', () => {
  const rectNode = (id: string, x: number, y: number): CanvasNode => ({
    id,
    type: 'text',
    x,
    y,
    width: 100,
    height: 60,
    text: 'A',
  });
  const boundArrow = (fromNode?: string, toNode?: string): CanvasNode => ({
    id: 'na',
    type: 'trefoil/shape',
    shape: 'arrow',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    points: [[0, 0], [100, 100]],
    fromNode,
    toNode,
  });

  it('effectiveEndpoints：绑定端锚在目标最近边中点，自由端取折点', () => {
    // 目标矩形 (150..250, 100..160)，箭头终点 (100,100) 离上边最近 → 锚到上缘中点 (200,100)
    const get = (id: string) => (id === 't' ? rectNode('t', 150, 100) : undefined);
    const n = boundArrow(undefined, 't');
    const { b } = effectiveEndpoints(n, get);
    expect(b).toEqual({ x: 200, y: 100 });
  });

  it('syncBoundArrow：锚点写回折点，包围盒收紧到两端', () => {
    const get = (id: string) => (id === 'f' ? rectNode('f', 0, 0) : id === 't' ? rectNode('t', 300, 200) : undefined);
    const n = boundArrow('f', 't');
    n.points = [[50, 50], [250, 150]]; // 过期折点
    syncBoundArrow(n, get);
    // 起点 → f 下缘中点 (50,60)（p1 在下方）；终点 → t 上缘中点 (350,200)（p0 在上方）
    expect(n.points![0]).toEqual([0, 0]);
    expect(n.points![1]).toEqual([300, 140]);
    expect(n.x).toBe(50);
    expect(n.y).toBe(60);
    expect(n.width).toBe(300);
    expect(n.height).toBe(140);
  });

  it('isBoundCurve / arrowCurve：双端绑定成立才有贝塞尔，端点为边缘锚点', () => {
    const get = (id: string) => (id === 'f' ? rectNode('f', 0, 0) : id === 't' ? rectNode('t', 300, 0) : undefined);
    expect(isBoundCurve(boundArrow('f', 't'), get)).toBe(true);
    expect(isBoundCurve(boundArrow('f', undefined), get)).toBe(false);
    expect(isBoundCurve(boundArrow('f', 'gone'), get)).toBe(false);
    const c = arrowCurve(boundArrow('f', 't'), get)!;
    expect(c.path).toHaveLength(8);
    // 起点 = f 右缘中点 (100,30)，终点 = t 左缘中点 (300,30)
    expect(c.path[0]).toBe(100);
    expect(c.path[1]).toBe(30);
    expect(c.path[6]).toBe(300);
    expect(c.path[7]).toBe(30);
    // 末端切线指向终点
    expect(c.endTangent.x).toBeGreaterThan(0);
  });

  it('sampleCubic：包含首末端点', () => {
    const s = sampleCubic([0, 0, 10, 10, 20, 0, 30, 30]);
    expect(s[0]).toBe(0);
    expect(s[1]).toBe(0);
    expect(s[s.length - 2]).toBe(30);
    expect(s[s.length - 1]).toBe(30);
  });

  it('magnetAnchor：半径内吸附最近元素锚点，跳过线类与排除项', () => {
    const nodes = [rectNode('a', 90, 100), rectNode('b', 500, 500), boundArrow('x')];
    const visible = () => true;
    // (210,130) 距 a 右缘中点 (190,130) 仅 20
    expect(magnetAnchor(210, 130, 30, nodes, visible)?.id).toBe('a');
    // 半径外不吸
    expect(magnetAnchor(210, 130, 10, nodes, visible)).toBeNull();
    // 排除后不吸
    expect(magnetAnchor(210, 130, 30, nodes, visible, 'a')).toBeNull();
  });

  it('removeNodes：删除被绑元素后箭头冻结为直线并清除绑定', () => {
    const doc = new Document();
    doc.nodes.push(rectNode('t', 150, 100));
    doc.nodes.push(boundArrow(undefined, 't'));
    doc.reindex();
    const arrow = doc.nodes[1]!;
    doc.removeNodes(['t']);
    expect(arrow.toNode).toBeUndefined();
    expect(arrow.points).toBeDefined(); // 锚点固化
    // 冻结后的终点 = 原 t 上缘中点 (200,100)
    expect(arrow.x! + arrow.points![1]![0]).toBe(200);
    expect(arrow.y! + arrow.points![1]![1]).toBe(100);
  });

  it('端点样式绑定字段随文件序列化', () => {
    const doc = { nodes: [boundArrow('f', 't')], edges: [] };
    const parsed = parseDoc(serializeDoc(doc as never));
    expect(parsed.nodes[0]!.fromNode).toBe('f');
    expect(parsed.nodes[0]!.toNode).toBe('t');
  });
});

describe('曲线杆端回缩与中点（连线圆头修复 / 关系描述）', () => {
  it('trimCubicEnd：截掉末端一段后形状不变、端点前移', () => {
    const path = [0, 0, 100, 0, 200, 0, 300, 0]; // 直线型三次曲线，总长 300
    const trimmed = trimCubicEnd(path, 60);
    // 新终点 ≈ x=240（回缩 60；数值弧长查找有半格误差）
    expect(Math.abs(trimmed[6]! - 240)).toBeLessThan(7);
    expect(trimmed[7]).toBeCloseTo(0, 3);
    // 新控制点仍在直线上（y ≈ 0）
    expect(trimmed[3]).toBeCloseTo(0, 3);
    expect(trimmed[5]).toBeCloseTo(0, 3);
    // 起点不动
    expect(trimmed[0]).toBe(0);
    expect(trimmed[1]).toBe(0);
  });

  it('trimCubicEnd：曲线太短时不回缩（原样返回）', () => {
    const path = [0, 0, 1, 0, 2, 0, 3, 0];
    expect(trimCubicEnd(path, 50)).toBe(path);
  });

  it('trimCubicStart：对称回缩起端', () => {
    const path = [0, 0, 100, 0, 200, 0, 300, 0];
    const trimmed = trimCubicStart(path, 60);
    expect(Math.abs(trimmed[0]! - 60)).toBeLessThan(7);
    expect(trimmed[6]).toBeCloseTo(300, 0);
  });

  it('cubicMidpoint / polylineMidpoint：中点计算', () => {
    expect(cubicMidpoint([0, 0, 100, 0, 200, 0, 300, 0])).toEqual({ x: 150, y: 0 });
    // 总长 220，前段 120：半长 110 落在第一段上
    const m = polylineMidpoint([[0, 0], [120, 0], [120, 100]]);
    expect(m).toEqual({ x: 110, y: 0 });
    // 中点恰好落在拐点上时返回拐点
    expect(polylineMidpoint([[0, 0], [100, 0], [100, 100]])).toEqual({ x: 100, y: 0 });
  });
});

describe('线型（实线/虚线/点状线）', () => {
  it('dashArray：随描边粗细缩放，solid 为 undefined', () => {
    expect(dashArray(undefined, 2)).toBeUndefined();
    expect(dashArray('solid', 2)).toBeUndefined();
    const d = dashArray('dashed', 2)!;
    expect(d).toHaveLength(2);
    expect(d[0]).toBeGreaterThanOrEqual(8);
    const dot = dashArray('dotted', 3)!;
    expect(dot[0]).toBeLessThanOrEqual(1);
    expect(dot[1]).toBeGreaterThan(4);
    // 粗描边 → 更长的虚线段
    expect(dashArray('dashed', 6)![0]).toBeGreaterThan(dashArray('dashed', 2)![0]);
  });

  it('strokeStyle 序列化：显式写入读回，solid 缺省不写文件', () => {
    const doc = { nodes: [arrowNode({ strokeStyle: 'dotted' })], edges: [] };
    const parsed = parseDoc(serializeDoc(doc as never));
    expect(parsed.nodes[0]!.strokeStyle).toBe('dotted');
    const plain = { nodes: [arrowNode()], edges: [] };
    expect(serializeDoc(plain as never)).not.toContain('strokeStyle');
  });
});

describe('形状辅助键拖拽（shapeRectFromDrag，PS 规范）', () => {
  const S = { x: 100, y: 100 };

  it('默认：对角矩形', () => {
    expect(shapeRectFromDrag(S, { x: 180, y: 150 }, false, false)).toEqual({ x: 100, y: 100, width: 80, height: 50 });
    // 反向拖拽归一化
    expect(shapeRectFromDrag(S, { x: 40, y: 60 }, false, false)).toEqual({ x: 40, y: 60, width: 60, height: 40 });
  });

  it('Shift：约束正形，起笔角锚定，朝拖拽方向扩展', () => {
    // 向右下拖 80×50 → 取大边 80，锚定左上角
    expect(shapeRectFromDrag(S, { x: 180, y: 150 }, true, false)).toEqual({ x: 100, y: 100, width: 80, height: 80 });
    // 向左上拖 60×40 → 锚定右下角（起点），向左上扩展 60
    expect(shapeRectFromDrag(S, { x: 40, y: 60 }, true, false)).toEqual({ x: 40, y: 40, width: 60, height: 60 });
  });

  it('Alt：中心展开，起点为中心，终点为半径对角', () => {
    // 拖 80×50 → 160×100，中心 (100,100)
    expect(shapeRectFromDrag(S, { x: 180, y: 150 }, false, true)).toEqual({ x: 20, y: 50, width: 160, height: 100 });
  });

  it('Shift+Alt：中心正形', () => {
    // 拖 80×50 → 边长 160 的正方形，中心 (100,100)
    expect(shapeRectFromDrag(S, { x: 180, y: 150 }, true, true)).toEqual({ x: 20, y: 20, width: 160, height: 160 });
  });
});
