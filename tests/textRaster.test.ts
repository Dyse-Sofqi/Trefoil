import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MAX_ENTRY_PX, RASTER_RATIO, TextRasterCache, rasterScaleFor } from '../src/engine/textRaster';

const fakeCtx = {} as CanvasRenderingContext2D;

function stubDocument() {
  const canvases: { width: number; height: number }[] = [];
  (globalThis as Record<string, unknown>).document = {
    createElement: () => {
      const c = { width: 0, height: 0, getContext: () => fakeCtx };
      canvases.push(c);
      return c;
    },
  };
  return canvases;
}

/** 计数用的绘制函数 */
function counter() {
  const state = { paints: 0, lastScale: 0 };
  return {
    state,
    paint: (_g: CanvasRenderingContext2D, k: number) => {
      state.paints++;
      state.lastScale = k;
    },
  };
}

describe('文本光栅档位（rasterScaleFor）', () => {
  it('永不低于所需分辨率，且不超过一档（1.5 倍）', () => {
    for (const needed of [0.05, 0.2, 0.5, 1, 1.1, 2, 2.25, 7.4, 16]) {
      const k = rasterScaleFor(needed);
      expect(k).toBeGreaterThanOrEqual(needed);
      expect(k / needed).toBeLessThanOrEqual(RASTER_RATIO + 1e-9);
    }
  });

  it('取值落在 1.5 的整数次幂上', () => {
    for (const needed of [0.3, 1, 3, 9]) {
      const k = rasterScaleFor(needed);
      const exp = Math.round(Math.log(k) / Math.log(RASTER_RATIO));
      expect(Math.abs(Math.pow(RASTER_RATIO, exp) - k)).toBeLessThan(1e-9);
    }
  });

  it('恰好落在档位时不额外升档', () => {
    expect(rasterScaleFor(1)).toBeCloseTo(1, 9);
    expect(rasterScaleFor(2.25)).toBeCloseTo(2.25, 9);
  });
});

