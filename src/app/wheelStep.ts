/**
 * 数值控件（滑块 / 数字框）的滚轮微调。
 * - 步进方式与步长来自设置里的「滚轮步进」（固定数值 / 当前值的百分比，见 defaults.ts）。
 * - 鼠标滚轮一格走一步；触控板的小增量累积到阈值再走一步，避免轻轻一划数值就飞掉。
 */
import { settings } from './ui.svelte';

/** 控件性质：比例类（透明度、浓度…）默认按百分比步进，其余按固定数值 */
export type StepKind = 'value' | 'percent';

/** 累积多少滚轮单位算一步（鼠标一格 deltaY 约 100） */
const STEP_UNITS = 40;

export function createWheelStepper(): (e: WheelEvent) => number {
  let acc = 0;
  return (e: WheelEvent): number => {
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1; // 行 / 页 → 像素
    const raw = e.deltaY * unit;
    if (!Number.isFinite(raw) || raw === 0) return 0;
    // 单独一格（或大增量）直接走一步，不留下余量被下一格叠成两步
    if (Math.abs(raw) >= STEP_UNITS) {
      acc = 0;
      return raw > 0 ? -1 : 1;
    }
    acc = Math.max(-STEP_UNITS, Math.min(STEP_UNITS, acc + raw));
    if (Math.abs(acc) >= STEP_UNITS) {
      acc = 0;
      return raw > 0 ? -1 : 1;
    }
    return 0;
  };
}

/** 实际生效的步进方式（auto 时按控件性质取值） */
export function effectiveStepKind(kind: StepKind): StepKind {
  const mode = settings.wheelStep.mode;
  return mode === 'auto' ? kind : mode;
}

/** 一格的步进量（正数） */
export function stepSize(kind: StepKind, current: number): number {
  const w = settings.wheelStep;
  return kind === 'percent' ? Math.abs(current) * (w.percent / 100) : w.value;
}

/**
 * Svelte action：悬停在数值控件（range / number）上滚轮微调。
 * 直接改 DOM 值并派发 input 事件，交给控件自身的绑定与处理逻辑落盘，
 * 因此对所有数值控件通用，无需逐个接线；min/max/step 直接读元素属性。
 */
export function wheelAdjust(node: HTMLInputElement, params: { kind?: StepKind } = {}) {
  let kind: StepKind = params.kind ?? 'value';
  const stepper = createWheelStepper();

  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const steps = stepper(e);
    if (!steps) return;
    const min = node.min === '' ? -Infinity : Number(node.min);
    const max = node.max === '' ? Infinity : Number(node.max);
    const cur = Number(node.value);
    if (!Number.isFinite(cur)) return;
    const stepAttr = Math.abs(Number(node.step)) || 0; // 未声明时 number/range 默认 1
    const delta = stepSize(effectiveStepKind(kind), cur) * steps;
    let next = Math.min(max, Math.max(min, cur + delta));
    if (stepAttr > 0) {
      // range 的合法值只能落在 min + n*step 上，先对齐网格；对齐后没动则至少挪一格
      const base = min === -Infinity ? 0 : min;
      next = base + Math.round((next - base) / stepAttr) * stepAttr;
      if (next === cur) next = Math.min(max, Math.max(min, cur + (steps > 0 ? stepAttr : -stepAttr)));
      next = Math.round(next * 1e6) / 1e6; // 抹掉步长累加的浮点误差（如 0.1+0.2）
    } else {
      next = Math.round(next * 1000) / 1000;
    }
    if (!Number.isFinite(next) || next === cur) return;
    node.value = String(next);
    node.dispatchEvent(new Event('input', { bubbles: true }));
  };

  node.addEventListener('wheel', onWheel);
  return {
    update(p: { kind?: StepKind } = {}) {
      kind = p.kind ?? 'value';
    },
    destroy() {
      node.removeEventListener('wheel', onWheel);
    },
  };
}
