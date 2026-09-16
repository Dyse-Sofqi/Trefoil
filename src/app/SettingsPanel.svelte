<script lang="ts">
  import type { CanvasApp } from './CanvasApp';
  import { settings, ui } from './ui.svelte';
  import { FONT_PRESETS } from '../core/defaults';
  import { wheelAdjust } from './wheelStep';
  import FontSelect from './FontSelect.svelte';

  let { app }: { app: CanvasApp } = $props();

  const fontOptions = $derived.by(() => {
    const extra = (settings.text.availableFonts ?? []).filter((f) => !FONT_PRESETS.includes(f));
    return [...FONT_PRESETS, ...extra];
  });

  async function loadSystemFonts(): Promise<void> {
    try {
      // Chrome/Electron: Local Font Access API（需用户授权）
      const qf = (window as unknown as { queryLocalFonts?: () => Promise<{ family: string }[]> }).queryLocalFonts;
      if (!qf) throw new Error('当前环境不支持读取系统字体');
      const fonts = await qf();
      const names = [...new Set(fonts.map((f) => f.family))].sort((a, b) => a.localeCompare(b, 'zh'));
      // 入库持久化（随 settings 防抖保存到插件 data.json）
      settings.text.availableFonts = names;
      app.adapter.toast?.(`已读取并保存 ${names.length} 个系统字体`);
    } catch (err) {
      app.adapter.toast?.(err instanceof Error ? err.message : '无法读取系统字体，可手动输入字体名');
    }
  }

  /** 提交字体：列表里的字体直接选，列表外的字体名/字体栈可以手输
   *  （读取系统字体不可用或未授权时，这是使用系统字体的唯一入口）；空值或未变化不写。 */
  function commitFont(v: string): void {
    const t = v.trim();
    if (!t || t === settings.text.fontFamily) return;
    settings.text.fontFamily = t;
  }

  const SIZE_MIN = 8;
  const SIZE_MAX = 96;
  let fontSel = $state<FontSelect | null>(null);
  let sizeBoxEl = $state<HTMLInputElement | null>(null);

  /**
   * 提交字号文本框：合法值直接用，越界/非法值夹取或还原显示。
   * 输入过程中只在值合法时即时生效（新建文本要用最新值），不夹取、不改写文本框，
   * 否则"输入 24"会被逐字符夹成 8 再拼接成 84。
   */
  function commitSize(): void {
    const el = sizeBoxEl;
    if (!el) return;
    const raw = el.value.trim();
    if (!raw || !Number.isFinite(+raw)) {
      el.value = String(settings.text.fontSize);
      return;
    }
    const v = Math.max(SIZE_MIN, Math.min(SIZE_MAX, Math.round(+raw)));
    if (v !== settings.text.fontSize) settings.text.fontSize = v;
  }

  const DELAYS: { v: number; label: string }[] = [
    { v: 1000, label: '1 秒' },
    { v: 3000, label: '3 秒' },
    { v: 5000, label: '5 秒' },
    { v: 10000, label: '10 秒' },
    { v: 0, label: '手动清除' },
  ];

  // 点击设置面板外的区域自动关闭（齿轮按钮自身保留切换语义）
  $effect(() => {
    const handler = (e: PointerEvent) => {
      const el = e.target as HTMLElement;
      if (!el) return;
      if (el.closest('.trefoil-settings')) return;
      if (el.closest('.trefoil-settings-toggle')) return;
      if (el.closest('.trefoil-font-pop')) return; // 字体弹层挂在 body 上，不算"面板外"
      fontSel?.flush(); // 关闭前先落盘文本类输入（面板一卸载就不会再有 blur/change）
      commitSize();
      ui.settingsOpen = false;
    };
    window.addEventListener('pointerdown', handler, true);
    return () => window.removeEventListener('pointerdown', handler, true);
  });

  // 标题栏拖动移动面板（保留初始居中，拖拽量叠加在 transform 上）
  let dragOffset = $state({ x: 0, y: 0 });
  let dragState: { sx: number; sy: number; ox: number; oy: number } | null = null;

  function onHeadPointerDown(e: PointerEvent): void {
    if ((e.target as HTMLElement).closest('.trefoil-x')) return;
    dragState = { sx: e.clientX, sy: e.clientY, ox: dragOffset.x, oy: dragOffset.y };
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragUp, { once: true });
    e.preventDefault();
  }

  function onDragMove(e: PointerEvent): void {
    if (!dragState) return;
    dragOffset = { x: dragState.ox + (e.clientX - dragState.sx), y: dragState.oy + (e.clientY - dragState.sy) };
  }

  function onDragUp(): void {
    dragState = null;
    window.removeEventListener('pointermove', onDragMove);
  }

  // 每次打开重置回居中位置
  $effect(() => {
    if (!ui.settingsOpen) dragOffset = { x: 0, y: 0 };
  });
