import { mount } from 'svelte';
import App from '../src/app/App.svelte';
import { DevAdapter } from './DevAdapter';
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
