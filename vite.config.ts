import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { copyFileSync, existsSync, mkdirSync, utimesSync } from 'node:fs';
import { resolve } from 'node:path';

/** 构建完成后自动同步插件到 Obsidian 测试库（配合 hot-reload 插件实时测试） */
function deployToVault(): Plugin {
  const target = process.env.TREFOIL_VAULT ?? 'F:/_Workspace/Plugin-Test/.obsidian/plugins/trefoil';
  return {
    name: 'trefoil-deploy-to-vault',
    apply: 'build',
    closeBundle() {
      if (process.env.TREFOIL_NO_DEPLOY) return;
      try {
        mkdirSync(target, { recursive: true });
        // 复制后刷新目标 mtime 为当前时间：copyFileSync 保留源 mtime，
        // 内容未变（如 manifest）时时间戳不变会让 hot-reload 检测不到部署
        const now = new Date();
        for (const f of ['main.js', 'styles.css']) {
          const src = resolve(__dirname, 'dist', f);
          if (existsSync(src)) {
            copyFileSync(src, resolve(target, f));
            utimesSync(resolve(target, f), now, now);
          }
        }
        for (const f of ['manifest.json', 'versions.json']) {
          if (existsSync(resolve(__dirname, f))) {
            copyFileSync(resolve(__dirname, f), resolve(target, f));
            utimesSync(resolve(target, f), now, now);
          }
        }
        console.log(`[trefoil] 已同步到 Obsidian 测试库 → ${target}`);
      } catch (err) {
        console.warn('[trefoil] 同步测试库失败（构建产物不受影响）:', err instanceof Error ? err.message : err);
      }
    },
  };
}

// Obsidian 插件构建：单入口 CJS(main.js) + styles.css
// 开发调试走 `vite dev`（dev/index.html 无 Obsidian 依赖的独立测试台）。
export default defineConfig(({ command }) => {
  if (command === 'serve') {
    return {
      plugins: [svelte()],
      server: { port: 5198 },
      build: { target: 'es2022' },
    };
  }
  return {
    plugins: [svelte(), deployToVault()],
    build: {
      target: 'es2022',
      lib: {
        entry: resolve(__dirname, 'src/main.ts'),
        formats: ['cjs'],
        fileName: () => 'main.js',
      },
      rollupOptions: {
        external: ['obsidian'],
        output: {
          entryFileNames: 'main.js',
          assetFileNames: 'styles.css',
          exports: 'named',
        },
      },
      minify: false,
      sourcemap: false,
    },
    define: {
      'process.env.NODE_ENV': JSON.stringify('production'),
    },
  };
});
