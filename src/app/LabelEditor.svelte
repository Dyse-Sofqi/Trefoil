<script lang="ts">
  /** 线段关系描述内联编辑框：双击连线/绑定箭头后挂在线段中点（屏幕坐标），Enter/失焦提交，Esc 取消 */
  import type { CanvasApp } from './CanvasApp';
  import { ui } from './ui.svelte';

  let { app }: { app: CanvasApp } = $props();

  let inputEl = $state<HTMLInputElement | null>(null);
  let value = $state('');
  let editingKey = $state('');

  const le = $derived.by(() => {
    void ui.rev;
    void ui.vpRev;
    return ui.labelEdit;
  });

  $effect(() => {
    if (le && (le.kind + le.id) !== editingKey) {
      editingKey = le.kind + le.id;
      value = le.value;
      queueMicrotask(() => {
        inputEl?.focus();
        inputEl?.select();
      });
    } else if (!le && editingKey) {
      editingKey = '';
    }
  });

  function commit(): void {
    app.commitLabelEdit(value);
  }

  function cancel(): void {
    ui.labelEdit = null;
  }
</script>

{#if le}
  <input
    class="trefoil-label-edit"
    type="text"
    placeholder="关系描述"
    bind:this={inputEl}
    bind:value
    style:left="{le.x}px"
    style:top="{le.y}px"
    onkeydown={(e) => {
      if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
      else if (e.key === 'Escape') {
        cancel();
        (e.currentTarget as HTMLInputElement).blur();
      }
      e.stopPropagation();
    }}
    onblur={commit}
    onpointerdown={(e) => e.stopPropagation()}
  />
{/if}

<style>
  .trefoil-label-edit {
    position: absolute;
    z-index: 30;
    transform: translate(-50%, -50%);
    width: 140px;
    padding: 4px 8px;
    border: 1.5px solid var(--interactive-accent, #4c8dff);
    border-radius: 6px;
    background: var(--background-primary, #fff);
    color: var(--text-normal, #222);
    font-size: 13px;
    text-align: center;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.12);
    outline: none;
    user-select: text;
  }
</style>
