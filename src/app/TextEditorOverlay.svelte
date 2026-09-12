<script lang="ts">
  import type { CanvasApp } from './CanvasApp';
  import { ui } from './ui.svelte';
  import { autoTextHeight, canvasFont, fontVerticalMetrics, layoutText } from '../engine/textMeasure';
  import { TEXT_PADDING } from '../engine/NodeView';
  import { resolveColor } from '../engine/palette';

  let { app }: { app: CanvasApp } = $props();

  let value = $state('');
  let textareaEl = $state<HTMLTextAreaElement | null>(null);
  let editingId = $state<string | null>(null);

  const node = $derived.by(() => {
    void ui.rev;
    if (!ui.editingNodeId) return null;
    return app.doc.getNode(ui.editingNodeId) ?? null;
  });

  // 进入/退出编辑态
  $effect(() => {
    if (node && ui.editingNodeId !== editingId) {
      editingId = ui.editingNodeId;
      value = node.text ?? '';
      queueMicrotask(() => {
        textareaEl?.focus();
        textareaEl?.select();
      });
    } else if (!node && editingId) {
      editingId = null;
    }
  });

  // ---------- 与 Konva 渲染态对齐的排版度量 ----------

  /** 字体度量缓存：font 串 → ascent/descent（canvas fontBoundingBox，与 CSS 内容区同源） */
  const metricsCache = new Map<string, { ascent: number; descent: number }>();
  function fontMetrics(font: string): { ascent: number; descent: number } {
    let m = metricsCache.get(font);
    if (!m) {
      const c = measureCtx2d();
      c.font = font;
      c.textBaseline = 'alphabetic';
      const t = c.measureText('Hxdj');
      m = { ascent: t.fontBoundingBoxAscent ?? fontPxOf(font), descent: t.fontBoundingBoxDescent ?? fontPxOf(font) / 4 };
      metricsCache.set(font, m);
    }
    return m;
  }

  let measureCanvas: HTMLCanvasElement | null = null;
  function measureCtx2d(): CanvasRenderingContext2D {
    if (!measureCanvas) {
      measureCanvas = document.createElement('canvas');
      measureCanvas.width = 120;
      measureCanvas.height = 80;
    }
    return measureCanvas.getContext('2d', { willReadFrequently: true })!;
  }

  function fontPxOf(font: string): number {
    const m = /(\d+(?:\.\d+)?)px/.exec(font);
    return m ? parseFloat(m[1]) : 16;
  }

  const box = $derived.by(() => {
    void ui.rev;
    void ui.vpRev; // 视口平移/缩放时跟随
    if (!node) return null;
    const vp = app.engine.vp;
    const s = vp.scale;
    const p = app.engine.worldToScreen(node.x, node.y);
    const F = node.fontSize ?? 16;
    const family = node.fontFamily ?? 'system-ui, sans-serif';
    const weight = node.fontWeight ?? 400;
    const fontCss = `${weight >= 600 ? 'bold ' : ''}${F}px ${canvasFont(family)}`;
    // 行进距与 textMeasure.layoutText / Konva buildText 完全一致
    const LH = Math.round(F * 1.5);
    const m = fontMetrics(fontCss);
    const vm = fontVerticalMetrics(fontCss);
    const mo = vm.baselineOffset;
    const shift = -vm.inkCenterOffset; // 与渲染层一致：墨迹视觉居中
    // 垂直方向恒居中：与 NodeView.buildText 同公式（世界单位）
    const layout = layoutText(value, Math.max(20, node.width - TEXT_PADDING * 2), F, family, weight);
    const startY = Math.max(TEXT_PADDING, (node.height - layout.height) / 2);
    // DOM 首行基线 = top + padTop + 半行距 + ascent；画布首行基线 = top + (startY + 行距/2 + shift + mo)·s
    // 反解 padTop 使两者重合（原地编辑）；padTop 为负时平移到 top 上（padding 不接受负值）
    let padTop = s * (startY + LH / 2 + shift + mo - LH / 2 - (m.ascent - m.descent) / 2);
    let topAdjust = 0;
    if (padTop < 0) {
      topAdjust = padTop;
      padTop = 0;
    }
    const padX = TEXT_PADDING * s;
    return {
      left: p.x,
      top: p.y + topAdjust,
      width: Math.max(60, node.width * s),
      fontSize: F * s,
      lineHeight: LH * s,
      padTop,
      padX,
      fontFamily: canvasFont(family),
      fontWeight: weight,
      color: resolveColor(node.color, app.palette) ?? 'var(--text-normal, #1f1f1f)',
      align: node.hAlign ?? 'left',
    };
  });

  // 高度随内容生长（与渲染态 autoTextHeight 同一算法，所见即所得）
  $effect(() => {
    void value;
    const el = textareaEl;
    const n = node;
    if (!el || !n) return;
    const worldH = autoTextHeight(value, n.width, n.fontSize ?? 16, n.fontFamily ?? 'system-ui, sans-serif', n.fontWeight ?? 400);
    el.style.minHeight = `${Math.max(28, worldH * app.engine.vp.scale)}px`;
  });

  function commit(): void {
    if (editingId) app.commitText(editingId, value);
    editingId = null;
  }

  function onkeydown(e: KeyboardEvent): void {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      commit();
    }
  }
</script>

{#if node && box}
  <textarea
    rows="1"
    bind:this={textareaEl}
    class="trefoil-text-editor"
    style:left="{box.left}px"
    style:top="{box.top}px"
    style:width="{box.width}px"
    style:padding="{box.padTop}px {box.padX}px {box.padX}px"
    style:font-size="{box.fontSize}px"
    style:line-height="{box.lineHeight}px"
    style:font-family="{box.fontFamily}"
    style:font-weight="{box.fontWeight}"
    style:color="{box.color}"
    style:text-align="{box.align === 'justify' ? 'justify' : box.align}"
    bind:value
    oninput={() => {}}
    onblur={commit}
    onkeydown={onkeydown}
    onpointerdown={(e) => e.stopPropagation()}
    ondblclick={(e) => e.stopPropagation()}
    placeholder="输入文字…"
  ></textarea>
{/if}

<style>
  /* 所见即所得：无背景、无边框、无特效，度量与 Konva 渲染态完全一致。
     !important 用于压过 Obsidian 全局 textarea 样式（form-field 背景/边框/内边距/聚焦环）。 */
  .trefoil-text-editor {
    position: absolute;
    z-index: 500;
    margin: 0;
    border: none !important;
    border-radius: 0 !important;
    outline: none;
    box-shadow: none !important;
    background: transparent !important;
    resize: none;
    overflow: hidden;
    box-sizing: border-box;
    user-select: text;
    caret-color: currentColor;
  }
  .trefoil-text-editor:focus {
    box-shadow: none !important;
    background: transparent !important;
  }
  .trefoil-text-editor::placeholder {
    color: var(--text-faint, #aaa);
    opacity: 0.6;
  }
</style>
