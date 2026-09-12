<!--
  字体选择框（可输入 + 可滚动的下拉列表）：
  - 列表项可能上千（读取系统字体后），用自绘弹层而不是原生 datalist：
    原生弹层无法限高/滚动，长列表会伸到屏幕外。
  - 弹层挂到 document.body（设置面板带 transform，fixed 定位会被其改变包含块）。
  - 列表外字体名/字体栈可直接输入，回车或失焦提交（commit 由宿主面板提供）。
-->
<script lang="ts">
  let fontSelectSeq = 0;

  let {
    value = '',
    options = [],
    placeholder = '字体名或字体栈',
    commit,
  }: {
    value?: string;
    options?: string[];
    placeholder?: string;
    commit: (v: string) => void;
  } = $props();

  /** 每个实例独立的列表 id（同一页面可能同时存在设置面板与属性面板两处字体框） */
  const listId = `trefoil-font-list-${++fontSelectSeq}`;

  let inputEl = $state<HTMLInputElement | null>(null);
  let popEl = $state<HTMLDivElement | null>(null);
  let open = $state(false);
  let query = $state('');
  let active = $state(-1);
  let pos = $state({ left: 0, top: 0, width: 0, maxHeight: 280 });

  const filtered = $derived.by(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((f) => f.toLowerCase().includes(q) || f.split(',')[0].toLowerCase().includes(q));
  });

  /** 把输入框里待提交的值交给宿主（空值还原显示）；可从面板外部调用（面板卸载前抢落盘） */
  export function flush(): void {
    const el = inputEl;
    if (!el) return;
    const v = el.value.trim();
    if (!v) {
      el.value = value;
      return;
    }
    if (v !== value) commit(v);
  }

  function place(): void {
    const r = inputEl?.getBoundingClientRect();
    if (!r) return;
    pos = {
      left: Math.round(r.left),
      top: Math.round(r.bottom + 4),
      width: Math.round(r.width),
      maxHeight: Math.max(140, Math.min(300, window.innerHeight - r.bottom - 12)),
    };
  }

  let closeTimer: ReturnType<typeof setTimeout> | null = null;

  function openList(): void {
    if (closeTimer) {
      clearTimeout(closeTimer); // 取消上一次失焦安排的收起，避免刚打开就被关掉
      closeTimer = null;
    }
    query = '';
    active = -1;
    place();
    open = true;
  }

  function onInput(): void {
    query = inputEl?.value ?? '';
    active = -1;
    if (!open) openList();
  }

  function pick(f: string): void {
    if (inputEl) inputEl.value = f;
    open = false;
    flush();
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) {
        openList();
        return;
      }
      const n = filtered.length;
      if (!n) return;
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (open && active >= 0 && filtered[active]) pick(filtered[active]);
      else {
        flush();
        open = false;
      }
      inputEl?.blur();
    } else if (e.key === 'Escape') {
      open = false;
    }
  }

  /** 输入框已持有焦点时 focus 不会再次触发（如 Esc 关闭后），按下时确保弹层打开 */
  function onInputDown(): void {
    if (!open) openList();
  }

  function onInnerBlur(): void {
    // 稍延迟收起，让选项的 click 先于收起/提交；重新聚焦会取消这次收起
    closeTimer = setTimeout(() => {
      closeTimer = null;
      open = false;
    }, 120);
    flush();
  }

  // 键盘高亮项滚进可视区
  $effect(() => {
    if (active < 0 || !popEl) return;
    popEl.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  });

  // 打开期间：滚动/缩放时跟随输入框重新定位（聚焦会触发容器滚动，不能直接关），
  // 点弹层/输入框之外关闭
  $effect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (t && (popEl?.contains(t) || inputEl?.contains(t))) return;
      open = false;
    };
    const onScroll = () => place();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    window.addEventListener('pointerdown', onDown, true);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
      window.removeEventListener('pointerdown', onDown, true);
    };
  });

  function portal(node: HTMLElement): { destroy(): void } {
    document.body.appendChild(node);
    return { destroy: () => node.remove() };
  }
</script>

<div class="trefoil-font-select">
  <input
    type="text"
    role="combobox"
    aria-expanded={open}
    aria-controls={listId}
    aria-autocomplete="list"
    bind:this={inputEl}
    {placeholder}
    value={value}
    oninput={onInput}
    onfocus={openList}
    onmousedown={onInputDown}
    onblur={onInnerBlur}
    onkeydown={onKeyDown}
  />
  {#if open}
    <div class="trefoil-font-pop" role="listbox" id={listId} bind:this={popEl} use:portal style="left:{pos.left}px;top:{pos.top}px;width:{pos.width}px;max-height:{pos.maxHeight}px">
      {#if filtered.length === 0}
        <div class="trefoil-font-empty">无匹配字体，回车使用输入的名称</div>
      {:else}
        {#each filtered as f, i (f)}
          <div
            class="trefoil-font-item"
            class:active={i === active}
            data-active={i === active}
            role="option"
            tabindex="-1"
            aria-selected={i === active}
            title={f}
            onmousedown={(e) => e.preventDefault()}
            onclick={() => pick(f)}
            onkeydown={(e) => {
              if (e.key === 'Enter') pick(f);
            }}
          >{f.split(',')[0]}</div>
        {/each}
      {/if}
    </div>
  {/if}
</div>

<style>
  .trefoil-font-select {
    position: relative;
    flex: 1;
    min-width: 0;
    display: flex;
  }
  input {
    all: unset;
    box-sizing: border-box;
    display: block;
    flex: 1;
    min-width: 0;
    padding: 3px 6px;
    border: 1px solid var(--background-modifier-border, #ddd);
    border-radius: 5px;
    background: var(--background-primary, #fff);
    color: var(--text-normal, #222);
    font-size: 12px;
    line-height: 1.4;
  }
  input:focus {
    border-color: var(--interactive-accent, #4c8dff);
  }
  /* 列表项用 div（不是 button）：Obsidian/主题对 button 的全局样式会盖掉这里的极简外观 */
  .trefoil-font-pop {
    all: unset;
    box-sizing: border-box;
    position: fixed;
    z-index: 1100;
    display: block;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 4px;
    background: var(--background-primary, #fff);
    border: 1px solid var(--background-modifier-border, #ddd);
    border-radius: 6px;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.12);
  }
  .trefoil-font-item {
    all: unset;
    box-sizing: border-box;
    display: block;
    width: 100%;
    padding: 2px 6px;
    border-radius: 4px;
    color: var(--text-normal, #222);
    font-size: 12px;
    line-height: 1.6;
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .trefoil-font-item:hover,
  .trefoil-font-item.active {
    background: var(--background-modifier-hover, #f0f0f0);
  }
  .trefoil-font-empty {
    all: unset;
    display: block;
    padding: 4px 6px;
    color: var(--text-muted, #888);
    font-size: 11px;
    line-height: 1.5;
  }
</style>
