import { describe, expect, it } from 'vitest';
import { computeArrange, type ArrangeBox, type ArrangeParams, type ArrangePositions } from '../src/core/arrange';

function boxes(list: [string, number, number, number, number][]): ArrangeBox[] {
  return list.map(([id, x, y, width, height]) => ({ id, x, y, width, height }));
}

function params(partial: Partial<ArrangeParams>): ArrangeParams {
  return { mode: 'horizontal', anchor: 'top-left', gapX: 10, gapY: 10, perRow: 3, ...partial };
}

describe('computeArrange', () => {
  it('空输入返回空结果', () => {
    expect(computeArrange([], params({})).size).toBe(0);
  });

  it('横向（左上角基准）：按 x 排序，边缘间距 = gap，顶部对齐包围盒顶部', () => {
    const out = computeArrange(
      boxes([
        ['a', 100, 0, 60, 40],
        ['b', 0, 50, 40, 30],
        ['c', 200, 20, 50, 20],
      ]),
      params({ mode: 'horizontal', gapX: 10 }),
    );
    // minX = 0、minY = 0 保持不动
    expect(out.get('b')).toEqual({ x: 0, y: 0 });
    expect(out.get('a')).toEqual({ x: 50, y: 0 }); // 0 + 40 + 10
    expect(out.get('c')).toEqual({ x: 120, y: 0 }); // 50 + 60 + 10
    // 相邻边缘间距为 10
    expect(out.get('a')!.x - (out.get('b')!.x + 40)).toBe(10);
    expect(out.get('c')!.x - (out.get('a')!.x + 60)).toBe(10);
  });

  it('横向（几何中心基准）：中心间距 = gap，整体包围盒中心不动', () => {
    const out = computeArrange(
      boxes([
        ['a', 100, 0, 60, 40],
        ['b', 0, 50, 40, 30],
        ['c', 200, 20, 50, 20],
      ]),
      params({ mode: 'horizontal', anchor: 'center', gapX: 100 }),
    );
    // 原包围盒 x∈[0,250] → 中心 125；y∈[0,80] → 中心 40
    const cx = (b: ArrangeBox) => out.get(b.id)!.x + b.width / 2;
    const cy = (b: ArrangeBox) => out.get(b.id)!.y + b.height / 2;
    expect(cx({ id: 'a', x: 0, y: 0, width: 60, height: 40 })).toBeCloseTo(122.5);
    expect(cx({ id: 'b', x: 0, y: 0, width: 40, height: 30 })).toBeCloseTo(22.5);
    expect(cx({ id: 'c', x: 0, y: 0, width: 50, height: 20 })).toBeCloseTo(222.5);
    expect(cx({ id: 'a', x: 0, y: 0, width: 60, height: 40 }) - cx({ id: 'b', x: 0, y: 0, width: 40, height: 30 })).toBe(100);
    expect(cx({ id: 'c', x: 0, y: 0, width: 50, height: 20 }) - cx({ id: 'a', x: 0, y: 0, width: 60, height: 40 })).toBe(100);
    for (const b of [{ id: 'a', width: 60, height: 40 }, { id: 'b', width: 40, height: 30 }, { id: 'c', width: 50, height: 20 }] as ArrangeBox[]) {
      expect(cy(b)).toBe(40); // 中心线对齐原包围盒垂直中心
    }
    // 整体中心保持：x∈[2.5,247.5] → 125
    const left = Math.min(...[out.get('a')!.x, out.get('b')!.x, out.get('c')!.x]);
    const right = Math.max(...[out.get('a')!.x + 60, out.get('b')!.x + 40, out.get('c')!.x + 50]);
    expect((left + right) / 2).toBeCloseTo(125);
  });

  it('纵向（左上角基准）：按 y 排序，左对齐包围盒左侧', () => {
    const out = computeArrange(
      boxes([
        ['a', 100, 0, 60, 40],
        ['b', 0, 50, 40, 30],
        ['c', 0, 200, 50, 20],
      ]),
      params({ mode: 'vertical', gapY: 8 }),
    );
    expect(out.get('a')).toEqual({ x: 0, y: 0 });
    expect(out.get('b')).toEqual({ x: 0, y: 48 }); // 0 + 40 + 8
    expect(out.get('c')).toEqual({ x: 0, y: 86 }); // 48 + 30 + 8
  });

  it('纵向（几何中心基准）：中心间距 = gap，整体中心不动', () => {
    const out = computeArrange(
      boxes([
        ['a', 0, 0, 40, 20],
        ['b', 10, 100, 30, 50],
      ]),
      params({ mode: 'vertical', anchor: 'center', gapY: 30 }),
    );
    // 原包围盒 y∈[0,150] → 中心 75；两中心相距 30；整体包围盒中心保持 75
    const ay = out.get('a')!.y;
    const by = out.get('b')!.y;
    expect(by + 25 - (ay + 10)).toBe(30);
    expect((ay + by + 50) / 2).toBeCloseTo(75);
    // 水平中心对齐原包围盒中心 x=20
    expect(out.get('a')!.x + 20).toBe(20);
    expect(out.get('b')!.x + 15).toBe(20);
  });

  it('矩阵（左上角基准）：行优先填充、列对齐（列宽取最大值）、行高取最大值', () => {
    const out = computeArrange(
      boxes([
        ['a', 0, 0, 50, 30],
        ['b', 100, 0, 40, 20],
        ['c', 0, 100, 60, 10],
        ['d', 300, 300, 20, 40],
      ]),
      params({ mode: 'matrix', gapX: 10, gapY: 5, perRow: 2 }),
    );
    // 顺序 a,b,c,d → a(0,0) b(1,0) c(0,1) d(1,1)
    // colW = [60,40]，rowH = [30,40]
    expect(out.get('a')).toEqual({ x: 0, y: 0 });
    expect(out.get('b')).toEqual({ x: 70, y: 0 }); // 0 + 60 + 10
    expect(out.get('c')).toEqual({ x: 0, y: 35 }); // 0 + 30 + 5
    expect(out.get('d')).toEqual({ x: 70, y: 35 });
  });

  it('矩阵（几何中心基准）：单元中心网格间距 = gap，整体中心不动', () => {
    const out = computeArrange(
      boxes([
        ['a', 0, 0, 50, 30],
        ['b', 100, 0, 40, 20],
        ['c', 0, 100, 60, 10],
        ['d', 300, 300, 20, 40],
      ]),
      params({ mode: 'matrix', anchor: 'center', gapX: 100, gapY: 60, perRow: 2 }),
    );
    const cx = (id: string, w: number) => out.get(id)!.x + w / 2;
    const cy = (id: string, h: number) => out.get(id)!.y + h / 2;
    // 列中心距 100、行中心距 60
    expect(cx('b', 40) - cx('a', 50)).toBe(100);
    expect(cx('d', 20) - cx('c', 60)).toBe(100);
    expect(cy('c', 10) - cy('a', 30)).toBe(60);
    expect(cy('d', 40) - cy('b', 20)).toBe(60);
    // 原包围盒中心 (160,170) 保持
    const left = Math.min(out.get('a')!.x, out.get('b')!.x, out.get('c')!.x, out.get('d')!.x);
    const right = Math.max(out.get('a')!.x + 50, out.get('b')!.x + 40, out.get('c')!.x + 60, out.get('d')!.x + 20);
    const top = Math.min(out.get('a')!.y, out.get('b')!.y, out.get('c')!.y, out.get('d')!.y);
    const bottom = Math.max(out.get('a')!.y + 30, out.get('b')!.y + 20, out.get('c')!.y + 10, out.get('d')!.y + 40);
    expect((left + right) / 2).toBeCloseTo(160);
    expect((top + bottom) / 2).toBeCloseTo(170);
  });

  it('矩阵：每行个数 ≥ 元素数时排成一行；非法值按 1 处理', () => {
    const list = boxes([
      ['a', 0, 0, 50, 30],
      ['b', 100, 0, 40, 20],
      ['c', 0, 100, 60, 10],
    ]);
    const oneRow = computeArrange(list, params({ mode: 'matrix', gapX: 10, gapY: 5, perRow: 10 }));
    expect(oneRow.get('a')!.y).toBe(oneRow.get('b')!.y);
    expect(oneRow.get('c')!.y).toBe(oneRow.get('b')!.y);
    const col = computeArrange(list, params({ mode: 'matrix', gapX: 10, gapY: 5, perRow: 0 }));
    expect(col.get('a')!.x).toBe(col.get('b')!.x);
    expect(col.get('c')!.y).toBeGreaterThan(col.get('b')!.y);
  });

  it('排列对自身幂等（滑块连续重算不漂移）', () => {
    const list = boxes([
      ['a', 100, 0, 60, 40],
      ['b', 0, 50, 40, 30],
      ['c', 200, 20, 50, 20],
    ]);
    for (const p of [
      params({ mode: 'horizontal', gapX: 24 }),
      params({ mode: 'vertical', gapY: 12 }),
      params({ mode: 'matrix', anchor: 'center', gapX: 80, gapY: 60, perRow: 2 }),
    ]) {
      const first = computeArrange(list, p);
      const applied = list.map((b) => ({ ...b, x: first.get(b.id)!.x, y: first.get(b.id)!.y }));
      const second = computeArrange(applied, p);
      expect(second).toEqual(first);
    }
  });
});

