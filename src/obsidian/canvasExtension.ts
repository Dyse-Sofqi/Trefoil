/**
 * `.canvas` 扩展名的接管与归还。
 *
 * 背景（Obsidian 1.14.4 app.js 实证，非猜测）：
 * - `.canvas` 扩展名由内置 Canvas 核心插件注册：`typeByExtension['canvas'] = 'canvas'`，
 *   视图类型字符串同样是 `'canvas'`。核心插件禁用时其 onDisable 会
 *   `unregisterExtensions(['canvas'])`，此后 `.canvas` 不指向任何视图类型。
 * - `Plugin.registerExtensions` 在插件卸载时会**自动清理**映射
 *   （`this.register(() => this.app.viewRegistry.unregisterExtensions(e))`，
 *   且 Component.unload 先跑注册的清理、最后才调 `onunload()`）。
 *   所以禁用 Trefoil 后 `.canvas` 一定回到「无主」状态。
 * - 而 `WorkspaceLeaf.openFile` 对「无主扩展名」的兜底是
 *   `app.openWithDefaultApp(path)` → `window.open(绝对路径, "_external")`，
 *   把文件交给操作系统默认程序。`.canvas` 的系统默认关联正是 Obsidian 自己
 *   → 文件被交回 Obsidian → 依然没有视图类型 → 再交回系统 → **无限乒乓**，
 *   表现为「点击 canvas 文件疯狂尝试打开」。
 *
 * 对策：Trefoil 禁用时不把 `.canvas` 留在无主状态，而是把映射归还给内置画布视图类型
 * （`'canvas'`）。此时点击 .canvas 文件，宿主会创建稳定的「未知面板」占位视图
 * （app.js 里的 sI：`This pane doesn't look like anything to me`），不再甩给操作系统；
 * 用户若随后启用内置 Canvas，重新打开该文件即可正常加载。
 * 下次 Trefoil 启用时再把这个占位映射摘掉（仅当内置画布不可用时才可能是我们留的），
 * 保证重新启用后 `.canvas` 仍由 Trefoil 接管。
 */
import type { App } from 'obsidian';

/** 内置 Canvas 核心插件的视图类型（同时是它注册 .canvas 映射时的目标） */
export const CANVAS_VIEW_TYPE = 'canvas';

/** `.canvas` 扩展名（不带点，与 `TFile.extension` 一致） */
const CANVAS_EXTENSION = 'canvas';

/**
 * `app.viewRegistry` 里用到的内部面。
 * 这些成员均未入官方 typings（`viewRegistry` 本身就不在 `App` 上），统一按需收窄访问；
 * 全部可选 + 可选链调用，宿主缺项时静默降级，绝不在卸载路径上抛异常。
 */
export interface ViewRegistryLike {
  /** 扩展名 → 视图类型 的全局映射表 */
  typeByExtension?: Record<string, string>;
  /** 视图类型 → 视图构造器 的全局映射表 */
  viewByType?: Record<string, unknown>;
  getViewCreatorByType?: (viewType: string) => unknown;
  registerExtensions?: (extensions: string[], viewType: string) => void;
  unregisterExtensions?: (extensions: string[]) => void;
}

/** 取宿主的视图注册表（取不到时返回空对象，所有调用点都可安全继续） */
export function viewRegistryOf(app: App): ViewRegistryLike {
  return (app as unknown as { viewRegistry?: ViewRegistryLike }).viewRegistry ?? {};
}

/** 内置画布视图的构造器是否已注册（即核心插件 Canvas 是否处于启用状态） */
export function builtinCanvasAvailable(registry: ViewRegistryLike): boolean {
  if (typeof registry.getViewCreatorByType === 'function') {
    return !!registry.getViewCreatorByType(CANVAS_VIEW_TYPE);
  }
  return !!registry.viewByType?.[CANVAS_VIEW_TYPE];
}

/**
 * 摘除上次卸载时留下的「canvas → canvas」占位映射。
 *
 * 判据必须是「内置画布不可用」：内置 Canvas 启用时视图构造器与扩展名是一起注册的，
 * 那时的 `canvas → canvas` 映射属于核心插件，碰了会破坏原生画布；
 * 只有构造器缺失时的同名映射才可能是 Trefoil 自己留下的占位（无人能合法持有它）。
 *
 * 返回是否确实发起了摘除（unregisterExtensions 是否存在由可选链保证）。
 */
export function releaseLeftoverCanvasMapping(registry: ViewRegistryLike): boolean {
  if (registry.typeByExtension?.[CANVAS_EXTENSION] !== CANVAS_VIEW_TYPE) return false;
  if (builtinCanvasAvailable(registry)) return false;
  registry.unregisterExtensions?.([CANVAS_EXTENSION]);
  return true;
}

/**
 * 把 .canvas 扩展名归还给内置画布视图类型，避免禁用后落入
 * 「无主 → 交给操作系统 → 甩回 Obsidian」的无限乒乓。
 *
 * 仅当映射当前不存在、或仍指向 Trefoil 自己时才生效——不抢其它插件的注册。
 * 直接走 registry 而非 `Plugin.registerExtensions`：后者会挂一个随本次卸载执行的清理，
 * 把刚归还的映射又删掉（本方法只应在 onunload 里调用，那时清理队列已跑完）。
 *
 * 返回是否成功写入了映射。
 */
export function restoreBuiltinCanvasExtension(registry: ViewRegistryLike, trefoilViewType: string): boolean {
  const owner = registry.typeByExtension?.[CANVAS_EXTENSION];
  if (owner !== undefined && owner !== trefoilViewType) return false;
  try {
    if (owner === trefoilViewType) {
      // 映射仍指向我们（宿主自动清理未跑的兜底路径）：registerExtensions 不能覆盖
      // 已有映射，先摘除再写入
      registry.unregisterExtensions?.([CANVAS_EXTENSION]);
    }
    registry.registerExtensions?.([CANVAS_EXTENSION], CANVAS_VIEW_TYPE);
    return true;
  } catch {
    // 扩展名恰好被他人注册（理论上不会发生在卸载路径）——安静放弃即可
    return false;
  }
}
