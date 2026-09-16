/** 图标层：Obsidian 宿主注入 lucide 图标解析器；浏览器测试台回退到内置 SVG */

type Resolver = (lucideName: string) => string | null;

let resolver: Resolver | null = null;
const cache = new Map<string, string>();

/** 宿主（Obsidian 插件层）在 onload 时注入 lucide 解析器 */
export function setIconResolver(r: Resolver | null): void {
  resolver = r;
  cache.clear();
}

const wrap = (body: string) =>
  `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

/** 内置回退图标（键 = 内部图标名） */
const ICONS: Record<string, string> = {
  select: wrap('<path d="M5 3l14 8-6.5 1.5L15 19l-2.5 1-2.5-6.5L5 17z"/>'),
  rect: wrap('<rect x="4" y="6" width="16" height="12" rx="1"/>'),
  ellipse: wrap('<ellipse cx="12" cy="12" rx="8" ry="6"/>'),
  diamond: wrap('<path d="M12 3l8 9-8 9-8-9z"/>'),
  triangle: wrap('<path d="M12 4l8 15H4z"/>'),
  arrow: wrap('<path d="M4 20L20 4M20 4h-7M20 4v7"/>'),
  polyline: wrap('<path d="M3 17l5-8 4 5 4-9 5 12"/>'),
  text: wrap('<path d="M5 5h14M12 5v14M9 19h6"/>'),
  laser: wrap('<path d="M6 3l6 14M12 17l1 4M9 4l2 5M15 5l3 9"/><circle cx="12" cy="17" r="1.6"/>'),
  eraser: wrap('<path d="M7 20h10M5 14l8-8 6 6-8 8H7z"/><path d="M9 10l6 6"/>'),
  pan: wrap('<path d="M12 3v18M3 12h18M8 7l4-4 4 4M8 17l4 4 4-4M7 8l-4 4 4 4M17 8l4 4-4 4"/>'),
  gear: wrap('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1"/>'),
  'arrow-up-to-line': wrap('<path d="M5 4h14M12 20V8M6 14l6-6 6 6"/>'),
  'trash-2': wrap('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
  undo: wrap('<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 010 12h-3"/>'),
  redo: wrap('<path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 100 12h3"/>'),
  eye: wrap('<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/>'),
  'h-left': wrap('<path d="M21 6H3M15 12H3M17 18H3"/>'),
  'h-center': wrap('<path d="M21 6H3M17 12H7M19 18H5"/>'),
  'h-right': wrap('<path d="M3 6h18M9 12h12M7 18h12"/>'),
  'h-justify': wrap('<path d="M21 6H3M21 12H3M21 18H3"/>'),
  'v-top': wrap('<path d="M4 3h16"/><rect x="7" y="7" width="10" height="6" rx="1"/><rect x="9" y="16" width="6" height="5" rx="1"/>'),
  'v-middle': wrap('<path d="M4 12h16"/><rect x="7" y="3" width="10" height="6" rx="1"/><rect x="9" y="15" width="6" height="6" rx="1"/>'),
  'v-bottom': wrap('<path d="M4 21h16"/><rect x="7" y="11" width="10" height="6" rx="1"/><rect x="9" y="3" width="6" height="5" rx="1"/>'),
  'chevron-right': wrap('<path d="M9 18l6-6-6-6"/>'),
  'chevron-left': wrap('<path d="M15 18l-6-6 6-6"/>'),
  menu: wrap('<path d="M4 6h16M4 12h16M4 18h16"/>'),
  image: wrap('<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="M21 15l-5-5L5 21"/>'),
  sun: wrap('<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>'),
  moon: wrap('<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>'),
  monitor: wrap('<rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/>'),
  'circle-question-mark': wrap('<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>'),
  'scan-square': wrap('<path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><rect x="8" y="8" width="8" height="8" rx="1"/>'),
};

/** 内部图标名 → Obsidian lucide 图标名 */
const OBSIDIAN_ICON: Record<string, string> = {
  select: 'mouse-pointer-2',
  rect: 'square',
  ellipse: 'circle',
  diamond: 'diamond',
  triangle: 'triangle',
  arrow: 'arrow-up-right',
  polyline: 'spline',
  text: 'type',
  laser: 'highlighter',
  eraser: 'eraser',
  pan: 'hand',
  gear: 'settings',
  'arrow-up-to-line': 'arrow-up-to-line',
  'trash-2': 'trash-2',
  undo: 'undo-2',
  redo: 'redo-2',
  eye: 'eye',
  'h-left': 'align-left',
  'h-center': 'align-center',
  'h-right': 'align-right',
  'h-justify': 'align-justify',
  'v-top': 'align-start-vertical',
  'v-middle': 'align-center-vertical',
  'v-bottom': 'align-end-vertical',
  'chevron-right': 'chevron-right',
  'chevron-left': 'chevron-left',
  image: 'image',
};

/** 解析图标为 SVG 字符串：优先 Obsidian lucide，缺失时回退内置 */
export function icon(name: string): string {
  if (resolver) {
    let cached = cache.get(name);
    if (cached === undefined) {
      const lucideName = OBSIDIAN_ICON[name] ?? name;
      cached = resolver(lucideName) ?? ICONS[name] ?? '';
      cache.set(name, cached);
    }
    return cached;
  }
  return ICONS[name] ?? '';
}

export const TOOL_ITEMS: { id: string; icon: string; label: string; key: string }[] = [
  { id: 'select', icon: 'select', label: '选择', key: 'V' },
  { id: 'rect', icon: 'rect', label: '矩形', key: 'R' },
  { id: 'ellipse', icon: 'ellipse', label: '圆形/椭圆', key: 'C' },
  { id: 'diamond', icon: 'diamond', label: '菱形', key: 'D' },
  { id: 'triangle', icon: 'triangle', label: '三角形', key: '5' },
  { id: 'arrow', icon: 'arrow', label: '箭头', key: '6' },
  { id: 'polyline', icon: 'polyline', label: '直线/折线（双击结束）', key: '7' },
  { id: 'text', icon: 'text', label: '文本', key: 'T' },
  { id: 'laser', icon: 'laser', label: '镭射笔', key: 'L' },
  { id: 'eraser', icon: 'eraser', label: '橡皮擦（滚轮调半径）', key: 'E' },
];
