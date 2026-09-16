/**
 * 导出：PNG（可选透明背景、可选包含镭射笔迹图层）/ SVG。
 * PNG 走 Konva 舞台快照；SVG 由数据模型直接序列化（几何精确、文本保真）。
 */
import type { CanvasApp } from './app/CanvasApp';
import { unionRect, sideAnchor, inferSides, bezierPath, mindmapEdgeCurve, type Rect } from './core/geometry';
import { isContainerNode, isFileNode, isShapeNode, isTextNode, type CanvasEdge, type CanvasNode } from './core/types';
import { paintOrder } from './core/zorder';
import { CONTAINER_DEFAULT_FILL_OPACITY, CONTAINER_DEFAULT_RADIUS } from './core/defaults';
import { canvasFont, fontVerticalMetrics, layoutText } from './engine/textMeasure';
import { resolveColor, type Palette } from './engine/palette';
import { pointsOf } from './engine/NodeView';
import { arrowHeadParts } from './engine/arrowHead';
import { arrowCurve } from './core/arrowLink';

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
  for (const n of paintOrder(app.doc.nodes)) {
    if (engine.erasedIds.has(n.id) || engine.isNodeHidden(n.id)) continue;
    parts.push(nodeToSvg(n, { palette, getImageUrl: (raw) => imageData.get(raw) ?? null, getNode: (id) => app.doc.getNode(id) }));
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

function nodeToSvg(
  n: CanvasNode,
  engine: { palette: Palette; getImageUrl?(raw: string): string | null; getNode?(id: string): CanvasNode | undefined },
): string {
  const palette = engine.palette;
  const opacity = n.opacity !== undefined && n.opacity !== 1 ? ` opacity="${num(n.opacity)}"` : '';
  if (isContainerNode(n)) {
    // 与画布渲染一致：先铺背景（透明度 = 节点 opacity × fillOpacity），再压虚线边框（0.85 × 节点 opacity）。
    // 圆角与背景透明度未显式设置时走容器默认值（见 core/defaults）。
    const alpha = n.opacity ?? 1;
    const radius = Math.max(0, n.borderRadius ?? CONTAINER_DEFAULT_RADIUS);
    const box = `x="${num(n.x)}" y="${num(n.y)}" width="${num(n.width)}" height="${num(n.height)}" rx="${num(radius)}"`;
    const out: string[] = [];
    const fill = n.fill ? (resolveColor(n.fill, palette) ?? null) : null;
    if (fill) {
      const a = alpha * Math.min(1, Math.max(0, n.fillOpacity ?? CONTAINER_DEFAULT_FILL_OPACITY));
      out.push(`<rect ${box} fill="${fill}"${a < 1 ? ` opacity="${num(a)}"` : ''}/>`);
    }
    const borderAlpha = alpha * 0.85;
    out.push(
      `<rect ${box} fill="none" stroke="${palette.containerBorder}" stroke-width="1.5" stroke-dasharray="7 5"${borderAlpha < 1 ? ` opacity="${num(borderAlpha)}"` : ''}/>`,
    );
    return out.join('');
  }
  if (isTextNode(n)) {
    return textToSvg(n, palette, opacity);
  }
  if (isFileNode(n)) {
    return fileToSvg(n, engine, opacity);
  }
  if (isShapeNode(n)) {
    return shapeToSvg(n, palette, opacity, engine.getNode);
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
    const cap = (n.caption !== undefined ? n.caption : (n.file ?? '').split('/').pop()?.replace(/\.[^.]+$/, '') ?? '').trim();
    let capSvg = '';
    if (cap) {
      // x/y/w/h 已是格式化字符串：运算时转回数字
      const capW = cap.length * 13 * 0.6 + 8;
      const capX = Number(x) + Number(w) / 2 - capW / 2;
      const capY = Number(y) + Number(h) + 4;
      capSvg = `<rect x="${num(capX)}" y="${num(capY)}" width="${num(capW)}" height="20" rx="4" fill="${engine.palette.canvasBg}" opacity="0.92"/><text x="${num(capX + capW / 2)}" y="${num(capY + 14)}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="13" fill="${engine.palette.text}"${opacity}>${esc(cap)}</text>`;
    }
    return wrap(`<image x="${x}" y="${y}" width="${w}" height="${h}" href="${esc(url)}" preserveAspectRatio="xMidYMid slice"${opacity}/>` + capSvg);
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
  // 背景/实体边框：与画布渲染同一几何 —— 开边框时内缩线宽一半、圆角夹取到框内可达最大值，先画（压在文字下方）
  const bw = n.border ? Math.max(1, Math.min(n.strokeSize ?? 2, n.width, n.height)) : 0;
  const inset = bw / 2;
  const frameR = Math.min(Math.max(0, n.borderRadius ?? 0), Math.max(0, Math.min(n.width, n.height) / 2 - inset));
  const fx = num(n.x + inset);
  const fy = num(n.y + inset);
  const fw = num(Math.max(0, n.width - bw));
  const fh = num(Math.max(0, n.height - bw));
  if (n.fill) {
    const fill = resolveColor(n.fill, palette) ?? 'none';
    out.push(`<rect x="${fx}" y="${fy}" width="${fw}" height="${fh}" rx="${num(frameR)}" fill="${fill}"${opacity}/>`);
  }
  if (n.border) {
    const stroke = resolveColor(n.stroke, palette) ?? palette.nodeStroke;
    const dash =
      n.borderStyle === 'dashed'
        ? ` stroke-dasharray="${num(bw * 4)} ${num(bw * 3)}"`
        : n.borderStyle === 'dotted'
          ? ` stroke-dasharray="0.01 ${num(bw * 1.9)}" stroke-linecap="round"`
          : '';
    out.push(`<rect x="${fx}" y="${fy}" width="${fw}" height="${fh}" rx="${num(frameR)}" fill="none" stroke="${stroke}" stroke-width="${num(bw)}"${dash}${opacity}/>`);
  }
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

function shapeToSvg(n: CanvasNode, palette: Palette, opacity: string, getNode?: (id: string) => CanvasNode | undefined): string {
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
    case 'polyline':
    case 'arrow': {
      // 双端绑定：与画布渲染同款的三次贝塞尔（端点样式仍生效，切线方向放端点）
      if (getNode && n.fromNode && n.toNode) {
        const bg = palette.canvasBg;
        const curve = arrowCurve(n, getNode);
        if (curve) {
          const [cx1x, cx1y, cx2x, cx2y] = [curve.path[2]!, curve.path[3]!, curve.path[4]!, curve.path[5]!];
          const ax = curve.path[0]!, ay = curve.path[1]!, bx = curve.path[6]!, by = curve.path[7]!;
          const d = `M ${num(ax)} ${num(ay)} C ${num(cx1x)} ${num(cx1y)}, ${num(cx2x)} ${num(cx2y)}, ${num(bx)} ${num(by)}`;
          const headSvgC = (style: string, from: readonly number[], to: readonly number[]): string => {
            const partsH = arrowHeadParts({ x: from[0]!, y: from[1]! }, { x: to[0]!, y: to[1]! }, sw, style as never);
            if (!partsH) return '';
            if (partsH.triangle) {
              const pts3 = partsH.triangle.map((v) => num(v)).join(',');
              return partsH.hollowFill
                ? `<polygon points="${pts3}" fill="${bg}" stroke="${stroke}" stroke-width="${sw}"${opacity}/>`
                : `<polygon points="${pts3}" fill="${stroke}"${opacity}/>`;
            }
            if (partsH.chevron) {
              const vp = partsH.chevron.map((v) => num(v)).join(' ');
              return `<polyline points="${vp}" fill="none" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"${opacity}/>`;
            }
            if (partsH.circle) {
              const c = partsH.circle;
              return partsH.hollowFill
                ? `<circle cx="${num(c.x)}" cy="${num(c.y)}" r="${num(c.r)}" fill="${bg}" stroke="${stroke}" stroke-width="${sw}"${opacity}/>`
                : `<circle cx="${num(c.x)}" cy="${num(c.y)}" r="${num(c.r)}" fill="${stroke}"${opacity}/>`;
            }
            return '';
          };
          const headStyleS = n.headStyle ?? (n.shape === 'arrow' ? 'solid' : 'none');
          const tailStyleS = n.tailStyle ?? 'none';
          return wrap(
            `<path d="${d}" fill="none"${common} stroke-linecap="round"/>` +
              (tailStyleS !== 'none' ? headSvgC(tailStyleS, [curve.path[2]!, curve.path[3]!], [ax, ay]) : '') +
              (headStyleS !== 'none' ? headSvgC(headStyleS, [cx2x, cx2y], [bx, by]) : ''),
          );
        }
      }
      const pts = pointsOf(n).map(([px, py]) => ({ x: x + px, y: y + py }));
      // 端点样式与画布渲染一致（arrow 缺省实心终点）；两端回缩后再画端点
      const head = n.headStyle ?? (n.shape === 'arrow' ? 'solid' : 'none');
      const tail = n.tailStyle ?? 'none';
      const headParts = arrowHeadParts(pts[pts.length - 2]!, pts[pts.length - 1]!, sw, head);
      const tailParts = pts.length >= 2 ? arrowHeadParts(pts[1]!, pts[0]!, sw, tail) : null;
      const shaft = pts.map((p, i) =>
        i === 0 && tailParts ? tailParts.shaftEnd : i === pts.length - 1 && headParts ? headParts.shaftEnd : p,
      );
      const ptsStr = shaft.map((p) => `${num(p.x)},${num(p.y)}`).join(' ');
      const bg = palette.canvasBg;
      const headSvg = (parts: ReturnType<typeof arrowHeadParts>): string => {
        if (!parts) return '';
        if (parts.triangle) {
          const points = parts.triangle.map((v) => num(v)).join(',');
          return parts.hollowFill
            ? `<polygon points="${points}" fill="${bg}" stroke="${stroke}" stroke-width="${sw}"${opacity}/>`
            : `<polygon points="${points}" fill="${stroke}"${opacity}/>`;
        }
        if (parts.chevron) {
          const points = parts.chevron.map((v) => num(v)).join(' ');
          return `<polyline points="${points}" fill="none" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"${opacity}/>`;
        }
        if (parts.circle) {
          return parts.hollowFill
            ? `<circle cx="${num(parts.circle.x)}" cy="${num(parts.circle.y)}" r="${num(parts.circle.r)}" fill="${bg}" stroke="${stroke}" stroke-width="${sw}"${opacity}/>`
            : `<circle cx="${num(parts.circle.x)}" cy="${num(parts.circle.y)}" r="${num(parts.circle.r)}" fill="${stroke}"${opacity}/>`;
        }
        return '';
      };
      const dash = n.strokeStyle === 'dashed' ? ` stroke-dasharray="${num(Math.max(8, sw * 4))} ${num(Math.max(6, sw * 2.8))}"` : n.strokeStyle === 'dotted' ? ` stroke-dasharray="1 ${num(Math.max(4, sw * 2.4))}"` : '';
      return wrap(
        `<polyline points="${ptsStr}" fill="none"${common}${dash} stroke-linecap="round" stroke-linejoin="round"/>` +
          headSvg(tailParts) +
          headSvg(headParts),
      );
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
  if (e.kind === 'mindmap') {
    // 导图分支线：与画布 EdgeView 同一条三次贝塞尔（水平切线、张力随水平距离缩放），无箭头
    const [p0, c1, c2, p1] = mindmapEdgeCurve(fr, tr).path;
    const color = resolveColor(e.color, palette) ?? palette.accent;
    const d = `M ${num(p0.x)} ${num(p0.y)} C ${num(c1.x)} ${num(c1.y)}, ${num(c2.x)} ${num(c2.y)}, ${num(p1.x)} ${num(p1.y)}`;
    return `<path d="${d}" fill="none" stroke="${color}" stroke-width="1.6" opacity="0.85"/>`;
  }
  const sides = inferSides(fr, tr);
  const fromSide = e.fromSide ?? sides.fromSide;
  const toSide = e.toSide ?? sides.toSide;
  const a = sideAnchor(fr, fromSide);
  const b = sideAnchor(tr, toSide);
  const { path } = bezierPath(a, fromSide, b, toSide);
  const [, c1, c2, bEnd] = path;
  const color = resolveColor(e.color, palette) ?? palette.edge;
  const d = `M ${num(a.x)} ${num(a.y)} C ${num(c1.x)} ${num(c1.y)}, ${num(c2.x)} ${num(c2.y)}, ${num(bEnd.x)} ${num(bEnd.y)}`;
  const tan = { x: bEnd.x - c2.x, y: bEnd.y - c2.y };
  const ang = Math.atan2(tan.y, tan.x);
  const len = 9;
  const spread = 0.45;
  const head = [
    `${num(bEnd.x)},${num(bEnd.y)}`,
    `${num(bEnd.x - len * Math.cos(ang - spread))},${num(bEnd.y - len * Math.sin(ang - spread))}`,
    `${num(bEnd.x - len * Math.cos(ang + spread))},${num(bEnd.y - len * Math.sin(ang + spread))}`,
  ].join(' ');
  return `<path d="${d}" fill="none" stroke="${color}" stroke-width="2"/>\n<polygon points="${head}" fill="${color}"/>`;
}
