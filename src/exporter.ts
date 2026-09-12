/**
 * 导出：PNG（可选透明背景、可选包含镭射笔迹图层）/ SVG。
 * PNG 走 Konva 舞台快照；SVG 由数据模型直接序列化（几何精确、文本保真）。
 */
import type { CanvasApp } from './app/CanvasApp';
import { unionRect, sideAnchor, inferSides, bezierPath, type Rect } from './core/geometry';
import { isContainerNode, isFileNode, isShapeNode, isTextNode, type CanvasEdge, type CanvasNode } from './core/types';
import { canvasFont, fontVerticalMetrics, layoutText } from './engine/textMeasure';
import { resolveColor, type Palette } from './engine/palette';
import { pointsOf } from './engine/NodeView';

export interface ExportOptions {
  transparent: boolean;
  includeLaser: boolean;
  pixelRatio?: number;
}

// ---------- PNG ----------

function prepareExportStage(
  app: CanvasApp,
  opts: ExportOptions,
): { restore: () => void } | null {
  const engine = app.engine;
  let bbox: Rect | null = engine.contentBBox(opts.includeLaser);
  if (!bbox || bbox.width <= 0 || bbox.height <= 0) return null;
  bbox = unionRect(null, bbox);

  const pad = 32;
  const size = {
    width: Math.ceil(bbox.width + pad * 2),
    height: Math.ceil(bbox.height + pad * 2),
  };

  const prevVp = { ...engine.vp };
  const prevStageSize = { width: engine.stage.width(), height: engine.stage.height() };
  const prevBg = engine.layers.bg.visible();
  const prevLaser = engine.layers.laser.visible();
  const prevOverlay = engine.layers.overlay.visible();

  engine.layers.overlay.visible(false);
  engine.layers.bg.visible(!opts.transparent);
  engine.layers.laser.visible(opts.includeLaser);

  engine.stage.size({ width: size.width, height: size.height });
  engine.background.width = size.width;
  engine.background.height = size.height;
  engine.setViewport({ x: bbox.x - pad, y: bbox.y - pad, scale: 1 });

  return {
    restore: () => {
      engine.layers.overlay.visible(prevOverlay);
      engine.layers.bg.visible(prevBg);
      engine.layers.laser.visible(prevLaser);
      engine.stage.size(prevStageSize);
      engine.background.width = prevStageSize.width;
      engine.background.height = prevStageSize.height;
      engine.setViewport(prevVp);
    },
  };
}

export function exportPng(app: CanvasApp, opts: ExportOptions): string | null {
  const prepared = prepareExportStage(app, opts);
  if (!prepared) return null;
  try {
    return app.engine.stage.toDataURL({ pixelRatio: opts.pixelRatio ?? 2 });
  } finally {
    prepared.restore();
  }
}

// ---------- SVG ----------

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const num = (v: number): string => String(Math.round(v * 100) / 100);

export async function exportSvg(app: CanvasApp): Promise<string | null> {
  const engine = app.engine;
  const palette = engine.palette;
  let bbox: Rect | null = null;
  for (const n of app.doc.nodes) {
    if (engine.erasedIds.has(n.id)) continue;
    bbox = unionRect(bbox, { x: n.x, y: n.y, width: n.width, height: n.height });
  }
  if (!bbox) return null;
  const pad = 32;
  const vb = { x: bbox.x - pad, y: bbox.y - pad, w: bbox.width + pad * 2, h: bbox.height + pad * 2 };

  // 图片节点：先把 app:// / blob: 资源拉成 data URL 内嵌，保证导出的 SVG 自包含
  const imageData = new Map<string, string | null>();
  const tasks = app.doc.nodes
    .filter((n) => isFileNode(n) && n.file)
    .map(async (n) => {
      const url = app.adapter.resolveImageUrl?.(n.file!) ?? n.file!;
      imageData.set(n.file!, await fetchAsDataUrl(url).catch(() => null));
    });
  await Promise.all(tasks);

  const parts: string[] = [];
  // 连线在下层
  for (const e of app.doc.edges) {
    const from = app.doc.getNode(e.fromNode);
    const to = app.doc.getNode(e.toNode);
    if (!from || !to || engine.isNodeHidden(e.fromNode) || engine.isNodeHidden(e.toNode)) continue;
    parts.push(edgeToSvg(e, from, to, palette));
  }
  for (const n of app.doc.nodes) {
    if (engine.erasedIds.has(n.id) || engine.isNodeHidden(n.id)) continue;
    parts.push(nodeToSvg(n, { palette, getImageUrl: (raw) => imageData.get(raw) ?? null }));
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${num(vb.x)} ${num(vb.y)} ${num(vb.w)} ${num(vb.h)}" width="${num(vb.w)}" height="${num(vb.h)}">`,
    ...parts,
    `</svg>`,
  ].join('\n');
}

