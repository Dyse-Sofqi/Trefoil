import { describe, expect, it } from 'vitest';
import {
  dedupeName,
  extensionForFile,
  extensionForMime,
  folderOf,
  joinVaultPath,
  normalizeVaultPath,
  pastedImageName,
  resolveAttachmentFolder,
} from '../src/core/attachment';

describe('附件目录解析（Obsidian attachmentFolderPath 语义）', () => {
  it('默认（空配置）→ 库根', () => {
    expect(resolveAttachmentFolder('', 'Notes/My Canvas.canvas')).toBe('');
    expect(resolveAttachmentFolder(null, 'Notes/My Canvas.canvas')).toBe('');
  });

  it('"/" → 库根', () => {
    expect(resolveAttachmentFolder('/', 'Notes/My Canvas.canvas')).toBe('');
  });

  it("'./' → 画布所在文件夹", () => {
    expect(resolveAttachmentFolder('./', 'Notes/Sub/My Canvas.canvas')).toBe('Notes/Sub');
    expect(resolveAttachmentFolder('./', 'My Canvas.canvas')).toBe('');
  });

  it("'./sub' → 画布文件夹下的子目录", () => {
    expect(resolveAttachmentFolder('./assets', 'Notes/My Canvas.canvas')).toBe('Notes/assets');
    // 根目录画布 + 相对子目录
    expect(resolveAttachmentFolder('./assets', 'My Canvas.canvas')).toBe('assets');
  });

  it("'folder/sub' → 库内绝对路径", () => {
    expect(resolveAttachmentFolder('attachments', 'Notes/My Canvas.canvas')).toBe('attachments');
    expect(resolveAttachmentFolder('/rooted', 'Notes/My Canvas.canvas')).toBe('rooted');
  });

  it('反斜杠与重复斜杠归一', () => {
    expect(resolveAttachmentFolder('.\\assets', 'Notes/My Canvas.canvas')).toBe('Notes/assets');
    expect(normalizeVaultPath('a//b\\c/')).toBe('a/b/c');
  });
});

describe('粘贴图片命名', () => {
  it('时间戳文件名与扩展名', () => {
    const d = new Date(2025, 0, 2, 3, 4, 5);
    const name = pastedImageName('png', d);
    expect(name).toBe('Pasted image 20250102030405.png');
    // 毫秒无关
    expect(name.length).toBeGreaterThan(20);
  });

  it('MIME → 扩展名', () => {
    expect(extensionForMime('image/png')).toBe('png');
    expect(extensionForMime('image/jpeg')).toBe('jpg');
    expect(extensionForMime('image/webp')).toBe('webp');
    expect(extensionForMime('text/plain')).toBe('png'); // 未知回退
  });

  it('文件名优先于 MIME', () => {
    expect(extensionForFile('photo.PNG', 'image/jpeg')).toBe('png');
    expect(extensionForFile('clip', 'image/png')).toBe('png');
  });
});

describe('附件名去重', () => {
  it('存在时追加序号', () => {
    const exists = new Set(['a.png', 'a 1.png']);
    expect(dedupeName('a.png', (n) => exists.has(n))).toBe('a 2.png');
  });

  it('不存在时原样返回', () => {
    expect(dedupeName('fresh.png', () => false)).toBe('fresh.png');
  });

  it('无扩展名文件名', () => {
    expect(dedupeName('x', () => true)).toMatch(/^x \d+$/);
  });
});

describe('库内路径拼接', () => {
  it('文件夹 + 文件名', () => {
    expect(joinVaultPath('attachments', 'a.png')).toBe('attachments/a.png');
    expect(joinVaultPath('', 'a.png')).toBe('a.png');
    expect(joinVaultPath('a/b/', 'c.png')).toBe('a/b/c.png');
  });

  it('folderOf', () => {
    expect(folderOf('a/b/c.canvas')).toBe('a/b');
    expect(folderOf('root.canvas')).toBe('');
  });
});