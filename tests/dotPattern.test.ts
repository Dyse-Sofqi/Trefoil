import { describe, expect, it } from 'vitest';
import { dotPatternTransform, mod } from '../src/engine/dotPattern';

describe('点阵图块平铺（dotPatternTransform）', () => {
  it('mod 结果恒非负', () => {
    expect(mod(-1, 6)).toBeCloseTo(5, 10);
    expect(mod(-6.5, 6)).toBeCloseTo(5.5, 10);
    expect(mod(7.2, 6)).toBeCloseTo(1.2, 10);
  });

  it('k 把整数设备像素图块缩回精确周期（小数步长不丢精度）', () => {
    for (const step of [6, 7.2, 9.6, 12.0001, 120]) {
      const tileSize = Math.ceil(step * 2);
      const { k } = dotPatternTransform(step, tileSize, 0, 0, 1);
      expect(k * tileSize).toBeCloseTo(step, 10);
    }
  });

  it('世界格点映射到屏幕后正好落在图块格心（含负视口与小数缩放）', () => {
    const spacing = 24;
    for (const scale of [0.25, 0.3, 0.4, 0.5, 1, 2.37]) {
      const step = spacing * scale;
      const tileSize = Math.ceil(step * 2);
      for (const [vx, vy] of [
        [0, 0],
        [-1234.5, 987.25],
        [3000, -42],
        [0.3, -0.7],
      ]) {
        const { offX, offY } = dotPatternTransform(step, tileSize, vx, vy, scale);
        for (let m = -20; m <= 20; m++) {
          const sx = (m * spacing - vx) * scale;
          const sy = (m * spacing - vy) * scale;
          // 点心 = 平铺原点 + 半个周期 + n 个周期
          const rx = mod(sx - offX - step / 2, step);
          const ry = mod(sy - offY - step / 2, step);
          expect(Math.min(rx, step - rx)).toBeLessThan(1e-6);
          expect(Math.min(ry, step - ry)).toBeLessThan(1e-6);
        }
      }
    }
  });

  it('平移时偏移随之移动，保证点阵跟着画布走', () => {
    const step = 12;
    const a = dotPatternTransform(step, 12, 0, 0, 0.5);
    const b = dotPatternTransform(step, 12, 24, 0, 0.5);
    // 视口右移一个世界间距 = 屏幕右移一个 step，偏移回到同一格点
    expect(mod(b.offX - a.offX, step)).toBeCloseTo(0, 10);
    const c = dotPatternTransform(step, 12, 4, 0, 0.5);
    expect(mod(c.offX - a.offX, step)).toBeCloseTo(step - 2, 10);
  });
});
