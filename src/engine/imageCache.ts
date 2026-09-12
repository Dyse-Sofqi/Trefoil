/**
 * 图片加载缓存：同一 URL 只加载一次，多个 file 节点共享；
 * 加载失败（文件被删/路径失效）也缓存为 null，避免滚动回来反复请求。
 * NodeView 持有一个 Loader（由 CanvasApp → Engine 注入），notify 在图片就绪时触发重绘。
 */

export type ImageLoadResult = HTMLImageElement | null;

export interface ImageLoader {
  /** 给定 URL 加载图片，resolve(null) 表示加载失败（调用方自行决定要不要缓存失败） */
  loadImage(url: string): Promise<ImageLoadResult>;
  /** 图片就绪（成功或失败，URL 为 key）时通知画布重绘 */
  notify(url: string): void;
  /** 重新加载同一个 URL（外部文件变更后手动刷新） */
  reload(url: string): void;
}

export function createImageCache(loader: ImageLoader): {
  /** 取图片：缓存命中直接返回；未命中发起加载并监听通知 */
  get(url: string): ImageLoadResult | 'pending';
  /** 命中缓存（含失败缓存） */
  has(url: string): boolean;
  /** 返回失败缓存条目，供显示缺失占位 */
  isBroken(url: string): boolean;
  /** 清空全部缓存（资源失效时调用） */
  clear(): void;
} {
  const cache = new Map<string, HTMLImageElement | null>();

  return {
    get(url) {
      // 空 URL = 宿主已判定文件缺失（或节点没有 file 字段），直接按失败处理，不再发请求
      if (!url) return null;
      const hit = cache.get(url);
      if (hit !== undefined) return hit;
      void loader
        .loadImage(url)
        .then((img) => {
          // 失败也缓存：缺失文件不重复请求
          cache.set(url, img);
          loader.notify(url);
        })
        .catch(() => {
          cache.set(url, null);
          loader.notify(url);
        });
      return 'pending';
    },
    has(url) {
      return cache.has(url);
    },
    isBroken(url) {
      return cache.get(url) === null;
    },
    clear() {
      cache.clear();
    },
  };
}

/** createImageCache 的返回类型（供消费方声明依赖注入的类型） */
export type ImageCache = ReturnType<typeof createImageCache>;