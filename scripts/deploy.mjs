#!/usr/bin/env node
/** 手动同步：把 dist 构建产物复制到 Obsidian 测试库插件目录 */
import { copyFileSync, existsSync, mkdirSync, utimesSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const target = process.env.TREFOIL_VAULT ?? 'F:/_Workspace/Plugin-Test/.obsidian/plugins/trefoil';

const main = resolve(root, 'dist/main.js');
if (!existsSync(main)) {
  console.error('[deploy] dist/main.js 不存在，请先运行 pnpm build');
  process.exit(1);
}

mkdirSync(target, { recursive: true });
// 复制后把目标 mtime 刷新为当前时间（copyFileSync 会保留源 mtime，
// 内容未变时时间戳不变会让 hot-reload 检测不到部署）
const now = new Date();
for (const f of ['main.js', 'styles.css']) {
  copyFileSync(resolve(root, 'dist', f), resolve(target, f));
  utimesSync(resolve(target, f), now, now);
}
for (const f of ['manifest.json', 'versions.json']) {
  if (existsSync(resolve(root, f))) {
    copyFileSync(resolve(root, f), resolve(target, f));
    utimesSync(resolve(target, f), now, now);
  }
}
console.log(`[deploy] 已同步 → ${target}`);
console.log('[deploy] 在 Obsidian 中执行 Hot-Reload 或重载应用即可生效');
