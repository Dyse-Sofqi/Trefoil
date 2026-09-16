# Trefoil 开发约定（AGENTS.md）

Obsidian 白板插件「思考的可视化工作台」。技术栈：TypeScript + Svelte 5 (Runes) + Konva.js + Vite。

## 核心工作流（每次完成代码修改后必须执行）

1. **构建并同步**：`pnpm build`（类型检查 + 构建 + **自动同步到 Obsidian 测试库** `F:\_Workspace\Plugin-Test\.obsidian\plugins\trefoil\`）
2. **用户在 Obsidian 中实时测试**：测试库装有 hot-reload 插件，构建后执行 Hot-Reload（或 `Ctrl+P` → 重载应用）即可加载最新版本。
3. 仅同步构建产物：`main.js` / `styles.css` / `manifest.json` / `versions.json` 四个文件；**不要**把源码工程或 node_modules 复制进 plugins 目录。
4. 纯构建同步可用 `pnpm deploy`；持续增量构建用 `pnpm watch`（每次重编译自动同步）。

## 常用命令

- `pnpm dev` — 浏览器开发测试台 http://localhost:5198/dev/（无 Obsidian 依赖，localStorage 持久化）
- `pnpm test` — vitest 单元测试
- `pnpm build` — 类型检查 + 构建 + 自动部署到测试库
- `pnpm package` — 组装发布包到 build/release/trefoil-{version}/
- 环境变量：`TREFOIL_VAULT=<路径>` 覆盖同步目标；`TREFOIL_NO_DEPLOY=1` 跳过同步。

## 架构速览

- 分层：Obsidian 插件层 (`src/main.ts`, `src/obsidian/`) → UI 视图层 (`src/app/` Svelte) → 渲染引擎层 (`src/engine/` Konva) → 核心业务层 (`src/core/`) → Worker (`src/workers/`) → 数据持久层 (`src/data/` JSON Canvas)
- 工具独立成类经 `ToolManager` 注册；Svelte 与 Konva 通过事件总线 / Runes 状态通信
- 数据格式：JSON Canvas 1.1，扩展字段 `trefoil:` 前缀；容器子节点文件内相对坐标；镭射笔迹永不落盘
- 修改核心逻辑后先 `pnpm test`；涉及交互的修改建议同时在 `pnpm dev` 测试台验证

## 已知注意事项

- 插件构建为单文件 CJS（`vite build` lib 模式）；**禁止在插件代码中使用动态 `import()`**（会产生分块文件破坏 Obsidian 加载），Web Worker 用 `?worker&inline` 内联。
- pnpm 如报 ignored build scripts（esbuild），package.json 已含 `pnpm.onlyBuiltDependencies` 白名单。
- Obsidian 测试库路径：`F:\_Workspace\Plugin-Test`；插件 id：`trefoil`。
