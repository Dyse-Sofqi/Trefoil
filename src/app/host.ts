/** 宿主适配器接口：隔离 Obsidian 与浏览器开发环境差异 */
import type { Palette } from '../engine/palette';
import type { TrefoilSettings } from '../core/defaults';

/** 拖放解析结果：库内已有图片按路径引用，系统拖入的新图片按附件约定落盘 */
export interface DroppedImages {
  /** 库内已存在的图片路径（Obsidian 内部拖拽）：直接建节点引用，不复制文件 */
  paths: string[];
  /** 来自系统文件管理器的新图片：需要落盘 */
  files: { blob: Blob; fileName: string }[];
}

export interface HostAdapter {
  /** 读取画布文件内容（JSON Canvas 文本），不存在返回 null */
  load(): Promise<string | null>;
  /** 保存画布文件 */
  save(text: string): Promise<void>;
  palette(): Palette;
  /** 主题（深/浅色）变化回调，返回取消函数 */
  onThemeChange?(cb: () => void): () => void;
  /** 导出文件（宿主决定保存方式） */
  saveFile?(name: string, data: string, mime: string): Promise<void>;
  /** 持久化设置默认值（设置面板修改后防抖调用） */
  saveDefaults?(settings: TrefoilSettings): Promise<void>;
  toast?(msg: string): void;
  /** 宿主显示名称（导出文件默认名） */
  fileName?: string;

  // ---- 图片 / 附件（遵循 Obsidian 附件约定） ----

  /**
   * file 节点 `file` 字段 → 可直接加载的图片 URL。
   * 输入是库内路径或纯 https/data/blob URL；找不到文件返回 null。
   */
  resolveImageUrl?(rawPath: string): string | null;

  /**
   * 保存粘贴的图片 blob（宿主按 Obsidian 附件配置落盘并去重命名），
   * 返回库内路径；不支持时返回 null（调用方回退 data URL 内嵌）。
   */
  saveAttachment?(blob: Blob, fileName: string): Promise<string | null>;

  /** 在系统文件管理器中显示该库文件（仅桌面端 Obsidian 实现） */
  revealFile?(vaultPath: string): void;

  /**
   * 拖拽悬停（`dragover`/`dragenter`）时判断能否接收。
   *
   * 必须在 `dragover` 阶段就能给出答案：此时浏览器禁用了 `dataTransfer.getData()`，
   * 拿不到载荷内容；而只有 `preventDefault()` 了，浏览器才会派发 `drop`。
   * 所以实现只能依据 `dataTransfer.types`/`files` 与宿主自身的拖拽状态判断
   * （Obsidian 内部拖拽要看 `app.dragManager.draggable`，其 dataTransfer 里没有 File 对象）。
   */
  canDropImages?(e: DragEvent): boolean;

  /**
   * 宿主内拖放（Obsidian 文件管理器/其它面板拖图片到画布 / 系统文件拖入）。
   * 库内已有文件返回路径（不复制），系统新文件返回 blob（调用方落盘）。
   */
  pickDroppedImages?(e: DragEvent): Promise<DroppedImages>;
}
