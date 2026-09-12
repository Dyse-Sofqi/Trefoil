import { describe, expect, it } from 'vitest';
import { dragText, fileLooksLikeImage, isImageFileDrag, vaultPathFromDragText } from '../src/core/dragDrop';

/** 构造只带指定字段的假 DragEvent（Node 环境无 DragEvent 构造器） */
function dragEvent(opts: {
  files?: { name: string; type: string }[];
  data?: Record<string, string>;
}): DragEvent {
  const files = (opts.files ?? []).map((f) => ({ name: f.name, type: f.type }));
  const data = opts.data ?? {};
  return {
    dataTransfer: {
      files: Object.assign(files, { length: files.length }),
      types: Object.keys(data),
      getData: (type: string) => data[type] ?? '',
    },
  } as unknown as DragEvent;
}

/** 构造假 File */
function fakeFile(name: string, type: string): File {
  return { name, type } as File;
}

describe('拖放载荷：dragover 阶段的接收判断', () => {
  it('系统拖入图片文件时判定可接收', () => {
    expect(isImageFileDrag(dragEvent({ files: [{ name: 'a.png', type: 'image/png' }] }))).toBe(true);
  });

  it('MIME 缺失时按扩展名兜底（部分平台 dragover 阶段 type 为空）', () => {
    expect(isImageFileDrag(dragEvent({ files: [{ name: 'a.JPG', type: '' }] }))).toBe(true);
    expect(isImageFileDrag(dragEvent({ files: [{ name: 'a.txt', type: '' }] }))).toBe(false);
  });

  it('非图片文件不接收（避免吞掉其他类型的拖放）', () => {
    expect(isImageFileDrag(dragEvent({ files: [{ name: 'a.pdf', type: 'application/pdf' }] }))).toBe(false);
  });

  it('SVG 不接收（渲染层刻意不支持，以免污染导出画布）', () => {
    expect(isImageFileDrag(dragEvent({ files: [{ name: 'a.svg', type: 'image/svg+xml' }] }))).toBe(false);
    expect(fileLooksLikeImage(fakeFile('a.svg', ''))).toBe(false);
  });

  it('内部拖拽（无 File、只有文本）在通用判断下不可接收 —— 需宿主另判 dragManager', () => {
    // 这正是原实现失效的原因：dragover 阶段 getData 返回空串，
    // 只看 dataTransfer 无法识别 Obsidian 内部拖拽
    expect(isImageFileDrag(dragEvent({ data: { 'text/plain': 'obsidian://open?vault=V&file=a.png' } }))).toBe(false);
    const protectedMode = { dataTransfer: { files: Object.assign([], { length: 0 }), types: ['text/plain'], getData: () => '' } };
    expect(isImageFileDrag(protectedMode as unknown as DragEvent)).toBe(false);
  });
});

describe('拖放文本：obsidian:// URL 与库内路径解析', () => {
  it('解析 obsidian:// 里的 file 参数（Obsidian 内部拖拽写入的格式）', () => {
    expect(vaultPathFromDragText('obsidian://open?vault=MyVault&file=assets%2Fa%20b.png')).toBe('assets/a b.png');
  });

  it('文件名里的 + 不被还原成空格（故用 decodeURIComponent 而非 URLSearchParams）', () => {
    expect(vaultPathFromDragText('obsidian://open?vault=V&file=a%2Bb.png')).toBe('a+b.png');
  });

  it('缺少 file 参数时返回 null（不把库名当路径）', () => {
    expect(vaultPathFromDragText('obsidian://open?vault=MyVault')).toBeNull();
  });

  it('裸库内路径与 / 开头的绝对路径都归一为无首斜杠的库内路径', () => {
    expect(vaultPathFromDragText('/assets/a.png')).toBe('assets/a.png');
    expect(vaultPathFromDragText('assets/a.png')).toBe('assets/a.png');
    expect(vaultPathFromDragText('a.png')).toBe('a.png');
    expect(vaultPathFromDragText('assets\\sub\\a.png')).toBe('assets/sub/a.png');
  });

  it('非库内路径返回 null（网页拖图不能当成库内文件）', () => {
    expect(vaultPathFromDragText('https://example.com/a.png')).toBeNull();
    expect(vaultPathFromDragText('data:image/png;base64,AAAA')).toBeNull();
    expect(vaultPathFromDragText('blob:app://abc')).toBeNull();
    expect(vaultPathFromDragText('')).toBeNull();
    expect(vaultPathFromDragText('   ')).toBeNull();
  });
});

describe('拖放文本：text/uri-list 优先', () => {
  it('优先取 text/uri-list，缺失时退回 text/plain', () => {
    expect(dragText(dragEvent({ data: { 'text/uri-list': 'uri', 'text/plain': 'plain' } }))).toBe('uri');
    expect(dragText(dragEvent({ data: { 'text/plain': 'plain' } }))).toBe('plain');
    expect(dragText({ dataTransfer: null } as unknown as DragEvent)).toBe('');
  });
});
