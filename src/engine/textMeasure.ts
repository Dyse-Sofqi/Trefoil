/** 富文本排版：测量 + 换行（支持中英文混行），供 Konva 富文本渲染使用 */
import { parseInline, type Run } from '../core/mdInline';

export interface LaidSeg {
  text: string;
  x: number;
  w: number;
  run: Run;
}

export interface LaidLine {
  segs: LaidSeg[];
  width: number;
  /** 源 Markdown 行索引（空行判断用） */
  srcIndex: number;
}

export interface TextLayout {
  lines: LaidLine[];
  height: number;
  lineHeight: number;
}

let ctx: CanvasRenderingContext2D | null = null;
function measureCtx(): CanvasRenderingContext2D {
  if (!ctx) {
    const cv = document.createElement('canvas');
    cv.width = 8;
    cv.height = 8;
    ctx = cv.getContext('2d')!;
  }
  return ctx;
}

/** 测试钩子：Node 环境无 Canvas，可注入模拟测量上下文 */
export function _setMeasureCtxForTests(c: { font: string; measureText(text: string): { width: number } } | null): void {
  ctx = c as unknown as CanvasRenderingContext2D;
}

/** 将字体族串转为 canvas 可用的 font 字符串（含空格的族名加引号） */
export function canvasFont(family: string): string {
  const fams = family
    .split(',')
    .map((f) => f.trim())
    .filter(Boolean)
    .map((f) => (f.startsWith('"') || f.startsWith("'") ? f : /\s/.test(f) ? `"${f}"` : f));
  return fams.join(', ') || 'sans-serif';
}

function fontString(style: Run, fontSize: number, family: string, baseWeight = 400): string {
  const parts: string[] = [];
  if (runItalic(style)) parts.push('italic');
  if (runBold(style)) parts.push('bold');
  else if (baseWeight !== 400) parts.push(String(baseWeight));
  parts.push(`${fontSize}px`);
  parts.push(style.code ? `${canvasFont('Consolas, Menlo, monospace')}` : canvasFont(family));
  return parts.join(' ');
}

function runBold(r: Run): boolean {
  return r.bold || r.code;
}
function runItalic(r: Run): boolean {
  return r.italic;
}

