# 更新日志 / Changelog

Trefoil 的版本变更记录。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。
All notable changes to Trefoil are documented here.

---

## [1.0.3] - 2026-09-18

一次以「交互稳健性与连接表达」为主的版本：块状元素获得旋转，连线与箭头端点可以重新绑定，
点选 / 框选 / 吸附 / 删除跟随等连接行为整体收紧；同时修复容器拖动语义、主题切换与箭头接缝等一批问题。

### 新增功能

#### 元素旋转

- **旋转手柄** — 单选文本 / 形状 / 图片时，元素顶部出现旋转手柄（未旋转也显示），绕自身中心拖拽旋转；按住 `Shift` 吸附 15°，松手生成可撤销的「旋转」记录；双击手柄一键归零。
- **属性面板「旋转」区块** — 数字框实时输入角度（-180 ~ 180，悬停滚轮可调）+ 实时预览 + 「重置」按钮；仅可旋转的元素显示（线类与容器自动过滤）。
- **持久化** — 旋转角写入扩展字段 `trefoil:rotation`，**0° 不落盘**，旧文件保持干净。

#### 连线与端点重连

- **连线端点重连** — 单选连线（非导图分支）时两端显示圆形手柄，拖动可在四向磁吸下重新绑定到其它元素并实时跟随，松手改连（可撤销 / 重做）；拖到空白恢复原连接；绑定未变化不产生撤销记录。
- **箭头端点重链** — 单选直线 / 箭头拖端点靠近其它元素，会自动磁吸绑定该端（可撤销 / 重做）。
- **磁吸可视化** — 拖端点或画箭头时，贴近可连接元素会显示四向吸附端口，并高亮松手时实际会吸附的锚点；提示范围与真实磁吸范围（14 屏幕像素）完全一致，稳定不闪烁。

### 行为变化

- **容器拖动语义修正** — 单击容器边带只选中内容（空容器选中自身）；只有**从边带发起拖拽**容器框才随内容整体搬家（嵌套容器逐层补齐，撤销可还原）；**全选容器内全部元素后从元素发起拖动，容器框不再跟随**。
- **绑定箭头分场景** — 多选同批移动时箭头保持绑定跟随元素（不脱钩）；单独拖动箭头本体冻结绑定可自由移动，撤销还原磁吸关系；点按即松不再误解除绑定。
- **网格吸附改为边缘贴格** — 左 / 上边缘直接取整到格线（不再受阈值限制），对象吸附未命中的轴才兜底；自由微调仍可用方向键或按住 `Alt` 拖动。
- **点选 / 框选按实体判定** — 直线 / 箭头 / 连线按线实体 ±4 屏幕像素命中，不再误选包围盒空白；框选线类按线段实际相交判定（`lineHitsRect`）；双端绑定曲线按采样弧线命中，选中框贴合弧线。
- **标签底牌镂空** — 关系描述小牌底色改 destination-out 镂空，背景的点阵 / 网格从文字后方透出。
- **删除部分跟随** — 删除被连接元素时只冻结被删一侧的绑定，另一侧继续跟随幸存元素（此前整条线冻结成直线）。
- **斜向连线切线倾斜** — 斜向贝塞尔控制点混入弦向，端点切线随弧线倾斜（箭头尾部不再垂直正对元素）；水平 / 垂直连线与旧版一致。
- **文本框缩放手柄改为仅四角** — 不再显示左右中点手柄。
- **连线创建统一** — 从元素起笔画箭头，松手在元素或空白都生成同一种箭头节点（此前元素上 = 连线、空白 = 箭头，颜色行为不一致）；松手在元素上即使超出磁吸半径也完成双向绑定，终点锚在朝向起点一侧的边中点，并随目标移动绕边。
- **环形排列重做** — 线类节点不再参与环上排位；半径只在首次切入时按选中区域拟合（`fitRingRadius`），重复点击沿用原圆心与半径，不再越排越散。
- 文案统一：「磁吸网格」→「吸附网格」、「阈值」→「对象阈值」。

