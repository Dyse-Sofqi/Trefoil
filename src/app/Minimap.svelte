<script lang="ts">
  /**
   * 画布缩略图：右下角常驻，显示全部内容与当前视口的相对位置。
   * - 点击 / 拖动缩略图 → 把视口中心移到对应世界坐标（不改变缩放级别）。
   * 绘制数据来自 Engine（内容包围盒 + 视口），以 ui.vpRev / ui.rev 作为重绘信号。
   */
  import type { CanvasApp } from './CanvasApp';
  import { ui } from './ui.svelte';
  import { nodeRect, type Rect } from '../core/geometry';
  import { paintOrder } from '../core/zorder';
  import {
    MINIMAP_W,
    MINIMAP_H,
    computeMinimapLayout,
    indicatorRect,
    mapToWorld,
    miniNodePaint,
    viewWorldRect,
    worldToMap,
    type MinimapLayout,
  } from './minimap';

  let { app }: { app: CanvasApp } = $props();

  let canvasEl = $state<HTMLCanvasElement | null>(null);
  let dragging = $state(false);
  /** 拖动期间冻结映射：否则视口移动会改变映射范围，指示框在指针下「追着跑」 */
  let dragLayout: MinimapLayout | null = null;

  function currentLayout(): MinimapLayout {
    const eng = app.engine;
    return computeMinimapLayout(
      eng.contentBBox(),
      viewWorldRect(eng.vp, eng.stage.width(), eng.stage.height()),
      MINIMAP_W,
      MINIMAP_H,
    );
  }

  function draw(): void {
    const c = canvasEl;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const pxW = Math.round(MINIMAP_W * dpr);
    const pxH = Math.round(MINIMAP_H * dpr);
    if (c.width !== pxW || c.height !== pxH) {
      c.width = pxW;
      c.height = pxH;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, MINIMAP_W, MINIMAP_H);

    const eng = app.engine;
    const palette = app.palette;
    ctx.fillStyle = palette.canvasBg;
    ctx.fillRect(0, 0, MINIMAP_W, MINIMAP_H);

    const content = eng.contentBBox();
    const view = viewWorldRect(eng.vp, eng.stage.width(), eng.stage.height());
    const lay = computeMinimapLayout(content, view, MINIMAP_W, MINIMAP_H);

    // 内容范围提示框
    if (content) {
      const a = worldToMap(lay, content.x, content.y);
      const b = worldToMap(lay, content.x + content.width, content.y + content.height);
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = palette.containerBorder;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.strokeRect(a.x + 0.5, a.y + 0.5, Math.max(1, b.x - a.x - 1), Math.max(1, b.y - a.y - 1));
      ctx.setLineDash([]);
    }

    // 连线（先画，位于节点之下）
    ctx.globalAlpha = 0.45;
    ctx.strokeStyle = palette.edge;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const e of app.doc.edges) {
      const from = app.doc.getNode(e.fromNode);
      const to = app.doc.getNode(e.toNode);
      if (!from || !to) continue;
      if (eng.isNodeHidden(from.id) || eng.isNodeHidden(to.id)) continue;
      const fr = nodeRect(from);
      const tr = nodeRect(to);
      const a = worldToMap(lay, fr.x + fr.width / 2, fr.y + fr.height / 2);
      const b = worldToMap(lay, tr.x + tr.width / 2, tr.y + tr.height / 2);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();

    // 节点
    const selection = app.doc.selection;
    for (const n of paintOrder(app.doc.nodes)) {
      if (eng.isNodeHidden(n.id)) continue;
      const r: Rect = nodeRect(n);
      const a = worldToMap(lay, r.x, r.y);
      const b = worldToMap(lay, r.x + r.width, r.y + r.height);
      const w = Math.max(1, b.x - a.x);
      const h = Math.max(1, b.y - a.y);
      const paint = miniNodePaint(n, palette);
      if (selection.has(n.id)) {
        ctx.globalAlpha = 0.95;
        ctx.fillStyle = palette.accent;
        ctx.fillRect(a.x, a.y, w, h);
        continue;
      }
      ctx.globalAlpha = paint.alpha;
      if (paint.outline) {
        ctx.strokeStyle = paint.color;
        ctx.lineWidth = 1;
        if (paint.dashed) ctx.setLineDash([3, 2]);
        ctx.strokeRect(a.x + 0.5, a.y + 0.5, Math.max(1, w - 1), Math.max(1, h - 1));
        ctx.setLineDash([]);
      } else {
        ctx.fillStyle = paint.color;
        ctx.fillRect(a.x, a.y, w, h);
      }
    }

    // 当前视口指示框
    const ind = indicatorRect(lay, view);
    ctx.globalAlpha = 1;
    ctx.fillStyle = palette.selectionFill;
    ctx.fillRect(ind.x, ind.y, ind.width, ind.height);
    ctx.strokeStyle = palette.accent;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(ind.x + 0.75, ind.y + 0.75, Math.max(1, ind.width - 1.5), Math.max(1, ind.height - 1.5));
  }

  // 视口移动 / 内容变化 / 容器尺寸变化（Engine 会递增 vpRev）→ 重绘
  $effect(() => {
    void ui.vpRev;
    void ui.rev;
    draw();
  });

  function localPoint(e: PointerEvent): { x: number; y: number } {
    const rect = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
    const scaleX = MINIMAP_W / Math.max(1, rect.width);
    const scaleY = MINIMAP_H / Math.max(1, rect.height);
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  }

  function navigateTo(mapLayout: MinimapLayout, p: { x: number; y: number }): void {
    const eng = app.engine;
    const scale = eng.vp.scale;
    const world = mapToWorld(mapLayout, p.x, p.y);
    eng.setViewport({
      scale,
      x: world.x - eng.stage.width() / (2 * scale),
      y: world.y - eng.stage.height() / (2 * scale),
    });
  }

  function onPointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    dragging = true;
    dragLayout = currentLayout();
    (e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId);
    navigateTo(dragLayout, localPoint(e));
  }

  function onPointerMove(e: PointerEvent): void {
    if (!dragging || !dragLayout) return;
    e.preventDefault();
    e.stopPropagation();
    navigateTo(dragLayout, localPoint(e));
  }

  function onPointerUp(e: PointerEvent): void {
    if (!dragging) return;
    e.preventDefault();
    e.stopPropagation();
    dragging = false;
    dragLayout = null;
    (e.currentTarget as HTMLCanvasElement).releasePointerCapture?.(e.pointerId);
  }
</script>

<div class="trefoil-minimap" class:dragging style="width:{MINIMAP_W}px;height:{MINIMAP_H}px">
  <canvas
    bind:this={canvasEl}
    title="画布缩略图：点击或拖动可定位视图"
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    onpointercancel={onPointerUp}
    oncontextmenu={(e) => e.preventDefault()}
  ></canvas>
</div>

<style>
  .trefoil-minimap {
    position: absolute;
    right: 10px;
    bottom: 8px;
    /* 低于其它 HUD：属性面板变高时可自然盖住缩略图，避免叠字 */
    z-index: 15;
    border-radius: 8px;
    border: 1px solid var(--background-modifier-border, #ddd);
    background: var(--background-primary, #fff);
    box-shadow: 0 1px 6px rgba(0, 0, 0, 0.08);
    overflow: hidden;
    cursor: pointer;
    touch-action: none;
  }
  .trefoil-minimap.dragging {
    cursor: grabbing;
  }
  .trefoil-minimap canvas {
    display: block;
    width: 100%;
    height: 100%;
  }
</style>
