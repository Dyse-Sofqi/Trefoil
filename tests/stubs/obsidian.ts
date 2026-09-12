/**
 * `obsidian` 的测试替身。
 *
 * 官方 `obsidian` 包**只发布 .d.ts**（运行时由宿主注入），vite 解析不到入口，
 * 因此 `vitest.config.ts` 把 `obsidian` 别名指到本文件。类型仍来自真实 typings（tsc 走 node 解析），
 * 所以这里只需给出运行时会用到的形状。
 *
 * 目前只覆盖拖放相关的用例；后续测试若需要别的导出，在此按需补充。
 */

export class TAbstractFile {
  constructor(public path: string) {}
  get name(): string {
    return this.path.split('/').pop() ?? '';
  }
  get basename(): string {
    const n = this.name;
    const i = n.lastIndexOf('.');
    return i > 0 ? n.slice(0, i) : n;
  }
  get extension(): string {
    const i = this.name.lastIndexOf('.');
    return i > 0 ? this.name.slice(i + 1) : '';
  }
  get parent(): TFolder | null {
    const i = this.path.lastIndexOf('/');
    return i < 0 ? null : new TFolder(this.path.slice(0, i));
  }
}

export class TFile extends TAbstractFile {
  get stat(): { size: number; mtime: number } {
    return { size: 0, mtime: 0 };
  }
}

export class TFolder extends TAbstractFile {}

/** Notice 只是宿主提示，测试里吞掉即可 */
export class Notice {
  constructor(public message: string) {}
}
