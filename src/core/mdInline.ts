/** 内联 Markdown 解析：**加粗**、_斜体_、`代码`、~~删除线~~ → 样式分段 */

export interface Run {
  text: string;
  bold: boolean;
  italic: boolean;
  code: boolean;
  strike: boolean;
}

interface StyleState {
  bold: boolean;
  italic: boolean;
  code: boolean;
  strike: boolean;
}

const MARKERS: { token: string; key: keyof StyleState }[] = [
  { token: '**', key: 'bold' },
  { token: '~~', key: 'strike' },
  { token: '`', key: 'code' },
  { token: '_', key: 'italic' },
  { token: '*', key: 'italic' },
];

/** 解析为多行 run 序列（\n 分行） */
export function parseInline(md: string): Run[][] {
  const lines = (md ?? '').split('\n');
  return lines.map(parseLine);
}

function parseLine(line: string): Run[] {
  const runs: Run[] = [];
  let state: StyleState = { bold: false, italic: false, code: false, strike: false };
  let buf = '';
  let i = 0;

  const flush = () => {
    if (buf) {
      runs.push({ text: buf, ...state });
      buf = '';
    }
  };

  outer: while (i < line.length) {
    for (const { token, key } of MARKERS) {
      if (!line.startsWith(token, i)) continue;
      // '**' 整体优先：单 '*' 不在 '**' 位置生效
      if (token === '*' && line.startsWith('**', i)) continue;
      // 已开启：遇到同名定界符即闭合
      if (state[key]) {
        flush();
        state = { ...state, [key]: false };
        i += token.length;
        continue outer;
      }
      // 开标记后紧跟空格 → 非强调（CommonMark 左侧匹配规则的简化版）
      if ((token === '*' || token === '_') && line[i + token.length] === ' ') continue;
      // 未开启：要求后方存在成对定界符才开启（避免把下划线变量当斜体）
      const rest = line.indexOf(token, i + token.length);
      if (rest !== -1) {
        flush();
        state = { ...state, [key]: true };
        i += token.length;
        continue outer;
      }
    }
    buf += line[i];
    i++;
  }
  flush();
  return runs.length ? runs : [{ text: '', ...state }];
}

/** 生成 Konva 使用的 fontStyle 字符串 */
export function fontStyleOf(run: Run): string {
  const parts: string[] = [];
  if (run.italic) parts.push('italic');
  if (run.bold) parts.push('bold');
  return parts.join(' ') || 'normal';
}
