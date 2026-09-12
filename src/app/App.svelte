<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { HostAdapter } from './host';
  import type { TrefoilSettings } from '../core/defaults';
  import { CanvasApp } from './CanvasApp';
  import { ui, settings } from './ui.svelte';
  import Toolbar from './Toolbar.svelte';
  import PropertyPanel from './PropertyPanel.svelte';
  import SettingsPanel from './SettingsPanel.svelte';
  import ContextMenuSvelte from './ContextMenu.svelte';
  import TextEditorOverlay from './TextEditorOverlay.svelte';
  import StatusBar from './StatusBar.svelte';
  import Minimap from './Minimap.svelte';
  import HelpModal from './HelpModal.svelte';

  let {
    adapter,
    initialSettings,
    onAppReady,
  }: {
    adapter: HostAdapter;
    initialSettings?: Partial<TrefoilSettings>;
    onAppReady?: (app: CanvasApp) => void;
  } = $props();

  let hostEl = $state<HTMLDivElement | null>(null);
  let app = $state<CanvasApp | null>(null);
  let started = false;

  onMount(() => {
    if (!hostEl || started) return;
    started = true;
    CanvasApp.create(hostEl, adapter, initialSettings).then((a) => {
      app = a;
      onAppReady?.(a);
    });
  });

  onDestroy(() => {
    app?.destroy();
    app = null;
  });

  // 设置变化 → 推送到引擎 + 防抖持久化
  $effect(() => {
    JSON.stringify(settings);
    if (app) {
      app.engine.background.setSettings({ ...settings.background });
      app.engine.laser.setSettings({ ...settings.laser });
      app.persistSettingsSoon();
    }
  });
</script>

<div class="trefoil-root">
  <div class="trefoil-canvas-host" bind:this={hostEl}></div>
  {#if app}
    <Toolbar {app} />
    <PropertyPanel {app} />
    <StatusBar {app} />
    {#if ui.minimapOpen}
      <Minimap {app} />
    {/if}
    <ContextMenuSvelte {app} />
    <TextEditorOverlay {app} />
    {#if ui.settingsOpen}
      <SettingsPanel {app} />
    {/if}
    {#if ui.helpOpen}
      <HelpModal />
    {/if}
  {:else}
    <div class="trefoil-loading">正在加载白板…</div>
  {/if}
</div>

<style>
  .trefoil-root {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: var(--trefoil-canvas-bg, #ffffff);
    color: var(--text-normal, #1f1f1f);
    font-family: var(--font-interface, system-ui, sans-serif);
    user-select: none;
  }
  .trefoil-canvas-host {
    position: absolute;
    inset: 0;
    /* 数位板笔/触摸拖动默认会被浏览器接管为滚动手势（触发 pointercancel 中断笔迹），必须声明为应用自管 */
    touch-action: none;
  }
  .trefoil-loading {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted, #888);
    font-size: 13px;
  }
</style>
