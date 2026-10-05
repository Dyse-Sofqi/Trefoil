<!--
  取色弹层（Excalidraw 风格）：透明色 + 经典色 → 当前色相明暗梯度 → 调色板（饱和度/亮度方块 + 色条）→ 十六进制值 + 吸管。
  交互约定：按压 / 拖动只「预览」（onpreview 实时生效、并入宿主进行中的样式会话，不入撤销栈），松手才「提交」
  （oncommit，由宿主与预览合并为一条撤销记录）——替代原生取色器，原实现每次取色都会经 {#key} 重建 input
  把系统弹窗当场关掉（「一按就选中并退出」）。弹层挂 document.body（宿主面板在 transform 容器内，fixed
  定位会被改变包含块），点弹层外 / Esc / 再点触发钮关闭。
-->
<script module lang="ts">
  /** 经典色（5 列 × 3 行）：白/深灰/黑/棕 + 青/蓝/紫/堇/绯 + 绿/青绿/琥珀/橙/红 */
  export const CLASSIC_COLORS: string[] = [
    '#ffffff', '#343a40', '#000000', '#846358', '#0b7285',
    '#1971c2', '#6741d9', '#9c36b5', '#a61e4d', '#2f9e44',
    '#0ca678', '#f08c00', '#e8590c', '#e03131',
  ];

  const SHADE_LIGHTNESSES = [0.93, 0.8, 0.65, 0.47, 0.3];

  function clamp(v: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, v));
  }

  /** '#rgb'/'#rrggbb' → [r,g,b]（0-255）；非法返回 null */
  export function hexToRgb(hex: string): [number, number, number] | null {
    let h = hex.trim().replace(/^#/, '');
    if (/^[0-9a-fA-F]{3}$/.test(h)) h = h.split('').map((c) => c + c).join('');
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }

  export function rgbToHex(r: number, g: number, b: number): string {
    const to = (v: number) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0');
    return `#${to(r)}${to(g)}${to(b)}`;
  }

  /** 任意 3/6 位 hex 文本 → 规整的 '#rrggbb'；非法返回 null */
  export function normalizeHex(raw: string): string | null {
    const rgb = hexToRgb(raw);
    return rgb ? rgbToHex(rgb[0], rgb[1], rgb[2]) : null;
  }

  /** rgb → hsv（h: 0-360，s/v: 0-1）——调色板方块用 HSV 坐标 */
  export function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
    r /= 255;
    g /= 255;
    b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    let h = 0;
    if (d > 0) {
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h = h * 60 + (h < 0 ? 360 : 0);
    }
    return { h, s: max === 0 ? 0 : d / max, v: max };
  }

  export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
    h = ((h % 360) + 360) % 360;
    const c = v * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = v - c;
    let rgb: [number, number, number];
    if (h < 60) rgb = [c, x, 0];
    else if (h < 120) rgb = [x, c, 0];
    else if (h < 180) rgb = [0, c, x];
    else if (h < 240) rgb = [0, x, c];
    else if (h < 300) rgb = [x, 0, c];
    else rgb = [c, 0, x];
    return [(rgb[0] + m) * 255, (rgb[1] + m) * 255, (rgb[2] + m) * 255];
  }

  export function hsvToHex(h: number, s: number, v: number): string {
    const [r, g, b] = hsvToRgb(h, s, v);
    return rgbToHex(r, g, b);
  }

  export function hexToHsv(hex: string): { h: number; s: number; v: number } | null {
    const rgb = hexToRgb(hex);
    return rgb ? rgbToHsv(rgb[0], rgb[1], rgb[2]) : null;
  }

  /** rgb → hsl（h: 0-360，s/l: 0-1）——明暗梯度按 HSL 亮度分档 */
  export function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
    r /= 255;
    g /= 255;
    b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    const d = max - min;
    if (!d) return { h: 0, s: 0, l };
    let h: number;
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = h * 60 + (h < 0 ? 360 : 0);
    return { h, s: d / (1 - Math.abs(2 * l - 1)), l };
  }

  export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
    h = ((h % 360) + 360) % 360;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    let rgb: [number, number, number];
    if (h < 60) rgb = [c, x, 0];
    else if (h < 120) rgb = [x, c, 0];
    else if (h < 180) rgb = [0, c, x];
    else if (h < 240) rgb = [0, x, c];
    else if (h < 300) rgb = [x, 0, c];
    else rgb = [c, 0, x];
    return [(rgb[0] + m) * 255, (rgb[1] + m) * 255, (rgb[2] + m) * 255];
  }

  export function hslToHex(h: number, s: number, l: number): string {
    const [r, g, b] = hslToRgb(h, s, l);
    return rgbToHex(r, g, b);
  }

  /** 明暗梯度：保留色相 5 档（浅 → 深）；灰色系保持灰阶，彩色把饱和度夹进可辨识区间 */
  export function shadesOf(hex: string | null, fallbackHue: number): string[] {
    const rgb = hex ? hexToRgb(hex) : null;
    const hsl = rgb ? rgbToHsl(rgb[0], rgb[1], rgb[2]) : null;
    const h = hsl ? hsl.h : fallbackHue;
    const s = !hsl || hsl.s < 0.08 ? 0 : clamp(hsl.s, 0.42, 0.78);
    return SHADE_LIGHTNESSES.map((l) => hslToHex(h, s, l));
  }
