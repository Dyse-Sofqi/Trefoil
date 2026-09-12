/**
 * 拖放载荷解析（纯逻辑层：不 import obsidian，可直接单测）。
 *
 * 这里的所有设计都围绕浏览器的一条硬约束：
 *
 * **`dragover` 阶段 dataTransfer 处于「保护模式」，`getData()` 一律返回空串**，
 * 只有 `types` 与 `files` 可读。所以「这次拖拽能不能接收」必须在 `dragover` 阶段
 * 靠类型信息判断（否则不 `preventDefault()`，浏览器根本不会派发 `drop`），
 * 真正的载荷要等到 `drop` 阶段才能取。
 *
 * 另外，Obsidian 内部拖拽（文件管理器 / 搜索结果 / 内链）**不把路径写进 dataTransfer**：
 * 它写入的是 `obsidian://open?vault=..&file=..` 这样的 URL，真正的载荷挂在
 * `app.dragManager.draggable` 这个全局对象上（Obsidian 自己的视图也是读它）。
 * 因此 `text/plain` 不能当作库内路径来解析 —— 见 `vaultPathFromDragText`。
 */
import { isImagePath, normalizeVaultPath } from './attachment';

/** File 是否为可渲染的图片：优先 MIME，MIME 缺失时退回扩展名（部分平台 dragover 阶段 type 为空） */
export function fileLooksLikeImage(f: File): boolean {
  if (f.type) return f.type.startsWith('image/') && !f.type.includes('svg');
  return isImagePath(f.name);
}

/**
 * 是否为「携带图片文件」的拖拽（`dragover` 阶段可读的信息）。
 * 只能识别系统文件管理器的拖入 —— Obsidian 内部拖拽的 dataTransfer 里没有 File 对象，
 * 需要宿主另行判断（见 `HostAdapter.canDropImages`）。
 */
export function isImageFileDrag(e: DragEvent): boolean {
  const files = e.dataTransfer?.files;
  if (!files?.length) return false;
  for (const f of Array.from(files)) {
    if (fileLooksLikeImage(f)) return true;
  }
  return false;
}

/** `drop` 阶段取拖拽文本：`text/uri-list` 优先（Obsidian 内部拖拽写的是 obsidian:// URL） */
export function dragText(e: DragEvent): string {
  const dt = e.dataTransfer;
  if (!dt) return '';
  return dt.getData('text/uri-list') || dt.getData('text/plain') || '';
}

/** 拖拽文本 → 候选库内路径；非库内路径（http/data/blob/file/app）返回 null */
export function vaultPathFromDragText(text: string): string | null {
  const t = (text ?? '').trim();
  if (!t) return null;
  if (/^obsidian:\/\//i.test(t)) {
    // obsidian://open?vault=X&file=<库内路径>；只认 file 参数，避免把库名当路径
    const m = /[?&]file=([^&]*)/i.exec(t);
    if (!m) return null;
    try {
      // 用 decodeURIComponent 而不是 URLSearchParams：后者会把文件名里的 '+' 还原成空格
      return normalizeVaultPath(decodeURIComponent(m[1]));
    } catch {
      return null;
    }
  }
  if (/^(https?|data|blob|file|app):/i.test(t)) return null;
  return normalizeVaultPath(t);
}
