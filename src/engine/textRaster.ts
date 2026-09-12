/**
 * 文本节点的位图缓存。
 *
 * 逐帧按「行 × 片段」调 fillText，开销与节点数成正比；而可见节点数随缩放下降按 1/scale² 增长，
 * 几百个文本节点时单帧就要上万次 fillText（外加同样次数的 font/fillStyle 赋值）。
 * 改为把每个文本节点光栅化成位图，命中缓存时每帧只剩一次 drawImage。
 *
 * 三个关键设计：
 *
 * 1. **分辨率分档**：每世界单位需要的光栅像素数 = 视口缩放 × 设备像素比。按 1.5 的幂向上取整，
 *    只降采样不升采样（画面不会糊），且跨档才重画 —— 整个缩放区间只重画 O(log) 次。
 * 2. **滞回复用**：记 e = 所需分辨率对应的理想档位指数，则「e ≤ 缓存指数 ≤ e + 1」且「缓存档位 ≥ needed」
 *    就继续用 —— 也就是「绝不欠采样（否则字会糊）」且「最多比理想档位高一档」。缩小方向因此可以一路
 *    复用旧位图，放大方向只有真正要糊了才升档重画。判定在**指数空间**做整数比较，
 *    避免 1.5⁻¹ × 1.5 = 0.9999999999999999 这类浮点边界把复用误判成重画。
 *    这里必须是**真滞回**（进出条件不同），不能写成 T ≤ needed × 1.5：后者与 T 的档位区间
 *    恒等，等价于「档位完全相同才复用」，于是每次跨档都要重画。而全画布节点共享同一个视口缩放，
 *    跨档时几百个节点会在同一帧里集体重画，正好在缩放手势收尾时制造一次掉帧。
 * 3. **预算内准入，而不是 LRU 淘汰**：总像素超预算时只淘汰「最近若干毫秒没被画过」的条目；
 *    若仍不够，本次直接不缓存、交给调用方走矢量绘制。若改用 LRU 强行淘汰，
 *    超预算的工作集会让节点每帧被踢出又重画，反而比矢量绘制更慢。
 *
 * 内存量级：所有可见节点的光栅像素之和 ≈ 屏幕设备像素 × 文本节点覆盖率 ×（档位/所需）²，
 * 后者上限 (1.5²)² ≈ 5.1（滞回允许高一档，档位本身又向上取整一档），
 * 所以总量仍有界、与缩放级别无关；真正的兜底是下面的总预算，超了就退回矢量绘制。
 */

/** 光栅档位比：向上取整到 1.5 的幂 */
export const RASTER_RATIO = 1.5;
/** 单节点光栅像素上限：高倍缩放下大节点会到几百万像素，超过就不值得缓存 */
export const MAX_ENTRY_PX = 2_000_000;
/** 全部节点光栅的总像素预算（约 48MB @ 4B/px） */
export const DEFAULT_BUDGET_PX = 12_000_000;
/** 超过这么久没被画过的条目视为离屏，可在预算紧张时淘汰 */
const STALE_MS = 250;

const defaultNow = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** 所需分辨率 → 光栅档位指数（1.5 的幂次，向上取整）。
 *  末尾减 1e-9：恰好落在档位上的值（如 1.0、2.25）因浮点误差算出略大于整数时，不该再升一档。 */
function tierExponent(needed: number): number {
  return Math.ceil(Math.log(Math.max(needed, 1e-4)) / Math.log(RASTER_RATIO) - 1e-9);
}

/** 所需分辨率 → 光栅档位（1.5 的幂，向上取整） */
export function rasterScaleFor(needed: number): number {
  return Math.pow(RASTER_RATIO, tierExponent(needed));
}

export interface TextRaster {
  canvas: HTMLCanvasElement;
  /** 每世界单位的光栅像素数（把画布尺寸换算回世界单位用） */
  scale: number;
}

/** 把文本画到给定上下文；scale 为光栅倍率（1 = 世界坐标直绘） */
export type TextRasterPainter = (g: CanvasRenderingContext2D, scale: number) => void;

interface Entry extends TextRaster {
  px: number;
  /** 档位指数（1.5 的幂次）：滞回判定在指数空间做整数比较，避开浮点边界 */
  exp: number;
  /** 视觉状态标识：文本/宽高/字体/颜色等一变就重画 */
  state: string;
  lastSeen: number;
}

export class TextRasterCache {
  private entries = new Map<string, Entry>();
  private usedPx = 0;

  constructor(
    private budgetPx: number = DEFAULT_BUDGET_PX,
    private now: () => number = defaultNow,
  ) {}

  /**
   * 取（必要时重建）节点的文本位图。
   * 返回 null 表示本次不值得缓存，调用方应回退到矢量绘制。
   */
  get(
    nodeId: string,
    state: string,
    needed: number,
    width: number,
    height: number,
    paint: TextRasterPainter,
  ): TextRaster | null {
    const now = this.now();
    const prev = this.entries.get(nodeId);
    const exp = tierExponent(needed);
    // 滞回：理想档位 ≤ 缓存档位 ≤ 理想档位 + 1（不欠采样，且最多高一档）→ 缩小方向一路复用
    if (prev && prev.state === state && prev.exp >= exp && prev.exp <= exp + 1 && prev.scale >= needed) {
      prev.lastSeen = now;
      return prev;
    }

    const scale = Math.pow(RASTER_RATIO, exp);
    const w = Math.max(1, Math.ceil(width * scale));
    const h = Math.max(1, Math.ceil(height * scale));
    const px = w * h;
    if (px > MAX_ENTRY_PX) {
      this.drop(nodeId);
      return null;
    }
    if (this.usedPx + px > this.budgetPx) {
      this.evictStale(now);
      if (this.usedPx + px > this.budgetPx) {
        this.drop(nodeId);
        return null;
      }
    }

    // 复用同一个 canvas 元素：给 width 赋值会重置并清空位图
    const canvas = prev?.canvas ?? document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext('2d');
    if (!g) {
      this.drop(nodeId);
      return null;
    }
    paint(g, scale);

    if (prev) this.usedPx -= prev.px;
    const entry: Entry = { canvas, scale, exp, px, state, lastSeen: now };
    this.entries.set(nodeId, entry);
    this.usedPx += px;
    return entry;
  }

  drop(nodeId: string): void {
    const e = this.entries.get(nodeId);
    if (!e) return;
    this.usedPx -= e.px;
    this.entries.delete(nodeId);
  }

  clear(): void {
    this.entries.clear();
    this.usedPx = 0;
  }

  /** 淘汰长时间没被画过的条目（离屏节点），只回收不新增，因此不会引起抖动 */
  private evictStale(now: number): void {
    for (const [id, e] of this.entries) {
      if (now - e.lastSeen > STALE_MS) this.drop(id);
    }
  }

  get stats(): { count: number; usedPx: number } {
    return { count: this.entries.size, usedPx: this.usedPx };
  }
}
