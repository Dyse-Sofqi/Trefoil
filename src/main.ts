/**
 * Trefoil —— Obsidian 白板插件入口（Obsidian 插件层）。
 * 职责：视图注册、Ribbon 入口、命令面板命令、文件菜单、插件设置。
 */
import { Menu, Notice, Plugin, TAbstractFile, TFile, WorkspaceLeaf, getIcon } from 'obsidian';
import { VIEW_TYPE_TREFOIL, TrefoilView } from './obsidian/TrefoilView';
import { createEmptyDocJson } from './data/jsonCanvas';
import { ErrorLogger } from './obsidian/errorLog';
import { setIconResolver } from './app/icons';
import {
  DEFAULT_PLUGIN_SETTINGS,
  loadPluginSettings,
  savePluginSettings,
  type TrefoilPluginSettings,
} from './obsidian/pluginSettings';
import type { TrefoilSettings } from './core/defaults';
import './styles.css';

interface TrefoilState extends Record<string, unknown> {
  file: string;
}

export default class TrefoilPlugin extends Plugin {
  trefoilSettings: TrefoilPluginSettings = DEFAULT_PLUGIN_SETTINGS;
  errorLogger: ErrorLogger | null = null;

  async onload(): Promise<void> {
    this.errorLogger = new ErrorLogger(this);
    await this.errorLogger.install();
    this.trefoilSettings = await loadPluginSettings(this);
    // UI 图标使用 Obsidian 自带 lucide 图标库（缺失时由 icons.ts 回退内置 SVG）
    setIconResolver((name) => getIcon(`lucide-${name}`)?.outerHTML ?? getIcon(name)?.outerHTML ?? null);

    this.registerView(VIEW_TYPE_TREFOIL, (leaf: WorkspaceLeaf) => new TrefoilView(leaf, this));

    // 点击 .canvas 文件 → 默认用 Trefoil 打开（本插件启用期间接管该扩展名）
    this.registerExtensions(['canvas'], VIEW_TYPE_TREFOIL);

    // Ribbon：新建白板
    this.addRibbonIcon('lucide-sprout', '新建 Trefoil 白板', () => {
      void this.createNewCanvas();
    });

    // 命令面板
    this.addCommand({
      id: 'new-canvas',
      name: '新建白板',
      callback: () => void this.createNewCanvas(),
    });
    this.addCommand({
      id: 'open-active-in-trefoil',
      name: '在 Trefoil 中打开当前画布',
      checkCallback: (checking: boolean) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== 'canvas') return false;
        if (!checking) void this.openCanvas(file);
        return true;
      },
    });
    this.addCommand({
      id: 'export-png',
      name: '导出 PNG',
      checkCallback: (checking) => this.withActiveApp(checking, (app) => void app.exportPng({ transparent: false, includeLaser: false })),
    });
    this.addCommand({
      id: 'export-png-transparent',
      name: '导出 PNG（透明背景）',
      checkCallback: (checking) => this.withActiveApp(checking, (app) => void app.exportPng({ transparent: true, includeLaser: false })),
    });
    this.addCommand({
      id: 'export-svg',
      name: '导出 SVG',
      checkCallback: (checking) => this.withActiveApp(checking, (app) => void app.exportSvg()),
    });
    this.addCommand({
      id: 'clear-laser',
      name: '清除镭射笔迹',
      checkCallback: (checking) =>
        this.withActiveApp(checking, (app) => {
          app.engine.laser.clearAll();
          new Notice('已清除镭射笔迹');
        }),
    });
    this.addCommand({
      id: 'zoom-to-fit',
      name: '缩放适应内容',
      checkCallback: (checking) => this.withActiveApp(checking, (app) => app.engine.zoomToFit()),
    });
    this.addCommand({
      id: 'undo',
      name: '撤销',
      hotkeys: [{ modifiers: ['Mod'], key: 'z' }],
      checkCallback: (checking) => this.withActiveApp(checking, (app) => app.history.undo()),
    });
    this.addCommand({
      id: 'redo',
      name: '重做',
      hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'z' }],
      checkCallback: (checking) => this.withActiveApp(checking, (app) => app.history.redo()),
    });

    // 工具切换命令
    const tools: [string, string][] = [
      ['select', '选择'],
      ['rect', '矩形'],
      ['ellipse', '圆形/椭圆'],
      ['diamond', '菱形'],
      ['triangle', '三角形'],
      ['arrow', '箭头'],
      ['polyline', '直线/折线'],
      ['text', '文本'],
      ['laser', '镭射笔'],
      ['eraser', '橡皮擦'],
    ];
    for (const [id, label] of tools) {
      this.addCommand({
        id: `tool-${id}`,
        name: `切换工具：${label}`,
        checkCallback: (checking) => this.withActiveApp(checking, (app) => app.setTool(id)),
      });
    }

    // 文件菜单：在 Trefoil 中打开
    this.registerEvent(
      this.app.workspace.on('file-menu', (menu: Menu, file: TAbstractFile) => {
        if (file instanceof TFile && file.extension === 'canvas') {
          menu.addItem((item) => {
            item.setTitle('在 Trefoil 中打开').setIcon('lucide-sprout').onClick(() => void this.openCanvas(file));
          });
        }
      }),
    );

    // 主题切换 → 重新着色
    this.registerEvent(this.app.workspace.on('css-change', () => this.rethemeViews()));
  }

  onunload(): void {
    this.errorLogger?.uninstall();
    this.errorLogger = null;
  }

  async saveTrefoilSettings(): Promise<void> {
    await savePluginSettings(this, this.trefoilSettings);
  }

  /** 白板内设置面板修改默认值（防抖调用，立即落盘 data.json） */
  saveDefaultTrefoilSettings(defaults: TrefoilSettings): void {
    this.trefoilSettings.defaults = defaults;
    void savePluginSettings(this, this.trefoilSettings);
  }

  /** 活动叶子为 Trefoil 视图时执行回调 */
  private withActiveApp(checking: boolean, fn: (app: import('./app/CanvasApp').CanvasApp) => void): boolean {
    const view = this.app.workspace.getActiveViewOfType(TrefoilView);
    if (!view || !view.canvasApp) return false;
    if (!checking) fn(view.canvasApp);
    return true;
  }

  async createNewCanvas(): Promise<void> {
    const folder = this.trefoilSettings.newFileFolder.replace(/\/+$/, '');
    let base = 'Trefoil 白板';
    let path = '';
    for (let i = 0; i < 1000; i++) {
      const name = i === 0 ? base : `${base} ${i}`;
      path = folder ? `${folder}/${name}.canvas` : `${name}.canvas`;
      if (!this.app.vault.getAbstractFileByPath(path)) break;
    }
    try {
      if (folder && !this.app.vault.getAbstractFileByPath(folder)) {
        await this.app.vault.createFolder(folder);
      }
      const file = await this.app.vault.create(path, createEmptyDocJson());
      await this.openCanvas(file);
    } catch (err) {
      new Notice(`创建白板失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async openCanvas(file: TFile): Promise<void> {
    const state: TrefoilState = { file: file.path };
    // 复用已有 Trefoil 叶子
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_TREFOIL);
    for (const leaf of existing) {
      const st = leaf.getViewState().state as Partial<TrefoilState> | undefined;
      if (st?.file === file.path) {
        await this.app.workspace.revealLeaf(leaf);
        return;
      }
    }
    let leaf: WorkspaceLeaf | null = existing[0] ?? null;
    if (leaf) {
      await leaf.setViewState({ type: VIEW_TYPE_TREFOIL, state });
    } else {
      leaf = this.app.workspace.getLeaf(true);
      await leaf.setViewState({ type: VIEW_TYPE_TREFOIL, state });
    }
    await this.app.workspace.revealLeaf(leaf);
  }

  private rethemeViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_TREFOIL)) {
      const view = leaf.view;
      if (view instanceof TrefoilView && view.canvasApp) {
        view.contentEl.style.setProperty(
          '--trefoil-canvas-bg',
          document.body.classList.contains('theme-dark') ? '#1e1e22' : '#ffffff',
        );
        view.canvasApp.retheme();
      }
    }
  }
}
