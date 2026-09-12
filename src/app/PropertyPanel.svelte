<script lang="ts">
  import type { CanvasApp } from './CanvasApp';
  import { ui, settings } from './ui.svelte';
  import { icon } from './icons';
  import type { CanvasNode, HAlign } from '../core/types';
  import { resolveColor } from '../engine/palette';
  import { FONT_PRESETS } from '../core/defaults';
  import { wheelAdjust } from './wheelStep';
  import { autoTextHeight } from '../engine/textMeasure';
  import FontSelect from './FontSelect.svelte';

  let { app }: { app: CanvasApp } = $props();

  const sel = $derived.by(() => {
    void ui.rev;
    return app.doc.selectedNodes();
  });
  const single = $derived(sel.length === 1 ? sel[0] : null);
  /** 读取显示值的代表节点：多选时取第一个，编辑会作用到全部选中项 */
  const ref = $derived(sel[0] ?? null);
  /** 全部选中项同一类型时才给出该类型的属性区（多选批量修改） */
  const allText = $derived(sel.length > 0 && sel.every((n) => n.type === 'text'));
  const allShapes = $derived(sel.length > 0 && sel.every((n) => n.type === 'trefoil/shape'));
  const allFiles = $derived(sel.length > 0 && sel.every((n) => n.type === 'file'));
  const isText = $derived(allText);
  const isShape = $derived(allShapes);
  const isFile = $derived(allFiles);
  const isContainer = $derived(!!single && single.type === 'trefoil/container');

  /** 图片节点文件名（库内路径的 basename） */
  const fileName = $derived.by(() => {
    void ui.rev;
    return single?.file?.split('/').pop() ?? '';
  });

  /** 在系统文件管理器中显示该图片 */
  function revealImage(): void {
    const f = single?.file;
    if (f && !/^(https?|data|blob|app|file):/i.test(f)) app.adapter.revealFile?.(f);
  }

  /** 替换选中图片：读入新图片 → 存附件 → 更新 file 节点 */
  function replaceImage(e: Event): void {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || !single) return;
    if (!file.type.startsWith('image/')) {
      app.adapter.toast?.('请选择图片文件');
      input.value = '';
      return;
    }
    input.value = '';
    void (async () => {
      const saved = await app.savePastedImage(file, file.name);
      if (!saved) return;
      app.doc.updateNode(single.id, { file: saved, fileSize: undefined }, '替换图片');
      app.engine.invalidateImages();
    })();
  }

  const presetColors = $derived(app.palette.presets);

  /**
   * 字号必须做成派生值：节点对象是原地修改的，直接读 ref.fontSize 时
   * 引用不变、Svelte 不会重新求值，滑块与文本框就无法互相同步。
   */
  const fontSize = $derived.by(() => {
    void ui.rev;
    return ref?.fontSize ?? 16;
  });
  const SIZE_MIN = 8;
  const SIZE_MAX = 200;
  let sizeBoxEl = $state<HTMLInputElement | null>(null);

  /** 透明度显示值：同样需要派生（节点是原地修改，直接读 ref.opacity 不会刷新） */
  const opacityPercent = $derived.by(() => {
    void ui.rev;
    return Math.round((ref?.opacity ?? 1) * 100);
  });

  function clampSize(v: number): number {
    if (!Number.isFinite(v)) return fontSize;
    return Math.max(SIZE_MIN, Math.min(SIZE_MAX, Math.round(v)));
  }

  /**
   * 文字度量变化（字号/字重/字体）后重算文本框高度，画布里的文本框才能即时贴合内容，
   * 否则调大字号后文字会溢出边框、调小则留白。与拖拽缩放、编辑提交用的是同一套计算。
   * 多选时每个节点各按自身文字与宽度算高度。
   */
  function textMetricPatches(fields: { fontSize?: number; fontWeight?: number; fontFamily?: string }): Map<string, Partial<CanvasNode>> {
    const patches = new Map<string, Partial<CanvasNode>>();
    for (const n of sel) {
      if (n.type !== 'text') continue;
      const size = fields.fontSize ?? n.fontSize ?? 16;
      const weight = fields.fontWeight ?? n.fontWeight ?? 400;
      const family = fields.fontFamily ?? n.fontFamily ?? settings.text.fontFamily;
      patches.set(n.id, { ...fields, height: autoTextHeight(n.text ?? '', n.width, size, family, weight) });
    }
    return patches;
  }

  /** 连续调整中的文字度量变化（拖动滑块 / 滚轮微调） */
  function liveTextMetrics(fields: { fontSize?: number; fontWeight?: number; fontFamily?: string }, label: string): void {
    app.liveSelectionPatches(textMetricPatches(fields), label);
  }

  /** 一次性提交的文字度量变化（失焦、回车、点面板外落盘） */
  function applyTextMetrics(fields: { fontSize?: number; fontWeight?: number; fontFamily?: string }, label: string): void {
    app.doc.updateNodes(textMetricPatches(fields), label);
  }

  /** 容器名称（派生：节点原地修改，直接读 single.text 不会刷新） */
  const containerName = $derived.by(() => {
    void ui.rev;
    return single?.text ?? '';
  });
  let nameEl = $state<HTMLInputElement | null>(null);

  function commitName(): void {
    const el = nameEl;
    const n = single;
    if (!el || !n || n.type !== 'trefoil/container') return;
    const v = el.value.trim();
    if (v === (n.text ?? '').trim()) return;
    app.doc.updateNode(n.id, { text: v }, '重命名容器');
  }

  // 双击名片 → 聚焦并全选名称，直接输入即可改名
  $effect(() => {
    const target = ui.renameTarget;
    if (!target || !nameEl || single?.id !== target) return;
    nameEl.focus();
    nameEl.select();
    ui.renameTarget = null;
  });

  /** 选中项涉及的组与容器：用于给出对应的反向操作（解绑 / 拆解） */
  const selGroups = $derived([...new Set(sel.map((n) => n.groupId).filter((g): g is string => !!g))]);
  const selContainers = $derived(sel.filter((n) => n.type === 'trefoil/container'));

  function unbindSelectionGroups(): void {
    app.unbindGroups(selGroups);
  }

  function decomposeSelectionContainers(): void {
    for (const c of selContainers) app.decomposeContainer(c.id);
  }

  /** 连续调整（拖动滑块 / 滚轮微调）：实时生效，停止后合并为一条撤销记录 */
  function live(patch: Partial<CanvasNode>, label: string): void {
    app.liveSelectionProps(patch, label);
  }

  /** 把文本框里待提交的字号落盘（合法即用，越界夹取，非法还原显示）；数值没变就不动节点 */
  function commitSize(): void {
    const el = sizeBoxEl;
    if (!el) return;
    const raw = el.value.trim();
    if (!raw || !Number.isFinite(+raw)) {
      el.value = String(fontSize);
      return;
    }
    const v = clampSize(+raw);
    if (v === fontSize) return;
    applyTextMetrics({ fontSize: v }, '字号');
  }

  // 点击面板外（画布）会先清空选中并卸载本面板，blur/change 不会再来：抢在它之前落盘
  $effect(() => {
    const onDown = (e: PointerEvent) => {
      if (e.target !== sizeBoxEl) commitSize();
      fontSel?.flush();
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  });

  function apply(patch: Partial<CanvasNode>, label?: string): void {
    app.updateSelectionProps(patch, label);
  }

  function resolveC(c?: string | null): string {
    return resolveColor(c, app.palette) ?? '#000000';
  }

  const fontOptions = $derived.by(() => {
    const extra = (settings.text.availableFonts ?? []).filter((f) => !FONT_PRESETS.includes(f));
    return [...FONT_PRESETS, ...extra];
  });

  /** 选中节点的字体（派生值：节点是原地修改的，直接读 single.fontFamily 不会刷新） */
  const fontFamily = $derived.by(() => {
    void ui.rev;
    return ref?.fontFamily ?? settings.text.fontFamily;
  });
  let fontSel = $state<FontSelect | null>(null);

  /** 提交字体：列表外字体名/字体栈可手输；未变化不写（避免顺手重算框高） */
  function commitFont(v: string): void {
    const t = v.trim();
    if (!t || t === fontFamily) return;
    applyTextMetrics({ fontFamily: t }, '字体');
  }
</script>

{#if ui.propsOpen && sel.length > 0}
  <div class="trefoil-props">
    <div class="trefoil-props-head">
      <span>{sel.length > 1 ? `已选 ${sel.length} 项${allText ? '（文本）' : allShapes ? '（形状）' : allFiles ? '（图片）' : ''}` : single?.type === 'text' ? '文本' : single?.type === 'file' ? '图片' : single?.type === 'trefoil/container' ? '导图容器' : '形状'}</span>
      <button class="trefoil-icon-btn" title="收起" onclick={() => (ui.propsOpen = false)}>{@html icon('chevron-right')}</button>
    </div>

    {#if isText && ref}
      <div class="trefoil-sec">
        <label class="trefoil-row">
          <span class="trefoil-lab">字体</span>
          <FontSelect bind:this={fontSel} value={fontFamily} options={fontOptions} commit={commitFont} />
        </label>
        <label class="trefoil-row">
          <span class="trefoil-lab">字号</span>
          <input
            type="range"
            min={SIZE_MIN}
            max={SIZE_MAX}
            value={fontSize}
            use:wheelAdjust={{ kind: 'value' }}
            oninput={(e) => liveTextMetrics({ fontSize: clampSize(+e.currentTarget.value) }, '字号')}
            onchange={() => app.commitSelectionStyle()}
          />
          <input
            type="number"
            min={SIZE_MIN}
            max={SIZE_MAX}
            bind:this={sizeBoxEl}
            value={fontSize}
            use:wheelAdjust={{ kind: 'value' }}
            oninput={(e) => {
              const raw = e.currentTarget.value.trim();
              const v = raw ? Math.round(+raw) : NaN;
              if (Number.isFinite(v) && v >= SIZE_MIN && v <= SIZE_MAX) liveTextMetrics({ fontSize: v }, '字号');
            }}
            onchange={commitSize}
            onkeydown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
          />
        </label>
        <label class="trefoil-row">
          <span class="trefoil-lab">字重</span>
          <input
            type="number"
            min="1"
            max="900"
            step="1"
            value={ref.fontWeight ?? 400}
            use:wheelAdjust={{ kind: 'value' }}
            oninput={(e) => {
              const raw = e.currentTarget.value.trim();
              const v = raw ? Math.round(+raw) : NaN;
              if (Number.isFinite(v) && v >= 1 && v <= 900) liveTextMetrics({ fontWeight: v }, '字重');
            }}
            onchange={(e) => {
              const v = Math.max(1, Math.min(900, Math.round(+e.currentTarget.value || 400)));
              liveTextMetrics({ fontWeight: v }, '字重');
              app.commitSelectionStyle();
            }}
          />
        </label>
        <label class="trefoil-row">
          <span class="trefoil-lab">颜色</span>
          <input type="color" title="自定义颜色" value={resolveC(ref.color)} oninput={(e) => apply({ color: e.currentTarget.value }, '颜色')} />
          {#each presetColors as c, i (i)}
            <button class="trefoil-swatch" style:background={c} onclick={() => apply({ color: String(i + 1) }, '颜色')}></button>
          {/each}
        </label>
        <label class="trefoil-row">
          <span class="trefoil-lab">透明度</span>
          <input
            type="range"
            min="0"
            max="100"
            value={opacityPercent}
            use:wheelAdjust={{ kind: 'percent' }}
            oninput={(e) => live({ opacity: +e.currentTarget.value / 100 }, '透明度')}
            onchange={() => app.commitSelectionStyle()}
          />
          <span class="trefoil-val">{opacityPercent}%</span>
        </label>
        <div class="trefoil-row">
          <span class="trefoil-lab">水平</span>
          <div class="trefoil-btn-group">
            {#each [['left', 'h-left', '左对齐'], ['center', 'h-center', '居中'], ['right', 'h-right', '右对齐'], ['justify', 'h-justify', '两端对齐']] as [a, ic, lab] (a)}
              <button
                class="trefoil-mini-btn"
                class:active={(ref.hAlign ?? 'left') === a}
                title={lab}
                onclick={() => apply({ hAlign: a as HAlign }, '对齐')}
              >{@html icon(ic)}</button>
            {/each}
          </div>
        </div>
      </div>
    {/if}

    {#if isShape && ref}
      <div class="trefoil-sec">
        <div class="trefoil-row">
          <span class="trefoil-lab">填充</span>
          <input
            type="color"
            title="自定义颜色"
            value={ref.fill ? resolveC(ref.fill) : '#ffffff'}
            oninput={(e) => apply({ fill: e.currentTarget.value }, '填充')}
          />
          <button class="trefoil-mini-btn" class:active={!ref.fill} onclick={() => apply({ fill: null }, '填充')}>无</button>
        </div>
        <div class="trefoil-row">
          <span class="trefoil-lab">描边</span>
          <input type="color" title="自定义颜色" value={resolveC(ref.stroke)} oninput={(e) => apply({ stroke: e.currentTarget.value }, '描边')} />
          <input
            type="number"
            min="1"
            max="40"
            value={ref.strokeSize ?? 2}
            style="width:52px"
            use:wheelAdjust={{ kind: 'value' }}
            oninput={(e) => {
              const raw = e.currentTarget.value.trim();
              if (raw && Number.isFinite(+raw) && +raw >= 1 && +raw <= 40) live({ strokeSize: +raw }, '描边宽度');
            }}
            onchange={(e) => {
              live({ strokeSize: Math.max(1, +e.currentTarget.value || 2) }, '描边宽度');
              app.commitSelectionStyle();
            }}
          />
        </div>
        <label class="trefoil-row">
          <span class="trefoil-lab">透明度</span>
          <input
            type="range"
            min="0"
            max="100"
            value={opacityPercent}
            use:wheelAdjust={{ kind: 'percent' }}
            oninput={(e) => live({ opacity: +e.currentTarget.value / 100 }, '透明度')}
            onchange={() => app.commitSelectionStyle()}
          />
          <span class="trefoil-val">{opacityPercent}%</span>
        </label>
      </div>
    {/if}

    {#if isFile && single}
      <div class="trefoil-sec">
        <div class="trefoil-row">
          <span class="trefoil-lab">文件</span>
          <span class="trefoil-file-name" title={single.file}>{fileName}</span>
        </div>
        <div class="trefoil-row trefoil-row-actions">
          <button class="trefoil-mini-btn" onclick={revealImage} disabled={!fileName || /^(https?|data|blob|app|file):/i.test(single.file ?? '')}>
            在文件中显示
          </button>
          <label class="trefoil-mini-btn">
            替换图片
            <input type="file" accept="image/*" style="display:none" onchange={replaceImage} />
          </label>
        </div>
      </div>
    {/if}

    {#if isContainer && single}
      <div class="trefoil-sec">
        <div class="trefoil-row">
          <span class="trefoil-lab">名称</span>
          <input
            type="text"
            placeholder="容器名称"
            bind:this={nameEl}
            value={containerName}
            onchange={commitName}
            onkeydown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
          />
        </div>
        <div class="trefoil-row">
          <span class="trefoil-lab">布局</span>
          <div class="trefoil-btn-group">
            <button
              class="trefoil-mini-btn"
              class:active={(single.layout ?? 'horizontal') === 'horizontal'}
              onclick={() => app.layoutContainer(single.id, 'horizontal')}
            >横向树</button>
            <button
              class="trefoil-mini-btn"
              class:active={single.layout === 'vertical'}
              onclick={() => app.layoutContainer(single.id, 'vertical')}
            >纵向树</button>
          </div>
        </div>
        <div class="trefoil-row">
          <button class="trefoil-mini-btn" onclick={() => app.toggleContainerCollapse(single.id)}>
            {single.collapsed ? '展开' : '折叠'}
          </button>
          <button class="trefoil-mini-btn" onclick={() => app.addChildTo(single.id)}>+ 子节点</button>
          <button class="trefoil-mini-btn" onclick={() => app.decomposeContainer(single.id)}>拆解</button>
        </div>
      </div>
    {/if}

    {#if sel.length >= 2 || selGroups.length}
      <div class="trefoil-sec">
        <div class="trefoil-row trefoil-row-actions">
          {#if sel.length >= 2}
            {#if selContainers.length}
              <button class="trefoil-mini-btn" onclick={decomposeSelectionContainers}>拆解容器</button>
            {:else}
              <button class="trefoil-mini-btn" onclick={() => app.composeSelection()}>组合为容器</button>
            {/if}
          {/if}
          {#if selGroups.length}
            <button class="trefoil-mini-btn" onclick={unbindSelectionGroups}>解绑组</button>
          {:else if sel.length >= 2}
            <button class="trefoil-mini-btn" onclick={() => app.bindGroup()}>绑定组</button>
          {/if}
        </div>
      </div>
    {/if}

    <div class="trefoil-sec trefoil-props-foot">
      <div class="trefoil-row">
        <button class="trefoil-mini-btn" title="置于顶层" onclick={() => app.doc.bringToFront([...app.doc.selection])}>{@html icon('arrow-up-to-line')}</button>
        <button class="trefoil-mini-btn" onclick={() => app.clipboard.copy(app.doc)}>复制</button>
        <button class="trefoil-mini-btn danger" title="删除" onclick={() => app.deleteSelection()}>
          {@html icon('trash-2')}
        </button>
      </div>
    </div>
  </div>
{:else if !ui.propsOpen}
  <button class="trefoil-props-collapsed" title="展开属性面板" onclick={() => (ui.propsOpen = true)}>{@html icon('chevron-left')}</button>
{/if}

<style>
  .trefoil-props {
    position: absolute;
    top: 56px;
    right: 10px;
    z-index: 20;
    width: 250px;
    max-height: calc(100% - 90px);
    overflow: auto;
    padding: 10px;
    border-radius: 10px;
    background: var(--background-primary, #fff);
    border: 1px solid var(--background-modifier-border, #ddd);
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
    font-size: 12.5px;
  }
  .trefoil-props-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-weight: 600;
    margin-bottom: 8px;
  }
  .trefoil-sec {
    display: flex;
    flex-direction: column;
    gap: 7px;
    padding: 8px 0;
    border-top: 1px solid var(--background-modifier-border, #eee);
  }
  .trefoil-props-foot {
    border-bottom: none;
  }
  .trefoil-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  /* 组合/绑定这类成组操作：按钮等宽平分一行，标签不折行 */
  .trefoil-row-actions > .trefoil-mini-btn {
    flex: 1 1 0;
    justify-content: center;
    white-space: nowrap;
  }
  .trefoil-lab {
    width: 34px;
    flex: none;
    color: var(--text-muted, #777);
  }
  .trefoil-val {
    width: 34px;
    text-align: right;
    color: var(--text-muted, #777);
    font-size: 11px;
  }
  .trefoil-file-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 11.5px;
    color: var(--text-normal, #222);
  }
  input[type='text'],
  input[type='number'] {
    flex: 1;
    min-width: 0;
    padding: 3px 6px;
    border: 1px solid var(--background-modifier-border, #ddd);
    border-radius: 5px;
    background: var(--background-primary, #fff);
    color: var(--text-normal, #222);
    font-size: 12px;
  }
  input[type='range'] {
    flex: 1;
    accent-color: var(--interactive-accent, #4c8dff);
  }
  /* 原生取色器：Chromium 新版会把色块画成圆形，这里改写伪元素压成与预设色块同语言的圆角方 */
  input[type='color'] {
    width: 22px;
    height: 22px;
    flex: none;
    padding: 0;
    border: 1px solid var(--background-modifier-border, #ddd);
    border-radius: 5px;
    background: var(--background-primary, #fff);
    cursor: pointer;
    overflow: hidden;
    transition: border-color 0.12s ease, box-shadow 0.12s ease;
  }
  input[type='color']:hover {
    border-color: var(--interactive-accent, #4c8dff);
  }
  input[type='color']:focus-visible {
    outline: none;
    border-color: var(--interactive-accent, #4c8dff);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--interactive-accent, #4c8dff) 30%, transparent);
  }
  input[type='color']::-webkit-color-swatch-wrapper {
    padding: 0;
  }
  input[type='color']::-webkit-color-swatch {
    border: none;
    border-radius: 4px;
  }
  input[type='color']::-moz-color-swatch {
    border: none;
    border-radius: 4px;
  }
  .trefoil-mini-btn {
    padding: 3px 8px;
    border: 1px solid var(--background-modifier-border, #ddd);
    border-radius: 5px;
    background: var(--background-primary, #fff);
    color: var(--text-normal, #222);
    font-size: 12px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 3px;
  }
  .trefoil-mini-btn :global(svg) {
    width: 14px;
    height: 14px;
    display: block;
  }
  .trefoil-mini-btn:hover {
    background: var(--background-modifier-hover, #eee);
  }
  .trefoil-mini-btn.active {
    background: var(--interactive-accent, #4c8dff);
    border-color: var(--interactive-accent, #4c8dff);
    color: var(--text-on-accent, #fff);
  }
  .trefoil-mini-btn.danger {
    color: var(--text-error, #d33);
  }
  .trefoil-btn-group {
    display: flex;
    gap: 3px;
  }
  .trefoil-swatch {
    width: 16px;
    height: 16px;
    border-radius: 4px;
    border: 1px solid rgba(0, 0, 0, 0.15);
    cursor: pointer;
    padding: 0;
    transition: transform 0.12s ease, box-shadow 0.12s ease;
  }
  .trefoil-swatch:hover {
    transform: translateY(-1px);
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.18);
  }
  .trefoil-swatch:active {
    transform: none;
  }
  .trefoil-icon-btn {
    border: none;
    background: none;
    cursor: pointer;
    color: var(--text-muted, #777);
    font-size: 16px;
    padding: 2px 6px;
    display: inline-flex;
    align-items: center;
  }
  .trefoil-icon-btn :global(svg) {
    width: 16px;
    height: 16px;
  }
  .trefoil-props-collapsed {
    position: absolute;
    top: 56px;
    right: 10px;
    z-index: 20;
    padding: 6px 10px;
    border-radius: 8px;
    border: 1px solid var(--background-modifier-border, #ddd);
    background: var(--background-primary, #fff);
    cursor: pointer;
    color: var(--text-muted, #777);
    display: inline-flex;
    align-items: center;
  }
  .trefoil-props-collapsed :global(svg) {
    width: 16px;
    height: 16px;
  }
</style>