### 错误修复

1. **箭头接缝** — 线杆与两端端点改在同一个 2D 上下文中一次画完（新模块 `arrowPaint.ts`，无图元拼接接缝），长曲线按弧长自适应回缩（采样密度 32–512 段），修复「圆帽从箭头尖冒出、线杆和箭头像两块拼的」；SVG 导出改用与画布同源的布局，导出图不再错位。
2. **旋转元素命中错位** — 点选时先把指针逆旋转回局部坐标再判定，旋转后不再按轴对齐包围盒误命中空白。
3. **容器拖动误带容器框** — 全选容器内容后拖动元素不再连带容器框（见行为变化）。
4. **主题切换不跟随** — Obsidian 切换主题时 `css-change` 可能先于 body 主题类翻转到达，重绘读到旧主题；改为延迟到下一帧统一重绘（rAF 去重），并以 `MutationObserver` 监听 body 主题类兜底，深浅切换即时生效。
5. **夜间重载后切回日间背景不变** — 旧版在夜间挂载时把深色底直接写进背景 `color`（污染日间默认值）；夜间配色改走 `colorDark`，并自动迁移已污染的历史数据。
6. **环形排列越排越散 / 环漂移**（见行为变化）。
7. **磁吸自环 / 重复绑定** — 磁吸目标支持排除多个 id，线类元素不再作为绑定目标。

### 维护与规范

- 新增 `tests/selectFlow.test.ts`（977 行）、`tests/arrowPaint.test.ts`、`tests/pluginSettings.test.ts` 等交互流与几何单测，全量 317 项通过。
- `arrowHead` 精简（移除 `addHeadShapes`，抽出 `headRetract`）；`linePolyline` 成为命中 / 框选的唯一几何来源；网格吸附抽为纯函数并补单测。

### 数据格式变更

新增扩展字段 `trefoil:rotation`（元素旋转角，0° 不落盘）。旧文件向后兼容，缺失字段按默认值处理。

### English summary

**New features**

- **Rotation** — a handle appears above a selected text / shape / image; drag to rotate around its centre (`Shift` snaps to 15°), double-click the handle to zero it, and the property panel offers an exact angle input with live preview and a reset button. The angle is persisted as `trefoil:rotation` and omitted when 0°.
- **Edge re-linking** — select an edge (non-mind-map) to reveal circular handles at both ends; drag one to magnetically re-bind it to another element with four-direction snapping and live follow-through, or drop on empty space to restore the original connection — all undoable, with no history entry when nothing changed. Free arrow / line endpoints snap-bind when dragged near an element.
- **Magnet preview** — while dragging an endpoint or drawing an arrow, hovering near a connectable element shows its four snap ports and highlights the anchor that will actually be captured, matching the real 14 px magnet radius.

**Behavior changes**

- Container drag semantics: clicking the edge band selects the contents only (an empty container selects itself); the frame follows only when the drag starts on the band itself (nested containers follow layer by layer, undoable); dragging an element no longer drags the frame even when every child is selected.
- Bound arrows stay attached when moved together with their elements, but freeze and move freely when dragged alone (undo restores the binding); a press-and-release without a drag no longer unbinds an endpoint.
- Grid snapping now quantises the left / top edge to grid lines (threshold-free), with object snapping as a fallback on the other axis; arrows / lines / edges are hit-tested and marquee-selected by their actual geometry (±4 screen px, arcs by sampled curve) instead of the bounding box.
- Relationship label plates are knocked out (destination-out) so dots and grid show through behind the text; deleting a bound element freezes only the deleted side while the other keeps following the survivor; diagonal edge Bezier control points blend toward the chord so endpoint tangents tilt with the arc (horizontal / vertical unchanged).
- Ring arrangement no longer places line-like nodes and keeps its fitted radius and centre across repeated clicks (no more drift); drawing an arrow from an element start now yields the same node whether you release on an element or empty space; text boxes expose only corner resize handles; wording updated ("吸附网格" / "对象阈值").

**Bug fixes**

