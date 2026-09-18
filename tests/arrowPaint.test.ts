/**
 * 箭头「一体绘制」的几何不变量：线杆末端必须藏在端点件内部。
 * 只要这条不变量成立，任何角度下都不会出现线杆圆帽从三角里冒出来 / 两块拼在一起的观感。
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('konva', () => ({ default: { Shape: class {} } }));

import { layoutArrow } from '../src/engine/arrowPaint';
import { arrowCurve } from '../src/core/arrowLink';
import { headLength } from '../src/engine/arrowHead';
import type { CanvasNode } from '../src/core/types';
import type { Vec } from '../src/core/geometry';

const SW = 2;

const node = (id: string, x: number, y: number, width: number, height: number): CanvasNode => ({
  id,
  type: 'text',
  x,
  y,
  width,
  height,
  text: id,
});

/** 双端绑定箭头：from → to */
function boundArrow(from: CanvasNode, to: CanvasNode): CanvasNode {
  return {
    id: 'arr',
    type: 'trefoil/shape',
    shape: 'arrow',
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    points: [
      [0, 0],
      [10, 10],
    ],
    fromNode: from.id,
    toNode: to.id,
    strokeSize: SW,
  };
}

function inTriangle(p: Vec, tri: number[]): boolean {
  const [ax, ay, bx, by, cx, cy] = tri as [number, number, number, number, number, number];
  const sign = (x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) =>
    (x1 - x3) * (y2 - y3) - (x2 - x3) * (y1 - y3);
  const d1 = sign(p.x, p.y, ax, ay, bx, by);
  const d2 = sign(p.x, p.y, bx, by, cx, cy);
  const d3 = sign(p.x, p.y, cx, cy, ax, ay);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}

/**
 * 检查线杆末端（含圆帽两侧的极限点）是否落在三角内。
 * 圆帽半径 = 半线宽：只要这两点都在三角内，杆头就不会从三角侧边冒出来。
 */
function shaftHidden(
  shaftEnd: Vec,
  axisFrom: Vec,
  axisTo: Vec,
  triangle: number[],
  sw = SW,
): { ok: boolean; detail: string } {
  const len = Math.hypot(axisTo.x - axisFrom.x, axisTo.y - axisFrom.y) || 1;
  const nx = -(axisTo.y - axisFrom.y) / len;
  const ny = (axisTo.x - axisFrom.x) / len;
  const r = sw / 2;
  const bad: string[] = [];
  if (!inTriangle(shaftEnd, triangle)) bad.push('端点');
  if (!inTriangle({ x: shaftEnd.x + nx * r, y: shaftEnd.y + ny * r }, triangle)) bad.push('帽+');
  if (!inTriangle({ x: shaftEnd.x - nx * r, y: shaftEnd.y - ny * r }, triangle)) bad.push('帽-');
  const rd = (v: number) => Math.round(v * 10) / 10;
  return {
    ok: bad.length === 0,
    detail: `${bad.join('+')} 杆端(${rd(shaftEnd.x)},${rd(shaftEnd.y)}) 尖(${rd(axisTo.x)},${rd(axisTo.y)}) 三角[${triangle.map(rd).join(',')}]`,
  };
}

describe('箭头一体绘制：线杆末端藏在端点件内', () => {
  const from = node('f', 0, 0, 120, 60);

  it('直线箭头（折点分支）：杆端收进三角内部', () => {
    const arrow: CanvasNode = {
      id: 'a',
      type: 'trefoil/shape',
      shape: 'arrow',
      x: 0,
      y: 0,
      width: 300,
      height: 120,
      points: [
        [0, 0],
        [300, 120],
      ],
      strokeSize: SW,
    };
    const layout = layoutArrow({
      pts: [
        { x: 0, y: 0 },
        { x: 300, y: 120 },
      ],
      sw: SW,
      head: 'solid',
      tail: 'none',
      color: '#000',
      bg: '#fff',
    });
    const head = layout.head!;
    const straight = shaftHidden(head.shaftEnd, { x: 0, y: 0 }, { x: 300, y: 120 }, head.triangle!);
    expect(straight.ok, straight.detail).toBe(true);
    expect(arrow.points!.length).toBe(2);
  });

  it('绑定曲线：各种角度 / 距离下线杆末端都在三角内（含长曲线）', () => {
    const sizes: [number, number][] = [
      [600, 300], // 宽卡片
      [60, 40], // 小节点
      [120, 360], // 高卡片
    ];
    const failures: string[] = [];
    for (const [w, h] of sizes) {
      for (let deg = 0; deg < 360; deg += 15) {
        for (const dist of [160, 420, 900]) {
          const rad = (deg * Math.PI) / 180;
          const to = node('t', 400 + Math.cos(rad) * dist, 300 + Math.sin(rad) * dist, w, h);
          const arrow = boundArrow(from, to);
          const get = (id: string) => (id === 'f' ? from : id === 't' ? to : undefined);
          const curve = arrowCurve(arrow, get);
          if (!curve) continue;
          const layout = layoutArrow({
            pts: [],
            bezier: curve.path,
            sw: SW,
            head: 'solid',
            tail: 'solid',
            color: '#000',
            bg: '#fff',
          });
          const head = layout.head!;
          const tail = layout.tail!;
          const tip = { x: curve.path[6]!, y: curve.path[7]! };
          const start = { x: curve.path[0]!, y: curve.path[1]! };
          const shaft = layout.shaft;
          if (shaft.kind !== 'bezier') throw new Error('应为贝塞尔线杆');
          const shaftEnd = { x: shaft.path[6]!, y: shaft.path[7]! };
          const shaftStart = { x: shaft.path[0]!, y: shaft.path[1]! };
          const label = `${w}×${h} @${deg}° d${dist}`;
          // 末端：杆端必须收进三角（线杆总长不足以回缩时允许不缩，但那时曲线本身很短）
          const total = Math.hypot(
            curve.path[6]! - curve.path[0]!,
            curve.path[7]! - curve.path[1]!,
          );
          if (total > headLength(SW) * 3) {
            const h = shaftHidden(shaftEnd, { x: curve.path[4]!, y: curve.path[5]! }, tip, head.triangle!);
            if (!h.ok) failures.push(`末端 ${label}：${h.detail}`);
            const t = shaftHidden(shaftStart, { x: curve.path[2]!, y: curve.path[3]! }, start, tail.triangle!);
            if (!t.ok) failures.push(`起端 ${label}：${t.detail}`);
          }
        }
      }
    }
    expect(failures.slice(0, 5), `共 ${failures.length} 例失败`).toEqual([]);
    expect(failures).toHaveLength(0);
  });
});
