/**
 * Trefoil —— Obsidian 白板插件入口（Obsidian 插件层）。
 * 职责：视图注册、Ribbon 入口、命令面板命令、文件菜单、插件设置。
 */
import { Menu, Notice, Plugin, TAbstractFile, TFile, WorkspaceLeaf, getIcon, requireApiVersion } from 'obsidian';
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
  /** 主题重绘的 rAF 句柄（去重：同一帧内多次触发只重绘一次） */
  private rethemeRaf = 0;
  /** body 主题类监听器：css-change 有时先于类翻转触发，用它兜底 */
  private bodyObserver: MutationObserver | null = null;
  /** 最近一次观察到的深色状态（body class 是否含 theme-dark） */
  private lastThemeDark = false;
  /** file-open 接管进行中（防止自身触发的 file-open 递归处理） */
  private interceptingCanvasOpen = false;

  async onload(): Promise<void> {
    this.errorLogger = new ErrorLogger(this);
    await this.errorLogger.install();
    this.trefoilSettings = await loadPluginSettings(this);
    // UI 图标使用 Obsidian 自带 lucide 图标库（缺失时由 icons.ts 回退内置 SVG）
    setIconResolver((name) => getIcon(`lucide-${name}`)?.outerHTML ?? getIcon(name)?.outerHTML ?? null);

    this.registerView(VIEW_TYPE_TREFOIL, (leaf: WorkspaceLeaf) => new TrefoilView(leaf, this));

    // 点击 .canvas 文件 → 默认用 Trefoil 打开（本插件启用期间接管该扩展名）
    this.registerCanvasExtension();

    // Ribbon：新建白板（🔍 审核规则 sentence-case / no-plugin-name：UI 文案不重复插件名，
    // 命令面板与 Ribbon 提示里 Obsidian 已经展示了插件名）
    this.addRibbonIcon('lucide-sprout', '新建白板', () => {
      void this.createNewCanvas();
    });

    // 命令面板
    this.addCommand({
      id: 'new-canvas',
      name: '新建白板',
      callback: () => void this.createNewCanvas(),
    });
    this.addCommand({
      // 🔍 审核规则 no-plugin-id-in-command-id：命令 id 不包含插件 id
      id: 'open-active-canvas',
      name: '打开当前画布',
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
    // ⚠️ 这两个命令**绝对不能**声明默认热键（曾经声明过 Mod+Z / Mod+Shift+Z，会全局吞掉 Ctrl+Z）。
    // Obsidian 的热键分发在 window 捕获阶段（Keymap.onKeyEvent）匹配到命令后调用
    // Commands.executeCommand —— 它**不看 checkCallback 的结果**，只要不抛异常就返回 true，
    // 于是 Keymap 认定「本次按键已被处理」，执行 preventDefault() + stopPropagation()。
    // 后果：只要插件占用了 Mod+Z，整个 Obsidian 的 Ctrl+Z 都失效 ——
    // CodeMirror 编辑器的原生撤销、白板内文本覆盖层 textarea 的撤销、各输入框的浏览器撤销全被吞掉，
    // 而且事件被 stopPropagation 拦在 window 上，连 ToolManager 自己的监听器也收不到。
    // 画布内的 Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y 由 ToolManager 的 window 监听器负责，不依赖默认热键；
    // 想让画布外的入口（命令面板、移动端工具栏）也能用，用户可在「设置 → 快捷键」里自行绑定。
    this.addCommand({
      id: 'undo',
      name: '撤销',
      checkCallback: (checking) => this.withActiveApp(checking, (app) => app.history.undo()),
    });
    this.addCommand({
      id: 'redo',
      name: '重做',
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

    // 文件菜单：打开白板视图
    this.registerEvent(
      this.app.workspace.on('file-menu', (menu: Menu, file: TAbstractFile) => {
        if (file instanceof TFile && file.extension === 'canvas') {
          menu.addItem((item) => {
            item.setTitle('打开白板视图').setIcon('lucide-sprout').onClick(() => void this.openCanvas(file));
          });
        }
      }),
    );

    // 主题切换 → 重新着色。css-change 与 body 主题类翻转都可能单独/先后到达，
    // 统一走 scheduleRetheme（延迟到下一帧 + 去重），避免读到旧主题。
    this.registerEvent(this.app.workspace.on('css-change', () => this.scheduleRetheme()));
    this.startThemeWatch();
  }

  onunload(): void {
    this.bodyObserver?.disconnect();
    this.bodyObserver = null;
    if (this.rethemeRaf) {
      window.cancelAnimationFrame(this.rethemeRaf);
      this.rethemeRaf = 0;
    }
    this.errorLogger?.uninstall();
    this.errorLogger = null;
  }

  /**
   * 让 .canvas 文件默认用 Trefoil 打开。
   *
   * ⚠️ 必须容错：Obsidian 的扩展名注册表（`app.viewRegistry.typeByExtension`）是全局的，
   * `ViewRegistry.registerExtensions` 遇到**已被注册**的扩展名会直接抛异常。
   * 而 `.canvas` 默认由内置「Canvas」核心插件注册，核心插件又先于社区插件加载 ——
   * 无条件注册必然抛错；异常从 onload 抛出后 Obsidian 会打印
   * 「Plugin failure: <id>」并**自动禁用本插件**，用户侧表现为「装上就用不了」。
   * 因此这里绝不能把异常放出去，也绝不能不判断就注册。
   *
   * 抢不到扩展名时退回 file-open 拦截：活动叶子里刚打开的 .canvas 文件由内置 Canvas
   * 视图承载，就地把它换成 Trefoil 视图，接管效果与注册扩展名一致。
   * 右键菜单「打开白板视图」始终保留，作为手动入口。
   */
  private registerCanvasExtension(): void {
    try {
      this.registerExtensions(['canvas'], VIEW_TYPE_TREFOIL);
      return;
    } catch {
      // 已被占用（内置 Canvas 默认启用，也可能被其它插件先注册）
      this.errorLogger?.log('info', '.canvas 扩展名已被占用，改用 file-open 接管');
    }
    this.registerEvent(
      this.app.workspace.on('file-open', (file) => {
        if (this.interceptingCanvasOpen) return;
        if (!(file instanceof TFile) || file.extension !== 'canvas') return;
        const leaf = this.app.workspace.getLeaf(false);
        if (leaf.getViewState().type === VIEW_TYPE_TREFOIL) return;
        // 只在「活动叶子正显示这个 .canvas 文件」时接管，避免误改其它标签页；
        // 1.7.2+ 的延迟视图此刻可能还没加载，读不到 file，此时保持原样（用户可右键手动打开）
        const view = leaf.view as unknown as { file?: unknown };
        if (!(view.file instanceof TFile) || view.file.path !== file.path) return;
        const state: TrefoilState = { file: file.path };
        this.interceptingCanvasOpen = true;
        void leaf
          .setViewState({ type: VIEW_TYPE_TREFOIL, state })
          .catch((err: unknown) => {
            this.errorLogger?.log('error', `接管 .canvas 打开失败：${err instanceof Error ? err.message : String(err)}`);
          })
          .finally(() => {
            this.interceptingCanvasOpen = false;
          });
      }),
    );
  }

  /**
   * 主题切换 → 延迟到下一帧统一重新着色。
   *
   * 为什么不能直接在事件回调里读：Obsidian 切换主题是「翻转 body 主题类 + 换主题 CSS +
   * 触发 css-change」的组合，顺序并不稳定 —— css-change 有时先于 body 类翻转到达，
   * 此刻 CanvasApp.themeKind()（读 body 类）与调色板（读 CSS 变量）拿到的还是旧主题，
   * 画布就停在旧深浅色上，要再来回切一次才纠正。
   *
   * 对策两条腿走路（共用本方法去重，同一帧只重绘一次）：
   * 1. css-change 依旧监听，但延迟到 requestAnimationFrame —— 本任务结束后、绘制前执行，
   *    此时 body 类与样式表都已就位，读到的一定是新主题；
   * 2. MutationObserver 盯 body 的 class 属性兜底 —— 类一翻转必然收到通知，再走同一延迟重绘，
   *    即使这次切换没有派发 css-change 也不会丢。
   */
  private scheduleRetheme(): void {
    if (this.rethemeRaf) return;
    this.rethemeRaf = window.requestAnimationFrame(() => {
      this.rethemeRaf = 0;
      this.rethemeViews();
    });
  }

  /** 兜底：body 的主题类一翻转（无论有没有 css-change）就触发统一重绘 */
  private startThemeWatch(): void {
    this.lastThemeDark = document.body.classList.contains('theme-dark');
    this.bodyObserver = new MutationObserver(() => {
      const dark = document.body.classList.contains('theme-dark');
      if (dark === this.lastThemeDark) return;
      this.lastThemeDark = dark;
      this.scheduleRetheme();
    });
    this.bodyObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
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
        await this.revealLeafCompat(leaf);
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
    await this.revealLeafCompat(leaf);
  }

  /**
   * 把叶子带到前台并确保视图已加载。
   * revealLeaf 自 Obsidian 1.7.2 才提供（1.7.2 的延迟视图需要它强制加载），
   * 旧版本退回 setActiveLeaf，与 manifest 声明的 minAppVersion 1.5.0 保持一致。
   */
  private async revealLeafCompat(leaf: WorkspaceLeaf): Promise<void> {
    if (requireApiVersion('1.7.2')) {
      await this.app.workspace.revealLeaf(leaf);
      return;
    }
    this.app.workspace.setActiveLeaf(leaf, { focus: true });
  }

  private rethemeViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_TREFOIL)) {
      const view = leaf.view;
      if (view instanceof TrefoilView && view.canvasApp) {
        // 底色变量随主题 class 由 CSS 自动切换，这里只需重绘画布
        view.canvasApp.retheme();
      }
    }
  }
}