Arrow seams — shaft and both endpoints painted in a single 2D-context pass (new `arrowPaint.ts`) with arc-length adaptive retraction (32–512 segments), so the round cap never pokes past the tip, and SVG export shares the same layout; hit-testing of rotated elements (pointer inverse-rotated to local coordinates); container frame dragged along by element drags; theme switches not applying (css-change deferred to the next frame with rAF coalescing plus a `MutationObserver` fallback on the body theme class); canvas background stuck dark after reloading Obsidian in night mode (dark colour now carried by `colorDark` instead of polluting `color`, with legacy data migrated); ring-arrange radius / centre drift; magnet targets excluding multiple ids and line-like elements no longer linkable.

**Maintenance:** added `tests/selectFlow.test.ts`, `tests/arrowPaint.test.ts` and `tests/pluginSettings.test.ts` (317 tests passing); `arrowHead` slimmed down and grid snap extracted into pure functions.

---

## [1.0.2] - 2026-09-17

一次以「绘图表达力」为主线的功能版本：线类元素获得端点绑定、端点样式与线型，容器获得背景与圆角，
导图从「容器自动布局」重做为「边驱动的导图语义 + 手动增量增删」，并新增通用的多选排列面板。

### 新增功能

#### 线类（箭头 / 直线 / 折线）

- **端点磁吸绑定** — 绘制时端点靠近其它元素边缘会自动吸附（屏幕 14 px 判定半径），绑定后端点随目标元素移动而移动；两端都绑定时整条线渲染为三次贝塞尔曲线，只绑一端则保持直线。
  写入扩展字段 `trefoil:fromNode` / `trefoil:toNode`。
- **被绑定元素删除后冻结** — 删除箭头所依附的元素时，箭头不再跟着消失，而是就地冻结为普通直线并清除绑定。
- **6 种端点样式** — 终点与起点可分别设置：无、实心箭头、空心箭头、线段箭头（V 形）、实心圆点、空心圆点；起点设为箭头或圆点即为双向箭头。端点尺寸随描边粗细缩放。
  写入扩展字段 `trefoil:headStyle` / `trefoil:tailStyle`。
- **线型** — 实线 / 虚线 / 点状。写入扩展字段 `trefoil:strokeStyle`。
- **端点手柄拖拽改折点** — 单选线类元素时不再显示包围盒，只显示两端/顶点手柄，拖拽直接改折点；越出原包围盒时整条线自动重排，另一端世界位置不动。拖拽绑定的端点会解除该端吸附。
- **翻转后可正常命中** — 水平/垂直翻转的线在拖拽前把镜像「烘进」折点，视觉不变，修复了此前翻转后命中错位、只有中点能拖的问题。
- **旧文件包围盒自动收紧** — 打开旧版本写出的线类节点时按其折点实际范围重算包围盒，修复「选中框比线大一圈、端点对不上」。

#### 连线与关系描述

- **连线可选中** — 单击线段即选中，叠加层沿曲线高亮并标出两端圆点，`Delete` 可删除。
- **关系描述内联编辑** — 双击连线或线类形状的线段，在线段中点弹出输入框；`Enter` / 失焦提交，`Esc` 取消，空串即清除。连线使用 JSON Canvas 标准 `label` 字段，线类形状使用扩展字段 `trefoil:label`。
- **右键菜单**新增「编辑关系描述 / 清除关系描述 / 删除连线」。
- 关系描述小牌按曲线中点（贝塞尔）或折线弧长中点定位，并垫画布底色以遮住身后的线条。

#### 文本框

- **实体边框** — 可开关，并可调边框颜色、样式（实线 / 虚线 / 点状）、圆角（0–48）、粗细（1–40）；关闭时保留参数，再次开启即还原。新建文本默认带实体边框，呈卡片感。
  写入扩展字段 `trefoil:border` / `trefoil:borderStyle` / `trefoil:borderRadius`。
