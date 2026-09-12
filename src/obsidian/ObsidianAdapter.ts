/** Obsidian 宿主适配器：.canvas 文件读写、主题、导出、通知、附件（图片粘贴遵循 Obsidian 约定） */
import { Notice, TFile, TAbstractFile, type Plugin } from 'obsidian';
import type { DroppedImages, HostAdapter } from '../app/host';
import { readPalette, type Palette } from '../engine/palette';
import type { TrefoilSettings } from '../core/defaults';
import type TrefoilPlugin from '../main';
import {
  dedupeName,
  extensionForFile,
  isImagePath,
  joinVaultPath,
  pastedImageName,
  resolveAttachmentFolder,
} from '../core/attachment';
import { dragText, fileLooksLikeImage, isImageFileDrag, vaultPathFromDragText } from '../core/dragDrop';

export class ObsidianAdapter implements HostAdapter {
  /** 正在由本插件写入的内容（避免外部修改事件回环） */
  private savingText: string | null = null;

  constructor(
    private plugin: Plugin,
    public file: TFile,
  ) {}

  fileName = '';

  async load(): Promise<string | null> {
    try {
      return await this.plugin.app.vault.cachedRead(this.file);
    } catch {
      return null;
    }
  }

  async save(text: string): Promise<void> {
    this.savingText = text;
    await this.plugin.app.vault.modify(this.file, text);
  }

  /** 外部修改判断（由视图层在 vault modify 事件中调用） */
  isExternalChange(text: string): boolean {
    return this.savingText === null || text !== this.savingText;
  }

  palette(): Palette {
    return readPalette(document.body);
  }

  get canvasBg(): string {
    return document.body.classList.contains('theme-dark') ? '#1e1e22' : '#ffffff';
  }

  onThemeChange(cb: () => void): () => void {
    const ref = this.plugin.app.workspace.on('css-change', () => cb());
    this.plugin.registerEvent(ref);
    return () => this.plugin.app.workspace.offref(ref);
  }