</script>

<script lang="ts">
  import { icon } from './icons';

  let {
    value = '#000000',
    allowTransparent = false,
    onpreview,
    oncommit,
  }: {
    /** 当前显示色：宿主已 resolve 的 '#rrggbb'；'transparent' = 透明（无填充） */
    value?: string;
    /** 提供透明色块（填充类颜色） */
    allowTransparent?: boolean;
    /** 按压 / 拖动中的预览；null = 透明 */
    onpreview?: (c: string | null) => void;
    /** 松手 / 吸管 / 回车的提交；null = 透明 */
    oncommit?: (c: string | null) => void;
  } = $props();

  let open = $state(false);
  let triggerEl = $state<HTMLButtonElement | null>(null);
  let popEl = $state<HTMLDivElement | null>(null);
  let svEl = $state<HTMLDivElement | null>(null);
  let hueEl = $state<HTMLDivElement | null>(null);
  let pos = $state({ left: 0, top: 0 });
  let paletteOpen = $state(false);

  /** 色条相位与方块内的饱和度 / 明度（拖动中即预览态） */
  let hue = $state(210);
  let sv = $state({ s: 0.7, v: 0.5 });

  type DragKind = '' | 'sv' | 'hue' | 'grid' | 'shades';
  let dragKind: DragKind = $state('');
  /** 本轮按压会话最近一次预览值（undefined = 尚未预览） */
  let sessionColor: string | null | undefined = undefined;

  function sessionPreview(c: string | null): void {
    sessionColor = c;
    onpreview?.(c);
  }

  /** 松手：dragKind 先清（让外部 value → 调色板状态的同步恢复），再提交 */
  function sessionCommit(): void {
    const c = sessionColor;
    sessionColor = undefined;
    dragKind = '';
    if (c !== undefined) oncommit?.(c);
  }

  // ---- 弹层开关 / 定位 ----

  /** 当前色是否是经典色 / 明暗梯度里列出的颜色（决定调色板默认展开） */
  function isListedColor(v: string): boolean {
    if (v === 'transparent') return true;
    const lower = v.toLowerCase();
    if (CLASSIC_COLORS.some((c) => c === lower)) return true;
    return shadesOf(v, hue).some((c) => c === lower);
  }

  function toggle(): void {
    if (open) {
      open = false;
      return;
    }
    open = true;
    // 自定义色（非经典 / 梯度色）默认展开调色板，直接可微调
    paletteOpen = !isListedColor(value);
  }

  function place(): void {
    const t = triggerEl;
    if (!t) return;
    const r = t.getBoundingClientRect();
    const w = popEl?.offsetWidth || 248;
    const h = popEl?.offsetHeight || 380;
    const left = clamp(r.right - w, 8, Math.max(8, window.innerWidth - w - 8));
    let top = r.bottom + 6;
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
    pos = { left: Math.round(left), top: Math.round(top) };
  }

  // 挂载即同步定位（$effect 在 DOM 挂载后运行，能量到实际尺寸）；rAF 在后台/被遮挡窗口会被
  // 节流到不触发，不能作为唯一时机。滚动 / 缩放跟随见下方监听。
  $effect(() => {
    if (!open) return;
    void popEl;
    place();
    const t = setTimeout(place, 0);
    return () => clearTimeout(t);
  });

  // 点弹层与触发钮之外关闭
  $effect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (t && (popEl?.contains(t) || triggerEl?.contains(t))) return;
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

  // 外部 value 变化（撤销 / 其它预览回写）→ 同步调色板状态；拖动中不打断
  $effect(() => {
    const hsv = hexToHsv(value);
    if (dragKind || !hsv) return;
    hue = hsv.h;
    sv = { s: hsv.s, v: hsv.v };
  });

  // ---- 色块网格（经典色 / 明暗梯度）：按住可在格内拖动连续预览，松手提交 ----

  function swatchAt(x: number, y: number): HTMLElement | null {
    return document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-c]') ?? null;
  }

  function previewSwatch(el: HTMLElement | null): void {
    const c = el?.dataset.c;
    if (!c) return;
    sessionPreview(c === 'transparent' ? null : normalizeHex(c));
  }

  function gridDown(e: PointerEvent, kind: 'grid' | 'shades'): void {
    const hit = swatchAt(e.clientX, e.clientY);
    if (!hit) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragKind = kind;
    previewSwatch(hit);
  }

  function gridMove(e: PointerEvent): void {
    if (dragKind !== 'grid' && dragKind !== 'shades') return;
    previewSwatch(swatchAt(e.clientX, e.clientY));
  }

  function gridUp(): void {
    if (dragKind !== 'grid' && dragKind !== 'shades') return;
    sessionCommit();
  }

  // ---- 调色板：饱和度 / 明度方块与色条，按压拖动连续预览 ----

  function svDown(e: PointerEvent): void {
    const el = svEl;
    if (!el) return;
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    dragKind = 'sv';
    svApply(e);
  }

  function svMove(e: PointerEvent): void {
    if (dragKind === 'sv') svApply(e);
  }

  function svApply(e: PointerEvent): void {
    const el = svEl;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const s = clamp((e.clientX - r.left) / r.width, 0, 1);
    const v = clamp(1 - (e.clientY - r.top) / r.height, 0, 1);
    sv = { s, v };
    sessionPreview(hsvToHex(hue, s, v));
  }

  function hueDown(e: PointerEvent): void {
    const el = hueEl;
    if (!el) return;
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    dragKind = 'hue';
    hueApply(e);
  }

  function hueMove(e: PointerEvent): void {
    if (dragKind === 'hue') hueApply(e);
  }

  function hueApply(e: PointerEvent): void {
    const el = hueEl;
    if (!el) return;
    const r = el.getBoundingClientRect();
    hue = clamp((e.clientX - r.left) / r.width, 0, 1) * 360;
    sessionPreview(hsvToHex(hue, sv.s, sv.v));
  }

  // ---- 十六进制输入：合法值即时预览，回车 / 失焦提交，非法还原 ----

  let hexFocused = $state(false);
  let hexText = $state('');
  const valueHex = $derived(value && value !== 'transparent' ? normalizeHex(value) : null);

  $effect(() => {
    if (hexFocused) return;
    hexText = valueHex?.slice(1) ?? '';
  });

  function onHexInput(e: Event): void {
    hexText = (e.currentTarget as HTMLInputElement).value;
    const v = normalizeHex(hexText);
    if (v) onpreview?.(v);
  }

  function onHexCommit(): void {
    const v = normalizeHex(hexText);
    if (v) {
      onpreview?.(v);
      oncommit?.(v);
    } else {
      hexText = valueHex?.slice(1) ?? '';
    }
  }

  // ---- 屏幕吸管（Chromium EyeDropper；不支持时隐藏按钮） ----

  interface EyeDropperLike {
    open(): Promise<{ sRGBHex: string }>;
  }
  const eyeCtor = (globalThis as { EyeDropper?: new () => EyeDropperLike }).EyeDropper;
  const eyeSupported = typeof eyeCtor === 'function';

  async function pickWithEye(): Promise<void> {
    if (!eyeCtor) return;
    try {
      const res = await new eyeCtor().open();
      const v = normalizeHex(res.sRGBHex ?? '');
      if (!v) return;
      onpreview?.(v);
      oncommit?.(v);
    } catch {
      /* 用户按 Esc 取消 */
    }
  }

  // ---- 选中高亮 ----

  function swatchSelected(c: string): boolean {
    const lower = value.toLowerCase();
    return c === 'transparent' ? lower === 'transparent' : c === lower;
  }

  const shades = $derived(shadesOf(value === 'transparent' ? null : valueHex, hue));

  function portal(node: HTMLElement): { destroy(): void } {
    document.body.appendChild(node);
    return { destroy: () => node.remove() };
  }
