/** 右键上下文菜单构建（根据点击对象动态变化） */
import type { CanvasApp } from './CanvasApp';
import type { ContextMenuInfo } from '../tools/types';
import { ui } from './ui.svelte';
import type { CanvasNode } from '../core/types';
import { NODE_TYPE_SHAPE } from '../core/types';

export interface MenuItem {
  label?: string;
  hint?: string;
  danger?: boolean;
  disabled?: boolean;
  separator?: boolean;
  checked?: boolean;
  children?: MenuItem[];
  action?: () => void;
}

export function buildContextMenu(app: CanvasApp, info: ContextMenuInfo): MenuItem[] {
  const { doc, settings, clipboard } = app;
  const sel = doc.selectedNodes();

  if (info.pick.kind === 'canvas' && sel.length === 0) {
    return [
      {
        label: '吸附',
        children: [
          { label: '启用吸附', checked: settings.snap.enabled, action: () => (settings.snap.enabled = !settings.snap.enabled) },
          { label: '磁吸网格', checked: settings.snap.gridSnap, action: () => (settings.snap.gridSnap = !settings.snap.gridSnap) },
          { label: '吸附至对象', checked: settings.snap.objectSnap, action: () => (settings.snap.objectSnap = !settings.snap.objectSnap) },
        ],
      },
      {
        label: '查看模式',
        children: (['normal', 'browse', 'focus'] as const).map((m) => ({
          label: viewModeLabel(m),
          checked: settings.viewMode === m,
          disabled: m === 'focus' && doc.selection.size === 0,
          action: () => app.setViewMode(m),
        })),
      },
      {
        label: '背景',
        children: (['solid', 'dots', 'grid'] as const).map((m) => ({
          label: bgLabel(m),
          checked: settings.background.mode === m,
          action: () => (settings.background.mode = m),
        })),
      },
      { separator: true },
      { label: '粘贴元素', disabled: clipboard.isEmpty(), action: () => clipboard.paste(doc, 24, { x: info.wx, y: info.wy }) },
      { label: '粘贴文本', action: () => void pasteSystemText(app, { x: info.wx, y: info.wy }) },
      { label: '粘贴图片', action: () => void pasteSystemImage(app, { x: info.wx, y: info.wy }) },
      { label: '添加文本', action: () => app.quickAddText(info.wx, info.wy) },
      { label: '缩放适应', action: () => app.engine.zoomToFit() },
    ];
  }

  // 有选中内容或点击元素
  const items: MenuItem[] = [];
  const single = sel.length === 1 ? sel[0] : null;
  const clicked =
    info.pick.kind === 'node'
      ? doc.getNode(info.pick.nodeId)
      : info.pick.kind === 'container-band'
        ? doc.getNode(info.pick.containerId)
        : null;

  // 若点击的元素未被选中 → 视为对它的操作
  const target: CanvasNode | null = clicked ?? single;

  if (target?.type === 'text' && !target.containerId) {
    items.push({ label: '编辑文本', hint: '双击', action: () => app.beginPathTextEdit(target.id) });
    items.push({ label: '文本样式…', action: () => (ui.propsOpen = true) });
    items.push({ separator: true });
  }

  // 容器操作
  if (target?.type === 'trefoil/container') {
    items.push({ label: '添加子节点', hint: 'Tab', action: () => app.addChildTo(target.id) });
    items.push({
      label: '自动布局',
      children: [
        { label: '横向树', action: () => app.layoutContainer(target.id, 'horizontal') },
        { label: '纵向树', action: () => app.layoutContainer(target.id, 'vertical') },
      ],
    });
    items.push({
      label: target.collapsed ? '展开全部' : '折叠全部',
      action: () => app.toggleContainerCollapse(target.id),
    });
    items.push({ label: '重命名容器', action: () => app.renameContainer(target.id) });
    items.push({ label: '拆解容器', action: () => app.decomposeContainer(target.id) });
    items.push({ separator: true });
  }

  if (sel.length >= 2) {
    items.push({ label: '组合为容器', action: () => app.composeSelection() });
    items.push({ label: '绑定组', hint: '编队', action: () => app.bindGroup() });
    items.push({ separator: true });
  }
  if (target?.groupId) {
    items.push({ label: '解绑组', action: () => app.unbindGroup(target.groupId!) });
    items.push({ separator: true });
  }

  // 图层顺序
  if (sel.length > 0 || target) {
    const ids = sel.length ? [...doc.selection] : target ? [target.id] : [];
    items.push({
      label: '图层顺序',
      children: [
        { label: '置于顶层', action: () => doc.bringToFront(ids) },
        { label: '置于底层', action: () => doc.sendToBack(ids) },
        { label: '上移一层', action: () => doc.bringForward(ids) },
        { label: '下移一层', action: () => doc.sendBackward(ids) },
      ],
    });
  }

  // 形状翻转
  if (target?.type === NODE_TYPE_SHAPE) {
    const flipIds = sel.length ? [...doc.selection] : [target.id];
    items.push({
      label: '翻转',
      children: [
        { label: '水平翻转', action: () => app.flipSelection('x', flipIds) },
        { label: '垂直翻转', action: () => app.flipSelection('y', flipIds) },
      ],
    });
  }

  items.push({ label: '复制', hint: 'Ctrl+C', action: () => app.copySelection(false) });
  if (sel.length > 0) {
    items.push({ label: '剪切', hint: 'Ctrl+X', action: () => app.copySelection(true) });
    items.push({ label: '删除', hint: 'Delete', danger: true, action: () => app.deleteSelection() });
  }

  return items;
}

function viewModeLabel(m: 'normal' | 'browse' | 'focus'): string {
  return m === 'normal' ? '正常' : m === 'browse' ? '浏览（只读）' : '聚焦';
}

function bgLabel(m: 'solid' | 'dots' | 'grid'): string {
  return m === 'solid' ? '纯色' : m === 'dots' ? '点阵' : '网格';
}

/** 右键菜单：把系统剪贴板文本按行粘贴为文本元素（Ctrl+V 之外的可发现入口） */
async function pasteSystemText(app: CanvasApp, at?: { x: number; y: number }): Promise<void> {
  try {
    const text = (await navigator.clipboard?.readText?.()) ?? '';
    if (!text.trim()) {
      app.adapter.toast?.('剪贴板里没有文本');
      return;
    }
    app.pasteTextAsNodes(text, at);
  } catch {
    app.adapter.toast?.('无法读取系统剪贴板');
  }
}

/** 右键菜单：把系统剪贴板图片粘贴为图片节点（Ctrl+V 之外的可发现入口） */
async function pasteSystemImage(app: CanvasApp, at?: { x: number; y: number }): Promise<void> {
  try {
    const items = await navigator.clipboard?.read?.();
    const item = items?.find((i) => i.types.some((t) => t.startsWith('image/')));
    if (!item) {
      app.adapter.toast?.('剪贴板里没有图片');
      return;
    }
    const type = item.types.find((t) => t.startsWith('image/'))!;
    const blob = await item.getType(type);
    if (!blob) {
      app.adapter.toast?.('剪贴板里没有图片');
      return;
    }
    app.pasteImageBlob(blob, `Pasted image.${type.split('/')[1] ?? 'png'}`, at);
  } catch {
    app.adapter.toast?.('无法读取系统剪贴板');
  }
}
