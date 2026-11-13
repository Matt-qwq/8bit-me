/**
 * 主题定义（2026-09 重构：13 套 GB 主题 → 1 套身份 × 明暗两档，ADR-0021；
 * 2026-09-23 作者裁决：「不要浅色主题了」—— LIGHT 档退役，站点恒暗）。
 *
 * 设计主张：「夜晩房间」——站点的颜色从「窗外世界」的天空调色板采样
 * （src/lib/sky-palette.ts 的 SKY_FRAMES），窗外与窗内同源，天生一体：
 * - Dark（夜晚房间）：底色取夜空色带，正文取月光，强调取窗灯金——
 *   夜里唯一的暖色，就是窗外人家亮着的那盏灯。
 * 窗外世界（sky-scene）照旧跟随太阳晨昏变化——那不是「主题」，是窗外；
 * UI 恒暗，与窗外景色的时辰无关。
 *
 * 四槽语义（不再是 Game Boy 槽位，按角色命名）：
 * - bg     页面底色
 * - panel  卡片 / 面板底色（受光面）
 * - line   结构线 / 边框（大气透视的「地平线」）
 * - accent 强调色（单强调色纪律保留）
 * - text   正文 / 最亮结构色
 *
 * 加 / 改颜色只动本文件；global.css 与各组件自动跟随。
 */

/**
 * WCAG 相对亮度与对比度工具（纯函数，单测与 SideDock guard 共用）。
 */
function parseHex(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const v =
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h;
  return [
    parseInt(v.slice(0, 2), 16),
    parseInt(v.slice(2, 4), 16),
    parseInt(v.slice(4, 6), 16),
  ];
}

function channelLuminance(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** WCAG 2.1 相对亮度（0=黑, 1=白） */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex);
  return (
    0.2126 * channelLuminance(r) +
    0.7152 * channelLuminance(g) +
    0.0722 * channelLuminance(b)
  );
}

/** 两色对比度是否满足 ≥min（默认 4.5 = WCAG AA 正文阈值） */
export function meetsContrast(fg: string, bg: string, min = 4.5): boolean {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05) >= min;
}

export type ModeKey = 'dark';

export interface ModeColors {
  /** 页面底色 */
  readonly bg: string;
  /** 卡片 / 面板底色（受光面） */
  readonly panel: string;
  /** 结构线 / 边框 */
  readonly line: string;
  /** 强调色 */
  readonly accent: string;
  /** 正文 / 最亮结构色 */
  readonly text: string;
}

export interface ModeDef {
  readonly key: ModeKey;
  /** 开关按钮上的显示名 */
  readonly label: string;
  readonly desc: string;
  readonly colors: ModeColors;
}

/**
 * Dark —— 夜晚房间（唯一档；LIGHT 已退役，作者 2026-09-23「不要浅色主题了」）。
 * bg = 夜空色带（alt=-0.35 帧 bands[1] #0d1234 附近）；
 * panel = 室内一档（bands[3] #131a4c 收敛）；
 * text = 月光（sky-palette moon #e8ecf5）；
 * accent = 窗灯金（sky-palette windowLit #ffd27a）。
 */
export const DARK: ModeDef = {
  key: 'dark',
  label: 'DARK',
  desc: '夜晚 · 一盏窗灯',
  colors: {
    bg: '#0b102c',
    panel: '#202a5e', /* 室内一档：向夜空 band[4] #1a2264 靠拢但更亮（ΔL ≥ 0.02 可辨） */
    line: '#39437a',
    accent: '#ffd27a',
    text: '#e8ecf5',
  },
};

/** 单档（顺序数组仅为兼容遍历方；LIGHT 已退役） */
export const MODES: readonly ModeDef[] = [DARK];

/** 兼容存留：历史上是「无 data-mode / 脏数据」的兜底档，现在就是唯一档（data-mode 属性已不存在，这个函数只剩旧偏好静默失效的语义） */
export const DEFAULT_MODE: ModeKey = 'dark';

/** 兼容存留：历史上挡 localStorage 脏数据；旧偏好（light/auto）一律不认 */
export function isValidMode(value: unknown): value is ModeKey {
  return value === 'dark';
}

/** 兼容存留：任何 key 都回暗档（LIGHT 已退役） */
export function modeDef(key: string | null | undefined): ModeDef {
  return DARK;
}

/** 全站颜色契约自检（单测与 SideDock guard 共用）：正文 vs 底 / 正文 vs 面板全过 AA */
export function modeContrastOk(mode: ModeDef): boolean {
  return (
    meetsContrast(mode.colors.text, mode.colors.bg, 4.5) &&
    meetsContrast(mode.colors.text, mode.colors.panel, 4.5)
  );
}
