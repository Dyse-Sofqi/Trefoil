/**
 * 编辑态可见性回归：文字编辑时画布本体与 DOM 覆盖层的分工。
 *
 * 回归背景：编辑中的节点曾被一律保持可见（只藏内嵌文字），而 `NodeView.drawText`
 * 并不读 textHidden —— 文本节点于是与覆盖层的 DOM 文本重叠，出现重影。
 */
import { describe, expect, it } from 'vitest';
import { Document } from '../src/core/Document';
import { editingNodeVisibility } from '../src/engine/editVisibility';

const textNode = () => Document.newNode({ id: 't', type: 'text', x: 0, y: 0, width: 200, height: 36, text: '甲' });
const rectNode = () =>
  Document.newNode({ id: 'r', type: 'trefoil/shape', shape: 'rect', x: 0, y: 0, width: 120, height: 80, text: '乙' });
const arrowNode = () =>
  Document.newNode({ id: 'a', type: 'trefoil/shape', shape: 'arrow', x: 0, y: 0, width: 120, height: 80 });
const containerNode = () =>
  Document.newNode({ id: 'c', type: 'trefoil/container', x: 0, y: 0, width: 300, height: 200, text: '容器' });

describe('editingNodeVisibility：编辑态让位给覆盖层', () => {
  it('编辑中的文本节点整体隐藏（否则画布文字/边框与覆盖层叠成重影）', () => {
    const vis = editingNodeVisibility(textNode(), true, true, true);
    expect(vis.hidden).toBe(true);
    expect(vis.textHidden).toBe(false);
  });

  it('编辑中的闭合图形保留本体、只藏内嵌文字（覆盖层透明，形状要透出来）', () => {
    const vis = editingNodeVisibility(rectNode(), true, true, true);
    expect(vis.hidden).toBe(false);
    expect(vis.textHidden).toBe(true);
  });

  it('编辑中的容器与线类不保留本体（它们的文字走关系描述/名片，不走内嵌文字）', () => {
    for (const n of [containerNode(), arrowNode()]) {
      expect(editingNodeVisibility(n, true, true, true)).toEqual({ hidden: true, textHidden: false });
    }
  });

  it('编辑中但已移出视口：仍然隐藏', () => {
    expect(editingNodeVisibility(rectNode(), true, true, false).hidden).toBe(true);
  });

  it('非编辑态：跟随模型隐藏状态，且不藏内嵌文字', () => {
    expect(editingNodeVisibility(textNode(), false, false, true)).toEqual({ hidden: false, textHidden: false });
    expect(editingNodeVisibility(textNode(), false, true, true)).toEqual({ hidden: true, textHidden: false });
    expect(editingNodeVisibility(textNode(), false, false, false).hidden).toBe(true);
  });

  it('退出编辑后闭合图形的内嵌文字恢复可见', () => {
    const n = rectNode();
    expect(editingNodeVisibility(n, true, true, true).textHidden).toBe(true);
    expect(editingNodeVisibility(n, false, false, true).textHidden).toBe(false);
  });
});
