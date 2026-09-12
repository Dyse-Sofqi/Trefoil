<script lang="ts">
  import type { CanvasApp } from './CanvasApp';
  import { ui } from './ui.svelte';
  import { TOOL_ITEMS, icon } from './icons';

  let { app }: { app: CanvasApp } = $props();
</script>

<div class="trefoil-toolbar" class:readonly={ui.viewMode === 'browse'}>
  {#each TOOL_ITEMS as item, i (item.id)}
    {#if i === 7 || i === 9}
      <span class="trefoil-toolbar-sep"></span>
    {/if}
    <button
      type="button"
      class="trefoil-tool-btn"
      class:active={ui.activeTool === item.id}
      title="{item.label}（{item.key}）"
      aria-label={item.label}
      onclick={() => (ui.activeTool === item.id ? app.setTool('select') : app.setTool(item.id))}
      disabled={ui.viewMode === 'browse'}
    >
      {@html icon(item.icon)}
    </button>
  {/each}
  <span class="trefoil-toolbar-sep"></span>
  <button
    type="button"
    class="trefoil-tool-btn trefoil-settings-toggle"
    class:active={ui.settingsOpen}
    title="设置"
    aria-label="设置"
    onclick={() => (ui.settingsOpen = !ui.settingsOpen)}
  >
    {@html icon('gear')}
  </button>
</div>

<style>
  .trefoil-toolbar {
    position: absolute;
    top: 10px;
    left: 10px;
    z-index: 20;
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 4px;
    border-radius: 8px;
    background: var(--background-primary, #fff);
    border: 1px solid var(--background-modifier-border, #ddd);
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.08);
  }
  .trefoil-toolbar.readonly {
    opacity: 0.85;
  }
  .trefoil-tool-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--text-muted, #555);
    cursor: pointer;
    padding: 0;
  }
  .trefoil-tool-btn:hover {
    background: var(--background-modifier-hover, #eee);
    color: var(--text-normal, #222);
  }
  .trefoil-tool-btn.active {
    background: var(--interactive-accent, #4c8dff);
    color: var(--text-on-accent, #fff);
  }
  .trefoil-tool-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .trefoil-toolbar-sep {
    width: 1px;
    height: 18px;
    margin: 0 3px;
    background: var(--background-modifier-border, #ddd);
  }
</style>
