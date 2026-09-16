<script lang="ts">
  import type { CanvasApp } from './CanvasApp';
  import { ui } from './ui.svelte';
  import { autoTextHeight, autoTextWidth, canvasFont, fontVerticalMetrics, layoutText } from '../engine/textMeasure';
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
    // 宽高贴合内容（与 commitText 同一算法）：随输入实时伸缩，提交后几何不变、画布不跳。
    // 空文本给占位符宽（5 字宽 + 内边距），保证「输入文字…」完整可见
    const worldW = value ? autoTextWidth(value, F, family, weight) : Math.ceil(F * 5) + TEXT_PADDING * 2;
    const worldH = autoTextHeight(value, worldW, F, family, weight);
    const layout = layoutText(value, Math.max(20, worldW - TEXT_PADDING * 2), F, family, weight);
    // 垂直方向恒居中：与 NodeView.buildText 同公式（世界单位）
    const startY = Math.max(TEXT_PADDING, (worldH - layout.height) / 2);
    // 编辑态带出背景与实体边框（所见即所得）：与画布 paintFrame 同一几何 —— 内缩描边、圆角夹取。
    // 边框被取消的节点保持无边框透明；背景跟随节点 fill
    const bSw = node.border ? Math.max(1, node.strokeSize ?? 2) : 0;
    const borderColor = node.border ? (resolveColor(node.stroke, app.palette) ?? app.palette.nodeStroke) : null;
    const borderDash = node.borderStyle === 'dashed' ? 'dashed' : node.borderStyle === 'dotted' ? 'dotted' : 'solid';
    const frameR = Math.min(Math.max(0, node.borderRadius ?? 0), Math.max(0, Math.min(worldW, worldH) / 2 - bSw / 2));
    const bg = node.fill ? (resolveColor(node.fill, app.palette) ?? 'transparent') : 'transparent';
    // DOM 首行基线 = top + 边框 + padTop + 半行距 + ascent；画布首行基线 = top + (startY + 行距/2 + shift + mo)·s
    // 反解 padTop 使两者重合（原地编辑）；CSS 边框把内容整体下推 bSw·s，需从 padTop 中扣除；
    // 水平同理：padX = (TEXT_PADDING - bSw)·s。padTop 为负时平移到 top 上（padding 不接受负值）
    let padTop = s * (startY + LH / 2 + shift + mo - LH / 2 - (m.ascent - m.descent) / 2) - bSw * s;
    let topAdjust = 0;
    if (padTop < 0) {
      topAdjust = padTop;
      padTop = 0;
    }
    const padX = Math.max(0, TEXT_PADDING - bSw) * s;
    return {
      left: p.x,
      top: p.y + topAdjust,
      width: worldW * s,
      height: worldH * s,
      fontSize: F * s,
      lineHeight: LH * s,
      padTop,
      padX,
      fontFamily: canvasFont(family),
      fontWeight: weight,
      color: resolveColor(node.color, app.palette) ?? 'var(--text-normal, #1f1f1f)',
      align: node.hAlign ?? 'left',
      borderCss: borderColor ? `${bSw * s}px ${borderDash} ${borderColor}` : 'none',
      radiusCss: `${frameR * s}px`,
      bgCss: bg,
    };
  });

  // 高度随内容生长（与渲染态 autoTextHeight 同一算法，所见即所得）——并入 box 派生值，模板声明式绑定

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
    style:height="{box.height}px"
    style:padding="{box.padTop}px {box.padX}px {box.padX}px"
    style:font-size="{box.fontSize}px"
    style:line-height="{box.lineHeight}px"
    style:font-family="{box.fontFamily}"
    style:font-weight="{box.fontWeight}"
    style:color="{box.color}"
    style:text-align="{box.align === 'justify' ? 'justify' : box.align}"
    style:--trefoil-editor-border={box.borderCss}
    style:--trefoil-editor-radius={box.radiusCss}
    style:--trefoil-editor-bg={box.bgCss}
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
  /* 所见即所得：度量与 Konva 渲染态完全一致；边框/圆角/背景由节点样式经 CSS 变量注入
     （默认透明无边框，见 box 派生值）。!important 用于压过 Obsidian 全局 textarea 样式
     （form-field 背景/边框/内边距/聚焦环）——变量在声明处展开，保持覆盖力。 */
  .trefoil-text-editor {
    position: absolute;
    z-index: 500;
    margin: 0;
    border: var(--trefoil-editor-border, none) !important;
    border-radius: var(--trefoil-editor-radius, 0) !important;
    outline: none;
    box-shadow: none !important;
    background: var(--trefoil-editor-bg, transparent) !important;
    resize: none;
    overflow: hidden;
    box-sizing: border-box;
    user-select: text;
    caret-color: currentColor;
  }
  .trefoil-text-editor:focus {
    box-shadow: none !important;
  }
  .trefoil-text-editor::placeholder {
    color: var(--text-faint, #aaa);
    opacity: 0.6;
  }
</style>
