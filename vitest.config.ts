import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// obsidian 包只发布 .d.ts（运行时由宿主注入），vite 解析不到入口。
// 测试里把 'obsidian' 指向最小替身，让 ObsidianAdapter 这类宿主相关代码可单测。
const obsidianStub = fileURLToPath(new URL('./tests/stubs/obsidian.ts', import.meta.url));

export default defineConfig({
  resolve: {
    alias: { obsidian: obsidianStub },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
