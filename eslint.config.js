import tseslint from 'typescript-eslint';
import obsidianmd from 'eslint-plugin-obsidianmd';
import globals from 'globals';
import { globalIgnores } from 'eslint/config';

// 只保留 Obsidian 上架审核实际使用的规则（obsidianmd/* + no-unsanitized/*）。
// 官方 recommended 预设还捆绑了 typescript-eslint 的 type-checked 全集，
// 那批规则不属于审核范围，会把真正要修的问题淹没在噪音里。
const reviewBlocks = obsidianmd.configs.recommended.map((block) => ({
  ...block,
  rules: Object.fromEntries(
    Object.entries(block.rules ?? {}).filter(
      ([name]) => name.startsWith('obsidianmd/') || name.startsWith('no-unsanitized/'),
    ),
  ),
}));

export default tseslint.config(
  globalIgnores([
    // 依赖与构建产物
    'node_modules',
    'dist',
    'build',
    // 非插件运行时代码：本 lint 只覆盖审核关注的范围（src + dev）；
    // 测试与构建脚本由 tsc / vitest 负责，配置文件与 AI 元数据不参与审核
    'tests',
    'scripts',
    'vite.config.ts',
    'vitest.config.ts',
    '.workbuddy-ai',
    'svelte.config.js',
    'eslint.config.js',
    'package.json',
    'pnpm-lock.yaml',
    'versions.json',
    'tsconfig.json',
    'tsconfig.build.json',
  ]),
  {
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: {
        projectService: { allowDefaultProject: ['manifest.json'] },
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: ['.json'],
      },
    },
  },
  ...reviewBlocks,
);