- **填充背景** — 文本框可设背景色（含 6 个预设色块与「无填充」），当作卡片使用。
- **宽高贴合内容** — 新增 `autoTextWidth`：宽度贴合文字，超过 480 px 才折行；提交编辑、粘贴文本、调整字体三处共用同一算法，不再出现文字溢出或留白。
- **编辑态所见即所得** — 内联编辑框带出节点的背景色、实体边框（含虚线/点状）与圆角，尺寸随输入实时伸缩，因此提交后画布不跳动。

#### 图片

- **图片描述** — 可显示/隐藏描述、自定义描述内容；默认显示去掉扩展名的文件名，留空即隐藏，清空并回车恢复默认。写入扩展字段 `trefoil:caption`；SVG 导出会带上描述牌。

#### 容器

- **背景与圆角** — 容器可设背景色（取色器 / 预设色 / 无）、背景透明度（默认 10%）与圆角（默认 10，上限 160）。背景绘制在容器内容**之下**，不会盖住容器里的节点；背景透明度使用独立的 `trefoil:fillOpacity`，不会连带把名片文字一起变淡。
  写入扩展字段 `trefoil:fillOpacity` / `trefoil:borderRadius`。
- **绘制层级修正** — 新增 `paintOrder` 排序：非容器节点相对顺序完全不变，仅把容器下移到其最靠前后代之前，支持嵌套容器，并能容错悬空或成环的 `containerId`。画布渲染、SVG 导出、缩略图三处统一使用。
- **容器名片** — 名称牌按 1 / 视口缩放反向缩放，屏幕尺寸恒定、缩放不变形；底色为画布底色加深，与画布浑然一体。

#### 多选排列（新）

选中 ≥ 2 个元素后，属性面板出现「排列」区：

- **四种模式** — 横向、纵向、矩阵（可调每行个数）、环形。
- **环形参数** — 分布（均分整圆 / 固定角距）、角距（5–180°）、半径（20–1200）、起始角（0–360°）、方向（顺 / 逆时针）、环上排序依据（按当前角度 / X / Y / 选择顺序）。
- **基准** — 左上角（按边缘间距）或几何中心（按中心间距），排列过程保持选中包围盒不动。
- **撤销友好** — 拖动滑块即时重排，停顿 300 ms 后合并为一条「排列」撤销记录；排列对自身幂等，反复应用不漂移；容器与其子节点一同选中时，子节点整体跟随容器平移而不单独排位。

#### 导图（重做）

- **升级为导图主节点 / 取消导图主节点** — 属性面板与右键菜单均可操作，主节点在画布上有专属标记。取消升级时子树内的导图连线转为普通连线，连接关系保留，且可撤销。
  写入扩展字段 `trefoil:mapRoot`。
- **Tab 加子节点、Enter 加同级节点** — 选中导图成员后即可用快捷键扩展导图：新节点自动选中并进入文字编辑，子节点排到父节点右侧的新一层，同级节点排到参考节点正下方，文字样式与实体边框继承父 / 参考节点。
- **成员资格由边决定** — 导图成员完全由 `kind: 'mindmap'` 的连线（`fromNode` = 父，`toNode` = 子）决定，删边即脱离导图；不再依赖容器或父指针字段。
- **分支曲线** — 导图分支线渲染为两端切线水平的平滑 S 形贝塞尔曲线（此前被 Konva 误当作折线绘制）。
- **移除**容器自动树布局（横向树 / 纵向树）、折叠展开（`Space`）与 Web Worker 布局管线（`src/core/layout.ts`、`src/workers/layout*`），改由「手动增量增删 + 通用排列面板」承担；相关扩展字段 `treeParent` / `collapsed` / `layout` 一并移除。

#### 主题

- **日间 / 夜间 / 跟随系统三态** — 状态栏一键循环切换；夜间模式拥有独立的画布底色、点阵色与网格色（设置面板中拆分为「日间 / 夜间」两项）。
- **默认色随主题翻转** — 仍沿用日间默认色的节点文字与描边，在主题翻转时自动切换为夜间默认色；文本框颜色等于全局默认值时不再烤进节点，因此始终跟随主题。

