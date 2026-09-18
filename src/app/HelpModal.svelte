<script lang="ts">
  import { ui } from './ui.svelte';

  /** 与 ToolManager / 工具实现保持一致的快捷键清单（新增快捷键时同步维护） */
  const GROUPS: { title: string; items: [string, string][] }[] = [
    {
      title: '工具切换',
      items: [
        ['选择', 'V / 1'],
        ['矩形', 'R / 2'],
        ['圆形 / 椭圆', 'C / 3'],
        ['菱形', 'D / 4'],
        ['三角形', '5'],
        ['箭头', '6'],
        ['直线 / 折线', '7'],
        ['文本', 'T / 8'],
        ['镭射笔', 'L / 9'],
        ['橡皮擦', 'E / 0'],
      ],
    },
    {
      title: '编辑',
      items: [
        ['撤销', 'Ctrl+Z'],
        ['重做', 'Ctrl+Shift+Z / Ctrl+Y'],
        ['删除选中', 'Delete / Backspace'],
        ['全选', 'Ctrl+A'],
        ['复制 / 剪切选中元素', 'Ctrl+C / X'],
        ['粘贴到鼠标位置（剪贴板里是画布元素则粘元素，否则文本按行成文本元素）', 'Ctrl+V'],
        ['克隆选中', 'Ctrl+D'],
        ['微移选中（Shift 步长 ×10）', '方向键'],
        ['添加导图子节点（选中导图节点）', 'Tab'],
        ['添加导图同级节点（选中导图子节点）', 'Enter'],
        ['取消选择 / 退出聚焦 / 清除镭射笔迹', 'Esc'],
      ],
    },
    {
      title: '绘制辅助键',
      items: [
        ['形状约束正形（矩形画方 / 圆画正圆）', 'Shift + 拖拽'],
        ['形状从中心展开（起点为圆心）', 'Alt + 拖拽'],
        ['形状从中心展开且约束正形', 'Shift + Alt + 拖拽'],
        ['直线 / 箭头 45° 角度吸附', 'Shift + 拖拽'],
        ['箭头 / 直线端点磁吸连接元素（双端连接呈曲线）', '端点靠近元素自动吸附'],
        ['选中箭头 / 连线后拖动端点，可重新连接到其它元素（上下左右均可）', '拖动两端圆点手柄'],
        ['形状 / 箭头样式、线型（实线 / 虚线 / 点状）', '选中后在属性面板设置'],
        ['图片下方描述牌（默认文件名，随缩放恒定大小）', '选中图片后在属性面板设置'],
      ],
    },
    {
      title: '画布',
      items: [
        ['缩放', '滚轮'],
        ['重置缩放为 100%', '点击状态栏的缩放数字'],
        ['平移画布', 'Space + 左键拖拽'],
        ['平移画布', '右键 / 中键拖拽'],
        ['上下文菜单（选择工具下）', '右键单击'],
        ['回到选择工具（绘图工具激活时）', '右键单击'],
        ['连线：选中 / 删除', '单击线段 / Delete'],
        ['编辑线段关系描述（中点小牌）', '双击线段'],
        ['新建文本', '双击空白'],
        ['调整橡皮擦半径', '[ / ] / 滚轮'],
        ['结束折线绘制', 'Enter / Esc'],
      ],
    },
    {
      title: '文本编辑',
      items: [
        ['提交编辑', 'Ctrl+Enter'],
        ['取消编辑', 'Esc'],
      ],
    },
  ];

  function close(): void {
    ui.helpOpen = false;
  }

  function onBackdropClick(e: MouseEvent): void {
    if (e.target === e.currentTarget) close();
  }

  // Esc 关闭：capture 阶段拦截，避免画布全局快捷键（清除笔迹/取消选择）同时响应
  function onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  }

  $effect(() => {
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  });
</script>

<div class="trefoil-help-backdrop" onclick={onBackdropClick} role="presentation">
  <div class="trefoil-help" role="dialog" aria-modal="true" aria-label="帮助">
    <header class="trefoil-help-head">
      <span class="trefoil-help-title">帮助</span>
      <button type="button" class="trefoil-help-x" onclick={close} aria-label="关闭">✕</button>
    </header>
    <h4 class="trefoil-help-sec">快捷键</h4>
    <div class="trefoil-help-groups">
      {#each GROUPS as g (g.title)}
        <section class="trefoil-help-group">
          <div class="trefoil-help-group-title">{g.title}</div>
          {#each g.items as [name, keys], i (i)}
            <div class="trefoil-help-row">
              <span class="trefoil-help-name">{name}</span>
              <span class="trefoil-help-keys">
                {#each keys.split(' / ') as k, i (i)}
                  <kbd>{k}</kbd>
                {/each}
              </span>
            </div>
          {/each}
        </section>
      {/each}
    </div>
  </div>
</div>

<style>
  .trefoil-help-backdrop {
    position: absolute;
    inset: 0;
    z-index: 600;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.35);
  }
  .trefoil-help {
    width: 560px;
    max-width: calc(100% - 48px);
    max-height: calc(100% - 48px);
    overflow: auto;
    padding: 14px 16px;
    border-radius: 12px;
    background: var(--background-primary, #fff);
    border: 1px solid var(--background-modifier-border, #ddd);
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
    font-size: 12.5px;
    color: var(--text-normal, #222);
  }
  .trefoil-help-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 4px;
  }
  .trefoil-help-title {
    font-size: 14px;
    font-weight: 600;
  }
  .trefoil-help-x {
    border: none;
    background: none;
    cursor: pointer;
    color: var(--text-muted, #777);
    font-size: 13px;
    padding: 2px 6px;
    border-radius: 5px;
  }
  .trefoil-help-x:hover {
    background: var(--background-modifier-hover, #eee);
    color: var(--text-normal, #222);
  }
  .trefoil-help-sec {
    margin: 6px 0 8px;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-muted, #777);
    border-top: 1px solid var(--background-modifier-border, #eee);
    padding-top: 10px;
  }
  .trefoil-help-groups {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 2px 22px;
  }
  .trefoil-help-group {
    padding: 4px 0 8px;
  }
  .trefoil-help-group-title {
    font-weight: 600;
    color: var(--interactive-accent, #4c8dff);
    margin-bottom: 3px;
  }
  .trefoil-help-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 2.5px 0;
  }
  .trefoil-help-name {
    color: var(--text-normal, #222);
  }
  .trefoil-help-keys {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    flex: none;
  }
  kbd {
    font-family: var(--font-monospace, Consolas, monospace);
    font-size: 10.5px;
    line-height: 1.6;
    padding: 0 5px;
    border: 1px solid var(--background-modifier-border, #ccc);
    border-bottom-width: 2px;
    border-radius: 4px;
    background: var(--background-modifier-hover, #f2f2f2);
    color: var(--text-normal, #333);
    white-space: nowrap;
  }
</style>
