/** 画布光标：以 CSS 类切换，避免直接写入 element.style（Obsidian 插件样式规范） */

/** 取值 ↔ 类名一一对应；类定义见 src/styles.css */
const CURSOR_CLASSES: Record<string, string> = {
  default: 'trefoil-cursor-default',
  grab: 'trefoil-cursor-grab',
  grabbing: 'trefoil-cursor-grabbing',
  crosshair: 'trefoil-cursor-crosshair',
  none: 'trefoil-cursor-none',
  text: 'trefoil-cursor-text',
};

const ALL_CLASSES = Object.values(CURSOR_CLASSES);

export function applyCursor(el: HTMLElement, cursor: string): void {
  const next = CURSOR_CLASSES[cursor] ?? CURSOR_CLASSES.default;
  for (const cls of ALL_CLASSES) {
    if (cls !== next) el.classList.remove(cls);
  }
  el.classList.add(next);
}