#### 绘图辅助与交互

- **修饰键** — 绘制时 `Shift` 约束正形/角度，`Alt` 从中心向外展开，`Shift+Alt` 为中心正形。
- **右键回到选择工具** — 绘图工具激活时，右键单击直接切回选择工具（再按一次右键才弹出上下文菜单），避免误操作后要去工具栏切换。

#### 导出

- SVG 导出补齐新样式：容器背景色与圆角、文本框背景与实体边框（内缩半个线宽、圆角夹取、虚线/点状）、6 种箭头端点与回缩的线杆、双端绑定的贝塞尔曲线、图片描述牌、导图分支曲线，并按 `paintOrder` 输出层级。

### 错误修复

1. **夜间模式出现白色色块** — 画布底色变量设在视图内容元素上，而调色板从 `document.body` 读取，读不到便静默回退成 `#ffffff`，导致夜间深色画布上的关系描述小牌、容器名片、空心箭头内芯、缩略图底色全是白块。新增 `resolveThemedPalette` 强制以背景设置的实际绘制色为权威来源。
2. **容器背景盖住容器内节点** — 由 `paintOrder` 修正绘制层级（画布 / 导出 / 缩略图三处统一）。
3. **整个 UI 冻结、双击无法进入编辑** — 设置变更的 effect 内部读写了被追踪的状态形成闭环，effect 无限重跑直至 Svelte 调度器 depth exceeded 后死亡。已用 `untrack` 包裹推送动作。
4. **`Ctrl+Z` 被全局吞掉** — 撤销/重做命令曾声明默认热键 `Mod+Z` / `Mod+Shift+Z`；Obsidian 的热键分发不看 `checkCallback` 结果，只要不抛异常就认定按键已处理并 `preventDefault` + `stopPropagation`，导致编辑器原生撤销、输入框撤销全部失效。已移除默认热键，画布内撤销由工具系统的 window 监听器负责。
5. **双击不可靠、慢速双击丢失** — 改为自合成双击（< 500 ms 且位移 < 6 px），保留原生 `dblclick` 作为兜底并去重；同时 `preventDefault`，避免刚聚焦的文本域被立刻 blur。
6. **后台标签页误改白板** — 键盘分发前先检查画布容器是否可见、是否已挂载，避免在后台标签页按 `Delete` / `Ctrl+A` 时误删或全选。
7. **折线翻转后命中错位、只有中点能拖** — 命中检测对折点做 flip 镜像，容差随缩放变化以保证屏幕命中范围不小于 6 px。
8. **箭头尖端冒出圆头线帽** — 使用 de Casteljau 沿曲线回缩线杆，实心/空心端点不再被圆头线帽穿出。
9. **属性面板预设色不同步** — 点选预设色后自定义色块显示滞后（节点原地修改导致模板不重渲染），已用 `{#key}` 包裹颜色输入框。
10. **改字号 / 字重 / 字体后文字溢出或留白** — 此前只更新高度，现同步重算宽与高。
11. **程序化选中后不出现手柄** — 通过右键菜单或面板按钮选中元素时主动刷新叠加层。
12. **文本编辑框与画布度量不一致** — 编辑框改为与 Konva 渲染态同源的排版度量（同一字体度量、行距与墨迹居中公式），反解内边距使 DOM 首行基线与画布对齐。

### 维护与规范

13. **插件审核规范复查** — 运行官方 `eslint-plugin-obsidianmd` 审核规则集，`0 error`。本轮清除了剩余的直接样式写入：画布光标改用 CSS 类（`trefoil-cursor-*`）切换，画布底色兜底变量改由 `styles.css` 按主题类提供（不再写 `element.style`），文本编辑框高度并入模板声明式绑定；同时把属性面板与设置面板中残留的静态内联样式改为 CSS 类。
14. **弹窗窗口兼容** — 计时器统一改为 `window.setTimeout` / `window.clearTimeout`，消除 29 处 `prefer-window-timers` 提示。
15. **文档** — 新增本更新日志；README 补齐中英双语功能说明与关键词；开发约定补充审核规则说明。