  async saveFile(name: string, data: string, mime: string): Promise<void> {
    const folder = this.file.parent?.path ?? '';
    const pathParts = [folder, `${this.file.basename} - ${name}`].filter(Boolean);
    const path = pathParts.join('/');
    try {
      if (mime === 'image/png') {
        const base64 = data.split(',')[1] ?? '';
        await this.plugin.app.vault.createBinary(path, base64ToArrayBuffer(base64));
      } else {
        await this.plugin.app.vault.create(path, data);
      }
      new Notice(`已导出：${path}`);
    } catch (err) {
      // 同名文件已存在等情况
      new Notice(`导出失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** 持久化白板内设置面板的默认值 → 插件 data.json */
  async saveDefaults(settings: TrefoilSettings): Promise<void> {
    const plugin = this.plugin as TrefoilPlugin;
    plugin.saveDefaultTrefoilSettings(settings);
  }

  toast(msg: string): void {
    new Notice(msg);
  }

  /** 是否为本插件自身触发的保存 */
  consumeSaving(text: string): boolean {
    if (this.savingText !== null && text === this.savingText) {
      return true;
    }
    return false;
  }

  markSaved(text: string): void {
    this.savingText = text;
    setTimeout(() => {
      if (this.savingText === text) this.savingText = null;
    }, 800);
  }

  // ---------- 图片 / 附件（遵循 Obsidian 附件约定） ----------

  /**
   * file 节点 `file` 字段 → 图片 URL：
   * - https/data/blob/app URL 原样返回；
   * - 库内路径（绝对/相对画布所在文件夹）→ vault.resourcePath（app:// URL）；
   * - 找不到文件返回 null（画布显示缺失占位）。
   */
  resolveImageUrl(rawPath: string): string | null {
    const raw = (rawPath ?? '').trim();
    if (!raw) return null;
    if (/^(https?|data|blob|app|file):/i.test(raw)) return raw;
    if (!isImagePath(raw)) return null;
    const vault = this.plugin.app.vault;
    const f1 = vault.getAbstractFileByPath(raw);
    if (f1 instanceof TFile) return vault.getResourcePath(f1);
    const f2 = this.plugin.app.metadataCache.getFirstLinkpathDest(raw, this.file.path);
    if (f2) return vault.getResourcePath(f2);
    return null;
  }

  /** 粘贴图片落盘：解析附件目录 → 取名（带时间戳，去重）→ createBinary。失败返回 null。 */
  async saveAttachment(blob: Blob, fileName: string): Promise<string | null> {
    try {
      const vault = this.plugin.app.vault;
      const vaultAny = vault as unknown as {
        getAvailablePathForAttachment?: (name: string, sourcePath?: string) => Promise<string>;
      };
      let path: string;
      if (typeof vaultAny.getAvailablePathForAttachment === 'function') {
        // Obsidian ≥1.5.7：按「文件与链接」设置解析附件目录并去重
        path = await vaultAny.getAvailablePathForAttachment(fileName, this.file.path);
      } else {
        const cfg = String(
          (vault as unknown as { getConfig?: (k: string) => unknown }).getConfig?.('attachmentFolderPath') ?? '',
        );
        const folder = resolveAttachmentFolder(cfg, this.file.path);
        const dedupe = (name: string) =>
          dedupeName(name, (c) => !!vault.getAbstractFileByPath(joinVaultPath(folder, c)));
        const unique = dedupe(fileName);
        path = joinVaultPath(folder, unique);
      }
      const buf = await blob.arrayBuffer();
      const f = await vault.createBinary(path, buf);
      this.toast(`已粘贴图片：${f.path}`);
      return f.path;
    } catch (err) {
      this.toast(`保存粘贴图片失败：${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  /** 系统文件管理器显示该附件（vault.showInFolder 属运行时 API，未入 typings） */
  revealFile(vaultPath: string): void {
    const vault = this.plugin.app.vault;
    const f = vault.getAbstractFileByPath(vaultPath);
    if (f instanceof TFile) {
      const v = vault as unknown as { showInFolder?: (file: TFile) => void };
      if (typeof v.showInFolder === 'function') v.showInFolder(f);
      else this.toast(`附件位于：${f.path}`);
    }
  }

  /**
   * 拖放解析：
   * 1) 系统文件管理器拖入（dataTransfer.files 里的图片）→ 新文件，交给调用方落盘；
   * 2) Obsidian 内部拖拽（文件管理器 / 搜索结果 / 内链）→ 库内已有文件，直接按路径引用。
   *
   * 第 2 类的**权威载荷在 `app.dragManager.draggable`，不在 dataTransfer**：
   * Obsidian 拖拽文件时只往 dataTransfer 写了 `obsidian://open?vault=..&file=..`（text/plain 与
   * text/uri-list），所以拿 `text/plain` 当库内路径解析是行不通的。
   * `dragManager.draggable` 在 dragstart 赋值、dragend 清空，因此 dragover / drop 阶段都有效。
   */
  async pickDroppedImages(e: DragEvent): Promise<DroppedImages> {
    const out: DroppedImages = { paths: [], files: [] };
    // 1) 系统文件管理器拖入：新文件
    const osFiles = e.dataTransfer?.files;
    if (osFiles?.length) {
      for (const f of Array.from(osFiles)) {
        if (fileLooksLikeImage(f)) {
          out.files.push({ blob: f, fileName: f.name || pastedImageName(extensionForFile(f.name, f.type)) });
        }
      }
      return out;
    }
    // 2) Obsidian 内部拖拽：库内已有文件，直接引用（不复制）
    const drag = this.obsidianDrag();
    if (drag) {
      for (const f of dragFilesOf(drag)) {
        if (isImagePath(f.path)) out.paths.push(f.path);
      }
    }
    if (out.paths.length) return out;
    // 3) 兜底：解析 dataTransfer 文本里的 obsidian:// URL 或库内路径（text/uri-list 允许 # 注释行）
    for (const line of dragText(e).split(/\r?\n/)) {
      if (!line.trim() || line.startsWith('#')) continue;
      const p = this.resolveVaultImage(line);
      if (p) out.paths.push(p);
    }
    return out;
  }

  /** 拖拽悬停时判断能否接收：dragover 阶段读不到 dataTransfer 内容，只能靠类型与 dragManager 状态 */
  canDropImages(e: DragEvent): boolean {
    if (isImageFileDrag(e)) return true;
    const drag = this.obsidianDrag();
    return !!drag && dragFilesOf(drag).some((f) => isImagePath(f.path));
  }

  /** Obsidian 全局拖拽状态（内部拖拽的真实载荷） */
  private obsidianDrag(): ObsidianDrag | null {
    const app = this.plugin.app as unknown as { dragManager?: { draggable?: ObsidianDrag | null } };
    const d = app.dragManager?.draggable;
    return d && typeof d === 'object' ? d : null;
  }

  /** 拖拽文本 → 库内图片路径：先按库内路径直查，再按短链/裸文件名解析 */
  private resolveVaultImage(text: string): string | null {
    const raw = vaultPathFromDragText(text);
    if (!raw || !isImagePath(raw)) return null;
    const vault = this.plugin.app.vault;
    const direct = vault.getAbstractFileByPath(raw);
    if (direct instanceof TFile) return direct.path;
    const linked = this.plugin.app.metadataCache.getFirstLinkpathDest(raw, this.file.path);
    return linked && isImagePath(linked.path) ? linked.path : null;
  }
}

/** Obsidian `app.dragManager.draggable` 的形状（未入官方 typings，按运行时实测） */
interface ObsidianDrag {
  /** 'file' | 'files' | 'folder' | 'link' | 'bookmarks' … */
  type?: string;
  file?: TAbstractFile;
  files?: TAbstractFile[];
}

/** 拖拽载荷 → 涉及的文件（file / files / link 三种形态归一，文件夹与非文件项剔除） */
function dragFilesOf(d: ObsidianDrag): TFile[] {
  const raw = d.type === 'files' ? (d.files ?? []) : d.file ? [d.file] : [];
  return raw.filter((f): f is TFile => f instanceof TFile);
}


function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}
