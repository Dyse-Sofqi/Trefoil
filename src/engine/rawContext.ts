/**
 * 从 Konva 的场景回调参数里取出原生 2D 上下文。
 *
 * Konva 的 `Context` 是逐方法代理的包装（每次 moveTo / fillText 都要多走一层 JS 调用与属性查找），
 * 大量逐图元绘制时开销可观。底层上下文实际可达，因此直接用它。
 */
export function rawContext(kctx: unknown): CanvasRenderingContext2D {
  const c = kctx as { _context?: CanvasRenderingContext2D; canvas?: HTMLCanvasElement };
  if (c._context) return c._context;
  if (c.canvas) {
    const r = c.canvas.getContext('2d');
    if (r) return r;
  }
  // 最后手段：走 Konva 封装（仅当底层不可达时，旧版 Konva 兜底）
  return kctx as CanvasRenderingContext2D;
}