### 数据格式变更

新增（`trefoil:` 命名空间）：`fillOpacity`、`border`、`borderStyle`、`borderRadius`、`headStyle`、`tailStyle`、`fromNode`、`toNode`、`label`、`strokeStyle`、`caption`、`mapRoot`。
移除：`treeParent`、`collapsed`、`layout`。
旧文件向后兼容：缺失字段按默认值处理，镭射笔迹依旧永不落盘。

### English summary

**New features**

- **Line-like shapes (arrow / line / polyline):** endpoint snapping that binds an endpoint to another element (`trefoil:fromNode` / `trefoil:toNode`) and follows it; two bound endpoints render as a cubic Bezier; bound arrows freeze into plain lines when their target is deleted. Six independently selectable endpoint styles (none / solid arrow / hollow arrow / line arrow / dot / hollow dot, `trefoil:headStyle` / `trefoil:tailStyle`), a solid/dashed/dotted stroke style (`trefoil:strokeStyle`), per-vertex handles to reshape polylines, correct hit-testing after flipping, and automatic bounding-box tightening when opening older files.
- **Edges and relationship labels:** edges are now selectable (click to select, highlight, `Delete` to remove) and double-clicking an edge or segment opens an inline label editor (`label` for edges, `trefoil:label` for line shapes), also reachable from the context menu.
- **Text boxes:** optional solid border with color, line style, 0–48 radius and 1–40 width (`trefoil:border` / `trefoil:borderStyle` / `trefoil:borderRadius`); background fill with presets; width and height now hug the content (wrapping only past 480 px); the inline editor is fully WYSIWYG, so committing no longer shifts the canvas.
- **Images:** show/hide and customise an image caption (`trefoil:caption`), exported to SVG.
- **Containers:** background colour with its own opacity (default 10%) and corner radius (default 10, max 160) via `trefoil:fillOpacity` / `trefoil:borderRadius`; a new `paintOrder` keeps container backgrounds beneath their contents (canvas, SVG export and minimap all use it); the name plate keeps a constant on-screen size while zooming.
- **Arrange panel:** with 2+ elements selected, arrange them in a row, column, matrix (configurable per-row count) or ring (distribution, angle step, radius, start angle, direction, ordering), anchored by top-left edges or geometric centres; live preview while dragging, coalesced into a single undoable "Arrange" step.
- **Mind maps:** promote/demote a mind-map root (`trefoil:mapRoot`), `Tab` to add a child and `Enter` to add a sibling (new nodes inherit style and border and open in text editing), membership driven purely by `kind: 'mindmap'` edges, and smooth horizontal-tangent S-curve branches. The old container auto tree layout, collapse/expand and Web Worker layout pipeline were removed along with the `treeParent` / `collapsed` / `layout` fields.
- **Theme:** day / night / follow-system modes with a status-bar toggle and separate dark canvas, dot and grid colours; default text and stroke colours now follow theme flips.
- **Drawing aids:** `Shift` constrains proportions, `Alt` draws from the centre, `Shift+Alt` centres a regular shape; right-clicking while a drawing tool is active returns to the select tool.
- **SVG export** now covers container backgrounds and radii, text-box backgrounds and borders, endpoint styles and trimmed shafts, bound Bezier curves, image captions and mind-map branches, honouring `paintOrder`.

**Bug fixes**

Night-mode white patches (palette now derives the canvas colour from background settings); container backgrounds no longer cover their children; a Svelte effect loop that froze the whole UI and broke double-click editing; command hotkeys that globally swallowed `Ctrl+Z`; unreliable and lost slow double-clicks; background tabs mutating the whiteboard; misaligned hit-testing on flipped polylines; round line caps poking through arrow tips; stale preset colour swatches in the property panel; text overflow after font changes; missing overlays after programmatic selection; and mismatched text metrics between the inline editor and the canvas.

