/**
 * 系统剪贴板里的画布元素载荷：
 * - 复制时把节点写入系统剪贴板（text/html 内嵌 base64 JSON 作为标记，另附纯文本摘要），
 *   这样粘贴时能先看剪贴板里"是不是画布元素"，是就按元素粘贴，否则按文本粘贴。
 * - 用 text/html 而不是自定义 MIME：自定义类型在各平台/宿主里支持度不稳，HTML 到处都能带。
 */
import type { CanvasDoc } from './types';

/** HTML 里的标记属性（内容为 base64 编码的 CanvasDoc JSON） */
const MARKER_ATTR = 'data-trefoil-nodes';
const MARKER_RE = /data-trefoil-nodes="([A-Za-z0-9+/=]+)"/;

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

function fromBase64(b64: string): string {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** 元素的纯文本摘要：文本节点的文字按行拼接，便于粘到笔记里 */
function nodesToPlainText(data: CanvasDoc): string {
  const texts = data.nodes
    .filter((n) => n.type === 'text' && (n.text ?? '').trim())
    .map((n) => n.text as string);
  return texts.length ? texts.join('\n') : `[Trefoil 元素 ×${data.nodes.length}]`;
}

let lastWrittenText = '';

/** 文本归一化：换行/行尾空白差异不应影响"这是不是自己写的"判断 */
function normalize(text: string): string {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n');
}

/**
 * 剪贴板里的纯文本是否就是本应用刚写入的元素摘要。
 * 标记属性可能被宿主/剪贴板工具剥掉，但纯文本一般能原样回来，用它对上即可按元素粘贴。
 */
export function isOwnClipboardText(text: string): boolean {
  return !!lastWrittenText && normalize(text) === normalize(lastWrittenText);
}

/** 写入系统剪贴板（失败时静默，仍保留应用内剪贴板） */
export function writeNodesToSystemClipboard(data: CanvasDoc): void {
  const plain = nodesToPlainText(data);
  lastWrittenText = plain;
  const encodedNodes = toBase64(JSON.stringify(data));
  const marker = `<div ${MARKER_ATTR}="${encodedNodes}"></div>`;
  const body = plain
    .split('\n')
    .map((t) => `<p>${escapeHtml(t)}</p>`)
    .join('');
  // 标记走 HTML 属性，纯文本仍可读
  const html = marker + body;
  // 先用 execCommand（同步、无需权限，保证纯文本一定写进去），
  // 再用异步 API 写入同一份内容以带上 HTML 标记（属性会被 DOM 复制清洗掉，异步路径才能保留）
  writeViaExecCommand(buildCopyHost(encodedNodes, plain));
  void writeViaAsyncClipboard(html, plain);
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] ?? c);
}

/** execCommand 用的临时宿主：逐节点构造，不经 innerHTML 拼接，转义交给 DOM */
function buildCopyHost(encodedNodes: string, plain: string): HTMLElement {
  const host = document.createElement('div');
  host.setAttribute('contenteditable', 'true');
  host.classList.add('trefoil-clipboard-host');
  const marker = document.createElement('div');
  marker.setAttribute(MARKER_ATTR, encodedNodes);
  host.appendChild(marker);
  for (const line of plain.split('\n')) {
    const p = document.createElement('p');
    p.textContent = line;
    host.appendChild(p);
  }
  return host;
}

/**
 * 用 execCommand 写剪贴板：同步、无需权限，Obsidian（Electron）里同样可用；
 * 异步 ClipboardItem 常被宿主权限/文档聚焦限制挡掉，只作备选。
 */
function writeViaExecCommand(host: HTMLElement): boolean {
  document.body.appendChild(host);
  const sel = window.getSelection();
  const saved = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
  const range = document.createRange();
  range.selectNodeContents(host);
  sel?.removeAllRanges();
  sel?.addRange(range);
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  sel?.removeAllRanges();
  if (saved && sel) sel.addRange(saved);
  host.remove();
  return ok;
}

async function writeViaAsyncClipboard(html: string, plain: string): Promise<void> {
  try {
    if (!navigator.clipboard?.write) return;
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/plain': new Blob([plain], { type: 'text/plain' }),
        'text/html': new Blob([html], { type: 'text/html' }),
      }),
    ]);
  } catch {
    /* 例如权限被拒：忽略，粘贴时退回应用内剪贴板 */
  }
}

/** 从粘贴事件里取出画布元素数据；不是本应用写的元素则返回 null */
export function readNodesFromSystemClipboard(dt: DataTransfer | null): CanvasDoc | null {
  if (!dt) return null;
  try {
    const html = dt.getData('text/html');
    const m = html ? MARKER_RE.exec(html) : null;
    if (!m) return null;
    const parsed = JSON.parse(fromBase64(m[1])) as CanvasDoc;
    if (!parsed || !Array.isArray(parsed.nodes) || !parsed.nodes.length) return null;
    return { nodes: parsed.nodes, edges: Array.isArray(parsed.edges) ? parsed.edges : [] };
  } catch {
    return null;
  }
}
