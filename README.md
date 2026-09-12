<div align="center">

# Trefoil

思考的可视化工作台 —— 精确几何绘图 + 结构化思维导图容器 + 积木式交互 + 镭射笔演示标注。

[![GitHub Release](https://img.shields.io/github/v/release/Dyse-Sofqi/Trefoil?style=flat-square&logo=github&color=%2342b883)](https://github.com/Dyse-Sofqi/Trefoil/releases) [![License](https://img.shields.io/github/license/Dyse-Sofqi/Trefoil?style=flat-square&color=%2342b883)](LICENSE) [![Obsidian Min App](https://img.shields.io/badge/Obsidian-%5E1.5.0-%234a7ec1?style=flat-square&logo=obsidian&logoColor=%234a7ec1)](https://obsidian.md) [![GitHub Stars](https://img.shields.io/github/stars/Dyse-Sofqi/Trefoil?style=flat-square&logo=github&color=%23e4b341)](https://github.com/Dyse-Sofqi/Trefoil)

</div>

---

> 🇬🇧 **English**: scroll down to view the English README.

### 简介

Trefoil 是一款 Obsidian 白板插件，把「白板」当成思考的工作台：在白板上自由发散，在容器内收敛成结构，用镭射笔随时标注演示。

它不做手绘风格（Rough.js）、不追求压感手写，而是提供**像素级精确的几何绘图**与**结构化思维导图容器**，两者在同一张画布上同时存在、无缝混用。文件是标准的 `.canvas`（[JSON Canvas 1.1](https://jsoncanvas.org)），扩展字段使用 `trefoil:` 前缀，与 Obsidian 原生白板互为兼容。

### 核心理念：双模式共存（无切换）

自由模式与结构模式**同时存在**，没有「切换」动作：

- 结构化「容器」是贴在白板上的智能积木块，内部遵循树形结构；
- 交互行为由点击位置决定：画布空白处即自由拖拽，容器内部即树形编辑；
- 渲染引擎无需感知模式，交互层根据点击对象的类型决定行为；
- 容器无背景遮挡，容器内部空白点击直接穿透至下层画布。

### 关键词 / Keywords

- 精确几何绘图 · 矩形/椭圆/菱形/三角形/箭头/直线/折线 · 像素级精确 · 非手绘风格 · 内联 Markdown（加粗/斜体/代码/删除线）· 本地字体 · 自定义字体 · 文本对齐
- 思维导图容器 · Tab 子节点 · Enter 兄弟节点 · 折叠展开 · 自动布局（横向/纵向树）· Web Worker 计算 · 容器整体拖拽 · 容器内部穿透
- 积木式交互 · 智能吸附 · 边缘/中心对齐 · 磁吸网格 · 间距参考线 · 绑定组（编队）· 容器组合/拆解 · 连线 Ports · 图层排序 · 形状翻转
- 镭射笔 · 独立临时图层 · 延迟淡出 · 永不落盘 · 橡皮擦 · 动态半径 · 擦除可撤销
- 画布背景 · 纯色/点阵/双层级网格 · 查看模式（正常/浏览/聚焦）· PNG 导出（透明背景/含笔迹）· SVG 矢量导出 · 图片粘贴与拖入 · JSON Canvas 1.1 · 深浅色主题适配
- Precise geometric drawing · Rectangle/Ellipse/Diamond/Triangle/Arrow/Line/Polyline · Pixel-exact, no hand-drawn style · Inline Markdown (bold/italic/code/strikethrough) · Local & custom fonts · Text alignment
- Mind-map containers · Tab for child · Enter for sibling · Collapse/expand · Auto tree layout (horizontal/vertical) · Web Worker layout · Drag whole container · Click-through inside containers
- Building-block interaction · Smart snapping · Edge/center alignment · Grid magnet · Spacing guides · Binding groups · Compose/decompose containers · Connection ports · Layer ordering · Shape flipping
- Laser pointer · Dedicated transient layer · Delayed fade-out · Never persisted · Eraser · Dynamic radius · Undoable erase
- Canvas background · Solid/dots/dual-level grid · View modes (normal/browse/focus) · PNG export (transparent / with laser) · SVG vector export · Image paste & drop · JSON Canvas 1.1 · Dark & light theme aware

### 功能

---

#### 🎨 绘图与文本

- **精确几何绘图** — 矩形、圆形/椭圆、菱形、三角形、箭头、直线/折线（双击结束）。全部为几何精确的矢量图形，不做手绘抖动风格；绘制时按住 `Shift` 可约束比例/角度。

- **文本系统** — 双击画布空白处直接创建文本；编辑时支持 Obsidian 内联 Markdown：`**加粗**`、`_斜体_`、`` `代码` ``、`~~删除线~~`。可设置字体（内置预设 + 读取系统字体 + 自定义字体）、字号、字重、颜色、对齐方式。

- **图片 / 附件** — 从系统文件管理器拖入图片，或直接 `Ctrl+V` 粘贴剪贴板图片，按 Obsidian「新附件的默认位置」规则落盘并插入为图片节点；白板内可自由缩放、移动。

- **属性面板** — 选中元素后在右侧统一调整坐标/尺寸、填充、描边颜色与粗细、透明度、文本样式、圆角、翻转、箭头端点等；数值控件支持鼠标悬停滚轮微调（步进方式可配置：自动 / 固定数值 / 百分比）。

- **连线（Ports）** — 形状之间可建立连线关系，连线端点吸附在节点的上/下/左/右侧（`fromSide` / `toSide`），随节点移动自动重算。

---

#### 🧠 思维导图容器

容器是贴在白板上的智能积木块：外观上是一块可整体拖拽的区域，内部是一棵可键盘编辑的树。

- **容器内键盘编辑** — `Tab` 为当前节点添加子节点、`Enter` 添加兄弟节点、`Space` 折叠/展开子树；容器整体拖拽，子节点随行。

- **自动布局** — 一键把容器内的树整理为横向树或纵向树；布局算法在 Web Worker 中计算（不可用时主线程回退），大规模节点也不阻塞界面。

- **容器操作（右键菜单 / 属性面板）** — 添加子节点、自动布局（横向/纵向）、折叠全部、展开全部、重命名容器、拆解容器。

- **穿透交互** — 容器不绘制背景遮挡；点击容器内部的空白区域会穿透到下层画布，不会误选中容器。

- **数据存储** — 容器子节点在 `.canvas` 文件中以相对坐标存储（`trefoil:containerId` / `trefoil:treeParent` 记录父子关系），在内存中统一转换为绝对坐标。

---

#### 🧲 积木式交互

- **智能吸附** — 移动/缩放时自动吸附到其他元素的边缘与中心，显示对齐参考线；可选磁吸网格（按背景网格吸附），并在对齐元素之间显示间距数值参考线。

- **绑定组（编队）** — 把多个元素绑定为一个整体一起移动、缩放；组可嵌套，属性面板与右键菜单提供「绑定组 / 解绑组」。

- **组合 / 拆解容器** — 选中多个自由元素一键「组合为容器」；容器也可一键「拆解」回自由元素，子节点坐标自动还原为绝对坐标。

- **图层顺序** — 右键菜单「图层顺序」提供置于顶层 / 置于底层 / 上移一层 / 下移一层（内部数组顺序即 Z-index）。

- **形状翻转** — 形状可水平或垂直翻转，支持多选批量操作。

---

#### 🔦 镭射笔与橡皮擦

- **镭射笔** — 独立临时图层，绘制流畅、延迟期间新笔迹正常叠加；松手后按设定延迟自动淡出（1 秒 / 3 秒 / 5 秒 / 10 秒 / 手动清除）。**笔迹永不写入 `.canvas` 文件**，导出 PNG 时可选择是否包含笔迹。

- **橡皮擦** — 按住拖动即擦除，半径动态可调（`[` `]` 或滚轮，5–200 px），擦除操作可撤销。

---

#### 🖼️ 画布背景与视图

- **画布背景** — 纯色 / 点阵 / 双层级网格三种模式：点阵可调大小（1–10 px）、形状（圆形/方形/菱形）、颜色、间距；网格为双层结构，小格淡、大格浓，大格合并格数（N 格小网格 = 1 格大网格）可调。

- **查看模式** — 正常（可编辑）/ 浏览（只读平移缩放，适合演示）/ 聚焦（选中元素居中放大并加遮罩）。

- **视图操作** — 滚轮以鼠标位置为中心缩放；右键或中键拖拽平移；按住空格临时切换为平移模式；命令面板提供「缩放适应内容」。

- **主题适配** — 监听 Obsidian 的 `css-change` 事件，深浅色主题切换后画布重新着色。

---

#### 📤 导出

- **PNG** — 当前视口导出为 PNG，可选是否使用透明背景、是否包含镭射笔迹。
- **SVG** — 导出几何精确的矢量 SVG，适合二次编辑与印刷。

命令面板与右键菜单均可触发导出。

---

#### 🔌 Obsidian 集成

- **`.canvas` 原生读写** — 文件是标准 JSON Canvas 1.1；Trefoil 启用期间接管 `.canvas` 扩展名的默认打开方式，未知节点类型与字段按规范原样保留，不会破坏其他工具写入的数据。
- **Ribbon 入口** — 左侧功能区「新芽」图标一键新建白板（文件重名自动递增，可在插件设置中指定新文件所在目录）。
- **命令面板** — 新建白板、在 Trefoil 中打开当前画布、导出 PNG / PNG（透明背景）/ SVG、清除镭射笔迹、缩放适应内容、撤销 / 重做、以及全部工具切换命令（可绑定快捷键）。
- **文件菜单** — 在任意 `.canvas` 文件上右键 →「在 Trefoil 中打开」。
- **错误日志** — 内置错误记录器，异常写入插件日志便于反馈问题。

---

#### ⌨️ 快捷键

| 类别 | 按键 | 功能 |
| --- | --- | --- |
| 工具 | `V` `1` | 选择 |
| 工具 | `R` `2` / `C` `3` / `D` `4` | 矩形 / 圆形椭圆 / 菱形 |
| 工具 | `5` / `6` / `7` | 三角形 / 箭头 / 直线折线（双击结束） |
| 工具 | `T` `8` / `L` `9` / `E` `0` | 文本 / 镭射笔 / 橡皮擦 |
| 通用 | `Delete` | 删除选中（容器内级联删除子树） |
| 通用 | `Ctrl+Z` / `Ctrl+Shift+Z` / `Ctrl+Y` | 撤销 / 重做 |
| 通用 | `Ctrl+C` / `Ctrl+X` / `Ctrl+A` | 复制 / 剪切 / 全选 |
| 通用 | `Ctrl+V` | 在鼠标位置粘贴：剪贴板为画布元素则粘贴元素（跨白板可用），为文本则按行拆成文本元素，为图片则落盘插入 |
| 通用 | `Ctrl+D` | 原地克隆选中元素 |
| 通用 | 方向键（+`Shift`） | 微移 1 px（10 px） |
| 通用 | `Esc` | 清除全部镭射笔迹 / 退出聚焦 / 取消选中 |
| 容器内 | `Tab` / `Enter` | 添加子节点 / 添加兄弟节点 |
| 容器内 | `Space` | 点按折叠展开；按住并拖动 = 临时平移画布 |
| 橡皮擦 | `[` `]` / 滚轮 | 减小 / 增大半径 |
| 视图 | 滚轮 | 以鼠标为中心缩放 |
| 视图 | 右键拖拽 / 中键拖拽 | 平移画布（右键单击呼出菜单） |
| 视图 | 双击空白 | 创建文本元素 |

---

### 设置

设置面板位于**白板内部**（画布中的设置入口），仅影响视觉与交互辅助，**不写入 `.canvas` 数据文件**：

- **背景** — 模式（纯色 / 点阵 / 网格）、底色、点阵大小与形状与颜色与间距、网格间距与颜色、小格浓度、大格浓度、大格合并格数
- **吸附** — 启用吸附、磁吸网格、吸附对象、吸附阈值、参考线阈值
- **镭射笔** — 颜色、粗细、消失延迟（1 / 3 / 5 / 10 秒、手动清除）
- **橡皮擦** — 半径（5–200 px）
- **文本默认** — 字体、字号、字重、颜色
- **形状默认** — 填充、描边颜色、描边粗细
- **滚轮微调** — 步进方式：自动 / 固定数值 / 百分比
- **查看模式** — 正常 / 浏览 / 聚焦

插件级设置（Obsidian 设置 → 第三方插件 → Trefoil）保存新白板的默认设置与新建 `.canvas` 文件所在目录，数据存放于插件目录的 `data.json`。

### 数据格式

文件为标准 `.canvas`（[JSON Canvas 1.1](https://jsoncanvas.org)）：

- 标准字段原样保留：`id` / `x` / `y` / `width` / `height` / `type` / `text` / `color` / `fromSide` / `toSide`；
- Trefoil 扩展字段使用 `trefoil:` 命名空间，如 `trefoil:shape`、`trefoil:containerId`、`trefoil:treeParent`；
- 容器子节点在文件中以**相对坐标**存储，内存中统一为绝对坐标；
- 未知节点类型与字段按规范原样保留；**镭射笔迹永不写入文件**。

### 安装

#### 通过社区插件市场安装（推荐）

1. 打开 Obsidian → 设置 → 第三方插件 → 社区插件市场
2. 搜索 **Trefoil** 并安装
3. 在已安装插件列表中启用

#### 通过 BRAT 安装（预览版）

1. 安装 [BRAT](https://obsidian.md/plugins?id=obsidian42-brat) 插件
2. 在 BRAT 设置中添加 `Dyse-Sofqi/Trefoil`
3. 手动启用 Trefoil 插件

#### 手动安装

1. 从 [Releases](https://github.com/Dyse-Sofqi/Trefoil/releases) 下载 `manifest.json`、`main.js`、`styles.css`
2. 放入 `<你的库>/.obsidian/plugins/trefoil/`
3. 在 Obsidian 设置 → 第三方插件中启用 Trefoil

### 开发

```bash
pnpm install
pnpm dev        # 浏览器开发测试台 http://localhost:5198/dev/（无 Obsidian 依赖，localStorage 持久化）
pnpm test       # vitest 单元测试
pnpm build      # 类型检查 + 构建（dist/main.js + dist/styles.css）
pnpm package    # 组装发布包（build/release/trefoil-{version}/）
```

架构分层：

```
Obsidian 插件层 (main.ts / view / adapter)
    └── UI 视图层 (Svelte 5 Runes：Toolbar / PropertyPanel / ContextMenu / Overlay)
            └── 渲染引擎层 (Konva.js：背景层 / 内容层 / 镭射笔层 / 覆盖层，视口裁剪 + batchDraw)
                    └── 核心业务层 (Document / History 命令模式 / snap 吸附 / mindmap / layout)
                            └── Web Worker (树形布局计算，inline worker + 主线程回退)
                    └── 数据持久层 (JSON Canvas 规范，trefoil: 命名空间扩展字段)
```

- 工具独立成类，经 `ToolManager` 注册分发（指针 / 滚轮 / 键盘）；
- Svelte 组件与 Konva 实例通过事件总线（`Emitter`）与 Runes 状态通信，互不直接耦合；
- 宿主差异抽象为 `HostAdapter`（浏览器开发台 ↔ Obsidian）。

### 明确不做

手绘风格（Rough.js）、压感手写、实时协作、图片编辑、音视频嵌入、云端存储。

## License

[MIT](LICENSE)

---

<div align="center">

# Trefoil

**A visual thinking workbench** — precise geometric drawing, structured mind-map containers, building-block interaction and laser-pointer annotation for Obsidian.

[![GitHub Release](https://img.shields.io/github/v/release/Dyse-Sofqi/Trefoil?style=flat-square&logo=github&color=%2342b883)](https://github.com/Dyse-Sofqi/Trefoil/releases) [![License](https://img.shields.io/github/license/Dyse-Sofqi/Trefoil?style=flat-square&color=%2342b883)](LICENSE) [![Obsidian Min App](https://img.shields.io/badge/Obsidian-%5E1.5.0-%234a7ec1?style=flat-square&logo=obsidian&logoColor=%234a7ec1)](https://obsidian.md) [![GitHub Stars](https://img.shields.io/github/stars/Dyse-Sofqi/Trefoil?style=flat-square&logo=github&color=%23e4b341)](https://github.com/Dyse-Sofqi/Trefoil)

[🇨🇳 中文](README.md) · [🇬🇧 English](#introduction)

</div>

---

### Introduction

Trefoil is an Obsidian whiteboard plugin that treats the canvas as a workbench for thinking: diverge freely on the board, converge into structure inside containers, and annotate on the fly with a laser pointer.

It deliberately avoids a hand-drawn look (Rough.js) and pressure-sensitive inking. Instead it offers **pixel-exact geometric drawing** and **structured mind-map containers** that coexist on the same canvas without any mode switch. Files are standard `.canvas` ([JSON Canvas 1.1](https://jsoncanvas.org)); Trefoil extensions live under the `trefoil:` prefix and stay compatible with Obsidian's built-in canvas.

### Core Idea: Two Modes, No Switching

Free-form and structured editing **coexist**; there is no mode toggle:

- A container is a smart building block pinned to the board whose interior follows a tree structure;
- Behavior is decided by what you click: empty canvas means free dragging, inside a container means tree editing;
- The rendering engine is mode-agnostic — the interaction layer decides based on the clicked object's type;
- Containers draw no opaque background, so clicks on empty space inside them pass through to the canvas below.

### Features

---

#### 🎨 Drawing & Text

- **Precise geometric shapes** — rectangle, ellipse/circle, diamond, triangle, arrow, line/polyline (double-click to finish). All are geometrically exact vectors with no hand-drawn jitter; hold `Shift` while drawing to constrain proportions/angles.
- **Text system** — double-click empty canvas to create a text element. Editing supports inline Markdown: `**bold**`, `_italic_`, `` `code` ``, `~~strikethrough~~`. Font (built-in presets + system font list + custom family), size, weight, color and alignment are configurable.
- **Images & attachments** — drop images from the file manager or paste a clipboard image with `Ctrl+V`; files are saved following Obsidian's "Default location for new attachments" setting and inserted as image nodes you can move and resize.
- **Property panel** — one place to adjust position/size, fill, stroke color and width, opacity, text style, corner radius, flipping and arrow endpoints. Numeric controls support wheel fine-tuning while hovering (step mode: auto / fixed value / percentage).
- **Connections (ports)** — link shapes to each other; endpoints snap to the top/bottom/left/right sides of nodes (`fromSide` / `toSide`) and re-route as nodes move.

---

#### 🧠 Mind-map Containers

A container is a smart block on the board: a draggable region on the outside, a keyboard-editable tree on the inside.

- **Keyboard tree editing** — `Tab` adds a child, `Enter` adds a sibling, `Space` collapses/expands a subtree; drag the container as a whole and children follow.
- **Auto layout** — one click arranges the tree as a horizontal or vertical tree; layout runs in a Web Worker (with a main-thread fallback) so large trees never block the UI.
- **Container actions** (context menu / property panel) — add child, auto layout (horizontal/vertical), collapse all, expand all, rename container, decompose container.
- **Click-through** — containers paint no background, so clicking empty space inside one passes through to the canvas below instead of selecting the container.
- **Storage** — children are stored with relative coordinates in the `.canvas` file (`trefoil:containerId` / `trefoil:treeParent` record the parent-child relation) and converted to absolute coordinates in memory.

---

#### 🧲 Building-block Interaction

- **Smart snapping** — while moving/resizing, elements snap to other elements' edges and centers with alignment guides; optional grid magnet, plus live spacing readouts between aligned elements.
- **Binding groups** — bind multiple elements into one unit that moves and scales together; groups can nest. Available from the property panel and context menu (bind / unbind).
- **Compose / decompose containers** — turn a multi-selection into a container in one action, or decompose a container back into free elements with absolute coordinates restored.
- **Layer order** — context menu → Layer order: bring to front, send to back, bring forward, send backward (array order is Z-index).
- **Shape flipping** — flip shapes horizontally or vertically, including batch operations on a multi-selection.

---

#### 🔦 Laser Pointer & Eraser

- **Laser pointer** — a dedicated transient layer: strokes draw smoothly and stack during the delay window, then fade out automatically after the configured delay (1 s / 3 s / 5 s / 10 s / manual clear). **Strokes are never written to the `.canvas` file**; PNG export can optionally include them.
- **Eraser** — drag to erase with a dynamic radius (`[` `]` or the wheel, 5–200 px); erasing is undoable.

---

#### 🖼️ Canvas Background & Views

- **Background** — solid / dots / dual-level grid. Dots support size (1–10 px), shape (circle/square/diamond), color and spacing; the grid is two-level — minor lines faint, major lines strong — with a configurable merge count (N minor cells = 1 major cell).
- **View modes** — Normal (editable) / Browse (read-only pan & zoom, ideal for presentations) / Focus (center and magnify the selection behind a mask).
- **Navigation** — wheel zooms around the pointer; right-drag or middle-drag pans; hold `Space` for temporary pan mode; "Zoom to fit" is available from the command palette.
- **Theme aware** — listens to Obsidian's `css-change` event and re-colors the canvas for dark/light themes.

---

#### 📤 Export

- **PNG** — export the current viewport, optionally with a transparent background and optionally including laser strokes.
- **SVG** — export geometrically exact vector SVG, suitable for further editing and print.

Both are reachable from the command palette and the context menu.

---

#### 🔌 Obsidian Integration

- **Native `.canvas` I/O** — files are standard JSON Canvas 1.1. While Trefoil is enabled it takes over the `.canvas` extension, and unknown node types/fields are preserved verbatim so other tools' data is never destroyed.
- **Ribbon entry** — a "sprout" ribbon icon creates a new whiteboard, auto-incrementing the filename; the target folder is configurable.
- **Command palette** — new whiteboard, open the current canvas in Trefoil, export PNG / PNG (transparent) / SVG, clear laser strokes, zoom to fit, undo/redo, and a tool-switch command for every tool (bindable to hotkeys).
- **File menu** — right-click any `.canvas` file → "Open in Trefoil".
- **Error log** — a built-in error logger records exceptions to a plugin log for easier bug reports.

---

#### ⌨️ Keyboard Shortcuts

| Category | Key | Action |
| --- | --- | --- |
| Tool | `V` `1` | Select |
| Tool | `R` `2` / `C` `3` / `D` `4` | Rectangle / Ellipse / Diamond |
| Tool | `5` / `6` / `7` | Triangle / Arrow / Line-Polyline (double-click to finish) |
| Tool | `T` `8` / `L` `9` / `E` `0` | Text / Laser / Eraser |
| General | `Delete` | Delete selection (cascades to subtrees inside a container) |
| General | `Ctrl+Z` / `Ctrl+Shift+Z` / `Ctrl+Y` | Undo / redo |
| General | `Ctrl+C` / `Ctrl+X` / `Ctrl+A` | Copy / cut / select all |
| General | `Ctrl+V` | Paste at the pointer: canvas elements paste as elements (works across whiteboards), text splits into text nodes by line, images are saved and inserted |
| General | `Ctrl+D` | Clone the selection in place |
| General | Arrow keys (+`Shift`) | Nudge 1 px (10 px) |
| General | `Esc` | Clear all laser strokes / exit focus / clear selection |
| In container | `Tab` / `Enter` | Add child / add sibling |
| In container | `Space` | Tap to collapse/expand; hold and drag to pan the canvas |
| Eraser | `[` `]` / wheel | Decrease / increase radius |
| View | Wheel | Zoom around the pointer |
| View | Right-drag / middle-drag | Pan (right-click opens the context menu) |
| View | Double-click empty space | Create a text element |

---

### Settings

Settings live **inside the whiteboard**. They only affect visuals and interaction aids and are **never written into the `.canvas` file**:

- **Background** — mode (solid / dots / grid), base color, dot size/shape/color/spacing, grid spacing/color, minor opacity, major opacity, merge count
- **Snapping** — enable snapping, grid magnet, object snapping, snap threshold, guide threshold
- **Laser** — color, width, fade delay (1 / 3 / 5 / 10 s, manual clear)
- **Eraser** — radius (5–200 px)
- **Text defaults** — font, size, weight, color
- **Shape defaults** — fill, stroke color, stroke width
- **Wheel fine-tuning** — step mode: auto / fixed value / percentage
- **View mode** — normal / browse / focus

Plugin-level settings (Obsidian Settings → Community plugins → Trefoil) store the defaults for new whiteboards and the folder for new `.canvas` files, persisted to `data.json` in the plugin folder.

### Data Format

Files are standard `.canvas` ([JSON Canvas 1.1](https://jsoncanvas.org)):

- Standard fields are preserved verbatim: `id` / `x` / `y` / `width` / `height` / `type` / `text` / `color` / `fromSide` / `toSide`;
- Trefoil extensions use the `trefoil:` namespace, e.g. `trefoil:shape`, `trefoil:containerId`, `trefoil:treeParent`;
- Container children are stored with **relative coordinates** on disk and normalized to absolute coordinates in memory;
- Unknown node types and fields are preserved per the spec; **laser strokes are never written to disk**.

### Installation

#### Via Community Plugins (Recommended)

1. Open Obsidian → Settings → Community plugins → Browse
2. Search for **Trefoil** and install
3. Enable it in the installed plugins list

#### Via BRAT (Preview builds)

1. Install the [BRAT](https://obsidian.md/plugins?id=obsidian42-brat) plugin
2. Add `Dyse-Sofqi/Trefoil` in BRAT settings
3. Enable Trefoil manually

#### Manual

1. Download `manifest.json`, `main.js` and `styles.css` from [Releases](https://github.com/Dyse-Sofqi/Trefoil/releases)
2. Put them in `<your vault>/.obsidian/plugins/trefoil/`
3. Enable Trefoil under Settings → Community plugins

### Development

```bash
pnpm install
pnpm dev        # browser dev harness at http://localhost:5198/dev/ (no Obsidian dependency, localStorage persistence)
pnpm test       # vitest unit tests
pnpm build      # type-check + build (dist/main.js + dist/styles.css)
pnpm package    # assemble a release folder (build/release/trefoil-{version}/)
```

Layered architecture:

```
Obsidian plugin layer (main.ts / view / adapter)
    └── UI layer (Svelte 5 Runes: Toolbar / PropertyPanel / ContextMenu / Overlay)
            └── Rendering engine (Konva.js: background / content / laser / overlay layers, viewport culling + batchDraw)
                    └── Core domain (Document / History command pattern / snap / mindmap / layout)
                            └── Web Worker (tree layout, inline worker with main-thread fallback)
                    └── Persistence (JSON Canvas spec, trefoil: namespaced extensions)
```

- Tools are independent classes registered and dispatched by `ToolManager` (pointer / wheel / keyboard);
- Svelte components and Konva instances communicate through an event bus (`Emitter`) and Runes state, never coupled directly;
- Host differences are abstracted behind `HostAdapter` (browser dev harness ↔ Obsidian).

### Out of Scope

Hand-drawn style (Rough.js), pressure-sensitive inking, real-time collaboration, image editing, audio/video embedding, cloud storage.

## License

[MIT](LICENSE)
