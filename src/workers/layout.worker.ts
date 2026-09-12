/** 树形布局 Web Worker：计算密集型任务不在主线程执行。 */
import { computeTreeLayout, type LayoutInput, type LayoutOutput } from '../core/layout';

export interface LayoutRequest {
  type: 'layout';
  id: number;
  input: LayoutInput;
}

export interface LayoutResponse {
  type: 'layout';
  id: number;
  result: LayoutOutput;
}

self.onmessage = (ev: MessageEvent<LayoutRequest>) => {
  const msg = ev.data;
  if (msg?.type === 'layout') {
    const result = computeTreeLayout(msg.input);
    const res: LayoutResponse = { type: 'layout', id: msg.id, result };
    (self as unknown as Worker).postMessage(res);
  }
};
