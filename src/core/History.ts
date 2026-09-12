/** 撤销/重做 —— 命令模式。镭射笔迹不纳入撤销栈。 */

export interface Command {
  label: string;
  undo(): void;
  redo(): void;
}

export class History {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  private limit = 200;
  onChanged?: () => void;

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  get undoLabel(): string | undefined {
    return this.undoStack[this.undoStack.length - 1]?.label;
  }

  get redoLabel(): string | undefined {
    return this.redoStack[this.redoStack.length - 1]?.label;
  }

  push(cmd: Command): void {
    this.undoStack.push(cmd);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
    this.onChanged?.();
  }

  /** 合并/替换栈顶命令（拖拽节流用） */
  replaceTop(cmd: Command): void {
    if (this.undoStack.length) this.undoStack[this.undoStack.length - 1] = cmd;
    else this.push(cmd);
    this.onChanged?.();
  }

  undo(): boolean {
    const cmd = this.undoStack.pop();
    if (!cmd) return false;
    cmd.undo();
    this.redoStack.push(cmd);
    this.onChanged?.();
    return true;
  }

  redo(): boolean {
    const cmd = this.redoStack.pop();
    if (!cmd) return false;
    cmd.redo();
    this.undoStack.push(cmd);
    this.onChanged?.();
    return true;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.onChanged?.();
  }
}