/** 任意可访问资源 → data URL（失败返回 null） */
async function fetchAsDataUrl(url: string): Promise<string | null> {
  if (/^data:/i.test(url)) return url;
  if (!/^(https?|app|blob|file):/i.test(url)) return null;
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const blob = await resp.blob();
    return await new Promise<string | null>((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => resolve(null);
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

function nodeToSvg(n: CanvasNode, engine: { palette: Palette; getImageUrl?(raw: string): string | null }): string {
  const palette = engine.palette;
  const opacity = n.opacity !== undefined && n.opacity !== 1 ? ` opacity="${num(n.opacity)}"` : '';
  if (isContainerNode(n)) {
    return `<rect x="${num(n.x)}" y="${num(n.y)}" width="${num(n.width)}" height="${num(n.height)}" fill="none" stroke="${palette.containerBorder}" stroke-width="1.5" stroke-dasharray="7 5"${opacity}/>`;
  }
  if (isTextNode(n)) {
    return textToSvg(n, palette, opacity);
  }
  if (isFileNode(n)) {
    return fileToSvg(n, engine, opacity);
  }
  if (isShapeNode(n)) {
    return shapeToSvg(n, palette, opacity);
  }
  return '';
}

/** file 节点（图片）：data URL 内嵌；加载失败时给占位框（保证导出不崩） */
function fileToSvg(n: CanvasNode, engine: { palette: Palette; getImageUrl?(raw: string): string | null }, opacity: string): string {
  const url = engine.getImageUrl?.(n.file ?? '') ?? n.file ?? '';
  const x = num(n.x);
  const y = num(n.y);
  const w = num(n.width);
  const h = num(n.height);
  const label = (n.file ?? '').split('/').pop() ?? '';
  const flipT =
    n.flipX || n.flipY
      ? ` transform="translate(${num(n.flipX ? 2 * n.x + n.width : 0)} ${num(n.flipY ? 2 * n.y + n.height : 0)}) scale(${n.flipX ? -1 : 1} ${n.flipY ? -1 : 1})"`
      : '';
  const wrap = (body: string): string => (flipT ? `<g${flipT}>${body}</g>` : body);
  if (url && /^data:/i.test(url)) {
    return wrap(`<image x="${x}" y="${y}" width="${w}" height="${h}" href="${esc(url)}" preserveAspectRatio="xMidYMid slice"${opacity}/>`);
  }
  return wrap(
    `<g${opacity}><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${engine.palette.canvasBg}" stroke="${engine.palette.textMuted}" stroke-width="1" stroke-dasharray="4 4"/>` +
      `<text x="${num(n.x + n.width / 2)}" y="${num(n.y + n.height / 2)}" font-size="11" fill="${engine.palette.textMuted}" text-anchor="middle">${esc(label || '图片')}</text></g>`,
  );
}

function textToSvg(
  n: CanvasNode,
  palette: Palette,
  opacity: string,
): string {
  const fontSize = n.fontSize ?? 16;
  const family = n.fontFamily ?? 'system-ui, sans-serif';
  const baseWeight = n.fontWeight ?? 400;
  const color = resolveColor(n.color, palette) ?? palette.text;
  const layout = layoutText(n.text ?? '', Math.max(20, n.width - 12), fontSize, family, baseWeight);
  const align = n.hAlign ?? 'left';
  // 与画布渲染一致：恒垂直居中；SVG 用字母基线，基线 = 行距槽中线（含墨迹居中修正）+ 基线偏移
  const startY = Math.max(6, (n.height - layout.height) / 2);
  const vm = fontVerticalMetrics(`${baseWeight >= 600 ? 'bold ' : ''}${fontSize}px ${canvasFont(family)}`);
  const baseline = layout.lineHeight / 2 - vm.inkCenterOffset + vm.baselineOffset;
  let y = startY;
  const out: string[] = [];
  for (const line of layout.lines) {
    const lineX =
      align === 'left' || align === 'justify'
        ? 6
        : align === 'right'
          ? n.width - 6 - line.width
          : (n.width - line.width) / 2;
    for (const seg of line.segs) {
      const style = `${seg.run.italic ? ' font-style="italic"' : ''}${
        seg.run.bold || seg.run.code
          ? ' font-weight="bold"'
          : baseWeight !== 400
            ? ` font-weight="${baseWeight}"`
            : ''
      }`;
      const segColor = seg.run.code ? palette.accent : color;
      const fam = seg.run.code ? 'Consolas, Menlo, monospace' : family;
      out.push(
        `<text x="${num(n.x + lineX + seg.x)}" y="${num(n.y + y + baseline)}" font-size="${fontSize}" font-family="${esc(fam)}" fill="${segColor}"${style}${opacity}>${esc(seg.text)}</text>`,
      );
      if (seg.run.strike) {
        out.push(
          `<line x1="${num(n.x + lineX + seg.x)}" y1="${num(n.y + y + baseline - fontSize * 0.28)}" x2="${num(n.x + lineX + seg.x + seg.w)}" y2="${num(n.y + y + baseline - fontSize * 0.28)}" stroke="${segColor}" stroke-width="1"${opacity}/>`,
        );
      }
    }
    y += layout.lineHeight;
  }
  return out.join('\n');
}

function shapeToSvg(n: CanvasNode, palette: Palette, opacity: string): string {
  const stroke = resolveColor(n.stroke, palette) ?? palette.nodeStroke;
  const sw = n.strokeSize ?? 2;
  const fill = n.fill ? resolveColor(n.fill, palette) ?? 'none' : 'none';
  const common = ` stroke="${stroke}" stroke-width="${sw}"${opacity}`;
  const x = n.x;
  const y = n.y;
  const w = n.width;
  const h = n.height;
  // 翻转：与画布渲染一致（围绕包围盒镜像）
  const flipT =
    n.flipX || n.flipY
      ? ` transform="translate(${num(n.flipX ? 2 * x + w : 0)} ${num(n.flipY ? 2 * y + h : 0)}) scale(${n.flipX ? -1 : 1} ${n.flipY ? -1 : 1})"`
      : '';
  const wrap = (body: string): string => (flipT ? `<g${flipT}>${body}</g>` : body);
  switch (n.shape) {
    case 'ellipse':
      return wrap(`<ellipse cx="${num(x + w / 2)}" cy="${num(y + h / 2)}" rx="${num(w / 2)}" ry="${num(h / 2)}" fill="${fill}"${common}/>`);
    case 'diamond':
      return wrap(
        `<polygon points="${num(x + w / 2)},${num(y)} ${num(x + w)},${num(y + h / 2)} ${num(x + w / 2)},${num(y + h)} ${num(x)},${num(y + h / 2)}" fill="${fill}"${common}/>`,
      );
    case 'triangle':
      return wrap(`<polygon points="${num(x + w / 2)},${num(y)} ${num(x + w)},${num(y + h)} ${num(x)},${num(y + h)}" fill="${fill}"${common}/>`);
    case 'rect':
      return wrap(`<rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" fill="${fill}"${common}/>`);
    case 'line':
    case 'polyline': {
      const pts = pointsOf(n)
        .map(([px, py]) => `${num(x + px)},${num(y + py)}`)
        .join(' ');
      return wrap(`<polyline points="${pts}" fill="none"${common} stroke-linecap="round" stroke-linejoin="round"/>`);
    }
    case 'arrow': {
      const pts = pointsOf(n).map(([px, py]) => ({ x: x + px, y: y + py }));
      const ptsStr = pts.map((p) => `${num(p.x)},${num(p.y)}`).join(' ');
      const [p1, p2] = [pts[pts.length - 2], pts[pts.length - 1]];
      const ang = Math.atan2(p2.y - p1.y, p2.x - p1.x);
      const len = Math.max(10, sw * 3.5);
      const spread = 0.42;
      const head = [
        `${num(p2.x)},${num(p2.y)}`,
        `${num(p2.x - len * Math.cos(ang - spread))},${num(p2.y - len * Math.sin(ang - spread))}`,
        `${num(p2.x - len * Math.cos(ang + spread))},${num(p2.y - len * Math.sin(ang + spread))}`,
      ].join(' ');
      return wrap(`<polyline points="${ptsStr}" fill="none"${common} stroke-linecap="round"/><polygon points="${head}" fill="${stroke}"${opacity}/>`);
    }
    default:
      return '';
  }
}

function edgeToSvg(
  e: CanvasEdge,
  from: CanvasNode,
  to: CanvasNode,
  palette: Palette,
): string {
  const fr = { x: from.x, y: from.y, width: from.width, height: from.height };
  const tr = { x: to.x, y: to.y, width: to.width, height: to.height };
  const sides = inferSides(fr, tr);
  const fromSide = e.fromSide ?? sides.fromSide;
  const toSide = e.toSide ?? sides.toSide;
  const a = sideAnchor(fr, fromSide);
  const b = sideAnchor(tr, toSide);
  const { path } = bezierPath(a, fromSide, b, toSide);
  const [, c1, c2, bEnd] = path;
  const isMindmap = e.kind === 'mindmap';
  const color = resolveColor(e.color, palette) ?? (isMindmap ? palette.accent : palette.edge);
  const sw = isMindmap ? 1.6 : 2;
  const d = `M ${num(a.x)} ${num(a.y)} C ${num(c1.x)} ${num(c1.y)}, ${num(c2.x)} ${num(c2.y)}, ${num(bEnd.x)} ${num(bEnd.y)}`;
  let out = `<path d="${d}" fill="none" stroke="${color}" stroke-width="${sw}"${isMindmap ? ' opacity="0.85"' : ''}/>`;
  if (!isMindmap) {
    const tan = { x: bEnd.x - c2.x, y: bEnd.y - c2.y };
    const ang = Math.atan2(tan.y, tan.x);
    const len = 9;
    const spread = 0.45;
    const head = [
      `${num(bEnd.x)},${num(bEnd.y)}`,
      `${num(bEnd.x - len * Math.cos(ang - spread))},${num(bEnd.y - len * Math.sin(ang - spread))}`,
      `${num(bEnd.x - len * Math.cos(ang + spread))},${num(bEnd.y - len * Math.sin(ang + spread))}`,
    ].join(' ');
    out += `\n<polygon points="${head}" fill="${color}"/>`;
  }
  return out;
}
