<script lang="ts">
  import type { CanvasApp } from './CanvasApp';
  import { ui, settings } from './ui.svelte';
  import { icon } from './icons';
  import type { CanvasNode, HAlign, ArrowHeadStyle, BorderStyle } from '../core/types';
  import { canRotate, isLineLike } from '../core/types';
  import { arrangeTargets, fitRingRadius } from '../core/arrange';
  import type { ArrangeAnchor, ArrangeMode, RingDistribute, RingOrderBy } from '../core/arrange';
  import { resolveColor } from '../engine/palette';
  import { FONT_PRESETS, CONTAINER_DEFAULT_FILL_OPACITY, CONTAINER_DEFAULT_RADIUS } from '../core/defaults';
  import { isMapMember } from '../core/mindmap';
  import { wheelAdjust } from './wheelStep';
  import { autoTextHeight, autoTextWidth } from '../engine/textMeasure';
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
  /** 线类形状（直线/箭头/折线）：显示箭头端点样式设置 */
  const allLineLike = $derived(sel.length > 0 && sel.every((n) => isLineLike(n)));

  /** 箭头端点样式选项（终点/起点共用） */
  const ARROW_STYLES: [ArrowHeadStyle, string][] = [
    ['none', '无'],
    ['solid', '实心箭头'],
    ['hollow', '空心箭头'],
    ['chevron', '线段箭头'],
    ['dot', '圆点'],
    ['hollow-dot', '空心圆点'],
  ];

  /** 端点样式显示值（派生：节点原地修改；缺省按形状给默认 arrow=实心、line/polyline=无） */
  const headStyleVal = $derived.by(() => {
    void ui.rev;
    if (!ref) return 'none';
    return ref.headStyle ?? (ref.shape === 'arrow' ? 'solid' : 'none');
  });
  const tailStyleVal = $derived.by(() => {
    void ui.rev;
    return ref?.tailStyle ?? 'none';
  });
  /** 线型显示值（派生：节点原地修改；缺省 solid） */
  const strokeStyleVal = $derived.by(() => {
    void ui.rev;
    return ref?.strokeStyle ?? 'solid';
  });

  /** 图片节点文件名（库内路径的 basename） */
  const fileName = $derived.by(() => {
    void ui.rev;
    return single?.file?.split('/').pop() ?? '';
  });

  /** 图片描述（派生：caption undefined = 默认文件名，空串 = 隐藏） */
  const captionVal = $derived.by(() => {
    void ui.rev;
    return single?.caption ?? '';
  });
  /** 描述牌隐藏状态（caption = ''） */
  const captionHidden = $derived.by(() => {
    void ui.rev;
    return single?.caption === '';
  });

  // ---- 颜色输入框的响应式 key/value ----
  // 节点是原地修改的普通对象，模板里直接读 ref.fill 不会因取色变化而重渲染；
  // 必须经由读取 ui.rev 的派生值，预设色点击后自定义色块才能立即同步。
  const fillColorKey = $derived.by(() => {
    void ui.rev;
    return ref ? (ref.fill ? resolveC(ref.fill) : '#ffffff') : '#ffffff';
  });
  const strokeColorKey = $derived.by(() => {
    void ui.rev;
    return ref ? (resolveC(ref.stroke) ?? '#000000') : '#000000';
  });
  const textColorKey = $derived.by(() => {
    void ui.rev;
    return ref ? (resolveC(ref.color) ?? '#000000') : '#000000';
  });

  /** 提交图片描述：空 = 恢复默认文件名 */
  function commitCaption(raw: string): void {
    const v = raw.trim();
    if (!single || v === (single.caption ?? '')) return;
    apply({ caption: v || undefined }, '图片描述');
  }

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

  /** 可旋转：块状元素（文本/形状/图片）；线类几何由端点决定、容器要装子元素，都不参与旋转 */
  const rotatable = $derived(sel.length > 0 && sel.every((n) => canRotate(n)));
  /** 旋转角显示值（度）：派生读取 —— 拖旋转手柄时经 ui.rev 实时刷新到数字框 */
  const rotationVal = $derived.by(() => {
    void ui.rev;
    return Math.round((ref?.rotation ?? 0) * 10) / 10;
  });

  function clampSize(v: number): number {
    if (!Number.isFinite(v)) return fontSize;
    return Math.max(SIZE_MIN, Math.min(SIZE_MAX, Math.round(v)));
  }

  /**
   * 文字度量变化（字号/字重/字体）后重算文本框宽高，画布里的文本框才能即时贴合内容，
   * 否则调大字号后文字会溢出边框、调小则留白。与拖拽缩放、编辑提交用的是同一套计算：
   * 宽度取内容最宽行（超上限折行），高度按该宽度重排。多选时每个节点各按自身文字适配。
   */
  function textMetricPatches(fields: { fontSize?: number; fontWeight?: number; fontFamily?: string }): Map<string, Partial<CanvasNode>> {
    const patches = new Map<string, Partial<CanvasNode>>();
    for (const n of sel) {
      if (n.type !== 'text') continue;
      const size = fields.fontSize ?? n.fontSize ?? 16;
      const weight = fields.fontWeight ?? n.fontWeight ?? 400;
      const family = fields.fontFamily ?? n.fontFamily ?? settings.text.fontFamily;
      const width = autoTextWidth(n.text ?? '', size, family, weight);
      patches.set(n.id, { ...fields, width, height: autoTextHeight(n.text ?? '', width, size, family, weight) });
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

  /** 容器背景透明度显示值（派生；未设置过 → 容器默认背景透明度） */
  const containerFillOpacityPercent = $derived.by(() => {
    void ui.rev;
    return Math.round(Math.min(1, Math.max(0, ref?.fillOpacity ?? CONTAINER_DEFAULT_FILL_OPACITY)) * 100);
  });

  /** 容器圆角显示值（派生；未设置过 → 容器默认圆角。文本框的圆角走上面的 borderRadius，默认 0） */
  const containerRadius = $derived.by(() => {
    void ui.rev;
    return ref?.borderRadius ?? CONTAINER_DEFAULT_RADIUS;
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

  // 导图状态（派生：节点原地修改，直接读 single.mapRoot 不会刷新）
  const isMapRoot = $derived.by(() => {
    void ui.rev;
    return !!single?.mapRoot;
  });
  const mapMember = $derived.by(() => {
    void ui.rev;
    return !!single && isMapMember(app.doc, single.id);
  });

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

  // ---------- 实体边框（文本框） ----------

  const BORDER_WIDTH_MAX = 40;
  const BORDER_RADIUS_MAX = 48;
  /** 容器圆角上限：容器比文本框大得多，48 在几百像素的容器上几乎看不出圆角 */
  const CONTAINER_RADIUS_MAX = 160;
  const BORDER_STYLES: [BorderStyle, string][] = [
    ['solid', '实线'],
    ['dashed', '虚线'],
    ['dotted', '点状'],
  ];

  /** 边框开关与参数（派生：节点原地修改，直接读 ref.* 不会刷新） */
  const borderOn = $derived.by(() => {
    void ui.rev;
    return !!ref?.border;
  });
  const borderStyle = $derived.by(() => {
    void ui.rev;
    return ref?.borderStyle === 'dashed' || ref?.borderStyle === 'dotted' ? ref.borderStyle : 'solid';
  });
  const borderWidth = $derived.by(() => {
    void ui.rev;
    return ref?.strokeSize ?? 2;
  });
  const borderRadius = $derived.by(() => {
    void ui.rev;
    return ref?.borderRadius ?? 0;
  });
  /** 背景填充开关（派生） */
  const fillOn = $derived.by(() => {
    void ui.rev;
    return !!ref?.fill;
  });

  /**
   * 切换实体边框：开启时补齐缺省的颜色/粗细/圆角（颜色回落到新形状默认描边），
   * 关闭时保留已调参数，再次开启直接还原。
   */
  function toggleBorder(): void {
    const n = ref;
    if (!n) return;
    if (n.border) {
      apply({ border: false }, '实体边框');
    } else {
      apply(
        {
          border: true,
          stroke: n.stroke ?? settings.shape.stroke,
          strokeSize: n.strokeSize ?? 2,
          borderRadius: n.borderRadius ?? 6,
        },
        '实体边框',
      );
    }
  }

  /** 数字框提交粗细：越界夹取（拖动中走 live，松手/失焦走这里落定撤销记录） */
  function commitBorderWidth(v: number): void {
    live({ strokeSize: Math.max(1, Math.min(BORDER_WIDTH_MAX, Math.round(v) || 1)) }, '边框粗细');
    app.commitSelectionStyle();
  }

  function commitBorderRadius(v: number): void {
    commitRadius(v, BORDER_RADIUS_MAX, '边框圆角');
  }

  /** 圆角提交（失焦 / 回车落定撤销记录）：越界夹取，非法值归 0 */
  function commitRadius(v: number, max: number, label: string): void {
    live({ borderRadius: Math.max(0, Math.min(max, Math.round(v) || 0)) }, label);
    app.commitSelectionStyle();
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

  // ---------- 多选排列 ----------

  let arrangeMode = $state<ArrangeMode>('horizontal');
  let arrangeAnchor = $state<ArrangeAnchor>('top-left');
  let arrangeGapX = $state(24); // 横向排列与矩阵共用
  let arrangeGapY = $state(24); // 纵向排列与矩阵共用
  let arrangePerRow = $state(3);
  // 环形排列参数
  let arrangeRingDistribute = $state<RingDistribute>('even');
  let arrangeRingStep = $state(30); // 固定角距（度）
  let arrangeRingRadius = $state(200);
  let arrangeRingStart = $state(0); // 起始角（度，0 = 正上方）
  let arrangeRingClockwise = $state(true);
  let arrangeRingOrder = $state<RingOrderBy>('angle');

  const GAP_MAX = 500;
  const RING_RADIUS_MIN = 20;
  const RING_RADIUS_MAX = 1200;

  const gapValue = $derived(arrangeMode === 'vertical' ? arrangeGapY : arrangeGapX);

  function clampGap(v: number): number {
    if (!Number.isFinite(v)) return 0;
    return Math.max(0, Math.min(GAP_MAX, Math.round(v)));
  }

  function clampRingRadius(v: number): number {
    if (!Number.isFinite(v)) return arrangeRingRadius;
    return Math.max(RING_RADIUS_MIN, Math.min(RING_RADIUS_MAX, Math.round(v)));
  }

  function clampRingStart(v: number): number {
    if (!Number.isFinite(v)) return 0;
    return mod360(Math.round(v));
  }

  function mod360(deg: number): number {
    return ((deg % 360) + 360) % 360;
  }

  /** 修改横向/纵向间隙并立即重排（滑块与数字框共用，二者经同一状态互相同步） */
  function setGap(which: 'x' | 'y', v: number): void {
    if (which === 'x') arrangeGapX = clampGap(v);
    else arrangeGapY = clampGap(v);
    arrange();
  }

  /**
   * 首次切到环形模式：半径默认贴合现有位置（各元素几何中心到所选包围盒中心的最大距离，下限 40），
   * 之后保留用户调整值。线类节点（箭头/直线）不上环，计算时一并排除。
   */
  function initRingRadius(): void {
    const items = arrangeTargets(sel);
    arrangeRingRadius = clampRingRadius(fitRingRadius(items.length ? items : sel));
  }

  /**
   * 应用排列；mode 传入时先切换模式（点模式按钮即立即排列）。
   * 半径只在「切入环形模式」时按当前布局拟合一次（首次贴合现有位置），
   * 之后重复点「环形」沿用当前半径与圆心 —— 若每次点击都重新拟合，会拿刚排好的环形几何
   * 反推半径，而环心与元素包围盒中心并不重合（元素尺寸不同时必有偏移），半径会被越推越大。
   */
  function arrange(mode?: ArrangeMode): void {
    if (mode && mode !== arrangeMode) {
      arrangeMode = mode;
      if (mode === 'ring') initRingRadius();
    }
    app.arrangeSelection({
      mode: arrangeMode,
      anchor: arrangeAnchor,
      gapX: arrangeGapX,
      gapY: arrangeGapY,
      perRow: arrangePerRow,
      ring: arrangeMode === 'ring' ? {
        radius: arrangeRingRadius,
        distribute: arrangeRingDistribute,
        angleStep: arrangeRingStep,
        startAngle: arrangeRingStart,
        clockwise: arrangeRingClockwise,
        orderBy: arrangeRingOrder,
      } : undefined,
    });
  }
</script>

{#if ui.propsOpen && sel.length > 0}
  <div class="trefoil-props">
    <div class="trefoil-props-head">
      <span>{sel.length > 1 ? `已选 ${sel.length} 项${allText ? '（文本）' : allShapes ? '（形状）' : allFiles ? '（图片）' : ''}` : single?.type === 'text' ? '文本' : single?.type === 'file' ? '图片' : single?.type === 'trefoil/container' ? '容器' : '形状'}</span>
      <button class="trefoil-icon-btn" title="收起" onclick={() => (ui.propsOpen = false)}>{@html icon('chevron-right')}</button>
    </div>

    {#if rotatable}
      <div class="trefoil-sec">
        <div class="trefoil-row">
          <span class="trefoil-lab">旋转</span>
          <input
            type="number"
            min="-180"
            max="180"
            step="1"
            value={rotationVal}
            use:wheelAdjust={{ kind: 'value' }}
            oninput={(e) => {
              const v = +e.currentTarget.value;
              if (Number.isFinite(v)) app.liveSelectionRotation(v);
            }}
            onchange={(e) => app.commitSelectionRotation(+e.currentTarget.value || 0)}
            onkeydown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
          />
          <span class="trefoil-val">{rotationVal}°</span>
          <button
            class="trefoil-mini-btn"
            title="重置为 0°（双击画布上的旋转手柄同样生效）"
            disabled={rotationVal === 0}
            onclick={() => app.setSelectionRotation(0, '重置旋转')}>重置</button>
        </div>
      </div>
    {/if}

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
          {#key textColorKey}
            <input type="color" title="自定义颜色" value={textColorKey} oninput={(e) => apply({ color: e.currentTarget.value }, '颜色')} />
          {/key}
          {#each presetColors as c, i (i)}
            <button class="trefoil-swatch" style:background={c} onclick={() => apply({ color: String(i + 1) }, '颜色')}></button>
          {/each}
        </label>
        <div class="trefoil-row">
          <span class="trefoil-lab">边框</span>
          <button class="trefoil-mini-btn" class:active={borderOn} title="为文本框描出实体边框" onclick={toggleBorder}>实体边框</button>
          {#if borderOn && ref}
            {#key 'b' + strokeColorKey}
              <input
                type="color"
                title="边框颜色"
                value={strokeColorKey}
                oninput={(e) => apply({ stroke: e.currentTarget.value }, '边框颜色')}
              />
            {/key}
          {/if}
        </div>
        {#if borderOn && ref}
          <div class="trefoil-row">
            <span class="trefoil-lab">样式</span>
            <div class="trefoil-btn-group">
              {#each BORDER_STYLES as [s, lab] (s)}
                <button
                  class="trefoil-mini-btn"
                  class:active={borderStyle === s}
                  title={lab + '边框'}
                  onclick={() => apply({ borderStyle: s }, '边框样式')}>{lab}</button>
              {/each}
            </div>
          </div>
          <label class="trefoil-row">
            <span class="trefoil-lab">圆角</span>
            <input
              type="range"
              min="0"
              max={BORDER_RADIUS_MAX}
              value={borderRadius}
              use:wheelAdjust={{ kind: 'value' }}
              oninput={(e) => live({ borderRadius: Math.round(+e.currentTarget.value) }, '边框圆角')}
              onchange={() => app.commitSelectionStyle()}
            />
            <input
              type="number"
              min="0"
              max={BORDER_RADIUS_MAX}
              value={borderRadius}
              use:wheelAdjust={{ kind: 'value' }}
              oninput={(e) => {
                const raw = e.currentTarget.value.trim();
                if (raw === '') return;
                const v = Math.round(+raw);
                if (Number.isFinite(v) && v >= 0 && v <= BORDER_RADIUS_MAX) live({ borderRadius: v }, '边框圆角');
              }}
              onchange={(e) => commitBorderRadius(+e.currentTarget.value)}
              onkeydown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
              }}
            />
          </label>
          <label class="trefoil-row">
            <span class="trefoil-lab">粗细</span>
            <input
              type="number"
              min="1"
              max={BORDER_WIDTH_MAX}
              value={borderWidth}
              use:wheelAdjust={{ kind: 'value' }}
              oninput={(e) => {
                const raw = e.currentTarget.value.trim();
                if (raw && Number.isFinite(+raw) && +raw >= 1 && +raw <= BORDER_WIDTH_MAX) live({ strokeSize: +raw }, '边框粗细');
              }}
              onchange={(e) => commitBorderWidth(+e.currentTarget.value)}
              onkeydown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
              }}
            />
          </label>
        {/if}
        <div class="trefoil-row">
          <span class="trefoil-lab">填充</span>
          {#if ref}
            {#key ref.fill ? resolveC(ref.fill) : '#ffffff'}
              <input
                type="color"
                title="背景填充颜色"
                value={ref.fill ? resolveC(ref.fill) : '#ffffff'}
                oninput={(e) => apply({ fill: e.currentTarget.value }, '填充')}
              />
            {/key}
            <button class="trefoil-mini-btn" class:active={!fillOn} title="无填充" onclick={() => apply({ fill: null }, '填充')}>无</button>
          {/if}
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
          {#key fillColorKey}
            <input
              type="color"
              title="自定义颜色"
              value={fillColorKey}
              oninput={(e) => apply({ fill: e.currentTarget.value }, '填充')}
            />
          {/key}
          {#each presetColors as c, i (i)}
            <button class="trefoil-swatch" style:background={c} title="填充预设色 {i + 1}" onclick={() => apply({ fill: String(i + 1) }, '填充')}></button>
          {/each}
          <button class="trefoil-mini-btn" class:active={!ref.fill} onclick={() => apply({ fill: null }, '填充')}>无</button>
        </div>
        <div class="trefoil-row">
          <span class="trefoil-lab">描边</span>
          {#key strokeColorKey}
            <input type="color" title="自定义颜色" value={strokeColorKey} oninput={(e) => apply({ stroke: e.currentTarget.value }, '描边')} />
          {/key}
          {#each presetColors as c, i (i)}
            <button class="trefoil-swatch" style:background={c} title="描边预设色 {i + 1}" onclick={() => apply({ stroke: String(i + 1) }, '描边')}></button>
          {/each}
          <input
            type="number"
            min="1"
            max="40"
            value={ref.strokeSize ?? 2}
            class="trefoil-num-sm"
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
        {#if allLineLike}
          <div class="trefoil-row">
            <span class="trefoil-lab">终点</span>
            <select
              class="trefoil-select"
              title="箭头终点（末端）样式"
              value={headStyleVal}
              onchange={(e) => apply({ headStyle: e.currentTarget.value as ArrowHeadStyle }, '箭头样式')}
            >
              {#each ARROW_STYLES as [v, lab] (v)}
                <option value={v}>{lab}</option>
              {/each}
            </select>
          </div>
          <div class="trefoil-row">
            <span class="trefoil-lab">起点</span>
            <select
              class="trefoil-select"
              title="箭头起点样式；设为箭头/圆点即为双向"
              value={tailStyleVal}
              onchange={(e) => apply({ tailStyle: e.currentTarget.value as ArrowHeadStyle }, '箭头样式')}
            >
              {#each ARROW_STYLES as [v, lab] (v)}
                <option value={v}>{lab}</option>
              {/each}
            </select>
          </div>
          <div class="trefoil-row">
            <span class="trefoil-lab">线型</span>
            <div class="trefoil-btn-group">
              {#each [['solid', '实线'], ['dashed', '虚线'], ['dotted', '点状']] as [v, lab] (v)}
                <button
                  class="trefoil-mini-btn"
                  class:active={strokeStyleVal === v}
                  onclick={() => apply({ strokeStyle: v === 'solid' ? undefined : (v as CanvasNode['strokeStyle']) }, '线型')}
                >{lab}</button>
              {/each}
            </div>
          </div>
        {/if}
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
        <div class="trefoil-row">
          <span class="trefoil-lab">描述</span>
          <div class="trefoil-btn-group">
            <button
              class="trefoil-mini-btn"
              class:active={!captionHidden}
              title="在图片下方显示描述"
              onclick={() => {
                // 从隐藏恢复：回到默认文件名（清除自定义文字则先清空再点显示即可）
                apply({ caption: captionVal.trim() && captionVal !== '' ? captionVal : undefined }, '描述');
              }}
            >显示</button>
            <button
              class="trefoil-mini-btn"
              class:active={captionHidden}
              title="隐藏图片下方描述"
              onclick={() => apply({ caption: '' }, '描述')}
            >隐藏</button>
          </div>
        </div>
        <div class="trefoil-row">
          <span class="trefoil-lab">内容</span>
          <input
            type="text"
            disabled={captionHidden}
            placeholder={fileName ? `默认：${fileName.replace(/\.[^.]+$/, '')}` : '图片描述'}
            value={captionHidden ? '' : captionVal}
            title="自定义描述文字；清空并回车 = 显示文件名"
            onchange={(e) => commitCaption(e.currentTarget.value)}
            onkeydown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
          />
        </div>
        <div class="trefoil-row trefoil-row-actions">
          <button class="trefoil-mini-btn" onclick={revealImage} disabled={!fileName || /^(https?|data|blob|app|file):/i.test(single.file ?? '')}>
            在文件中显示
          </button>
          <label class="trefoil-mini-btn">
            替换图片
            <input type="file" accept="image/*" class="trefoil-file-input" onchange={replaceImage} />
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
          <span class="trefoil-lab">背景</span>
          {#key fillColorKey}
            <input
              type="color"
              title="容器背景颜色"
              value={fillColorKey}
              oninput={(e) => apply({ fill: e.currentTarget.value }, '容器背景')}
            />
          {/key}
          {#each presetColors as c, i (i)}
            <button
              class="trefoil-swatch"
              style:background={c}
              title="背景预设色 {i + 1}"
              onclick={() => apply({ fill: String(i + 1) }, '容器背景')}
            ></button>
          {/each}
          <button class="trefoil-mini-btn" class:active={!fillOn} title="无背景（只保留虚线边框）" onclick={() => apply({ fill: null }, '容器背景')}>无</button>
        </div>
        {#if fillOn}
          <label class="trefoil-row">
            <span class="trefoil-lab">透明度</span>
            <input
              type="range"
              min="0"
              max="100"
              value={containerFillOpacityPercent}
              use:wheelAdjust={{ kind: 'percent' }}
              oninput={(e) => live({ fillOpacity: +e.currentTarget.value / 100 }, '背景透明度')}
              onchange={() => app.commitSelectionStyle()}
            />
            <span class="trefoil-val">{containerFillOpacityPercent}%</span>
          </label>
        {/if}
        <label class="trefoil-row">
          <span class="trefoil-lab">圆角</span>
          <input
            type="range"
            min="0"
            max={CONTAINER_RADIUS_MAX}
            value={containerRadius}
            use:wheelAdjust={{ kind: 'value' }}
            oninput={(e) => live({ borderRadius: Math.round(+e.currentTarget.value) }, '容器圆角')}
            onchange={() => app.commitSelectionStyle()}
          />
          <input
            type="number"
            min="0"
            max={CONTAINER_RADIUS_MAX}
            value={containerRadius}
            use:wheelAdjust={{ kind: 'value' }}
            oninput={(e) => {
              const raw = e.currentTarget.value.trim();
              if (raw === '') return;
              const v = Math.round(+raw);
              if (Number.isFinite(v) && v >= 0 && v <= CONTAINER_RADIUS_MAX) live({ borderRadius: v }, '容器圆角');
            }}
            onchange={(e) => commitRadius(+e.currentTarget.value, CONTAINER_RADIUS_MAX, '容器圆角')}
            onkeydown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
          />
        </label>
        <div class="trefoil-row trefoil-row-actions">
          <button class="trefoil-mini-btn" onclick={() => app.decomposeContainer(single.id)}>拆解容器</button>
        </div>
      </div>
    {/if}

    {#if single && !isContainer}
      <div class="trefoil-sec">
        {#if isMapRoot}
          <div class="trefoil-row trefoil-row-actions">
            <button class="trefoil-mini-btn" onclick={() => app.downgradeMapRoot(single.id)}>取消导图主节点</button>
          </div>
          <div class="trefoil-map-hint">导图主节点：Tab 添加子节点 · Enter 添加同级节点</div>
        {:else if mapMember}
          <div class="trefoil-map-hint">导图成员：Tab 添加子节点 · Enter 添加同级节点</div>
        {:else}
          <div class="trefoil-row trefoil-row-actions">
            <button
              class="trefoil-mini-btn"
              title="升级为导图主节点后，选中它按 Tab / Enter 即可快捷添加子节点、同级节点"
              onclick={() => app.upgradeMapRoot(single.id)}>升级为导图主节点</button>
          </div>
        {/if}
      </div>
    {/if}

    {#if sel.length >= 2}
      <div class="trefoil-sec">
        <div class="trefoil-row">
          <span class="trefoil-lab">排列</span>
          <div class="trefoil-btn-group">
            <button class="trefoil-mini-btn" class:active={arrangeMode === 'horizontal'} onclick={() => arrange('horizontal')}>横向</button>
            <button class="trefoil-mini-btn" class:active={arrangeMode === 'vertical'} onclick={() => arrange('vertical')}>纵向</button>
            <button class="trefoil-mini-btn" class:active={arrangeMode === 'matrix'} onclick={() => arrange('matrix')}>矩阵</button>
            <button class="trefoil-mini-btn" class:active={arrangeMode === 'ring'} title="沿圆环排布元素" onclick={() => arrange('ring')}>环形</button>
          </div>
        </div>
        {#if arrangeMode === 'matrix'}
          <label class="trefoil-row">
            <span class="trefoil-lab trefoil-lab-wide">横向间距</span>
            <input
              type="range"
              min="0"
              max={GAP_MAX}
              value={arrangeGapX}
              use:wheelAdjust={{ kind: 'value' }}
              oninput={(e) => setGap('x', +e.currentTarget.value)}
            />
            <input
              type="number"
              min="0"
              max={GAP_MAX}
              value={arrangeGapX}
              use:wheelAdjust={{ kind: 'value' }}
              oninput={(e) => {
                const raw = e.currentTarget.value.trim();
                if (!raw) return;
                const v = Math.round(+raw);
                if (Number.isFinite(v) && v >= 0 && v <= GAP_MAX) setGap('x', v);
              }}
              onchange={(e) => setGap('x', +e.currentTarget.value || 0)}
              onkeydown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
              }}
              class="trefoil-num-fixed"
            />
          </label>
          <label class="trefoil-row">
            <span class="trefoil-lab trefoil-lab-wide">纵向间距</span>
            <input
              type="range"
              min="0"
              max={GAP_MAX}
              value={arrangeGapY}
              use:wheelAdjust={{ kind: 'value' }}
              oninput={(e) => setGap('y', +e.currentTarget.value)}
            />
            <input
              type="number"
              min="0"
              max={GAP_MAX}
              value={arrangeGapY}
              use:wheelAdjust={{ kind: 'value' }}
              oninput={(e) => {
                const raw = e.currentTarget.value.trim();
                if (!raw) return;
                const v = Math.round(+raw);
                if (Number.isFinite(v) && v >= 0 && v <= GAP_MAX) setGap('y', v);
              }}
              onchange={(e) => setGap('y', +e.currentTarget.value || 0)}
              onkeydown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
              }}
              class="trefoil-num-fixed"
            />
          </label>
          <label class="trefoil-row">
            <span class="trefoil-lab trefoil-lab-wide">每行个数</span>
            <input
              type="number"
              min="1"
              max="99"
              value={arrangePerRow}
              use:wheelAdjust={{ kind: 'value' }}
              oninput={(e) => {
                const raw = e.currentTarget.value.trim();
                if (!raw) return;
                const v = Math.round(+raw);
                if (Number.isFinite(v) && v >= 1 && v <= 99 && v !== arrangePerRow) {
                  arrangePerRow = v;
                  arrange();
                }
              }}
              onchange={(e) => {
                const v = Math.max(1, Math.min(99, Math.round(+e.currentTarget.value || 3)));
                if (v !== arrangePerRow) {
                  arrangePerRow = v;
                  arrange();
                }
              }}
              onkeydown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
              }}
            />
            <span class="trefoil-val">个/行</span>
          </label>
        {:else if arrangeMode === 'ring'}
          <div class="trefoil-row">
            <span class="trefoil-lab">分布</span>
            <div class="trefoil-btn-group">
              <button
                class="trefoil-mini-btn"
                class:active={arrangeRingDistribute === 'even'}
                title="相邻角距 = 360° ÷ 元素数，均匀铺满整圆"
                onclick={() => {
                  arrangeRingDistribute = 'even';
                  arrange();
                }}>均分</button>
              <button
                class="trefoil-mini-btn"
                class:active={arrangeRingDistribute === 'step'}
                title="按固定角度间距排布（元素多时可能超过一圈）"
                onclick={() => {
                  arrangeRingDistribute = 'step';
                  arrange();
                }}>固定间距</button>
            </div>
          </div>
          {#if arrangeRingDistribute === 'step'}
            <label class="trefoil-row">
              <span class="trefoil-lab trefoil-lab-wide">角距 °</span>
              <input
                type="range"
                min="5"
                max="180"
                value={arrangeRingStep}
                use:wheelAdjust={{ kind: 'value' }}
                oninput={(e) => {
                  arrangeRingStep = Math.max(5, Math.min(180, Math.round(+e.currentTarget.value)));
                  arrange();
                }}
              />
              <input
                type="number"
                min="5"
                max="180"
                value={arrangeRingStep}
                use:wheelAdjust={{ kind: 'value' }}
                oninput={(e) => {
                  const raw = e.currentTarget.value.trim();
                  if (!raw) return;
                  const v = Math.round(+raw);
                  if (Number.isFinite(v) && v >= 5 && v <= 180) {
                    arrangeRingStep = v;
                    arrange();
                  }
                }}
                onchange={(e) => {
                  arrangeRingStep = Math.max(5, Math.min(180, Math.round(+e.currentTarget.value) || 30));
                  arrange();
                }}
                onkeydown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur();
                }}
                class="trefoil-num-fixed"
              />
            </label>
          {/if}
          <label class="trefoil-row">
            <span class="trefoil-lab trefoil-lab-wide">半径</span>
            <input
              type="range"
              min={RING_RADIUS_MIN}
              max={RING_RADIUS_MAX}
              value={arrangeRingRadius}
              use:wheelAdjust={{ kind: 'value' }}
              oninput={(e) => {
                arrangeRingRadius = clampRingRadius(+e.currentTarget.value);
                arrange();
              }}
            />
            <input
              type="number"
              min={RING_RADIUS_MIN}
              max={RING_RADIUS_MAX}
              value={arrangeRingRadius}
              use:wheelAdjust={{ kind: 'value' }}
              oninput={(e) => {
                const raw = e.currentTarget.value.trim();
                if (!raw) return;
                const v = Math.round(+raw);
                if (Number.isFinite(v)) {
                  arrangeRingRadius = clampRingRadius(v);
                  arrange();
                }
              }}
              onchange={(e) => {
                arrangeRingRadius = clampRingRadius(+e.currentTarget.value);
                arrange();
              }}
              onkeydown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
              }}
              class="trefoil-num-fixed"
            />
          </label>
          <label class="trefoil-row">
            <span class="trefoil-lab trefoil-lab-wide">起始角</span>
            <input
              type="range"
              min="0"
              max="360"
              value={arrangeRingStart}
              use:wheelAdjust={{ kind: 'value' }}
              oninput={(e) => {
                arrangeRingStart = clampRingStart(+e.currentTarget.value);
                arrange();
              }}
            />
            <input
              type="number"
              min="0"
              max="360"
              value={arrangeRingStart}
              use:wheelAdjust={{ kind: 'value' }}
              oninput={(e) => {
                const raw = e.currentTarget.value.trim();
                if (!raw) return;
                const v = Math.round(+raw);
                if (Number.isFinite(v)) {
                  arrangeRingStart = clampRingStart(v);
                  arrange();
                }
              }}
              onchange={(e) => {
                arrangeRingStart = clampRingStart(+e.currentTarget.value);
                arrange();
              }}
              onkeydown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
              }}
              class="trefoil-num-fixed"
            />
          </label>
          <div class="trefoil-row">
            <span class="trefoil-lab">方向</span>
            <div class="trefoil-btn-group">
              <button
                class="trefoil-mini-btn"
                class:active={arrangeRingClockwise}
                title="从起始角开始顺时针排布"
                onclick={() => {
                  arrangeRingClockwise = true;
                  arrange();
                }}>顺时针</button>
              <button
                class="trefoil-mini-btn"
                class:active={!arrangeRingClockwise}
                title="从起始角开始逆时针排布"
                onclick={() => {
                  arrangeRingClockwise = false;
                  arrange();
                }}>逆时针</button>
            </div>
          </div>
          <label class="trefoil-row">
            <span class="trefoil-lab">排序</span>
            <select
              class="trefoil-select"
              title="决定哪个元素排在起始角"
              value={arrangeRingOrder}
              onchange={(e) => {
                arrangeRingOrder = e.currentTarget.value as RingOrderBy;
                arrange();
              }}
            >
              <option value="angle">按当前角度</option>
              <option value="x">按 X 坐标</option>
              <option value="y">按 Y 坐标</option>
              <option value="selection">按选择顺序</option>
            </select>
          </label>
          <div class="trefoil-row trefoil-arrange-hint">0° = 正上方，顺时针为正；半径 = 圆心到元素中心；圆心取所选包围盒中心</div>
        {:else if arrangeMode !== 'ring'}
          <label class="trefoil-row">
            <span class="trefoil-lab">间距</span>
            <input
              type="range"
              min="0"
              max={GAP_MAX}
              value={gapValue}
              use:wheelAdjust={{ kind: 'value' }}
              oninput={(e) => setGap(arrangeMode === 'vertical' ? 'y' : 'x', +e.currentTarget.value)}
            />
            <input
              type="number"
              min="0"
              max={GAP_MAX}
              value={gapValue}
              use:wheelAdjust={{ kind: 'value' }}
              oninput={(e) => {
                const raw = e.currentTarget.value.trim();
                if (!raw) return;
                const v = Math.round(+raw);
                if (Number.isFinite(v) && v >= 0 && v <= GAP_MAX) setGap(arrangeMode === 'vertical' ? 'y' : 'x', v);
              }}
              onchange={(e) => setGap(arrangeMode === 'vertical' ? 'y' : 'x', +e.currentTarget.value || 0)}
              onkeydown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
              }}
              class="trefoil-num-fixed"
            />
          </label>
        {/if}
        {#if arrangeMode !== 'ring'}
          <div class="trefoil-row">
            <span class="trefoil-lab">基准</span>
            <div class="trefoil-btn-group">
              <button
                class="trefoil-mini-btn"
                class:active={arrangeAnchor === 'top-left'}
                title="间距 = 相邻元素包围盒边缘的间距，整体保持左上角不动"
                onclick={() => {
                  arrangeAnchor = 'top-left';
                  arrange();
                }}>左上角</button>
              <button
                class="trefoil-mini-btn"
                class:active={arrangeAnchor === 'center'}
                title="间距 = 相邻元素几何中心的间距，整体保持几何中心不动"
                onclick={() => {
                  arrangeAnchor = 'center';
                  arrange();
                }}>几何中心</button>
            </div>
          </div>
          <div class="trefoil-row trefoil-arrange-hint">左上角：按边缘间距排列；几何中心：按中心间距排列</div>
        {/if}
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
    /* 40px + nowrap：12.5px 字号下「透明度」三字约 37.5px，34px 会被折成两行 */
    width: 40px;
    flex: none;
    white-space: nowrap;
    color: var(--text-muted, #777);
  }
  /* 四字标签（横向间距 / 纵向间距 / 每行个数） */
  .trefoil-lab-wide {
    width: 58px;
    white-space: nowrap;
  }
  .trefoil-arrange-hint {
    color: var(--text-faint, #999);
    font-size: 11px;
    line-height: 1.5;
  }
  .trefoil-map-hint {
    color: var(--text-faint, #999);
    font-size: 11px;
    line-height: 1.5;
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
  input[type='number'],
  .trefoil-select {
    flex: 1;
    min-width: 0;
    padding: 3px 6px;
    border: 1px solid var(--background-modifier-border, #ddd);
    border-radius: 5px;
    background: var(--background-primary, #fff);
    color: var(--text-normal, #222);
    font-size: 12px;
  }
  .trefoil-select {
    cursor: pointer;
  }
  input[type='range'] {
    flex: 1;
    min-width: 0; /* 允许压缩到内容宽度以下，避免滑块+数字框撑出面板横向滚动条 */
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
  /* 固定宽数字框：排列/间距等窄列输入，压过上面的 input[type='number'] { flex: 1 } */
  input.trefoil-num-fixed {
    width: 56px;
    flex: none;
  }
  input.trefoil-num-sm {
    width: 52px;
  }
  /* 「替换图片」用隐藏文件选择器，由外层 label 触发 */
  input.trefoil-file-input {
    display: none;
  }
</style>