</script>

<div class="trefoil-settings" style:transform="translate(calc(-50% + {dragOffset.x}px), {dragOffset.y}px)">
  <div class="trefoil-settings-head" onpointerdown={onHeadPointerDown}>
    <span>设置</span>
    <button class="trefoil-x" onclick={() => (ui.settingsOpen = false)}>✕</button>
  </div>

  <section>
    <h4>背景</h4>
    <div class="row">
      <span>模式</span>
      <label><input type="radio" bind:group={settings.background.mode} value="solid" />纯色</label>
      <label><input type="radio" bind:group={settings.background.mode} value="dots" />点阵</label>
      <label><input type="radio" bind:group={settings.background.mode} value="grid" />网格</label>
    </div>
    <div class="row">
      <span>底色（日间）</span>
      <input type="color" bind:value={settings.background.color} />
    </div>
    <div class="row">
      <span>底色（夜间）</span>
      <input type="color" bind:value={settings.background.colorDark} />
    </div>
    {#if settings.background.mode === 'dots'}
      <div class="row">
        <span>点大小</span>
        <input type="range" min="1" max="10" bind:value={settings.background.dotSize} use:wheelAdjust={{ kind: 'value' }} />
        <em>{settings.background.dotSize}px</em>
      </div>
      <div class="row">
        <span>点形状</span>
        <label><input type="radio" bind:group={settings.background.dotShape} value="circle" />圆形</label>
        <label><input type="radio" bind:group={settings.background.dotShape} value="square" />方形</label>
        <label><input type="radio" bind:group={settings.background.dotShape} value="diamond" />菱形</label>
      </div>
      <div class="row">
        <span>点颜色（日间）</span>
        <input type="color" bind:value={settings.background.dotColor} />
      </div>
      <div class="row">
        <span>点颜色（夜间）</span>
        <input type="color" bind:value={settings.background.dotColorDark} />
      </div>
      <div class="row">
        <span>间距</span>
        <input type="range" min="8" max="120" bind:value={settings.background.dotSpacing} use:wheelAdjust={{ kind: 'value' }} />
        <em>{settings.background.dotSpacing}px</em>
      </div>
    {/if}
    {#if settings.background.mode === 'grid'}
      <div class="row">
        <span>小格间距</span>
        <input type="range" min="8" max="120" bind:value={settings.background.gridSpacing} use:wheelAdjust={{ kind: 'value' }} />
        <em>{settings.background.gridSpacing}px</em>
      </div>
      <div class="row">
        <span>大格单位</span>
        <input type="range" min="2" max="10" bind:value={settings.background.gridMajorEvery} use:wheelAdjust={{ kind: 'value' }} />
        <em>{settings.background.gridMajorEvery} 格</em>
      </div>
      <div class="row">
        <span>小格浓度</span>
        <input type="range" min="0" max="1" step="0.01" bind:value={settings.background.gridMinorOpacity} use:wheelAdjust={{ kind: 'percent' }} />
        <em>{Math.round(settings.background.gridMinorOpacity * 100)}%</em>
      </div>
      <div class="row">
        <span>大格浓度</span>
        <input type="range" min="0" max="1" step="0.01" bind:value={settings.background.gridMajorOpacity} use:wheelAdjust={{ kind: 'percent' }} />
        <em>{Math.round(settings.background.gridMajorOpacity * 100)}%</em>
      </div>
      <div class="row">
        <span>网格色（日间）</span>
        <input type="color" bind:value={settings.background.gridColor} />
      </div>
      <div class="row">
        <span>网格色（夜间）</span>
        <input type="color" bind:value={settings.background.gridColorDark} />
      </div>
    {/if}
  </section>

  <section>
    <h4>吸附</h4>
    <div class="row">
      <label><input type="checkbox" bind:checked={settings.snap.enabled} />启用吸附</label>
      <label><input type="checkbox" bind:checked={settings.snap.gridSnap} />磁吸网格</label>
      <label><input type="checkbox" bind:checked={settings.snap.objectSnap} />吸附对象</label>
    </div>
    <div class="row">
      <span>阈值</span>
      <input type="range" min="2" max="40" bind:value={settings.snap.threshold} use:wheelAdjust={{ kind: 'value' }} />
      <em>{settings.snap.threshold}px</em>
    </div>
  </section>

  <section>
    <h4>镭射笔</h4>
    <div class="row">
      <span>颜色</span>
      <input type="color" bind:value={settings.laser.color} />
      <span>线宽</span>
      <input type="range" min="2" max="24" bind:value={settings.laser.width} use:wheelAdjust={{ kind: 'value' }} />
      <em>{settings.laser.width}px</em>
    </div>
    <div class="row">
      <span>消失延迟</span>
      {#each DELAYS as d (d.v)}
        <label><input type="radio" bind:group={settings.laser.delayMs} value={d.v} />{d.label}</label>
      {/each}
    </div>
    <div class="row">
      <button onclick={() => app.engine.laser.clearAll()}>清除全部笔迹（Esc）</button>
    </div>
  </section>

  <section>
    <h4>橡皮擦</h4>
    <div class="row">
      <span>半径</span>
      <input type="range" min="5" max="200" bind:value={settings.eraser.radius} use:wheelAdjust={{ kind: 'value' }} />
      <em>{settings.eraser.radius}px</em>
    </div>
  </section>

  <section>
    <h4>文本默认</h4>
    <div class="row">
      <span>字体</span>
      <FontSelect bind:this={fontSel} value={settings.text.fontFamily} options={fontOptions} commit={commitFont} />
      <button onclick={loadSystemFonts}>读取系统字体</button>
    </div>
    <div class="row">
      <span>字号</span>
      <input type="range" min={SIZE_MIN} max={SIZE_MAX} bind:value={settings.text.fontSize} use:wheelAdjust={{ kind: 'value' }} />
      <input
        type="number"
        min={SIZE_MIN}
        max={SIZE_MAX}
        bind:this={sizeBoxEl}
        value={settings.text.fontSize}
        oninput={(e) => {
          // 合法值即时写入：blur 的 change 事件晚于画布 pointerdown（新建文本），
          // 只靠 change 会导致"刚改完就新建"仍用旧值；越界值留到提交时夹取
          const raw = e.currentTarget.value.trim();
          if (!raw) return;
          const v = Math.round(+raw);
          if (Number.isFinite(v) && v >= SIZE_MIN && v <= SIZE_MAX) settings.text.fontSize = v;
        }}
        onchange={commitSize}
        onkeydown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
        use:wheelAdjust={{ kind: 'value' }}
      />
      <span>字重</span>
      <input
        type="number"
        min="1"
        max="900"
        step="1"
        value={settings.text.fontWeight}
        use:wheelAdjust={{ kind: 'value' }}
        oninput={(e) => {
          // 与字号同一处理：合法值即时生效，越界值留到提交时夹取（避免边输入边改写文本框）
          const raw = e.currentTarget.value.trim();
          if (!raw) return;
          const v = Math.round(+raw);
          if (Number.isFinite(v) && v >= 1 && v <= 900) settings.text.fontWeight = v;
        }}
        onchange={(e) => {
          const v = Math.round(+e.currentTarget.value || 400);
          settings.text.fontWeight = Math.max(1, Math.min(900, v));
        }}
        onkeydown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
      />
      <span>颜色</span>
      <input type="color" bind:value={settings.text.color} />
    </div>
  </section>

  <section>
    <h4>滚轮步进</h4>
    <div class="row">
      <span>步进方式</span>
      <label><input type="radio" bind:group={settings.wheelStep.mode} value="auto" />自动</label>
      <label><input type="radio" bind:group={settings.wheelStep.mode} value="value" />固定数值</label>
      <label><input type="radio" bind:group={settings.wheelStep.mode} value="percent" />百分比</label>
    </div>
    <div class="row trefoil-wide-label">
      <span>数值步进</span>
      <input type="range" min="0.5" max="50" step="0.5" bind:value={settings.wheelStep.value} use:wheelAdjust={{ kind: 'value' }} />
      <em>{settings.wheelStep.value}</em>
    </div>
    <div class="row trefoil-wide-label">
      <span>百分比步进</span>
      <input type="range" min="1" max="100" step="1" bind:value={settings.wheelStep.percent} use:wheelAdjust={{ kind: 'value' }} />
      <em>{settings.wheelStep.percent}%</em>
    </div>
    <div class="row trefoil-hint">自动：透明度、浓度这类比例控件按「百分比步进」，字号、间距这类按「数值步进」</div>
  </section>

  <section>
    <h4>查看模式</h4>
    <div class="row">
      <label><input type="radio" bind:group={settings.viewMode} value="normal" onchange={() => app.setViewMode('normal')} />正常</label>
      <label><input type="radio" bind:group={settings.viewMode} value="browse" onchange={() => app.setViewMode('browse')} />浏览</label>
      <label><input type="radio" bind:group={settings.viewMode} value="focus" onchange={() => app.setViewMode('focus')} />聚焦</label>
    </div>
  </section>

  <section>
    <h4>导出</h4>
    <div class="row">
      <button onclick={() => app.exportPng({ transparent: true, includeLaser: false })}>PNG（透明）</button>
      <button onclick={() => app.exportPng({ transparent: false, includeLaser: false })}>PNG（含背景）</button>
      <button onclick={() => app.exportSvg()}>SVG</button>
    </div>
  </section>
</div>

<style>
  .trefoil-settings {
    position: absolute;
    top: 10px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 40;
    width: 430px;
    max-height: calc(100% - 40px);
    overflow: auto;
    padding: 12px 14px;
    border-radius: 10px;
    background: var(--background-primary, #fff);
    border: 1px solid var(--background-modifier-border, #ddd);
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.14);
    font-size: 12.5px;
  }
  .trefoil-settings-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-weight: 600;
    margin-bottom: 6px;
    cursor: move;
    user-select: none;
  }
  .trefoil-x {
    border: none;
    background: none;
    cursor: pointer;
    color: var(--text-muted, #777);
  }
  section {
    padding: 8px 0;
    border-top: 1px solid var(--background-modifier-border, #eee);
  }
  h4 {
    margin: 0 0 6px;
    font-size: 12px;
    color: var(--text-muted, #777);
    font-weight: 600;
  }
  .row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    margin: 5px 0;
  }
  .row > span:first-child {
    width: 58px;
    color: var(--text-muted, #777);
    flex: none;
  }
  .trefoil-wide-label > span:first-child {
    width: 68px;
    white-space: nowrap;
  }
  .trefoil-hint {
    display: block;
    color: var(--text-faint, #999);
    font-size: 11px;
    line-height: 1.5;
  }
  em {
    font-style: normal;
    color: var(--text-muted, #777);
    font-size: 11px;
    min-width: 34px;
  }
  label {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    white-space: nowrap;
  }
  input[type='range'] {
    flex: 1;
    min-width: 70px;
    accent-color: var(--interactive-accent, #4c8dff);
  }
  /* 原生取色器：Chromium 新版会把色块画成圆形，这里改写伪元素压成圆角方 */
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
  button {
    padding: 4px 10px;
    border: 1px solid var(--background-modifier-border, #ddd);
    border-radius: 5px;
    background: var(--background-primary, #fff);
    color: var(--text-normal, #222);
    font-size: 12px;
    cursor: pointer;
  }
  button:hover {
    background: var(--background-modifier-hover, #eee);
  }
</style>
