<script lang="ts">
  import type { CanvasApp } from './CanvasApp';
  import { ui, closeContextMenu } from './ui.svelte';
  import type { MenuItem } from './contextMenu';

  let { app }: { app: CanvasApp } = $props();

  /** 当前展开子菜单的条目下标（子菜单嵌在条目内，相对定位天然贴合主菜单） */
  let openSub = $state<number | null>(null);
  /** 屏幕右侧空间不足时子菜单向左展开 */
  let subToRight = $state(true);
  /** 进入无子菜单条目时的延迟关闭（斜向移向子菜单时避免被途经行误关） */
  let closeTimer: number | null = null;

  const pos = $derived.by(() => {
    if (!ui.contextMenu) return null;
    const menuW = 240;
    const menuH = Math.min(420, (ui.contextMenu.items.length + 2) * 34);
    return {
      left: Math.max(4, Math.min(ui.contextMenu.sx, window.innerWidth - menuW - 8)),
      top: Math.max(4, Math.min(ui.contextMenu.sy, window.innerHeight - menuH - 8)),
    };
  });

  function cancelSubClose(): void {
    if (closeTimer !== null) {
      clearTimeout(closeTimer);
      closeTimer = null;
    }
  }

  function enterItem(e: PointerEvent, item: MenuItem, i: number): void {
    cancelSubClose();
    if (!item.children) {
      if (openSub !== null) {
        closeTimer = window.setTimeout(() => {
          openSub = null;
          closeTimer = null;
        }, 220);
      }
      return;
    }
    const el = e.currentTarget as HTMLElement;
    const r = el.getBoundingClientRect();
    subToRight = r.right + 226 <= window.innerWidth;
    openSub = i;
  }

  function run(item: MenuItem): void {
    if (item.disabled) return;
    if (item.children) return;
    closeContextMenu();
    item.action?.();
    void app;
  }

  function runSub(e: Event, item: MenuItem): void {
    e.stopPropagation();
    run(item);
  }

  function onWindowPointerDown(e: PointerEvent) {
    const el = e.target as HTMLElement;
    if (!el.closest('.trefoil-ctxmenu')) closeContextMenu();
  }

  $effect(() => {
    if (ui.contextMenu) {
      cancelSubClose();
      openSub = null;
    }
  });

  $effect(() => {
    window.addEventListener('pointerdown', onWindowPointerDown, true);
    window.addEventListener('blur', closeContextMenu);
    return () => {
      window.removeEventListener('pointerdown', onWindowPointerDown, true);
      window.removeEventListener('blur', closeContextMenu);
    };
  });
</script>

{#if ui.contextMenu && pos}
  <div class="trefoil-ctxmenu" style:left="{pos.left}px" style:top="{pos.top}px" role="menu">
    {#each ui.contextMenu.items as item, i (i)}
      {#if item.separator}
        <div class="trefoil-ctx-sep"></div>
      {:else}
        <div
          class="trefoil-ctx-item"
          class:danger={item.danger}
          class:disabled={item.disabled}
          role="menuitem"
          onpointerenter={(e) => enterItem(e, item, i)}
          onclick={() => run(item)}
        >
          <span class="trefoil-ctx-check">{item.checked ? '✓' : ''}</span>
          <span class="trefoil-ctx-label">{item.label}</span>
          {#if item.hint}<span class="trefoil-ctx-hint">{item.hint}</span>{/if}
          {#if item.children}<span class="trefoil-ctx-arrow">›</span>{/if}
          {#if item.children && openSub === i}
            <div class="trefoil-ctxmenu trefoil-ctx-sub" class:sub-left={!subToRight} role="menu" onpointerenter={cancelSubClose}>
              {#each item.children as sub, j (j)}
                {#if sub.separator}
                  <div class="trefoil-ctx-sep"></div>
                {:else}
                  <div
                    class="trefoil-ctx-item"
                    class:danger={sub.danger}
                    class:disabled={sub.disabled}
                    onclick={(e) => runSub(e, sub)}
                    role="menuitem"
                  >
                    <span class="trefoil-ctx-check">{sub.checked ? '✓' : ''}</span>
                    <span class="trefoil-ctx-label">{sub.label}</span>
                  </div>
                {/if}
              {/each}
            </div>
          {/if}
        </div>
      {/if}
    {/each}
  </div>
{/if}

<style>
  .trefoil-ctxmenu {
    position: fixed;
    z-index: 1000;
    min-width: 200px;
    padding: 5px;
    border-radius: 8px;
    background: var(--background-primary, #fff);
    border: 1px solid var(--background-modifier-border, #ddd);
    box-shadow: 0 4px 18px rgba(0, 0, 0, 0.14);
    font-size: 13px;
  }
  .trefoil-ctx-item {
    position: relative;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 10px;
    border-radius: 5px;
    cursor: pointer;
    color: var(--text-normal, #222);
    white-space: nowrap;
  }
  .trefoil-ctx-item:hover {
    background: var(--background-modifier-hover, #eee);
  }
  .trefoil-ctx-item.disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .trefoil-ctx-item.danger {
    color: var(--text-error, #d33);
  }
  .trefoil-ctx-check {
    width: 14px;
    flex: none;
    color: var(--interactive-accent, #4c8dff);
  }
  .trefoil-ctx-label {
    flex: 1;
  }
  .trefoil-ctx-hint {
    color: var(--text-faint, #999);
    font-size: 11px;
    margin-left: 12px;
  }
  .trefoil-ctx-arrow {
    color: var(--text-faint, #999);
    margin-left: 6px;
  }
  .trefoil-ctx-sep {
    height: 1px;
    margin: 4px 8px;
    background: var(--background-modifier-border, #ddd);
  }
  /* 子菜单：嵌在条目内相对定位，左缘贴合主菜单右缘（6px = 内边距 5 + 边框 1）；
     clip-path 裁掉贴合侧的投影，避免阴影盖在主菜单上 */
  .trefoil-ctx-sub {
    position: absolute;
    left: calc(100% + 6px);
    top: -6px;
    max-height: none;
    clip-path: inset(-24px -24px -24px 0);
  }
  .trefoil-ctx-sub.sub-left {
    left: auto;
    right: calc(100% + 6px);
    clip-path: inset(-24px 0 -24px -24px);
  }
</style>
