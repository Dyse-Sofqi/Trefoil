/**
 * 插件内错误捕获：把 Obsidian 渲染进程的 window.error / unhandledrejection /
 * console.error 落盘到插件目录 console.log，供外部（开发流程）直接读取诊断。
 */
import type { Plugin } from 'obsidian';

const MAX_LOG_BYTES = 256 * 1024;

function fmtArg(arg: unknown): string {
  if (arg instanceof Error) {
    return arg.stack ?? `${arg.name}: ${arg.message}`;
  }
  if (typeof arg === 'object' && arg !== null) {
    try {
      return JSON.stringify(arg);
    } catch {
      return String(arg);
    }
  }
  return String(arg);
}

export class ErrorLogger {
  private buf: string[] = [];
  private flushTimer: number | null = null;
  private recording = false;
  private readonly origError: (...args: unknown[]) => void;

  private readonly onError = (e: ErrorEvent) => {
    this.record('window.error', e.message, e.error instanceof Error ? e.error.stack : undefined);
  };
  private readonly onRejection = (e: PromiseRejectionEvent) => {
    this.record('unhandledrejection', fmtArg(e.reason));
  };

  constructor(private plugin: Plugin) {
    this.origError = console.error.bind(console);
  }

  get path(): string {
    return `${this.plugin.manifest.dir}/console.log`;
  }

  async install(): Promise<void> {
    window.addEventListener('error', this.onError);
    window.addEventListener('unhandledrejection', this.onRejection);
    console.error = (...args: unknown[]) => {
      if (!this.recording) {
        this.record('console.error', args.map(fmtArg).join(' '));
      }
      this.origError(...args);
    };
    await this.truncateIfOversized();
    this.record('info', `logger installed (plugin ${this.plugin.manifest.version})`);
  }

  uninstall(): void {
    window.removeEventListener('error', this.onError);
    window.removeEventListener('unhandledrejection', this.onRejection);
    console.error = this.origError;
    void this.flush();
  }

  /** 供插件各处主动记录 */
  log(source: string, message: string): void {
    this.record(source, message);
  }

  private record(source: string, message: string, stack?: string): void {
    const ts = new Date().toISOString().slice(11, 23);
    this.buf.push(`[${ts}][${source}] ${message}`);
    if (stack) this.buf.push(stack);
    if (this.flushTimer) window.clearTimeout(this.flushTimer);
    this.flushTimer = window.setTimeout(() => void this.flush(), 300);
  }

  private async flush(): Promise<void> {
    if (this.flushTimer) {
      window.clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (!this.buf.length || this.recording) return;
    this.recording = true;
    const text = this.buf.join('\n') + '\n';
    this.buf = [];
    try {
      const adapter = this.plugin.app.vault.adapter;
      await adapter.append(this.path, text);
    } catch (err) {
      // 写日志失败只能回退到原控制台，避免递归
      this.origError('[trefoil] 写入诊断日志失败', err);
    } finally {
      this.recording = false;
    }
  }

  private async truncateIfOversized(): Promise<void> {
    try {
      const adapter = this.plugin.app.vault.adapter;
      if (!(await adapter.exists(this.path))) return;
      const stat = await adapter.stat(this.path);
      if (stat && stat.size > MAX_LOG_BYTES) {
        const text = await adapter.read(this.path);
        await adapter.write(this.path, text.slice(-64 * 1024));
      }
    } catch {
      /* 忽略 */
    }
  }
}
