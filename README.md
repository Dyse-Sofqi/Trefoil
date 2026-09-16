<div align="center">

# Trefoil

思考的可视化工作台 —— 精确几何绘图 + 容器化结构思考 + 积木式交互 + 镭射笔演示标注。

[![GitHub Release](https://img.shields.io/github/v/release/Dyse-Sofqi/Trefoil?style=flat-square&logo=github&color=%2342b883)](https://github.com/Dyse-Sofqi/Trefoil/releases) [![License](https://img.shields.io/github/license/Dyse-Sofqi/Trefoil?style=flat-square&color=%2342b883)](LICENSE) [![Obsidian Min App](https://img.shields.io/badge/Obsidian-%5E1.5.0-%234a7ec1?style=flat-square&logo=obsidian&logoColor=%234a7ec1)](https://obsidian.md) [![GitHub Stars](https://img.shields.io/github/stars/Dyse-Sofqi/Trefoil?style=flat-square&logo=github&color=%23e4b341)](https://github.com/Dyse-Sofqi/Trefoil)

</div>

---

> 🇬🇧 **English**: scroll down to view the English README.

### 简介

Trefoil 是一款 Obsidian 白板插件，把「白板」当成思考的工作台：在白板上自由发散，在容器内收敛成结构，用镭射笔随时标注演示。

它不做手绘风格（Rough.js）、不追求压感手写，而是提供**像素级精确的几何绘图**与**容器化的结构思考**，两者在同一张画布上同时存在、无缝混用。文件是标准的 `.canvas`（[JSON Canvas 1.1](https://jsoncanvas.org)），扩展字段使用 `trefoil:` 前缀，与 Obsidian 原生白板互为兼容。

### 核心理念：双模式共存（无切换）

自由模式与结构模式**同时存在**，没有「切换」动作：

- 结构化「容器」是贴在白板上的智能积木块，把相关元素收纳成组、整体拖拽；
- 交互行为由点击位置决定：画布空白处即自由编辑，容器边带即整体移动；
- 渲染引擎无需感知模式，交互层根据点击对象的类型决定行为；
- 容器默认无背景遮挡（可选半透明背景），容器内部空白点击直接穿透至下层画布。

同样地，「结构」也可以由**关系**而非层级来表达：线类元素的端点可绑定到其它元素，跟着元素一起移动；把连线用作导图边，按 `Tab` / `Enter` 就能让散落的元素长成一棵思维导图。

### 关键词 / Keywords

**中文关键词**

- **绘图** — 精确几何绘图 · 矩形 / 圆形椭圆 / 菱形 / 三角形 / 箭头 / 直线折线 · 像素级精确 · 非手绘风格 · `Shift` 约束正形 · `Alt` 中心展开
- **文本** — 内联 Markdown（加粗 / 斜体 / 代码 / 删除线）· 内置预设与系统字体 · 自定义字体 · 字号 / 字重 / 颜色 / 对齐 · 实体边框（实线 / 虚线 / 点状 / 圆角 / 粗细）· 填充背景 · 宽高贴合内容
- **容器** — 分组容器 · 整体拖拽 · 内部空白穿透 · 容器名片（随缩放同步屏幕大小）· 背景色与背景透明度 · 圆角 · 组合 / 拆解
- **线类与连线** — 端点磁吸绑定元素 · 跟随目标移动 · 双端绑定渲染为贝塞尔曲线 · 6 种端点样式（实心箭头 / 空心箭头 / 线段箭头 / 圆点 / 空心圆点 / 无）· 线型（实线 / 虚线 / 点状）· 端点手柄改折点 · 关系描述内联编辑 · 连线选中与删除 · 双向箭头
- **导图** — 升级 / 取消导图主节点 · `Tab` 加子节点 · `Enter` 加同级节点 · 边驱动成员资格 · 继承父节点样式 · S 形分支曲线
- **排列** — 横向 · 纵向 · 矩阵 · 环形（均分 / 固定角距 · 半径 · 起始角 · 顺逆时针 · 排序依据）· 基准（左上角边缘 / 几何中心）· 实时预览 · 单步撤销
- **积木式交互** — 智能吸附 · 边缘 / 中心对齐 · 磁吸网格 · 间距参考线 · 绑定组（编队）· 图层排序 · 形状翻转
- **镭射笔与橡皮擦** — 独立临时图层 · 延迟淡出（1 / 3 / 5 / 10 秒 / 手动）· 永不落盘 · 动态半径（5–200 px）· 擦除可撤销
- **画布与视图** — 纯色 / 点阵 / 双层级网格 · 日间 / 夜间 / 跟随系统 · 查看模式（正常 / 浏览 / 聚焦）· 主题适配
- **导出与集成** — PNG（可选透明背景 / 含笔迹）· SVG 矢量导出（含端点样式、曲线、容器背景、图片描述）· 图片粘贴与拖入 · JSON Canvas 1.1 · `.canvas` 原生读写 · 命令面板 · 快捷键 · 错误日志

**English keywords**

- **Drawing** — Precise geometric shapes · Rectangle / Ellipse / Diamond / Triangle / Arrow / Line & Polyline · Pixel-exact, no hand-drawn style · `Shift` to constrain · `Alt` to draw from the centre
- **Text** — Inline Markdown (bold / italic / code / strikethrough) · Built-in presets & system fonts · Custom font family · Size / weight / colour / alignment · Solid, dashed or dotted border with radius and width · Background fill · Size hugs content
- **Containers** — Grouped containers · Drag the whole group · Click-through interior · Zoom-synced name plate · Background colour & opacity · Corner radius · Compose / decompose
- **Lines & edges** — Endpoint snapping that binds to another element · Endpoints follow their target · Two bound endpoints render as a Bezier curve · Six endpoint styles (solid / hollow / line arrow, dot, hollow dot, none) · Solid, dashed or dotted stroke · Per-vertex handles · Inline relationship labels · Selectable and deletable edges · Double-headed arrows
- **Mind maps** — Promote / demote a mind-map root · `Tab` for a child node · `Enter` for a sibling · Edge-driven membership · Inherited styling · S-curve branches
- **Arrange** — Row · Column · Matrix · Ring (even distribution or fixed angle step, radius, start angle, direction, ordering) · Anchor by top-left edges or geometric centre · Live preview · Single undo step
- **Building-block interaction** — Smart snapping · Edge / centre alignment · Grid magnet · Spacing guides · Binding groups · Layer ordering · Shape flipping
- **Laser & eraser** — Dedicated transient layer · Delayed fade-out (1 / 3 / 5 / 10 s / manual) · Never persisted · Dynamic radius (5–200 px) · Undoable erase
- **Canvas & views** — Solid / dots / dual-level grid · Day / night / follow system · View modes (normal / browse / focus) · Theme aware
- **Export & integration** — PNG (optional transparent background / include laser) · Vector SVG export (endpoint styles, curves, container backgrounds, image captions) · Image paste & drop · JSON Canvas 1.1 · Native `.canvas` read/write · Command palette · Hotkeys · Error log

### 功能

---

#### 🎨 绘图与文本

- **精确几何绘图** — 矩形、圆形/椭圆、菱形、三角形、箭头、直线/折线（双击结束）。全部为几何精确的矢量图形，不做手绘抖动风格。绘制时按住 `Shift` 约束为正方形/正圆与水平垂直，按住 `Alt` 以起点为中心向两侧展开，`Shift+Alt` 为中心正形；绘图工具激活时右键单击可直接退回选择工具。

- **文本系统** — 双击画布空白处直接创建文本；编辑时支持 Obsidian 内联 Markdown：`**加粗**`、`_斜体_`、`` `代码` ``、`~~删除线~~`。可设置字体（内置预设 + 读取系统字体 + 自定义字体）、字号、字重、颜色、对齐方式。

- **文本框样式** — 文字可带实体边框（开关式，可调颜色、实线/虚线/点状、圆角 0–48、粗细 1–40）与填充背景，直接当卡片使用。文本宽高贴合内容（超过 480 px 才折行）；就地编辑的输入框与画布渲染完全一致（背景、边框、圆角、行距都对齐），因此提交后画布不会跳动。

- **图片 / 附件** — 从系统文件管理器拖入图片，或直接 `Ctrl+V` 粘贴剪贴板图片，按 Obsidian「新附件的默认位置」规则落盘并插入为图片节点；白板内可自由缩放、移动。图片可显示／隐藏描述文字，也可自定义描述内容（默认取去掉扩展名的文件名，留空即隐藏）。

- **端点磁吸绑定** — 画箭头或直线时，端点靠近其它元素边缘会自动吸附并绑定到该元素，此后端点随目标元素一起移动；两端都绑定时整条线渲染为平滑曲线。被绑定的元素被删除时，线不会跟着消失，而是就地冻结为普通直线。

- **端点样式与线型** — 终点与起点可分别选择 6 种端点样式：无、实心箭头、空心箭头、线段箭头、圆点、空心圆点（起点设为箭头或圆点即为双向箭头）；线型可选实线 / 虚线 / 点状。端点尺寸随描边粗细缩放，线杆会按端点样式回缩，箭头尖端不会被圆头线帽穿出。

- **编辑线与折点** — 单选直线/箭头/折线时不再显示包围盒，只显示端点与顶点手柄，拖拽手柄即可直接改折点；越出原范围时包围盒自动重算，另一端的世界位置保持不动。

- **属性面板** — 选中元素后在右侧统一调整坐标/尺寸、填充、描边颜色与粗细、透明度、文本样式、圆角、翻转、端点样式与线型等；数值控件支持鼠标悬停滚轮微调（步进方式可配置：自动 / 固定数值 / 百分比）。

- **连线与关系描述** — 形状之间可建立连线关系，连线端点吸附在节点的上/下/左/右侧（`fromSide` / `toSide`）。连线可单击选中并高亮，`Delete` 即可删除；双击连线或线类形状的线段，可在中点就地输入关系描述，右键菜单同样提供「编辑 / 清除关系描述」与「删除连线」。

---

#### 🧠 容器

容器是贴在白板上的智能积木块：外观上是一块可整体拖拽的区域，把相关元素收纳为一组，让画布上散落的想法聚合成结构。

- **容器操作（右键菜单 / 属性面板）** — 重命名容器、拆解容器；多选自由元素可一键「组合为容器」。

- **背景与圆角（属性面板）** — 容器可设背景色（取色器 / 6 个预设色 / 无）并单独调背景透明度，圆角 0–160px；背景绘制在容器内容**之下**，不会盖住容器里的节点。两者都有默认值（圆角 10、背景透明度 10%），只有显式调过才写进 `.canvas`。

- **容器名片** — 左上角名称牌随画布缩放同步保持合适的屏幕大小，无边框，底色为画布底色加深，与画布浑然一体；双击名片即可重命名。

- **穿透交互** — 容器背景不参与命中；点击容器内部的空白区域会穿透到下层画布，不会误选中容器。

- **数据存储** — 容器子节点在 `.canvas` 文件中以相对坐标存储（`trefoil:containerId` 记录归属关系），在内存中统一转换为绝对坐标；删除容器时其内部元素自动转为自由元素。

---

#### 🌳 导图

导图不是一种新的元素类型，而是**用连线表达层级**：把普通元素升级为「导图主节点」，再用 `Tab` / `Enter` 就能一层层长下去。

- **升级 / 取消导图主节点** — 属性面板与右键菜单均可操作，主节点在画布上有专属标记（`trefoil:mapRoot`）。取消升级时，子树内的导图连线会转为普通连线，连接关系保留，且整个操作可撤销。

- **`Tab` 加子节点、`Enter` 加同级节点** — 选中导图成员后即可用快捷键扩展导图：新节点自动选中并进入文字编辑，子节点排到父节点右侧的新一层，同级节点排到参考节点正下方，文字样式与实体边框自动继承父 / 参考节点。

- **成员资格由连线决定** — 导图成员完全由标记为 `mindmap` 的连线（起点为父、终点为子）决定，删掉连线即脱离导图；不依赖容器，也不依赖额外的父指针字段。

- **分支曲线** — 导图分支线渲染为两端切线水平的平滑 S 形曲线，读起来更像一棵树。

---

#### 🧲 积木式交互

- **智能吸附** — 移动/缩放时自动吸附到其他元素的边缘与中心，显示对齐参考线；可选磁吸网格（按背景网格吸附），并在对齐元素之间显示间距数值参考线。

- **绑定组（编队）** — 把多个元素绑定为一个整体一起移动、缩放；组可嵌套，属性面板与右键菜单提供「绑定组 / 解绑组」。

- **组合 / 拆解容器** — 选中多个自由元素一键「组合为容器」；容器也可一键「拆解」回自由元素，子节点坐标自动还原为绝对坐标。

- **图层顺序** — 右键菜单「图层顺序」提供置于顶层 / 置于底层 / 上移一层 / 下移一层（内部数组顺序即 Z-index）。

- **形状翻转** — 形状可水平或垂直翻转，支持多选批量操作。

---

#### 📐 排列

选中 ≥ 2 个元素后，属性面板出现「排列」区，一键把散落的元素摆整齐：

- **横向 / 纵向** — 沿一行或一列排开，间距可调（0–500）。
- **矩阵** — 指定横向间距、纵向间距与每行个数，铺成网格。
- **环形** — 绕一个圆心排成圆环，可调分布方式（均分整圆 / 固定角距）、角距（5–180°）、半径（20–1200）、起始角（0–360°）、方向（顺 / 逆时针）与环上排序依据（按当前角度 / X / Y / 选择顺序）。
- **基准** — 可选「左上角」（按元素边缘间距对齐）或「几何中心」（按中心间距对齐），排列过程保持选中区域的包围盒不动。
- **实时预览与单步撤销** — 拖动滑块即时重排，停顿 300 ms 后合并为一条「排列」撤销记录；排列对自身幂等，反复应用不会漂移；容器与其子节点一同选中时，子节点整体跟随容器平移而不单独排位。

---

#### 🔦 镭射笔与橡皮擦

- **镭射笔** — 独立临时图层，绘制流畅、延迟期间新笔迹正常叠加；松手后按设定延迟自动淡出（1 秒 / 3 秒 / 5 秒 / 10 秒 / 手动清除）。**笔迹永不写入 `.canvas` 文件**，导出 PNG 时可选择是否包含笔迹。

- **橡皮擦** — 按住拖动即擦除，半径动态可调（`[` `]` 或滚轮，5–200 px），擦除操作可撤销。

---

#### 🖼️ 画布背景与视图

- **画布背景** — 纯色 / 点阵 / 双层级网格三种模式：点阵可调大小（1–10 px）、形状（圆形/方形/菱形）、颜色、间距；网格为双层结构，小格淡、大格浓，大格合并格数（N 格小网格 = 1 格大网格）可调。

- **主题模式** — 日间 / 夜间 / 跟随系统三态，状态栏一键循环切换。夜间模式有独立的画布底色、点阵色与网格色；主题翻转时，仍沿用默认色的节点文字与描边会自动跟随切换（画布同样监听 Obsidian 的 `css-change` 事件重新着色）。

- **查看模式** — 正常（可编辑）/ 浏览（只读平移缩放，适合演示）/ 聚焦（选中元素居中放大并加遮罩）。

- **视图操作** — 滚轮以鼠标位置为中心缩放；右键或中键拖拽平移；按住空格临时切换为平移模式；命令面板提供「缩放适应内容」。

---

#### 📤 导出

- **PNG** — 当前视口导出为 PNG，可选是否使用透明背景、是否包含镭射笔迹。
- **SVG** — 导出几何精确的矢量 SVG，适合二次编辑与印刷。容器背景与圆角、文本框背景与实体边框、6 种端点样式与回缩后的线杆、双端绑定的曲线、导图分支曲线、图片描述都会一并导出，层级与画布一致。

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
| 通用 | `Delete` | 删除选中（删除容器时内部元素转为自由元素） |
| 通用 | `Ctrl+Z` / `Ctrl+Shift+Z` / `Ctrl+Y` | 撤销 / 重做 |
| 通用 | `Ctrl+C` / `Ctrl+X` / `Ctrl+A` | 复制 / 剪切 / 全选 |
| 通用 | `Ctrl+V` | 在鼠标位置粘贴：剪贴板为画布元素则粘贴元素（跨白板可用），为文本则按行拆成文本元素，为图片则落盘插入 |
| 通用 | `Ctrl+D` | 原地克隆选中元素 |
| 通用 | 方向键（+`Shift`） | 微移 1 px（10 px） |
| 通用 | `Esc` | 清除全部镭射笔迹 / 退出聚焦 / 取消选中 |
| 导图 | `Tab` / `Enter` | 为选中的导图成员添加子节点 / 同级节点 |
| 绘制 | `Shift` / `Alt` / `Shift+Alt` | 约束正形与水平垂直 / 以起点为中心展开 / 中心正形 |
| 绘制 | 右键单击 | 绘图工具激活时退回选择工具 |
| 橡皮擦 | `[` `]` / 滚轮 | 减小 / 增大半径 |
| 视图 | 滚轮 | 以鼠标为中心缩放 |
| 视图 | `Space` + 左键拖拽 / 右键拖拽 / 中键拖拽 | 平移画布（右键单击呼出菜单） |
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

- 标准字段原样保留：`id` / `x` / `y` / `width` / `height` / `type` / `text` / `color` / `fromSide` / `toSide` / `label`；
- Trefoil 扩展字段使用 `trefoil:` 命名空间，如 `trefoil:shape`、`trefoil:containerId`；
- 容器子节点在文件中以**相对坐标**存储，内存中统一为绝对坐标；
- 其他扩展字段：`trefoil:points`（折线折点）、`trefoil:headStyle` / `trefoil:tailStyle`（端点样式）、`trefoil:strokeStyle`（线型）、`trefoil:fromNode` / `trefoil:toNode`（端点绑定）、`trefoil:label`（线类形状的关系描述）、`trefoil:caption`（图片描述）、`trefoil:mapRoot`（导图主节点）、`trefoil:kind`（连线类型，如 `mindmap`）、`trefoil:fillOpacity` / `trefoil:borderRadius` / `trefoil:border` / `trefoil:borderStyle`；
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
                    └── 核心业务层 (Document / History 命令模式 / snap 吸附 / arrange 排列)
                    └── 数据持久层 (JSON Canvas 规范，trefoil: 命名空间扩展字段)
```

- 工具独立成类，经 `ToolManager` 注册分发（指针 / 滚轮 / 键盘）；
- Svelte 组件与 Konva 实例通过事件总线（`Emitter`）与 Runes 状态通信，互不直接耦合；
- 宿主差异抽象为 `HostAdapter`（浏览器开发台 ↔ Obsidian）。

### 明确不做

手绘风格（Rough.js）、压感手写、实时协作、图片编辑、音视频嵌入、云端存储。

## License

[MIT](LICENSE)

版本变更与完整修复清单见 [CHANGELOG.md](CHANGELOG.md)。

---

<div align="center">

# Trefoil

**A visual thinking workbench** — precise geometric drawing, containerized structural thinking, building-block interaction and laser-pointer annotation for Obsidian.

[![GitHub Release](https://img.shields.io/github/v/release/Dyse-Sofqi/Trefoil?style=flat-square&logo=github&color=%2342b883)](https://github.com/Dyse-Sofqi/Trefoil/releases) [![License](https://img.shields.io/github/license/Dyse-Sofqi/Trefoil?style=flat-square&color=%2342b883)](LICENSE) [![Obsidian Min App](https://img.shields.io/badge/Obsidian-%5E1.5.0-%234a7ec1?style=flat-square&logo=obsidian&logoColor=%234a7ec1)](https://obsidian.md) [![GitHub Stars](https://img.shields.io/github/stars/Dyse-Sofqi/Trefoil?style=flat-square&logo=github&color=%23e4b341)](https://github.com/Dyse-Sofqi/Trefoil)

[🇨🇳 中文](README.md) · [🇬🇧 English](#introduction)

</div>

---

### Introduction

Trefoil is an Obsidian whiteboard plugin that treats the canvas as a workbench for thinking: diverge freely on the board, converge into structure inside containers, and annotate on the fly with a laser pointer.

It deliberately avoids a hand-drawn look (Rough.js) and pressure-sensitive inking. Instead it offers **pixel-exact geometric drawing** and **containerized structural thinking** that coexist on the same canvas without any mode switch. Files are standard `.canvas` ([JSON Canvas 1.1](https://jsoncanvas.org)); Trefoil extensions live under the `trefoil:` prefix and stay compatible with Obsidian's built-in canvas.

### Core Idea: Two Modes, No Switching

Free-form and structured editing **coexist**; there is no mode toggle:

- A container is a smart building block pinned to the board that gathers related elements into one draggable group;
- Behavior is decided by what you click: empty canvas means free editing, a container's edge band moves the whole group;
- The rendering engine is mode-agnostic — the interaction layer decides based on the clicked object's type;
- Containers draw no opaque background, so clicks on empty space inside them pass through to the canvas below.

Structure can also be expressed through **relationships** rather than nesting: a line's endpoint can be bound to another element and then follows it around, and marking an edge as a mind-map edge lets `Tab` / `Enter` grow a tree out of scattered elements.

### Features

---

#### 🎨 Drawing & Text

- **Precise geometric shapes** — rectangle, ellipse/circle, diamond, triangle, arrow, line/polyline (double-click to finish). All are geometrically exact vectors with no hand-drawn jitter. Hold `Shift` to constrain to a square/circle and to horizontal or vertical; hold `Alt` to expand from the start point outwards (start point as centre); `Shift+Alt` gives a centred regular shape. Right-clicking while a drawing tool is active returns you to the select tool.
- **Text system** — double-click empty canvas to create a text element. Editing supports inline Markdown: `**bold**`, `_italic_`, `` `code` ``, `~~strikethrough~~`. Font (built-in presets + system font list + custom family), size, weight, color and alignment are configurable.
- **Text box styling** — text can carry an optional solid border (colour, solid/dashed/dotted, 0–48 radius, 1–40 width) and a background fill, so a text box doubles as a card. Width and height hug the content (wrapping only past 480 px), and the inline editor matches the canvas rendering exactly — background, border, radius and line metrics all line up — so committing an edit no longer shifts the canvas.
- **Images & attachments** — drop images from the file manager or paste a clipboard image with `Ctrl+V`; files are saved following Obsidian's "Default location for new attachments" setting and inserted as image nodes you can move and resize. An image can show or hide a caption, and the caption text is customisable (defaults to the file name without its extension).
- **Endpoint snapping** — while drawing an arrow or line, an endpoint that comes near another element's edge snaps to it and binds to that element; the endpoint then follows its target. When both endpoints are bound, the whole line renders as a smooth Bezier curve. If a bound element is deleted, the line does not disappear with it — it freezes in place as a plain line.
- **Endpoint styles & line styles** — the end and the start of a line each offer six styles: none, solid arrow, hollow arrow, line (V) arrow, dot, hollow dot. Setting the start to an arrow or dot gives a double-headed arrow. Stroke style can be solid, dashed or dotted. Endpoint size scales with stroke width, and the shaft is trimmed so a round line cap never pokes through the arrow tip.
- **Editing lines and vertices** — selecting a single line, arrow or polyline shows endpoint and vertex handles instead of a bounding box; dragging a handle reshapes the line directly. If it grows past its original bounds the bounding box is recomputed while the opposite end keeps its world position.
- **Property panel** — one place to adjust position/size, fill, stroke color and width, opacity, text style, corner radius, flipping, endpoint styles and stroke style. Numeric controls support wheel fine-tuning while hovering (step mode: auto / fixed value / percentage).
- **Edges & relationship labels** — link shapes to each other; endpoints snap to the top/bottom/left/right sides of nodes (`fromSide` / `toSide`). An edge can be clicked to select and highlight it, and `Delete` removes it. Double-clicking an edge or a line-like segment opens an inline label editor at its midpoint, and the context menu offers the same edit, clear and delete actions.

---

#### 🧠 Containers

A container is a smart block on the board: a draggable region that gathers scattered ideas into one group, turning a loose canvas into structure.

- **Container actions** (context menu / property panel) — rename container, decompose container; compose a multi-selection into a container in one action.
- **Background & radius** (property panel) — a container can take a background colour (picker / six presets / none) with its own opacity, plus a 0–160 px corner radius. The background is painted **beneath** the container's contents and never covers the nodes inside it. Both have defaults (radius 10, background opacity 10%) and are only written to the `.canvas` file once you change them explicitly.
- **Name plate** — the plate at the container's top-left keeps a comfortable on-screen size in sync with canvas zoom. It has no border; its background is a darkened shade of the canvas color, blending into the board. Double-click it to rename.
- **Click-through** — containers paint no background, so clicking empty space inside one passes through to the canvas below instead of selecting the container.
- **Storage** — children are stored with relative coordinates in the `.canvas` file (`trefoil:containerId` records the membership) and converted to absolute coordinates in memory; deleting a container turns its children back into free elements.

---

#### 🌳 Mind Maps

A mind map is not a new kind of element — it is **hierarchy expressed through edges**. Promote an ordinary element to a mind-map root, then use `Tab` / `Enter` to grow it level by level.

- **Promote / demote a mind-map root** — available from the property panel and the context menu; the root is marked on the canvas (`trefoil:mapRoot`). On demotion, the mind-map edges inside the subtree become ordinary edges — the connections are preserved — and the whole operation is undoable.
- **`Tab` for a child, `Enter` for a sibling** — select a mind-map member and use the shortcuts to extend the map: the new node is selected and opened for text editing, children are placed on a new level to the right of their parent, siblings go directly below the reference node, and text styling plus the solid border are inherited from the parent or reference node.
- **Membership is decided by edges** — a mind-map member is defined purely by an edge marked `mindmap` (start = parent, end = child); deleting the edge leaves the map. No container and no extra parent-pointer field is involved.
- **Branch curves** — mind-map branches render as smooth S-curves with horizontal tangents at both ends, so they read like a tree.

---

#### 🧲 Building-block Interaction

- **Smart snapping** — while moving/resizing, elements snap to other elements' edges and centers with alignment guides; optional grid magnet, plus live spacing readouts between aligned elements.
- **Binding groups** — bind multiple elements into one unit that moves and scales together; groups can nest. Available from the property panel and context menu (bind / unbind).
- **Compose / decompose containers** — turn a multi-selection into a container in one action, or decompose a container back into free elements with absolute coordinates restored.
- **Layer order** — context menu → Layer order: bring to front, send to back, bring forward, send backward (array order is Z-index).
- **Shape flipping** — flip shapes horizontally or vertically, including batch operations on a multi-selection.

---

#### 📐 Arrange

With 2 or more elements selected, the property panel shows an **Arrange** section that tidies them up in one action:

- **Row / Column** — lay elements out along one line, with an adjustable gap (0–500).
- **Matrix** — set the horizontal gap, vertical gap and number of items per row to lay out a grid.
- **Ring** — arrange around a centre, with a configurable distribution (even around the full circle, or a fixed angle step), angle step (5–180°), radius (20–1200), start angle (0–360°), direction (clockwise / counter-clockwise) and ordering along the ring (by current angle / X / Y / selection order).
- **Anchor** — "top-left" (align by element edges) or "geometric centre" (align by centres). The bounding box of the selection stays put during the operation.
- **Live preview, single undo step** — dragging the sliders rearranges immediately, and the changes coalesce into one "Arrange" undo entry after a 300 ms pause. Arranging is idempotent, so applying it repeatedly does not drift; when a container is selected together with its children, the children follow the container as a whole instead of being arranged individually.

---

#### 🔦 Laser Pointer & Eraser

- **Laser pointer** — a dedicated transient layer: strokes draw smoothly and stack during the delay window, then fade out automatically after the configured delay (1 s / 3 s / 5 s / 10 s / manual clear). **Strokes are never written to the `.canvas` file**; PNG export can optionally include them.
- **Eraser** — drag to erase with a dynamic radius (`[` `]` or the wheel, 5–200 px); erasing is undoable.

---

#### 🖼️ Canvas Background & Views

- **Background** — solid / dots / dual-level grid. Dots support size (1–10 px), shape (circle/square/diamond), color and spacing; the grid is two-level — minor lines faint, major lines strong — with a configurable merge count (N minor cells = 1 major cell).
- **View modes** — Normal (editable) / Browse (read-only pan & zoom, ideal for presentations) / Focus (center and magnify the selection behind a mask).
- **Navigation** — wheel zooms around the pointer; right-drag or middle-drag pans; hold `Space` for temporary pan mode; "Zoom to fit" is available from the command palette.
- **Theme mode** — day / night / follow system, cycled from the status bar. Night mode has its own canvas, dot and grid colours. When the theme flips, node text and strokes that still use the default colours follow automatically, and the canvas also listens to Obsidian's `css-change` event to recolour itself.

---

#### 📤 Export

- **PNG** — export the current viewport, optionally with a transparent background and optionally including laser strokes.
- **SVG** — export geometrically exact vector SVG, suitable for further editing and print. Container backgrounds and radii, text-box backgrounds and borders, all six endpoint styles with trimmed shafts, bound Bezier curves, mind-map branches and image captions are exported too, in the same layer order as the canvas.

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
| General | `Delete` | Delete selection (deleting a container frees its children) |
| General | `Ctrl+Z` / `Ctrl+Shift+Z` / `Ctrl+Y` | Undo / redo |
| General | `Ctrl+C` / `Ctrl+X` / `Ctrl+A` | Copy / cut / select all |
| General | `Ctrl+V` | Paste at the pointer: canvas elements paste as elements (works across whiteboards), text splits into text nodes by line, images are saved and inserted |
| General | `Ctrl+D` | Clone the selection in place |
| General | Arrow keys (+`Shift`) | Nudge 1 px (10 px) |
| General | `Esc` | Clear all laser strokes / exit focus / clear selection |
| Mind map | `Tab` / `Enter` | Add a child / sibling node to the selected mind-map member |
| Drawing | `Shift` / `Alt` / `Shift+Alt` | Constrain to a regular shape and to horizontal/vertical / expand from the start point / centred regular shape |
| Drawing | Right-click | Return to the select tool while a drawing tool is active |
| Eraser | `[` `]` / wheel | Decrease / increase radius |
| View | Wheel | Zoom around the pointer |
| View | `Space` + left-drag / right-drag / middle-drag | Pan (right-click opens the context menu) |
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

- Standard fields are preserved verbatim: `id` / `x` / `y` / `width` / `height` / `type` / `text` / `color` / `fromSide` / `toSide` / `label`;
- Trefoil extensions use the `trefoil:` namespace, e.g. `trefoil:shape`, `trefoil:containerId`;
- Container children are stored with **relative coordinates** on disk and normalized to absolute coordinates in memory;
- Other extension fields: `trefoil:points` (polyline vertices), `trefoil:headStyle` / `trefoil:tailStyle` (endpoint styles), `trefoil:strokeStyle` (line style), `trefoil:fromNode` / `trefoil:toNode` (endpoint bindings), `trefoil:label` (relationship label on a line-like shape), `trefoil:caption` (image caption), `trefoil:mapRoot` (mind-map root), `trefoil:kind` (edge kind, e.g. `mindmap`), `trefoil:fillOpacity` / `trefoil:borderRadius` / `trefoil:border` / `trefoil:borderStyle`;
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
                    └── Core domain (Document / History command pattern / snap / arrange)
                    └── Persistence (JSON Canvas spec, trefoil: namespaced extensions)
```

- Tools are independent classes registered and dispatched by `ToolManager` (pointer / wheel / keyboard);
- Svelte components and Konva instances communicate through an event bus (`Emitter`) and Runes state, never coupled directly;
- Host differences are abstracted behind `HostAdapter` (browser dev harness ↔ Obsidian).

### Out of Scope

Hand-drawn style (Rough.js), pressure-sensitive inking, real-time collaboration, image editing, audio/video embedding, cloud storage.

## License

[MIT](LICENSE)

See [CHANGELOG.md](CHANGELOG.md) for the version history and the full list of fixes.