/** 分词：英文按单词，CJK 按字符 */
function tokenize(text: string, run: Run): { text: string; run: Run }[] {
  const tokens: { text: string; run: Run }[] = [];
  const re = /[\u2E80-\u9FFF\uF900-\uFAFF\uFF01-\uFF60\u3000-\u303F]|[\w#$%^&*()\-+=\[\]{};:'",.<>/?\\|`~!@]+\s*|\s+/gu;
  for (const m of text.match(re) ?? []) tokens.push({ text: m, run });
  if (!tokens.length && text) tokens.push({ text, run });
  return tokens;
}

export function layoutText(
  md: string,
  maxWidth: number,
  fontSize: number,
  fontFamily: string,
  baseWeight = 400,
): TextLayout {
  const c = measureCtx();
  const lineHeight = Math.round(fontSize * 1.5);
  const mdLines = parseInline(md);
  const lines: LaidLine[] = [];

  mdLines.forEach((runs, srcIndex) => {
    const isEmptyLine = runs.every((r) => r.text === '');
    if (isEmptyLine) {
      lines.push({ segs: [], width: 0, srcIndex });
      return;
    }
    // 分词并测量
    type Tok = { text: string; run: Run; w: number };
    const toks: Tok[] = [];
    for (const run of runs) {
      if (!run.text) continue;
      c.font = fontString(run, fontSize, fontFamily, baseWeight);
      for (const t of tokenize(run.text, run)) {
        toks.push({ ...t, w: c.measureText(t.text).width });
      }
    }
    // 贪心换行
    let cur: Tok[] = [];
    let curW = 0;
    const pushLine = (src: number) => {
      const segs = mergeSegs(cur, fontSize, fontFamily, baseWeight);
      lines.push({ segs, width: curW, srcIndex: src });
    };
    for (const t of toks) {
      if (curW + t.w > maxWidth && cur.length) {
        pushLine(srcIndex);
        cur = [];
        curW = 0;
        // 行首空格丢弃
        if (/^\s+$/.test(t.text)) continue;
      }
      cur.push(t);
      curW += t.w;
    }
    pushLine(srcIndex);
  });

  return { lines, height: lines.length * lineHeight, lineHeight };
}

/** 相邻同样式 run 合并，减少 Konva 节点数 */
function mergeSegs(toks: { text: string; run: Run; w: number }[], fontSize: number, family: string, baseWeight = 400): LaidSeg[] {
  const c = measureCtx();
  const segs: LaidSeg[] = [];
  let x = 0;
  let i = 0;
  while (i < toks.length) {
    let j = i + 1;
    while (
      j < toks.length &&
      toks[j].run.bold === toks[i].run.bold &&
      toks[j].run.italic === toks[i].run.italic &&
      toks[j].run.code === toks[i].run.code &&
      toks[j].run.strike === toks[i].run.strike
    ) {
      j++;
    }
    const text = toks.slice(i, j).map((t) => t.text).join('');
    const run = toks[i].run;
    c.font = fontString(run, fontSize, family, baseWeight);
    const w = c.measureText(text).width;
    segs.push({ text, x, w, run });
    x += w;
    i = j;
  }
  return segs;
}

export { fontString };

export interface FontVerticalMetrics {
  /** textBaseline='middle' 的绘制点到字母基线的距离（编辑覆盖层反解 CSS 内边距用） */
  baselineOffset: number;
  /** 绘制点到墨迹竖直中心的距离（正 = 墨迹中心在绘制点下方）；渲染时用它让文字在行距槽里视觉居中 */
  inkCenterOffset: number;
}

const verticalMetricsCache = new Map<string, FontVerticalMetrics>();

/**
 * 字体的竖直度量（按字体串缓存）：实际绘制一次并扫描墨迹得到。
 * 这两个量无法从 measureText 推出——middle 基线取的是 em 框中线，
 * 而汉字/字母的墨迹中心普遍高于 em 中线，直接用行距居中会让文字整体偏上、下方留白。
 */
export function fontVerticalMetrics(font: string): FontVerticalMetrics {
  const hit = verticalMetricsCache.get(font);
  if (hit) return hit;
  let metrics: FontVerticalMetrics = { baselineOffset: 0, inkCenterOffset: 0 };
  try {
    // 样字取「汉字 + 上行字母」：中文为主的内容里墨迹中心更贴近实际（不含下伸部，避免把汉字抬得偏高）
    const SAMPLE = 'Hx国';
    const W = 240;
    const H = 100;
    const baseY = 50;
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const c = cv.getContext('2d', { willReadFrequently: true })!;
    c.font = font;
    c.textBaseline = 'middle';
    c.fillStyle = '#000';
    c.fillText(SAMPLE, 2, baseY);
    const img = c.getImageData(0, 0, W, H).data;
    let top = -1;
    let bottom = -1;
    for (let iy = 0; iy < H; iy++) {
      let ink = false;
      for (let ix = 0; ix < W; ix++) {
        if (img[(iy * W + ix) * 4 + 3] > 25) {
          ink = true;
          break;
        }
      }
      if (ink) {
        if (top < 0) top = iy;
        bottom = iy;
      }
    }
    c.textBaseline = 'alphabetic';
    const ab = c.measureText(SAMPLE);
    if (top >= 0 && ab.actualBoundingBoxAscent !== undefined) {
      metrics = {
        baselineOffset: top - baseY + ab.actualBoundingBoxAscent,
        inkCenterOffset: (top + bottom) / 2 - baseY,
      };
    }
  } catch {
    /* 无 Canvas 环境（单元测试）时退化为 0：仅按行距槽居中 */
  }
  verticalMetricsCache.set(font, metrics);
  return metrics;
}

/** 计算文本节点自动高度 */
export function autoTextHeight(md: string, width: number, fontSize: number, fontFamily: string, baseWeight = 400): number {
  const layout = layoutText(md, Math.max(20, width - 12), fontSize, fontFamily, baseWeight);
  return Math.max(36, layout.height + 10);
}

/** 文本框自适应宽度的上限：自然宽超过它才折行（编辑提交/粘贴/字体调整共用） */
export const TEXT_MAX_WIDTH = 480;

/**
 * 文本内容的贴合宽度（最宽行 + 左右内边距）：文本框自适应文字内容用。
 * 按「上限内容宽」预排版 —— 可折行的长段落折行后取最宽行（框宽 ≤ 上限）；
 * 无法折行的超长单词/URL 整行保留（框随之变宽，避免文字溢出框外）。
 * 空文本给光标位的最小框宽（左右内边距）。
 */
export function autoTextWidth(md: string, fontSize: number, fontFamily: string, baseWeight = 400): number {
  const layout = layoutText(md, TEXT_MAX_WIDTH - 12, fontSize, fontFamily, baseWeight);
  const widest = layout.lines.reduce((m, l) => Math.max(m, l.width), 0);
  return Math.ceil(widest) + 12;
}