describe('文本位图缓存', () => {
  let canvases: { width: number; height: number }[];
  beforeEach(() => {
    canvases = stubDocument();
  });
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).document;
  });

  it('首次取用时光栅化，之后同档位直接复用', () => {
    const cache = new TextRasterCache();
    const { state, paint } = counter();
    const first = cache.get('n1', 's1', 1, 100, 40, paint);
    expect(state.paints).toBe(1);
    expect(first?.scale).toBeCloseTo(1, 9);

    // 同一缩放（同 needed）连画 60 帧：不应再有任何光栅化
    for (let i = 0; i < 60; i++) {
      expect(cache.get('n1', 's1', 1, 100, 40, paint)).toBe(first);
    }
    expect(state.paints).toBe(1);
    expect(canvases.length).toBe(1); // 复用同一个 canvas 元素
  });

  it('滞回：缩小方向在一档之内复用，放大方向必然升档重画', () => {
    const cache = new TextRasterCache();
    const { state, paint } = counter();
    cache.get('n1', 's1', 1, 100, 40, paint); // 档位 1
    expect(state.paints).toBe(1);

    // 缩到 0.9：理想档位仍是 1 → 复用
    expect(cache.get('n1', 's1', 0.9, 100, 40, paint)?.scale).toBeCloseTo(1, 9);
    expect(state.paints).toBe(1);

    // 缩到 0.5：理想档位 0.667，缓存高它一档 → 仍复用（旧实现写 T ≤ needed×1.5 会在这里误重画）
    expect(cache.get('n1', 's1', 0.5, 100, 40, paint)?.scale).toBeCloseTo(1, 9);
    expect(state.paints).toBe(1);

    // 缩到 0.4：缓存已比理想档位高出两档 → 降档重画，释放内存
    expect(cache.get('n1', 's1', 0.4, 100, 40, paint)?.scale).toBeCloseTo(0.4444444444444444, 9);
    expect(state.paints).toBe(2);

    // 放大到 1.1：缓存档位不够（不能欠采样）→ 升到 1.5 重画
    expect(cache.get('n1', 's1', 1.1, 100, 40, paint)?.scale).toBeCloseTo(1.5, 9);
    expect(state.paints).toBe(3);

    // 再缩回 1.05：缓存 1.5 只比理想档位 1.5 高 0 档 → 复用，不再重画
    expect(cache.get('n1', 's1', 1.05, 100, 40, paint)?.scale).toBeCloseTo(1.5, 9);
    expect(state.paints).toBe(3);
  });

  it('档位边界上的来回缩放不重画（滞回窗口真的存在）', () => {
    const cache = new TextRasterCache();
    const { state, paint } = counter();
    cache.get('n1', 's1', 0.45, 100, 40, paint); // 理想档位 0.667
    expect(state.paints).toBe(1);
    // 0.444 是 0.667 与 0.444 两档的分界：来回摆动应始终复用
    for (let i = 0; i < 20; i++) {
      cache.get('n1', 's1', 0.45, 100, 40, paint);
      cache.get('n1', 's1', 0.44, 100, 40, paint);
    }
    expect(state.paints).toBe(1);
  });

  it('恰好落在档位上的分辨率不被浮点误差顶到上一档', () => {
    // 0.5 的理想档位是 0.667（= 1.5⁻¹），它 ×1.5 在浮点下是 0.9999999999999999，
    // 若按数值比较会把缓存档位 1.0 判成「高两档」而误重画
    const cache = new TextRasterCache();
    const { state, paint } = counter();
    cache.get('n1', 's1', 1, 100, 40, paint);
    expect(cache.get('n1', 's1', 0.5, 100, 40, paint)?.scale).toBeCloseTo(1, 9);
    expect(state.paints).toBe(1);
  });

  it('视觉状态变化后重画', () => {
    const cache = new TextRasterCache();
    const { state, paint } = counter();
    cache.get('n1', 's1', 1, 100, 40, paint);
    cache.get('n1', 's2', 1, 100, 40, paint); // 文本/字体/颜色变了
    expect(state.paints).toBe(2);
  });

  it('光栅尺寸随档位变化，画布按设备像素分配', () => {
    const cache = new TextRasterCache();
    const { paint } = counter();
    const raster = cache.get('n1', 's1', 2, 100, 40, paint);
    expect(raster?.scale).toBeCloseTo(2.25, 9);
    expect(raster?.canvas.width).toBe(Math.ceil(100 * 2.25));
    expect(raster?.canvas.height).toBe(Math.ceil(40 * 2.25));
  });

  it('单节点超上限时不缓存，交给调用方走矢量绘制', () => {
    const cache = new TextRasterCache();
    const { state, paint } = counter();
    // 2000×1000 世界单位 × 档位 2.25² ≈ 1013 万像素 > 200 万上限
    expect(cache.get('big', 's1', 2, 2000, 1000, paint)).toBeNull();
    expect(state.paints).toBe(0);
    expect(cache.stats.usedPx).toBe(0);
  });

  it('预算满且没有陈旧条目时拒绝新条目（不与 LRU 互相踢出）', () => {
    const cache = new TextRasterCache(100_000, () => 0);
    const { state, paint } = counter();
    // 每个 100×100 × 档位 1 = 1 万像素，预算只装得下 10 个
    for (let i = 0; i < 10; i++) expect(cache.get(`n${i}`, 's', 1, 100, 100, paint)).not.toBeNull();
    expect(state.paints).toBe(10);
    expect(cache.stats.usedPx).toBe(100_000);

    const rejected = cache.get('n10', 's', 1, 100, 100, paint);
    expect(rejected).toBeNull();
    expect(state.paints).toBe(10);
    expect(cache.stats.usedPx).toBe(100_000);
  });

  it('预算满时淘汰已离屏（久未绘制）的条目，为新节点腾位', () => {
    let now = 0;
    const cache = new TextRasterCache(100_000, () => now);
    const { paint } = counter();
    for (let i = 0; i < 10; i++) cache.get(`n${i}`, 's', 1, 100, 100, paint);

    now = 1000; // 超过陈旧阈值
    expect(cache.get('fresh', 's', 1, 100, 100, paint)).not.toBeNull();
    expect(cache.stats.count).toBe(1); // 旧条目全部淘汰，只剩新条目
    expect(cache.stats.usedPx).toBe(10_000);
  });

  it('clear / drop 释放预算', () => {
    const cache = new TextRasterCache();
    const { paint } = counter();
    cache.get('n1', 's', 1, 100, 100, paint);
    cache.get('n2', 's', 1, 100, 100, paint);
    expect(cache.stats.usedPx).toBe(20_000);
    cache.drop('n1');
    expect(cache.stats.usedPx).toBe(10_000);
    cache.clear();
    expect(cache.stats).toEqual({ count: 0, usedPx: 0 });
  });

  it('节点重画后（新实例 uid 不同）不会误用旧位图', () => {
    const cache = new TextRasterCache();
    const { state, paint } = counter();
    cache.get('n1', '7:1', 1, 100, 40, paint);
    cache.get('n1', '8:1', 1, 100, 40, paint); // 视图重建 → 新 uid
    expect(state.paints).toBe(2);
  });

  it('上限常量与档位比的关系符合预期', () => {
    expect(MAX_ENTRY_PX).toBeGreaterThan(100_000);
    expect(RASTER_RATIO).toBeGreaterThan(1);
  });
});
