import { mount } from 'svelte';
import App from '../src/app/App.svelte';
import { DevAdapter } from './DevAdapter';
// 让测试台也加载插件的全局样式（与 Obsidian 里 dist/styles.css 一致）
import '../src/styles.css';
import './dev.css';

const app = mount(App, {
  target: document.getElementById('app')!,
  props: {
    adapter: new DevAdapter(),
    onAppReady: (a: unknown) => {
      (window as unknown as Record<string, unknown>).__app = a;
    },
  },
});

export default app;
