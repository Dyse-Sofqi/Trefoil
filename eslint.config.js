import tseslint from 'typescript-eslint';
import obsidianmd from 'eslint-plugin-obsidianmd';
import globals from 'globals';
import { globalIgnores } from 'eslint/config';

// Obsidian 上架审核（obsidian-release 自动扫描）实际会报的规则族：
//   obsidianmd/*            插件 API / UI 文案 / manifest 规则
//   no-unsanitized/*        innerHTML 等注入风险
//   eslint-comments/*       disable 注释必须带说明、不得禁用受限规则（审核会报「Required」）
//   @microsoft/sdl/*        document.write / innerHTML
//   no-useless-escape       正则里多余的转义（审核报过「Unnecessary escape character」）
// 官方 recommended 预设还捆了 typescript-eslint 的 type-checked 全集（no-unsafe-* /
// no-unnecessary-type-assertion 等），那批不属于审核范围，会把真正要修的问题淹没在噪音里。
const REVIEW_RULE_PREFIXES = ['obsidianmd/', 'no-unsanitized/', 'eslint-comments/', '@microsoft/sdl/'];
const REVIEW_RULES = ['no-useless-escape'];
const isReviewRule = (name) =>
  REVIEW_RULE_PREFIXES.some((p) => name.startsWith(p)) || REVIEW_RULES.includes(name);

const reviewBlocks = obsidianmd.configs.recommended.map((block) => ({
  ...block,
  rules: Object.fromEntries(Object.entries(block.rules ?? {}).filter(([name]) => isReviewRule(name))),
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
