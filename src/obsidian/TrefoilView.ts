/** Trefoil 白板视图：承载 Svelte 应用，负责文件状态与外部修改同步 */
import { ItemView, TFile, WorkspaceLeaf, type EventRef, type ViewStateResult } from 'obsidian';
import { mount, unmount } from 'svelte';
import App from '../app/App.svelte';
import type { CanvasApp } from '../app/CanvasApp';
import { ObsidianAdapter } from './ObsidianAdapter';
import type { TrefoilPluginSettings } from './pluginSettings';
import { trefoilSettingsFromPlugin } from './pluginSettings';
import type TrefoilPlugin from '../main';

export const VIEW_TYPE_TREFOIL = 'trefoil-canvas';

export class TrefoilView extends ItemView {
  private svelteApp: Record<string, unknown> | null = null;
  canvasApp: CanvasApp | null = null;
  private adapter: ObsidianAdapter | null = null;
  private settings: TrefoilPluginSettings;
  private modifyRef: EventRef | null = null;
  /** 当前文件路径（由 setState/getState 管理，禁止在 getDisplayText 里调用 getViewState） */
  private path: string | null = null;

  constructor(leaf: WorkspaceLeaf, private plugin: TrefoilPlugin) {
    super(leaf);
    this.settings = plugin.trefoilSettings;
    this.navigation = true;
  }

  getViewType(): string {
    return VIEW_TYPE_TREFOIL;
  }

  getDisplayText(): string {
    const f = this.file;
    return f ? f.basename : 'Trefoil 白板';
  }

  getIcon(): string {
    return 'lucide-sprout';
  }

  private get file(): TFile | null {
    if (!this.path) return null;
    const f = this.plugin.app.vault.getAbstractFileByPath(this.path);
    return f instanceof TFile ? f : null;
  }

  async setState(state: Record<string, unknown>, result: ViewStateResult): Promise<void> {
    const nextFile = typeof (state as { file?: unknown }).file === 'string' ? (state as { file: string }).file : null;
    const changed = nextFile !== this.path;
    this.path = nextFile;
    if (changed && this.svelteApp) {
      // 叶子切换到另一个文件：卸载旧实例后重新挂载
      await this.unmountApp();
    }
    await super.setState(state, result);
    if (changed) {
      await this.mountApp();
    }
  }

  getState(): Record<string, unknown> {
    const state = super.getState() as Record<string, unknown>;
    return { ...state, file: this.path ?? '' };
  }

  async onOpen(): Promise<void> {
    if (!this.svelteApp) {
      await this.mountApp();
    }
  }

  private async mountApp(): Promise<void> {
    const content = this.contentEl;
    content.empty();
    content.addClass('trefoil-view');
    const file = this.file;
    if (!file) {
      content.setText('未指定画布文件：通过 Ribbon 图标或命令面板「新建白板」创建，或右键 .canvas 文件选择「在 Trefoil 中打开」。');
      return;
    }
    this.adapter = new ObsidianAdapter(this.plugin, file);
    this.adapter.fileName = file.basename;

    const initial = trefoilSettingsFromPlugin(this.settings);
    // 画布底色兜底变量由 styles.css 按主题 class 提供，无需写入元素样式

    this.svelteApp = mount(App, {
      target: content,
      props: {
        adapter: this.adapter,
        initialSettings: initial,
        onAppReady: (app: CanvasApp) => {
          this.canvasApp = app;
        },
      },
    });

    // 外部修改 → 重载（跳过自身保存触发的修改）
    this.modifyRef = this.plugin.app.vault.on('modify', async (f) => {
      if (!(f instanceof TFile) || f.path !== file.path || !this.canvasApp || !this.adapter) return;
      const text = await this.plugin.app.vault.cachedRead(f);
      if (this.adapter.consumeSaving(text)) {
        this.adapter.markSaved(text);
        return;
      }
      this.canvasApp.reloadFrom(text);
    });
  }

  private async unmountApp(): Promise<void> {
    // 把白板内调整过的设置回写插件默认值
    if (this.canvasApp) {
      this.settings.defaults = JSON.parse(JSON.stringify(this.canvasApp.settings));
      await this.plugin.saveTrefoilSettings();
    }
    if (this.svelteApp) {
      unmount(this.svelteApp);
      this.svelteApp = null;
      this.canvasApp = null;
      this.adapter = null;
    }
    if (this.modifyRef) {
      this.plugin.app.vault.offref(this.modifyRef);
      this.modifyRef = null;
    }
    this.contentEl.empty();
  }

  async onClose(): Promise<void> {
    await this.unmountApp();
  }
}
