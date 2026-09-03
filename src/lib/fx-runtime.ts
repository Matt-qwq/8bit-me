/**
 * fx-runtime —— canvas 特效运行时（fx runtime 控制器层，近纯：DOM 绑定集中于此）。
 * BgFx / CursorFx 共享底子：
 * - readPalette（--gb-0/--gb-2/--gb-3）+ additive 门控（唯一裁决点 = additiveFor(isDark(bg))，
 *   曾漂移：CursorFx 用 isDark(accent) 判门控致暗背景辉光被静默关闭，见 CONTEXT.md fx runtime 词条）
 * - dpr ≤1.5 clamp + canvas 尺寸 + setTransform
 * - [data-theme] MutationObserver 跟随（refresh → host.onTheme）
 * - visibilitychange 启停节流 + rAF 循环骨架（shouldRunFor 裁决）
 * 宿主（特效组件）只声明：getSize（尺寸来源）/ shouldRun（外部条件）/ frame（每帧绘制）/
 * onTheme（样式重算）/ onResize（同步尺寸）。粒子状态、绘制步、按钮与偏好接线留组件。
 * 单测：tests/unit/fx-runtime.spec.ts（纯决策函数；DOM 接线不测，node 环境无 DOM）。
 */

import { isDark, type Palette } from './palette';

/** dpr 钳制：≤1.5（性能约定，两特效与 Konami 一致） */
export function clampDpr(dpr: number): number {
  return Math.min(dpr || 1, 1.5);
}

/** additive 门控 —— 唯一裁决点：背景色 --gb-0 亮度 < 128 才允许辉光（浅色退回 source-over 防洗白） */
export function additiveFor(palette: Palette): boolean {
  return isDark(palette.bg);
}

/** 启停裁决：宿主外部条件（在视口/开关/指针在场）∧ 页面未隐藏 */
export function shouldRunFor(hostOk: boolean, hidden: boolean): boolean {
  return hostOk && !hidden;
}

export interface FxRuntimeHost {
  /** 画布尺寸来源（BgFx = 容器 rect；CursorFx = 视口） */
  getSize(): { width: number; height: number };
  /** 外部应跑条件（false = 停；页面隐藏由运行时并入） */
  shouldRun(): boolean;
  /** 每帧回调（ctx 已 setTransform(dpr)；宿主推进自身状态并绘制） */
  frame(ctx: CanvasRenderingContext2D): void;
  /** 主题变更：palette 与 additive 已重算后通知宿主重算样式 */
  onTheme(palette: Palette, additive: boolean): void;
  /** resize 完成：宿主同步尺寸并做播种等 */
  onResize(size: { width: number; height: number }): void;
}

export interface FxRuntime {
  readonly palette: Palette;
  readonly additive: boolean;
  resize(): void;
  sync(): void;
}

export function createFxRuntime(
  canvas: HTMLCanvasElement,
  host: FxRuntimeHost
): FxRuntime {
  const raw = canvas.getContext('2d');
  if (!raw) throw new Error('fx-runtime: canvas 2d context unavailable');
  const ctx: CanvasRenderingContext2D = raw;

  let palette: Palette = readPalette();
  let additive = additiveFor(palette);
  let w = 0;
  let h = 0;
  let running = false;
  let raf = 0;

  function readPalette(): Palette {
    const cs = getComputedStyle(document.documentElement);
    const g = (p: string) => cs.getPropertyValue(p).trim() || '#ffffff';
    return { bg: g('--gb-0'), accent: g('--gb-2'), light: g('--gb-3') };
  }

  /** 主题/配色重读（MutationObserver 触发） */
  function refresh(): void {
    palette = readPalette();
    additive = additiveFor(palette);
    host.onTheme(palette, additive);
  }

  function applySize(): void {
    const dpr = clampDpr(window.devicePixelRatio);
    const size = host.getSize();
    w = Math.max(1, Math.round(size.width));
    h = Math.max(1, Math.round(size.height));
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    host.onResize({ width: w, height: h });
  }

  function loop(): void {
    if (!running) return;
    host.frame(ctx);
    raf = requestAnimationFrame(loop);
  }

  function setRunning(v: boolean): void {
    if (running === v) return;
    running = v;
    if (v) raf = requestAnimationFrame(loop);
    else if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  }

  function sync(): void {
    setRunning(shouldRunFor(host.shouldRun(), document.hidden));
  }

  new MutationObserver(refresh).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });
  document.addEventListener('visibilitychange', sync);
  addEventListener('resize', () => applySize());

  return { palette, additive, resize: applySize, sync };
}

/** ctx 混合模式开关（additive 辉光 / source-over 防洗白） */
export function setAdditive(ctx: CanvasRenderingContext2D, on: boolean): void {
  ctx.globalCompositeOperation = on ? 'lighter' : 'source-over';
}