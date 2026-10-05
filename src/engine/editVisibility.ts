/**
 * 编辑态可见性：画布本体与文字编辑覆盖层（DOM textarea）的职责划分。
 *
 * 覆盖层负责呈现正在编辑的文字，两类节点的分工不同：
 * - **闭合图形**（矩形/椭圆/菱形/三角）：文字内嵌在形状里，覆盖层是**透明**的（只画文字）——
 *   形状本体必须留在画布上；
 * - **文本节点**：覆盖层自带背景 / 边框 / 圆角（所见即所得）—— 本体必须**整体隐藏**，
 *   否则画布上的文字与边框会和覆盖层叠在一起出现重影。
 *
 * 注意 `NodeView.drawText`（文本节点绘制）**不读** textHidden —— 文本节点只能靠整体
 * 隐藏来让位给覆盖层，正是「整体隐藏」这一条漏掉时才出现重影。
 */
import { isClosedShape, type CanvasNode } from '../core/types';

/** 编辑节点在画布上的可见性：hidden = 整个节点是否隐藏，textHidden = 是否只藏内嵌文字 */
export function editingNodeVisibility(
  node: CanvasNode,
  editing: boolean,
  hiddenByModel: boolean,
  inView: boolean,
): { hidden: boolean; textHidden: boolean } {
  const keepBody = editing && isClosedShape(node);
  return {
    // 编辑中的闭合图形绕过模型隐藏（编辑态本就被 isNodeHidden 判为隐藏），但仍在视口裁剪切内
    hidden: (editing ? !keepBody : hiddenByModel) || !inView,
    textHidden: keepBody,
  };
}