</script>

<button
  bind:this={triggerEl}
  type="button"
  class="trefoil-cpick-trigger"
  class:transparent={value === 'transparent'}
  style:background={value === 'transparent' ? undefined : value}
  title="自定义颜色"
  aria-haspopup="dialog"
  aria-expanded={open}
  onclick={toggle}
></button>

{#if open}
  <div
    class="trefoil-cpick-pop"
    role="dialog"
    aria-label="自定义颜色"
    tabindex="-1"
    bind:this={popEl}
    use:portal
    style="left:{pos.left}px;top:{pos.top}px"
    onkeydown={(e) => {
      e.stopPropagation();
      if (e.key === 'Escape') open = false;
    }}
  >
    <h5>颜色</h5>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="cgrid"
      onpointerdown={(e) => gridDown(e, 'grid')}
      onpointermove={gridMove}
      onpointerup={gridUp}
      onpointercancel={gridUp}
    >
      {#if allowTransparent}
        <button type="button" class="cswatch transparent" class:selected={swatchSelected('transparent')} data-c="transparent" title="透明" tabindex="-1"></button>
      {/if}
      {#each CLASSIC_COLORS as c (c)}
        <button type="button" class="cswatch" class:selected={swatchSelected(c)} data-c={c} style:background={c} title={c} tabindex="-1"></button>
      {/each}
    </div>

    <h5>色调明暗</h5>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="cgrid shades"
      onpointerdown={(e) => gridDown(e, 'shades')}
      onpointermove={gridMove}
      onpointerup={gridUp}
      onpointercancel={gridUp}
    >
      {#each shades as c (c)}
        <button type="button" class="cswatch" class:selected={swatchSelected(c)} data-c={c} style:background={c} title={c} tabindex="-1"></button>
      {/each}
    </div>

    <button type="button" class="pal-head" aria-expanded={paletteOpen} onclick={() => (paletteOpen = !paletteOpen)}>
      <span class="chev" class:open={paletteOpen}>{@html icon('chevron-right')}</span>
      <span>调色板</span>
    </button>
    {#if paletteOpen}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="sv"
        bind:this={svEl}
        style:background={`linear-gradient(to top, #000, rgba(0, 0, 0, 0)), linear-gradient(to right, #fff, rgba(255, 255, 255, 0)), hsl(${Math.round(hue)}, 100%, 50%)`}
        onpointerdown={svDown}
        onpointermove={svMove}
        onpointerup={() => dragKind === 'sv' && sessionCommit()}
        onpointercancel={() => dragKind === 'sv' && sessionCommit()}
      >
        <span class="sv-ind" style:left="{sv.s * 100}%" style:top="{(1 - sv.v) * 100}%"></span>
      </div>
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="hue"
        bind:this={hueEl}
        onpointerdown={hueDown}
        onpointermove={hueMove}
        onpointerup={() => dragKind === 'hue' && sessionCommit()}
        onpointercancel={() => dragKind === 'hue' && sessionCommit()}
      >
        <span class="hue-ind" style:left="{(hue / 360) * 100}%"></span>
      </div>
    {/if}

    <h5>十六进制值</h5>
    <div class="hexrow">
      <span class="hash">#</span>
      <input
        value={hexText}
        maxlength="6"
        spellcheck="false"
        aria-label="十六进制颜色值"
        oninput={onHexInput}
        onfocus={() => (hexFocused = true)}
        onblur={() => {
          hexFocused = false; // 复位后同步 effect 才能在外部值变化时刷新显示
          onHexCommit();
        }}
        onkeydown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          else if (e.key === 'Escape') open = false;
        }}
      />
      {#if eyeSupported}
        <button type="button" class="iconbtn" title="屏幕取色" onclick={pickWithEye}>{@html icon('pipette')}</button>
      {/if}
      <button
        type="button"
        class="round"
        class:transparent={value === 'transparent'}
        style:background={value === 'transparent' ? undefined : value}
        title={paletteOpen ? '收起调色板' : '展开调色板'}
        aria-expanded={paletteOpen}
        onclick={() => (paletteOpen = !paletteOpen)}
      ></button>
    </div>
  </div>
{/if}

<style>
  .trefoil-cpick-trigger {
    width: 22px;
    height: 22px;
    flex: none;
    padding: 0;
    border: 1px solid var(--background-modifier-border, #ddd);
    border-radius: 6px;
    background: var(--background-primary, #fff);
    cursor: pointer;
    transition: border-color 0.12s ease, box-shadow 0.12s ease;
  }
  .trefoil-cpick-trigger:hover {
    border-color: var(--interactive-accent, #4c8dff);
  }
  .trefoil-cpick-trigger:focus-visible {
    outline: none;
    border-color: var(--interactive-accent, #4c8dff);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--interactive-accent, #4c8dff) 30%, transparent);
  }
  .trefoil-cpick-trigger.transparent {
    background: repeating-conic-gradient(#cfcfcf 0% 25%, #ffffff 0% 50%) 0 0 / 10px 10px;
  }

  .trefoil-cpick-pop {
    position: fixed;
    z-index: 1100;
    width: 248px;
    padding: 8px 10px 12px;
    background: var(--background-primary, #fff);
    border: 1px solid var(--background-modifier-border, #ddd);
    border-radius: 10px;
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.14);
    font-size: 12px;
    color: var(--text-normal, #222);
    user-select: none;
  }
  h5 {
    margin: 6px 0 6px;
    font-size: 11px;
    font-weight: 600;
    color: var(--text-muted, #777);
  }
  .cgrid {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 6px;
    touch-action: none;
  }
  .cgrid.shades {
    display: flex;
  }
  .cgrid.shades .cswatch {
    flex: 1;
    height: 26px;
    border-radius: 6px;
  }
  .cswatch {
    height: 30px;
    padding: 0;
    border: 1px solid rgba(0, 0, 0, 0.14);
    border-radius: 8px;
    cursor: pointer;
  }
  .cswatch.transparent {
    background: repeating-conic-gradient(#cfcfcf 0% 25%, #ffffff 0% 50%) 0 0 / 10px 10px;
  }
  .cswatch.selected {
    box-shadow: 0 0 0 2px var(--background-primary, #fff), 0 0 0 4px var(--interactive-accent, #4c8dff);
  }

  .pal-head {
    display: flex;
    align-items: center;
    gap: 3px;
    margin: 12px 0 0;
    padding: 0;
    border: none;
    background: none;
    cursor: pointer;
    font-size: 11px;
    font-weight: 600;
    color: var(--text-muted, #777);
  }
  .pal-head .chev {
    display: inline-flex;
  }
  .pal-head .chev :global(svg) {
    width: 12px;
    height: 12px;
    transition: transform 0.12s ease;
  }
  .pal-head .chev.open :global(svg) {
    transform: rotate(90deg);
  }

  .sv {
    position: relative;
    height: 116px;
    margin-top: 8px;
    border: 1px solid rgba(0, 0, 0, 0.1);
    border-radius: 8px;
    cursor: crosshair;
    touch-action: none;
  }
  .sv-ind {
    position: absolute;
    width: 12px;
    height: 12px;
    border: 2px solid #fff;
    border-radius: 50%;
    box-shadow: 0 0 3px rgba(0, 0, 0, 0.5);
    transform: translate(-50%, -50%);
    box-sizing: border-box;
    pointer-events: none;
  }
  .hue {
    position: relative;
    height: 12px;
    margin-top: 10px;
    border: 1px solid rgba(0, 0, 0, 0.1);
    border-radius: 6px;
    cursor: pointer;
    touch-action: none;
    background: linear-gradient(to right, #f00 0%, #ff0 16.6%, #0f0 33.3%, #0ff 50%, #00f 66.6%, #f0f 83.3%, #f00 100%);
  }
  .hue-ind {
    position: absolute;
    top: -4px;
    width: 6px;
    height: 18px;
    border: 2px solid #fff;
    border-radius: 3px;
    box-shadow: 0 0 3px rgba(0, 0, 0, 0.5);
    transform: translateX(-50%);
    box-sizing: border-box;
    pointer-events: none;
  }

  .hexrow {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .hexrow .hash {
    color: var(--text-muted, #777);
  }
  .hexrow input {
    flex: 1;
    min-width: 0;
    padding: 3px 6px;
    border: 1px solid var(--background-modifier-border, #ddd);
    border-radius: 5px;
    background: var(--background-primary, #fff);
    color: var(--text-normal, #222);
    font-size: 12px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
  .hexrow input:focus {
    outline: none;
    border-color: var(--interactive-accent, #4c8dff);
  }
  .iconbtn {
    width: 24px;
    height: 24px;
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 1px solid var(--background-modifier-border, #ddd);
    border-radius: 6px;
    background: var(--background-primary, #fff);
    color: var(--text-muted, #555);
    cursor: pointer;
  }
  .iconbtn:hover {
    color: var(--text-normal, #222);
    background: var(--background-modifier-hover, #eee);
  }
  .iconbtn :global(svg) {
    width: 14px;
    height: 14px;
    display: block;
  }
  .round {
    width: 24px;
    height: 24px;
    flex: none;
    padding: 0;
    border: 1px solid rgba(0, 0, 0, 0.15);
    border-radius: 50%;
    cursor: pointer;
  }
  .round.transparent {
    background: repeating-conic-gradient(#cfcfcf 0% 25%, #ffffff 0% 50%) 0 0 / 10px 10px;
  }
</style>
