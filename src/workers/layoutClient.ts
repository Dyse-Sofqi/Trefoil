/**
 * 布局计算客户端：优先使用 Web Worker（内联打包），失败时回退主线程同步计算。
 */
import { computeTreeLayout, type LayoutInput, type LayoutOutput } from '../core/layout';
import WorkerCtor from '../workers/layout.worker?worker&inline';

let worker: Worker | null = null;
let reqId = 0;
const pending = new Map<number, (r: LayoutOutput) => void>();

function ensureWorker(): Worker | null {
  if (worker) return worker;
  try {
    worker = new WorkerCtor();
    worker.onmessage = (ev: MessageEvent) => {
      const res = ev.data as { type: string; id: number; result: LayoutOutput };
      if (res?.type === 'layout') {
        const resolve = pending.get(res.id);
        if (resolve) {
          pending.delete(res.id);
          resolve(res.result);
        }
      }
    };
    worker.onerror = () => {
      worker = null;
    };
    return worker;
  } catch {
    worker = null;
    return null;
  }
}

export async function layoutAsync(input: LayoutInput): Promise<LayoutOutput> {
  const w = ensureWorker();
  if (!w) return computeTreeLayout(input);
  const id = ++reqId;
  return new Promise<LayoutOutput>((resolve) => {
    pending.set(id, resolve);
    w.postMessage({ type: 'layout', id, input });
    // 兜底：worker 无响应 1.5s 后回退同步
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        resolve(computeTreeLayout(input));
      }
    }, 1500);
  });
}

export function layoutSync(input: LayoutInput): LayoutOutput {
  return computeTreeLayout(input);
}
