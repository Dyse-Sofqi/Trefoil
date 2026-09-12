import { describe, expect, it } from 'vitest';
import { createImageCache, type ImageLoadResult } from '../src/engine/imageCache';

/** 假加载器：记录请求次数，按 urls 决定成功/失败 */
function makeLoader(ok: (url: string) => boolean) {
  const requested: string[] = [];
  let notified = 0;
  const cache = createImageCache({
    loadImage: (url: string): Promise<ImageLoadResult> => {
      requested.push(url);
      return Promise.resolve(ok(url) ? ({ naturalWidth: 4, naturalHeight: 4 } as unknown as HTMLImageElement) : null);
    },
    notify: () => {
      notified++;
    },
    reload: () => cache.clear(),
  });
  return { cache, requested, notifiedCount: () => notified };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('图片缓存（createImageCache）', () => {
  it('空 URL（宿主判定文件缺失）直接返回 null，且不发请求', () => {
    const { cache, requested } = makeLoader(() => true);
    expect(cache.get('')).toBeNull();
    expect(requested).toEqual([]);
  });

  it('未命中先返回 pending，加载成功后返回图片并通知重绘', async () => {
    const { cache, requested, notifiedCount } = makeLoader(() => true);
    expect(cache.get('app://x/a.png')).toBe('pending');
    await flush();
    expect(cache.get('app://x/a.png')).not.toBe('pending');
    expect(requested).toEqual(['app://x/a.png']);
    expect(notifiedCount()).toBe(1);
  });

  it('加载失败缓存为 null：不重复请求，且不再通知', async () => {
    const { cache, requested, notifiedCount } = makeLoader(() => false);
    expect(cache.get('app://x/gone.png')).toBe('pending');
    await flush();
    expect(cache.get('app://x/gone.png')).toBeNull();
    expect(cache.isBroken('app://x/gone.png')).toBe(true);
    expect(requested).toEqual(['app://x/gone.png']);
    expect(notifiedCount()).toBe(1);
  });

  it('clear() 后同一 URL 重新加载', async () => {
    const { cache, requested } = makeLoader(() => true);
    cache.get('app://x/a.png');
    await flush();
    cache.clear();
    expect(cache.has('app://x/a.png')).toBe(false);
    cache.get('app://x/a.png');
    await flush();
    expect(requested).toEqual(['app://x/a.png', 'app://x/a.png']);
  });
});
