/**
 * canvasExtension：.canvas 扩展名的接管与归还。
 *
 * 钉住的行为是「插件禁用后点击 .canvas 文件不再疯狂尝试打开」：
 * 归还映射让宿主走稳定的「未知面板」占位，而不是把文件甩给操作系统默认程序
 * （.canvas 的系统默认关联是 Obsidian 自己，会形成无限乒乓）。
 */
import { describe, expect, it } from 'vitest';
import {
  CANVAS_VIEW_TYPE,
  builtinCanvasAvailable,
  releaseLeftoverCanvasMapping,
  restoreBuiltinCanvasExtension,
  viewRegistryOf,
  type ViewRegistryLike,
} from '../src/obsidian/canvasExtension';

const TREFOIL = 'trefoil-canvas';

/** 记录调用的假 viewRegistry，行为对齐宿主（registerExtensions 遇占用抛错） */
function fakeRegistry(opts: { typeByExtension?: Record<string, string>; viewByType?: Record<string, unknown> } = {}) {
  const typeByExtension: Record<string, string> = { ...(opts.typeByExtension ?? {}) };
  const viewByType: Record<string, unknown> = { ...(opts.viewByType ?? {}) };
  const calls: Array<{ op: 'register' | 'unregister'; extensions: string[]; viewType?: string }> = [];
  const registry: ViewRegistryLike = {
    typeByExtension,
    viewByType,
    getViewCreatorByType: (t) => viewByType[t],
    registerExtensions: (extensions, viewType) => {
      calls.push({ op: 'register', extensions: [...extensions], viewType });
      for (const e of extensions) {
        if (typeByExtension[e] !== undefined) {
          throw new Error(`Attempting to register an existing file extension "${e}"`);
        }
        typeByExtension[e] = viewType;
      }
    },
    unregisterExtensions: (extensions) => {
      calls.push({ op: 'unregister', extensions: [...extensions] });
      for (const e of extensions) delete typeByExtension[e];
    },
  };
  return { registry, typeByExtension, viewByType, calls };
}

describe('releaseLeftoverCanvasMapping：摘除上次卸载留下的占位映射', () => {
  it('残留 canvas→canvas 且内置画布不可用 → 摘除（这是重新启用后抢注失败的原因）', () => {
    const { registry, typeByExtension, calls } = fakeRegistry({ typeByExtension: { canvas: 'canvas' } });
    expect(releaseLeftoverCanvasMapping(registry)).toBe(true);
    expect(calls).toEqual([{ op: 'unregister', extensions: ['canvas'] }]);
    expect(typeByExtension.canvas).toBeUndefined();
  });

  it('canvas→canvas 但内置画布可用 → 不碰（映射属于核心插件，摘了会破坏原生画布）', () => {
    const { registry, typeByExtension, calls } = fakeRegistry({
      typeByExtension: { canvas: 'canvas' },
      viewByType: { canvas: function canvasView() {} },
    });
    expect(releaseLeftoverCanvasMapping(registry)).toBe(false);
    expect(calls).toEqual([]);
    expect(typeByExtension.canvas).toBe('canvas');
  });

  it('没有 canvas 映射 → 无事发生', () => {
    const { registry, calls } = fakeRegistry();
    expect(releaseLeftoverCanvasMapping(registry)).toBe(false);
    expect(calls).toEqual([]);
  });

  it('canvas 指向 Trefoil 自己 → 不摘（那是 onload 刚抢到的实时映射）', () => {
    const { registry, typeByExtension, calls } = fakeRegistry({ typeByExtension: { canvas: TREFOIL } });
    expect(releaseLeftoverCanvasMapping(registry)).toBe(false);
    expect(calls).toEqual([]);
    expect(typeByExtension.canvas).toBe(TREFOIL);
  });
});

