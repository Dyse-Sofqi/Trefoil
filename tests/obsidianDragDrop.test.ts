import { describe, expect, it } from 'vitest';
// 'obsidian' 由 vitest.config.ts 别名到 tests/stubs/obsidian.ts（官方包只有 .d.ts）
import { TFile, TFolder } from 'obsidian';
import { ObsidianAdapter } from '../src/obsidian/ObsidianAdapter';

// 替身类运行时接受库内路径，而真实 typings 的 TFile 构造签名无参 —— 只在构造处收窄
const TFileCtor = TFile as unknown as new (path: string) => TFile;
const TFolderCtor = TFolder as unknown as new (path: string) => TFolder;
const file = (path: string): TFile => new TFileCtor(path);
const folder = (path: string): TFolder => new TFolderCtor(path);

/** 只带指定字段的假 DragEvent（Node 环境无 DragEvent 构造器） */
function dragEvent(opts: {
  files?: { name: string; type: string }[];
  data?: Record<string, string>;
  /** 模拟 dragover 保护模式：getData 一律返回空串 */
  protectedMode?: boolean;
}): DragEvent {
  const files = (opts.files ?? []).map((f) => ({ name: f.name, type: f.type }));
  const data = opts.data ?? {};
  return {
    dataTransfer: {
      files: Object.assign(files, { length: files.length }),
      types: Object.keys(data),
      getData: (type: string) => (opts.protectedMode ? '' : (data[type] ?? '')),
    },
  } as unknown as DragEvent;
}

function makeAdapter(draggable: unknown, vaultFiles: Record<string, unknown> = {}, linkDest: unknown = null) {
  const plugin = {
    app: {
      vault: {
        getAbstractFileByPath: (p: string) => vaultFiles[p] ?? null,
        getResourcePath: (f: { path: string }) => `app://local/${f.path}`,
      },
      metadataCache: { getFirstLinkpathDest: () => linkDest },
      dragManager: { draggable },
    },
  };
  return new ObsidianAdapter(plugin as never, file('boards/board.canvas') as never);
}

describe('Obsidian 内部拖拽：dragManager.draggable 才是权威载荷', () => {
  it('文件管理器拖入图片：按库内路径引用，不复制文件', async () => {
    const img = file('assets/photo.png');
    const adapter = makeAdapter({ type: 'file', file: img });

    expect(adapter.canDropImages(dragEvent({ protectedMode: true }))).toBe(true);
    expect(await adapter.pickDroppedImages(dragEvent({}))).toEqual({ paths: ['assets/photo.png'], files: [] });
  });

  it('dragover 保护模式下仍能判断可接收（getData 返回空串也不受影响）', () => {
    // 这正是原实现失效的场景：旧代码在 dragover 里读 text/plain 当路径，保护模式下永远是空串，
    // 于是不 preventDefault、浏览器根本不派发 drop，整个拖放静默失败
    const adapter = makeAdapter({ type: 'file', file: file('assets/photo.png') });
    const e = dragEvent({ data: { 'text/plain': 'obsidian://open?vault=V&file=assets/photo.png' }, protectedMode: true });
    expect(e.dataTransfer?.getData('text/plain')).toBe('');
    expect(adapter.canDropImages(e)).toBe(true);
  });

  it('多选拖拽：只收图片，跳过笔记', async () => {
    const adapter = makeAdapter({
      type: 'files',
      files: [file('assets/a.png'), file('notes/b.md'), file('assets/c.webp')],
    });
    expect(adapter.canDropImages(dragEvent({}))).toBe(true);
    expect((await adapter.pickDroppedImages(dragEvent({}))).paths).toEqual(['assets/a.png', 'assets/c.webp']);
  });

  it('拖文件夹 / 非图片文件 / 其他面板载荷：不接管', async () => {
    const folderDrag = makeAdapter({ type: 'folder', file: folder('assets') });
    expect(folderDrag.canDropImages(dragEvent({}))).toBe(false);
    expect(await folderDrag.pickDroppedImages(dragEvent({}))).toEqual({ paths: [], files: [] });

    const note = makeAdapter({ type: 'file', file: file('notes/a.md') });
    expect(note.canDropImages(dragEvent({}))).toBe(false);

    const bookmarks = makeAdapter({ type: 'bookmarks', items: [] });
    expect(bookmarks.canDropImages(dragEvent({}))).toBe(false);

    const noDrag = makeAdapter(null);
    expect(noDrag.canDropImages(dragEvent({}))).toBe(false);
  });

  it('内链拖拽（type=link）解析到图片时同样接管', async () => {
    const adapter = makeAdapter({ type: 'link', linktext: 'photo.png', file: file('assets/photo.png') });
    expect(adapter.canDropImages(dragEvent({}))).toBe(true);
    expect((await adapter.pickDroppedImages(dragEvent({}))).paths).toEqual(['assets/photo.png']);
  });

  it('SVG 不被接管（渲染层刻意不支持，以免污染导出画布）', async () => {
    const adapter = makeAdapter({ type: 'file', file: file('assets/icon.svg') });
    expect(adapter.canDropImages(dragEvent({}))).toBe(false);
    expect((await adapter.pickDroppedImages(dragEvent({}))).paths).toEqual([]);
  });
});

describe('系统文件管理器拖入：新文件交给调用方落盘', () => {
  it('图片文件收集为 blob，忽略非图片', async () => {
    const adapter = makeAdapter(null);
    const e = dragEvent({
      files: [
        { name: 'a.png', type: 'image/png' },
        { name: 'b.txt', type: 'text/plain' },
      ],
    });
    expect(adapter.canDropImages(e)).toBe(true);
    const out = await adapter.pickDroppedImages(e);
    expect(out.paths).toEqual([]);
    expect(out.files.map((f) => f.fileName)).toEqual(['a.png']);
  });

  it('系统拖入优先于 dragManager（两者同时存在时按新文件处理）', async () => {
    const adapter = makeAdapter({ type: 'file', file: file('assets/old.png') });
    const out = await adapter.pickDroppedImages(dragEvent({ files: [{ name: 'new.png', type: 'image/png' }] }));
    expect(out.paths).toEqual([]);
    expect(out.files.map((f) => f.fileName)).toEqual(['new.png']);
  });
});

describe('兜底：从 dataTransfer 文本解析 obsidian:// URL', () => {
  it('dragManager 缺失时仍能从 obsidian:// URL 还原库内路径', async () => {
    const adapter = makeAdapter(null, { 'assets/photo.png': file('assets/photo.png') });
    const e = dragEvent({ data: { 'text/plain': 'obsidian://open?vault=V&file=assets%2Fphoto.png' } });
    expect((await adapter.pickDroppedImages(e)).paths).toEqual(['assets/photo.png']);
  });

  it('裸文件名经短链解析（根目录之外的图片也能定位）', async () => {
    const adapter = makeAdapter(null, {}, file('deep/nested/photo.png'));
    const e = dragEvent({ data: { 'text/plain': 'photo.png' } });
    expect((await adapter.pickDroppedImages(e)).paths).toEqual(['deep/nested/photo.png']);
  });

  it('库内查不到文件时返回空（不产生指向空气的节点）', async () => {
    const adapter = makeAdapter(null, {});
    const e = dragEvent({ data: { 'text/plain': 'obsidian://open?vault=V&file=assets%2Fghost.png' } });
    expect((await adapter.pickDroppedImages(e)).paths).toEqual([]);
  });
});
