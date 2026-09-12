/** Svelte 5 Runes 全局 UI 状态（视图层与引擎层通过事件/此状态通信） */
import type { ContextMenuInfo } from '../tools/types';
import type { MenuItem } from './contextMenu';
import { DEFAULT_SETTINGS, mergeSettings, type TrefoilSettings, type ViewMode } from '../core/defaults';

export const ui = $state({
  ready: false,
  activeTool: 'select',
  editingNodeId: null as string | null,
  /** 待重命名的容器 id：属性面板据此聚焦名称输入框 */
  renameTarget: null as string | null,
  contextMenu: null as { sx: number; sy: number; items: MenuItem[] } | null,
  settingsOpen: false,
  helpOpen: false,
  propsOpen: true,
  /** 右下角画布缩略图（Minimap）显隐开关 */
  minimapOpen: true,
  viewMode: 'normal' as ViewMode,
  zoom: 1,
  selectionCount: 0,
  /** 数据/选择版本号：驱动 Svelte 侧对 Document 的派生读取 */
  rev: 0,
  /** 视口版本号：平移/缩放时递增，编辑覆盖层据此跟随 */
  vpRev: 0,
  elementCount: 0,
});

export const settings = $state<TrefoilSettings>(mergeSettings(DEFAULT_SETTINGS));

export function updateStatus(opts: { zoom?: number; elementCount?: number; selectionCount?: number; viewMode?: ViewMode; activeTool?: string }): void {
  if (opts.zoom !== undefined) ui.zoom = opts.zoom;
  if (opts.elementCount !== undefined) ui.elementCount = opts.elementCount;
  if (opts.selectionCount !== undefined) ui.selectionCount = opts.selectionCount;
  if (opts.viewMode !== undefined) ui.viewMode = opts.viewMode;
  if (opts.activeTool !== undefined) ui.activeTool = opts.activeTool;
}

export function bumpRev(): void {
  ui.rev++;
}

export function closeContextMenu(): void {
  ui.contextMenu = null;
}