describe('环形排列', () => {
  // 4 个 20×20 元素散布在不同位置
  const four = boxes([
    ['a', 0, 0, 20, 20],
    ['b', 100, 0, 20, 20],
    ['c', 0, 100, 20, 20],
    ['d', 100, 100, 20, 20],
  ]);

  function ringParams(partial: Partial<ArrangeParams['ring']> & { radius: number }): ArrangeParams {
    return params({ mode: 'ring', ring: { distribute: 'even', angleStep: 30, startAngle: 0, clockwise: true, orderBy: 'angle', ...partial } });
  }

  function center(out: ArrangePositions, id: string) {
    const b = four.find((x) => x.id === id)!;
    return { x: out.get(id)!.x + b.width / 2, y: out.get(id)!.y + b.height / 2 };
  }

  it('均分：4 元素位于 0°/90°/180°/270°，0° = 正上方、顺时针', () => {
    const out = computeArrange(four, ringParams({ radius: 100 }));
    // orderBy 'angle'：以包围盒中心 (60,60) 为圆心的当前角度排序，起始角 0° = 正上方
    // 按角度排序后第一个元素应落在正上方，其余每 90° 顺时针一个
    const centers = ['a', 'b', 'c', 'd'].map((id) => center(out, id));
    const cx = 60;
    const cy = 60;
    for (const c of centers) {
      expect(Math.hypot(c.x - cx, c.y - cy)).toBeCloseTo(100); // 都在半径 100 的圆上
    }
    // 四个角度互不相同且均匀相隔 90°（按角度排序后角度递增）
    const angles = centers.map((c) => mod360((Math.atan2(c.x - cx, -(c.y - cy)) * 180) / Math.PI)).sort((x, y) => x - y);
    expect(angles[0]).toBeCloseTo(0);
    expect(angles[1]).toBeCloseTo(90);
    expect(angles[2]).toBeCloseTo(180);
    expect(angles[3]).toBeCloseTo(270);
  });

  it('固定角距：step=60 时 4 个元素只占 180° 扇区', () => {
    const out = computeArrange(four, ringParams({ radius: 100, distribute: 'step', angleStep: 60 }));
    const cx = 60;
    const cy = 60;
    const angles = ['a', 'b', 'c', 'd'].map((id) => {
      const c = center(out, id);
      return mod360((Math.atan2(c.x - cx, -(c.y - cy)) * 180) / Math.PI);
    });
    // 每个元素到圆心都在半径 100 上，且相对角度为 0/60/120/180 之一
    for (const c of ['a', 'b', 'c', 'd'].map((id) => center(out, id))) {
      expect(Math.hypot(c.x - cx, c.y - cy)).toBeCloseTo(100);
    }
    const sorted = angles.map((a) => Math.round(a)).sort((x, y) => x - y);
    expect(sorted).toEqual([0, 60, 120, 180]);
  });

  it('逆时针 + 起始角：锚定准确落位（以显式圆心计算）', () => {
    const two = boxes([
      ['a', 0, 0, 20, 20],
      ['b', 100, 0, 20, 20],
    ]);
    const center = { x: 50, y: 20 };
    const out = computeArrange(two, params({
      mode: 'ring',
      ring: { radius: 100, distribute: 'step', angleStep: 180, startAngle: 90, clockwise: false, orderBy: 'selection', center },
    }));
    // a 在 90°（正右）：圆心 (50,20) + (sin90, -cos90)*100 = (150, 20)
    expect(out.get('a')!.x + 10).toBeCloseTo(150);
    expect(out.get('a')!.y + 10).toBeCloseTo(20);
    // b 在 90° − 180° = −90° ≡ 270°（正左）：(50, 20) + (−100, 0)
    expect(out.get('b')!.x + 10).toBeCloseTo(-50);
    expect(out.get('b')!.y + 10).toBeCloseTo(20);
  });

  it('排序：orderBy x 时按 X 坐标决定环上顺序', () => {
    const list = boxes([
      ['right', 200, 0, 20, 20],
      ['left', 0, 0, 20, 20],
    ]);
    const center = { x: 110, y: 10 };
    const out = computeArrange(list, params({
      mode: 'ring',
      ring: { radius: 100, distribute: 'even', angleStep: 30, startAngle: 0, clockwise: true, orderBy: 'x', center },
    }));
    // left（x 小）排第一 → 正上方（0°）；right 排第二 → 均分角距 180° → 正下方
    expect(out.get('left')!.x + 10).toBeCloseTo(110);
    expect(out.get('left')!.y + 10).toBeCloseTo(-90);
    expect(out.get('right')!.x + 10).toBeCloseTo(110);
    expect(out.get('right')!.y + 10).toBeCloseTo(110);
  });
});

function mod360(deg: number): number {
  return ((deg % 360) + 360) % 360;
}
