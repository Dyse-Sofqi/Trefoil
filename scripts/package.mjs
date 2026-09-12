#!/usr/bin/env node
/** 组装 Obsidian 插件发布包：dist/main.js + dist/styles.css + manifest.json + versions.json */
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const dist = resolve(root, 'dist');
const release = resolve(root, 'build/release');

if (!existsSync(resolve(dist, 'main.js'))) {
  console.error('[package] dist/main.js 不存在，请先运行 pnpm build');
  process.exit(1);
}

const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'));
const outDir = resolve(release, `trefoil-${manifest.version}`);
await mkdir(outDir, { recursive: true });

await cp(resolve(dist, 'main.js'), resolve(outDir, 'main.js'));
await cp(resolve(dist, 'styles.css'), resolve(outDir, 'styles.css'));
await cp(resolve(root, 'manifest.json'), resolve(outDir, 'manifest.json'));
await cp(resolve(root, 'versions.json'), resolve(outDir, 'versions.json'));

await writeFile(
  resolve(release, `trefoil-${manifest.version}.json`),
  JSON.stringify({ ok: true, version: manifest.version }, null, 2),
);

console.log(`[package] 已组装 → build/release/trefoil-${manifest.version}/`);
console.log('  main.js / styles.css / manifest.json / versions.json');
