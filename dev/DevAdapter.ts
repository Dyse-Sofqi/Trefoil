/** 浏览器开发测试台：localStorage 持久化 + 下载导出，无需 Obsidian */
import type { DroppedImages, HostAdapter } from '../src/app/host';
import { readPalette } from '../src/engine/palette';
import { dragText, fileLooksLikeImage, isImageFileDrag } from '../src/core/dragDrop';

const STORAGE_KEY = 'trefoil-dev-doc';
const IMAGES_KEY = 'trefoil-dev-images';
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

export class DevAdapter implements HostAdapter {
  fileName = 'trefoil-dev';
  /** dev:// URL → (data URL) —— 替代 Obsidian 资源服务器；不足 3MB 才落 localStorage */
  private images = new Map<string, string>();

  async load(): Promise<string | null> {
    const doc = localStorage.getItem(STORAGE_KEY);
    // 恢复图片表（旧会话粘贴的图片仍在库里可复用）
    try {
      this.images = new Map(JSON.parse(localStorage.getItem(IMAGES_KEY) ?? '{}'));
    } catch {
      this.images = new Map();
    }
    return doc;
  }

  async save(text: string): Promise<void> {
    localStorage.setItem(STORAGE_KEY, text);
  }

  palette(): ReturnType<typeof readPalette> {
    const dark = new URLSearchParams(location.search).get('theme') === 'dark';
    // 深色变量定义在 dev.css 的 .theme-dark 下，靠 class 切换（避免逐个内联赋值）。
    // class 挂 body（与 Obsidian 一致）——CanvasApp.themeKind() 读的就是 body 上的 theme-dark
    document.body.classList.toggle('theme-dark', dark);
    return readPalette(document.body);
  }

  async saveFile(name: string, data: string, mime: string): Promise<void> {
    const a = document.createElement('a');
    a.href = mime === 'image/png' ? data : 'data:' + mime + ';charset=utf-8,' + encodeURIComponent(data);
    a.download = name;
    a.click();
  }

  toast(msg: string): void {
    const el = document.createElement('div');
    el.textContent = msg;
    el.classList.add('trefoil-dev-toast');
    document.body.appendChild(el);
    window.setTimeout(() => {
      el.classList.add('trefoil-dev-toast--hiding');
      window.setTimeout(() => el.remove(), 400);
    }, 2200);
  }

  // ---- 图片 / 附件（dev 回退：dev:// URL ↔ localStorage data URL） ----

  resolveImageUrl(rawPath: string): string | null {
    if (/^(https?|data|blob|app|file):/i.test(rawPath)) return rawPath;
    return this.images.get(rawPath) ?? null;
  }

  async saveAttachment(blob: Blob, fileName: string): Promise<string | null> {
    const dataUrl = await readAsDataUrl(blob).catch(() => null);
    if (!dataUrl) {
      this.toast('读取粘贴图片失败');
      return null;
    }
    const path = `dev/${fileName}`;
    if (dataUrl.length <= MAX_IMAGE_BYTES) {
      this.images.set(path, dataUrl);
      localStorage.setItem(IMAGES_KEY, JSON.stringify(Object.fromEntries(this.images)));
    }
    this.toast(`已粘贴图片（开发环境：${path}）`);
    return path;
  }

  revealFile(vaultPath: string): void {
    this.toast(`开发环境无法打开系统文件管理器：${vaultPath}`);
  }

  /**
   * 开发环境没有 Obsidian 的 dragManager：只认系统文件与 dataTransfer 里的图片 URL。
   * URL 拖拽在 dragover 阶段读不到内容（保护模式），只能靠 `text/uri-list` 类型放行，
   * 非图片的 URL 会在 drop 阶段被过滤掉 —— 测试台里没有别的落点处理者，放行无害。
   */
  canDropImages(e: DragEvent): boolean {
    const dt = e.dataTransfer;
    return isImageFileDrag(e) || !!dt?.types?.includes('text/uri-list');
  }

  async pickDroppedImages(e: DragEvent): Promise<DroppedImages> {
    const out: DroppedImages = { paths: [], files: [] };
    if (e.dataTransfer?.files?.length) {
      for (const f of Array.from(e.dataTransfer.files)) {
        if (fileLooksLikeImage(f)) out.files.push({ blob: f, fileName: f.name || 'Pasted image.png' });
      }
    }
    // 浏览器拖入的图片 URL（从网页拖图到画布）：抓成 blob 后按附件落盘
    if (!out.files.length) {
      const url = imageUrlOf(e);
      if (url) {
        try {
          const resp = await fetch(url, { mode: 'cors' });
          if (resp.ok) {
            out.files.push({ blob: await resp.blob(), fileName: url.split('/').pop()?.split('?')[0] || 'Pasted image.png' });
          }
        } catch {
          /* 跨域拖图失败：忽略 */
        }
      }
    }
    return out;
  }
}

/** dataTransfer 里指向图片的 URL（http(s) 直链） */
function imageUrlOf(e: DragEvent): string | null {
  const url = dragText(e).split(/\r?\n/).find((l) => l.trim() && !l.startsWith('#')) ?? '';
  return /^https?:\/\/.*\.(png|jpe?g|gif|webp|bmp|avif)(\?|#|$)/i.test(url.trim()) ? url.trim() : null;
}

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error('read blob failed'));
    r.readAsDataURL(blob);
  });
}