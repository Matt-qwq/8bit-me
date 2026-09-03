/**
 * palette —— 主题色纯函数库（fx runtime 的取色/判定层，零 DOM）。
 * BgFx / CursorFx 共享：hex→rgba、暗度判定。
 * additive 门控语义 = 背景色 --gb-0 亮度 < DARK_THRESHOLD（浅色退回 source-over 防洗白）；
 * 单一裁决点，见 fx-runtime.ts 的 additiveFor()（曾漂移：CursorFx 用 isDark(accent) 判门控，见 CONTEXT.md fx runtime 词条）。
 * 单测：tests/unit/fx-palette.spec.ts。
 */

/** 背景亮度阈值：< 128 = 深色 → 允许 additive 辉光 */
export const DARK_THRESHOLD = 128;

/** #rrggbb → rgba() 字符串（a 原样透传） */
export function hexToRgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** 亮度判定：加权亮度 < DARK_THRESHOLD 视为深色 */
export function isDark(hex: string): boolean {
  const n = parseInt(hex.slice(1), 16);
  const lum = ((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114;
  return lum < DARK_THRESHOLD;
}

/** 主题三色（--gb-0/--gb-2/--gb-3，见 readPalette 与 themes.ts） */
export interface Palette {
  bg: string;
  accent: string;
  light: string;
}