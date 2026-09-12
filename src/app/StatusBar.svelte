<script lang="ts">
  import type { CanvasApp } from './CanvasApp';
  import { ui } from './ui.svelte';
  import { icon } from './icons';

  let { app }: { app: CanvasApp } = $props();

  const modeLabel = $derived(ui.viewMode === 'normal' ? '正常' : ui.viewMode === 'browse' ? '浏览（只读）' : '聚焦');

  let menuOpen = $state(false);

  function toggleMenu(): void {
    menuOpen = !menuOpen;
  }

  function openHelp(): void {
    menuOpen = false;
    ui.helpOpen = true;
  }

  // 点击按钮/菜单以外区域时收起（capture 先于菜单项 click）
  $effect(() => {
    if (!menuOpen) return;
    const onDown = (e: PointerEvent) => {
      const el = e.target as HTMLElement | null;
      if (!el?.closest('.trefoil-status-menuwrap')) menuOpen = false;
    };
    const onBlur = () => (menuOpen = false);
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('blur', onBlur);
    };
  });
</script>

<div class="trefoil-status">
  <div class="trefoil-status-menuwrap">
    <button
      type="button"
      class="trefoil-status-menu-btn"
      class:active={menuOpen}
      title="菜单"
      aria-label="菜单"
      onclick={toggleMenu}
    >
      {@html icon('menu')}
    </button>
    {#if menuOpen}
      <div class="trefoil-status-menu" role="menu">
        <button type="button" class="trefoil-status-menu-item" role="menuitem" onclick={openHelp}>
          <span class="trefoil-status-menu-ic">{@html icon('circle-question-mark')}</span>
          <span class="trefoil-status-menu-label">帮助</span>
        </button>
      </div>
    {/if}
  </div>
  <button
    type="button"
    class="trefoil-status-zoom"
    title="重置缩放为 100%"
    aria-label="重置缩放为 100%"
    onclick={() => app.engine.resetZoom()}
  >
    缩放 {Math.round(ui.zoom * 100)}%
  </button>
  <span class="trefoil-status-item">{ui.elementCount} 元素</span>
  {#if ui.selectionCount > 0}
    <span class="trefoil-status-item sel">已选 {ui.selectionCount}</span>
  {/if}
  <button
    type="button"
    class="trefoil-status-icon-btn"
    class:active={ui.minimapOpen}
    title={ui.minimapOpen ? '隐藏缩略图' : '显示缩略图'}
    aria-label="缩略图"
    aria-pressed={ui.minimapOpen}
    onclick={() => (ui.minimapOpen = !ui.minimapOpen)}
  >
    {@html icon('scan-square')}
  </button>
  {#if app.engine.laser.strokeCount > 0}
    <button class="trefoil-status-btn" onclick={() => app.engine.laser.clearAll()} title="Esc">清除笔迹</button>
  {/if}
  {#if ui.viewMode !== 'normal'}
    <button class="trefoil-status-btn" onclick={() => app.setViewMode('normal')}>退出{modeLabel}</button>
  {/if}
</div>

<style>
  .trefoil-status {
    position: absolute;
    bottom: 8px;
    left: 10px;
    z-index: 20;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 4px 10px;
    border-radius: 7px;
    background: var(--background-primary, #fff);
    border: 1px solid var(--background-modifier-border, #ddd);
    box-shadow: 0 1px 6px rgba(0, 0, 0, 0.06);
    font-size: 11.5px;
    color: var(--text-muted, #777);
  }
  .trefoil-status-item.sel {
    color: var(--interactive-accent, #4c8dff);
  }
  /* 缩放数字即按钮：外观保持状态栏文本的克制，只在悬停/按下时给出可点反馈。
     高度与菜单/缩略图那两个图标按钮（22px）对齐；内边距用负 margin 抵消，
     保证文字间距仍与其它状态项一致，只是悬停底色向外扩出去。 */
  .trefoil-status-zoom {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 22px;
    border: none;
    background: transparent;
    padding: 0 5px;
    margin: 0 -5px;
    border-radius: 5px;
    font: inherit;
    color: inherit;
    cursor: pointer;
    transition: background-color 0.12s ease, color 0.12s ease;
  }
  .trefoil-status-zoom:hover {
    background: var(--background-modifier-hover, #eee);
    color: var(--text-normal, #222);
  }
  .trefoil-status-zoom:active {
    background: var(--background-modifier-active-hover, #e3e3e3);
  }
  .trefoil-status-zoom:focus-visible {
    outline: none;
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--interactive-accent, #4c8dff) 35%, transparent);
  }
  /* 高度与图标按钮（22px）对齐，整条状态栏的按钮同高 */
  .trefoil-status-btn {
    display: inline-flex;
    align-items: center;
    height: 22px;
    border: none;
    background: var(--interactive-accent, #4c8dff);
    color: var(--text-on-accent, #fff);
    border-radius: 4px;
    padding: 0 8px;
    cursor: pointer;
    font-size: 11px;
  }
  .trefoil-status-menuwrap {
    position: relative;
    display: flex;
    margin-left: -4px;
  }
  .trefoil-status-menu-btn,
  .trefoil-status-icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    padding: 0;
    border: none;
    border-radius: 5px;
    background: transparent;
    color: var(--text-muted, #777);
    cursor: pointer;
  }
  .trefoil-status-menu-btn:hover,
  .trefoil-status-menu-btn.active {
    background: var(--background-modifier-hover, #eee);
    color: var(--text-normal, #222);
  }
  .trefoil-status-menu-btn :global(svg),
  .trefoil-status-icon-btn :global(svg) {
    width: 15px;
    height: 15px;
  }
  /* 缩略图开关：开启时以强调色标示常驻状态 */
  .trefoil-status-icon-btn:hover {
    background: var(--background-modifier-hover, #eee);
    color: var(--text-normal, #222);
  }
  .trefoil-status-icon-btn.active {
    color: var(--interactive-accent, #4c8dff);
  }
  /* 锚定按钮、向上展开、左缘与按钮左缘对齐 */
  .trefoil-status-menu {
    position: absolute;
    left: 0;
    bottom: calc(100% + 10px);
    z-index: 30;
    min-width: 140px;
    padding: 5px;
    border-radius: 8px;
    background: var(--background-primary, #fff);
    border: 1px solid var(--background-modifier-border, #ddd);
    box-shadow: 0 4px 18px rgba(0, 0, 0, 0.14);
  }
  .trefoil-status-menu-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 10px;
    border: none;
    border-radius: 5px;
    background: transparent;
    color: var(--text-normal, #222);
    font-size: 12.5px;
    cursor: pointer;
    white-space: nowrap;
    text-align: left;
  }
  .trefoil-status-menu-item:hover {
    background: var(--background-modifier-hover, #eee);
  }
  .trefoil-status-menu-ic {
    display: flex;
    color: var(--text-muted, #777);
  }
  .trefoil-status-menu-ic :global(svg) {
    width: 15px;
    height: 15px;
  }
  .trefoil-status-menu-label {
    flex: 1;
  }
</style>
