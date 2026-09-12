import { describe, expect, it } from 'vitest';
import { IMAGE_MIN_SIZE, resizeImageRect, type ResizeHandleId } from '../src/core/resize';

/** 基准图片节点：420×210（2:1），左上角在 (100, 100) */
const base = { x: 100, y: 100, width: 420, height: 210 };
const ALL_HANDLES: ResizeHandleId[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const CORNERS: ResizeHandleId[] = ['nw', 'ne', 'se', 'sw'];

const call = (handle: ResizeHandleId, dx: number, dy: number, over = {}) =>
  resizeImageRect({ handle, dx, dy, ...base, ...over });

/** 沿手柄「向内收」的方向给位移（不同角的手柄方向不同，写死正负号容易把"放大"当成"缩小"） */
const inward = (handle: ResizeHandleId, amount: number) => {
  const cw = handle.includes('w') ? -1 : handle.includes('e') ? 1 : 0;
  const ch = handle.includes('n') ? -1 : handle.includes('s') ? 1 : 0;
  return { dx: -cw * amount, dy: -ch * amount };
};

describe('图片缩放：位移为 0 必须是恒等变换', () => {
  // 这条锁死的是「一按下手柄图片就飘走 / 缩成 32×32」那个回归：
  // 旧实现把「位移增量」当成了「新尺寸」，按下瞬间就得到 0 → 被夹到最小值。
  for (const handle of ALL_HANDLES) {
    it(`${handle} 手柄按下不动时矩形不变`, () => {
      expect(call(handle, 0, 0)).toEqual(base);
    });
  }

  it('微小位移只产生微小变化（连续，不跳变）', () => {
    const r = call('ne', 1, -1);
    expect(Math.abs(r.x - base.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(r.width - base.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(r.height - base.height)).toBeLessThanOrEqual(1);
    // 锚点（左下角）必须钉住
    expect(r.x).toBeCloseTo(base.x, 6);
    expect(r.y + r.height).toBeCloseTo(base.y + base.height, 6);
  });
});

describe('图片缩放：角手柄等比且锚点为对角', () => {
  it('ne：左边缘与下边缘固定，宽高同比例放大', () => {
    const r = call('ne', 100, -100);
    expect(r.x).toBeCloseTo(base.x, 6); // 左边缘不动
    expect(r.y + r.height).toBeCloseTo(base.y + base.height, 6); // 下边缘不动
    expect(r.width).toBeGreaterThan(base.width);
    expect(r.width / r.height).toBeCloseTo(base.width / base.height, 6);
  });

  it('sw：右边缘与上边缘固定，宽高同比例缩小', () => {
    const r = call('sw', 100, -100);
    expect(r.x + r.width).toBeCloseTo(base.x + base.width, 6); // 右边缘不动
    expect(r.y).toBeCloseTo(base.y, 6); // 上边缘不动
    expect(r.width).toBeLessThan(base.width);
    expect(r.width / r.height).toBeCloseTo(base.width / base.height, 6);
  });

  it('nw：右边缘与下边缘固定', () => {
    const r = call('nw', -60, -60);
    expect(r.x + r.width).toBeCloseTo(base.x + base.width, 6);
    expect(r.y + r.height).toBeCloseTo(base.y + base.height, 6);
  });

  it('se：左边缘与上边缘固定', () => {
    const r = call('se', 60, 60);
    expect(r.x).toBeCloseTo(base.x, 6);
    expect(r.y).toBeCloseTo(base.y, 6);
  });

  it('斜向拖动时按位移更大的那一轴定比例，不出现两轴打架', () => {
    // x 位移远大于 y：结果应与纯水平拖动一致
    const a = call('se', 120, 5);
    const b = call('se', 120, 0);
    expect(a.width).toBeCloseTo(b.width, 6);
    expect(a.height).toBeCloseTo(b.height, 6);
  });

  it('任意角手柄都保持宽高比', () => {
    for (const handle of CORNERS) {
      const r = call(handle, 37, -21);
      expect(r.width / r.height).toBeCloseTo(base.width / base.height, 6);
    }
  });
});

describe('图片缩放：缩到最小即停住，不翻转到锚点另一侧', () => {
  it('sw 向内拉过头不会翻到右上角', () => {
    const r = call('sw', 5000, -5000);
    // 仍在锚点（右上角）的左侧 / 下方，没有跳到它右边或上边
    expect(r.x + r.width).toBeLessThanOrEqual(base.x + base.width + 1e-6);
    expect(r.y).toBeGreaterThanOrEqual(base.y - 1e-6);
    expect(r.width).toBeGreaterThanOrEqual(IMAGE_MIN_SIZE - 1e-6);
  });

  it('ne 向内拉过头不会翻到左下角', () => {
    const r = call('ne', -5000, 5000);
    expect(r.x).toBeGreaterThanOrEqual(base.x - 1e-6);
    expect(r.y + r.height).toBeLessThanOrEqual(base.y + base.height + 1e-6);
    expect(r.width).toBeGreaterThanOrEqual(IMAGE_MIN_SIZE - 1e-6);
  });

  it('最小尺寸由较长边兜底，且保持比例', () => {
    for (const handle of CORNERS) {
      const { dx, dy } = inward(handle, 1e6);
      const r = call(handle, dx, dy);
      expect(Math.max(r.width, r.height)).toBeCloseTo(IMAGE_MIN_SIZE, 6);
      expect(r.width / r.height).toBeCloseTo(base.width / base.height, 6);
    }
  });
});

describe('图片缩放：边手柄自由拉伸单边', () => {
  it('e：只改宽度，左边缘与高度不变', () => {
    const r = call('e', 80, 40);
    expect(r.x).toBeCloseTo(base.x, 6);
    expect(r.y).toBeCloseTo(base.y, 6);
    expect(r.height).toBeCloseTo(base.height, 6);
    expect(r.width).toBeCloseTo(base.width + 80, 6);
  });

  it('s：只改高度，上边缘与宽度不变', () => {
    const r = call('s', 80, 40);
    expect(r.x).toBeCloseTo(base.x, 6);
    expect(r.y).toBeCloseTo(base.y, 6);
    expect(r.width).toBeCloseTo(base.width, 6);
    expect(r.height).toBeCloseTo(base.height + 40, 6);
  });

  it('w / n：移动左 / 上边缘', () => {
    const w = call('w', -30, 0);
    expect(w.x).toBeCloseTo(base.x - 30, 6);
    expect(w.width).toBeCloseTo(base.width + 30, 6);
    expect(w.x + w.width).toBeCloseTo(base.x + base.width, 6);
    const n = call('n', 0, -30);
    expect(n.y).toBeCloseTo(base.y - 30, 6);
    expect(n.height).toBeCloseTo(base.height + 30, 6);
    expect(n.y + n.height).toBeCloseTo(base.y + base.height, 6);
  });

  it('边手柄不锁比例（与角手柄语义区分）', () => {
    const r = call('e', 0, 100);
    expect(r.width).toBeCloseTo(base.width, 6);
    expect(r.height).toBeCloseTo(base.height, 6); // e 手柄不吃 dy
    const e = call('e', 200, 0);
    expect(e.width / e.height).not.toBeCloseTo(base.width / base.height, 3);
  });

  it('边手柄不会退化成 0 尺寸', () => {
    const r = call('e', -1e6, 0);
    expect(r.width).toBeGreaterThanOrEqual(1);
  });
});
