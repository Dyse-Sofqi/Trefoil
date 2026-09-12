/**
 * 附件约定（与 Obsidian「文件与链接 → 新附件的默认位置」保持一致）。
 *
 * 本模块是纯逻辑层（不 import obsidian），解析规则与命名规则可单测：
 * - `attachmentFolderPath` 配置值语义见 `resolveAttachmentFolder`。
 * - 文件名沿用 Obsidian 的 `Pasted image YYYYMMDDHHmmss`（本地时间）。
 */

/** 库内路径片段清理：反斜杠归一、去首尾斜杠、压缩重复斜杠 */
export function normalizeVaultPath(p: string): string {
  return p
    .replace(/\\/g, '/')
    .replace(/\/{2,}/g, '/')
    .replace(/^\/+|\/+$/g, '');
}

/** 画布所在文件夹（库内相对路径；根目录为 ''） */
export function folderOf(canvasPath: string): string {
  const p = normalizeVaultPath(canvasPath);
  const i = p.lastIndexOf('/');
  return i < 0 ? '' : p.slice(0, i);
}

/**
 * 解析附件目录（库内相对路径，'' = 库根）。
 * `config` 即 Obsidian 的 `attachmentFolderPath`：
 * - `''` / `'/'` → 库根
 * - `'./'` → 当前笔记所在文件夹
 * - `'./sub'` → 当前笔记文件夹下的 sub
 * - 其它 → 视为库内绝对路径
 */
export function resolveAttachmentFolder(config: string | null | undefined, canvasPath: string): string {
  const raw = (config ?? '').trim().replace(/\\/g, '/');
  if (!raw || raw === '/') return '';
  const base = folderOf(canvasPath);
  if (raw === '.' || raw === './') return base;
  if (raw.startsWith('./')) {
    const sub = normalizeVaultPath(raw.slice(2));
    return sub ? (base ? `${base}/${sub}` : sub) : base;
  }
  return normalizeVaultPath(raw);
}

const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
  'image/tiff': 'tiff',
};

const EXT_BY_MIME = MIME_EXT;

/** MIME → 扩展名（未知类型回退 png） */
export function extensionForMime(mime: string): string {
  return EXT_BY_MIME[(mime || '').toLowerCase()] ?? 'png';
}

/** 从文件名里取扩展名（无则回退 MIME 推断） */
export function extensionForFile(fileName: string | undefined, mime: string): string {
  const m = /\.([a-z0-9]{1,8})$/i.exec(fileName ?? '');
  if (m) return m[1].toLowerCase();
  return extensionForMime(mime);
}

function pad2(v: number): string {
  return v < 10 ? `0${v}` : String(v);
}

/** 本地时间戳 `YYYYMMDDHHmmss`（与 Obsidian 生成的时间戳格式一致） */
export function stamp(d = new Date()): string {
  return (
    `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}` +
    `${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`
  );
}

/**
 * 粘贴图片的默认文件名：`Pasted image YYYYMMDDHHmmss.<ext>`
 * （Obsidian 画布粘贴图片用的就是这个名字，用户一看即知来源）
 */
export function pastedImageName(ext = 'png', d = new Date()): string {
  const e = (ext || 'png').replace(/^\./, '');
  return `Pasted image ${stamp(d)}.${e}`;
}

/** 拼接库内路径 */
export function joinVaultPath(folder: string, name: string): string {
  const f = normalizeVaultPath(folder);
  const n = normalizeVaultPath(name);
  return f ? `${f}/${n}` : n;
}

/**
 * 去重：`name.ext` 已存在时依次尝试 `name 1.ext`、`name 2.ext`…（与 Obsidian 一致）。
 * `exists` 由宿主提供（Obsidian 传 1.5.7+ 的 `getAvailablePathForAttachment`，其余情况走这里）。
 */
export function dedupeName(name: string, exists: (candidate: string) => boolean, limit = 400): string {
  if (!exists(name)) return name;
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let i = 1; i <= limit; i++) {
    const candidate = `${base} ${i}${ext}`;
    if (!exists(candidate)) return candidate;
  }
  return `${base} ${Date.now()}${ext}`;
}

/** 图片直链（非库内路径）判定：http(s)/data/blob/app 协议 */
export function isDirectImageUrl(src: string): boolean {
  return /^(https?|data|blob|app|file):/i.test((src ?? '').trim());
}

/** 是否为本插件可渲染的图片扩展名 */
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif'] as const;

export function isImagePath(path: string): boolean {
  return /\.(png|jpe?g|gif|webp|bmp|avif)$/i.test((path ?? '').trim());
}