**Maintenance:** official Obsidian review rules report 0 errors; remaining direct style writes moved to CSS classes and theme variables; timers use `window.setTimeout` for popout-window compatibility; added this changelog and expanded the bilingual README.

---

## [1.0.1] - 2026-09-11

Obsidian 上架审核修复版。

### 错误修复

- **审核规范：直接写入元素样式** — 剪贴板临时宿主的 `element.style.cssText` 改为 CSS 类 `.trefoil-clipboard-host`；画布容器的 `style.touchAction` 改为 `App.svelte` 中的 `touch-action: none`（数位板笔/触摸拖动会被浏览器接管为滚动手势并触发 `pointercancel`，必须声明为应用自管）。
- **审核规范：`innerHTML`** — 系统剪贴板写入不再拼接 HTML 字符串，改为逐节点构造 DOM（`createElement` + `textContent`），转义交给 DOM。
- **低版本 Obsidian 兼容** — `revealLeaf` 自 Obsidian 1.7.2 才提供，新增 `revealLeafCompat` 在旧版本回退到 `setActiveLeaf`，与 manifest 声明的 `minAppVersion: 1.5.0` 保持一致。

### 维护与规范

- 引入 `eslint-plugin-obsidianmd`，并配置为只保留上架审核实际使用的规则集（`obsidianmd/*` + `no-unsanitized/*`）。

### English summary

Obsidian review-compliance release: replaced `element.style.cssText` with the `.trefoil-clipboard-host` CSS class and `style.touchAction` with a CSS rule; stopped building the clipboard host from an HTML string (per-node DOM construction instead); added `revealLeafCompat` so the plugin works on Obsidian versions before 1.7.2 as declared by `minAppVersion`; added the official `eslint-plugin-obsidianmd` review ruleset.

---

## [1.0.0] - 2026-09-06

首个公开版本。

### 功能

- **精确几何绘图** — 矩形、圆形/椭圆、菱形、三角形、箭头、直线/折线，全部为几何精确的矢量图形，不做手绘抖动风格。
- **文本系统** — 支持 Obsidian 内联 Markdown（加粗 / 斜体 / 代码 / 删除线），可配置字体（内置预设 + 系统字体 + 自定义）、字号、字重、颜色与对齐。
- **容器** — 可整体拖拽的智能积木块，容器内空白点击穿透至下层画布，子节点在文件中以相对坐标存储。
- **积木式交互** — 智能吸附与对齐参考线、磁吸网格、间距参考线、绑定组（编队）、图层顺序、形状翻转。
- **镭射笔与橡皮擦** — 独立临时图层、延迟淡出、**笔迹永不落盘**、动态半径橡皮擦（可撤销）。
- **画布背景与视图** — 纯色 / 点阵 / 双层级网格，正常 / 浏览 / 聚焦三种查看模式，深浅色主题适配。
- **导出** — PNG（可选透明背景、可选含笔迹）与 SVG 矢量导出。
- **Obsidian 集成** — `.canvas` 原生读写（JSON Canvas 1.1，扩展字段使用 `trefoil:` 前缀）、Ribbon 入口、命令面板、文件菜单、错误日志。

### English summary

First public release: precise geometric drawing (rectangle, ellipse, diamond, triangle, arrow, line/polyline), inline-Markdown text with configurable fonts, draggable containers with click-through interiors and relative child coordinates, smart snapping and alignment guides, binding groups, layer ordering, shape flipping, a non-persisted laser pointer with undoable eraser, solid/dot/dual-level-grid backgrounds, three view modes, PNG and SVG export, and native JSON Canvas 1.1 read/write with `trefoil:`-prefixed extensions.

---

[1.0.3]: https://github.com/Dyse-Sofqi/Trefoil/releases/tag/1.0.3
[1.0.2]: https://github.com/Dyse-Sofqi/Trefoil/releases/tag/1.0.2
[1.0.1]: https://github.com/Dyse-Sofqi/Trefoil/releases/tag/1.0.1
[1.0.0]: https://github.com/Dyse-Sofqi/Trefoil/releases/tag/1.0.0