describe('restoreBuiltinCanvasExtension：禁用时归还给内置画布视图类型', () => {
  it('无主状态 → 写入 canvas→canvas，宿主将显示稳定的「未知面板」占位', () => {
    const { registry, typeByExtension, calls } = fakeRegistry();
    expect(restoreBuiltinCanvasExtension(registry, TREFOIL)).toBe(true);
    expect(calls).toEqual([{ op: 'register', extensions: ['canvas'], viewType: 'canvas' }]);
    expect(typeByExtension.canvas).toBe(CANVAS_VIEW_TYPE);
  });

  it('仍指向 Trefoil（宿主自动清理没跑的兜底）→ 覆盖为 canvas→canvas', () => {
    const { registry, typeByExtension } = fakeRegistry({ typeByExtension: { canvas: TREFOIL } });
    expect(restoreBuiltinCanvasExtension(registry, TREFOIL)).toBe(true);
    expect(typeByExtension.canvas).toBe(CANVAS_VIEW_TYPE);
  });

  it('指向其它插件 → 不抢（保留他人的注册）', () => {
    const { registry, typeByExtension, calls } = fakeRegistry({ typeByExtension: { canvas: 'other-canvas' } });
    expect(restoreBuiltinCanvasExtension(registry, TREFOIL)).toBe(false);
    expect(calls).toEqual([]);
    expect(typeByExtension.canvas).toBe('other-canvas');
  });

  it('registerExtensions 抛错（竞态）→ 安静放弃，不向上抛', () => {
    const registry: ViewRegistryLike = {
      typeByExtension: {},
      registerExtensions: () => {
        throw new Error('Attempting to register an existing file extension "canvas"');
      },
    };
    expect(restoreBuiltinCanvasExtension(registry, TREFOIL)).toBe(false);
  });
});

describe('builtinCanvasAvailable：内置画布是否启用', () => {
  it('构造器已注册 → true', () => {
    const { registry } = fakeRegistry({ viewByType: { canvas: function canvasView() {} } });
    expect(builtinCanvasAvailable(registry)).toBe(true);
  });

  it('构造器未注册 → false', () => {
    const { registry } = fakeRegistry({ viewByType: { markdown: function mdView() {} } });
    expect(builtinCanvasAvailable(registry)).toBe(false);
  });

  it('宿主只有 viewByType（无 getViewCreatorByType）→ 退回查表', () => {
    const registry: ViewRegistryLike = { viewByType: { canvas: function canvasView() {} } };
    expect(builtinCanvasAvailable(registry)).toBe(true);
    expect(builtinCanvasAvailable({ viewByType: {} })).toBe(false);
  });
});

describe('viewRegistryOf：取不到注册表时不炸', () => {
  it('app 上没有 viewRegistry → 返回空对象', () => {
    expect(viewRegistryOf({} as never)).toEqual({});
  });

  it('有 viewRegistry → 原样返回', () => {
    const reg = { typeByExtension: {} };
    expect(viewRegistryOf({ viewRegistry: reg } as never)).toBe(reg);
  });
});

describe('完整生命周期：禁用 → 重新启用，.canvas 始终有明确归属', () => {
  it('禁用后点击不再触发「无主 → 交给操作系统」的乒乓；重新启用后 Trefoil 仍能抢回', () => {
    // 首次启用：内置画布禁用中，Trefoil 抢到 .canvas
    const { registry, typeByExtension, calls } = fakeRegistry();
    expect(releaseLeftoverCanvasMapping(registry)).toBe(false); // 没有残留，无需摘
    typeByExtension.canvas = TREFOIL; // 等价于 this.registerExtensions 成功

    // 禁用：宿主先跑注册的清理（自动删掉映射），再调 onunload（我们负责归还）
    delete typeByExtension.canvas;
    expect(restoreBuiltinCanvasExtension(registry, TREFOIL)).toBe(true);
    expect(typeByExtension.canvas).toBe('canvas'); // 占位映射在位，点击走「未知面板」而非 openWithDefaultApp
    expect(calls.filter((c) => c.op === 'register')).toEqual([{ op: 'register', extensions: ['canvas'], viewType: 'canvas' }]);

    // 重新启用：先摘掉自己留的占位，再抢注
    expect(releaseLeftoverCanvasMapping(registry)).toBe(true);
    expect(typeByExtension.canvas).toBeUndefined();
    typeByExtension.canvas = TREFOIL;
    expect(typeByExtension.canvas).toBe(TREFOIL);
  });

  it('热重载（禁用即启用）连续两轮，映射不残留、不抛错', () => {
    const { registry, typeByExtension } = fakeRegistry();
    for (let round = 0; round < 2; round++) {
      releaseLeftoverCanvasMapping(registry);
      typeByExtension.canvas = TREFOIL; // registerExtensions 成功
      delete typeByExtension.canvas; // 宿主自动清理
      restoreBuiltinCanvasExtension(registry, TREFOIL); // onunload 归还
      releaseLeftoverCanvasMapping(registry); // 下一轮 onload 摘除占位
    }
    expect(typeByExtension.canvas).toBeUndefined();
  });
});
