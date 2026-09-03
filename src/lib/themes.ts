/**
 * 13 套主题定义（单一数据源，三处使用方）：
 * - BaseLayout 生成主题 CSS 色块（:root[data-theme="<key>"]{--gb-0..3}）
 * - ThemeToggle 面板（显示名 + 色板点）
 * - head 预挂载脚本的合法 key 白名单（isValidTheme / themeKeys，防 FOUC）
 *
 * 加新主题 = 在此数组追加一项即可，全局 CSS 与面板自动跟随，
 * 无需再改 global.css。持久化：themePref（键 '8bitme:theme'）。
 */

/**
 * WCAG 相对亮度与对比度工具（纯函数，单测与 SideDock guard 共用）。
 * 像素字笔画细、易"漏光"，故正文区强制守 AA(4.5:1)，建议冲 AAA(7:1)。
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

export interface ThemeDef {
  /** 主题 key（= CSS 选择器 [data-theme="…"] 与 localStorage 存储值） */
  readonly key: string;
  /** 面板主显示名 */
  readonly label: string;
  /** 中文描述（面板副行，dim 样式） */
  readonly desc: string;
  /** GB 四色（--gb-0..3 顺序，与 BaseLayout 生成的色块一致） */
  readonly colors: readonly [string, string, string, string];
}

/** 默认主题：无 data-theme / 无存储记录时生效（global.css :root 兜底） */
export const DEFAULT_THEME = 'sms-surf';

/** 13 套主题（label 与 docs/themes 预览一致） */
export const THEMES: readonly ThemeDef[] = [
  {
    key: 'gb-green',
    label: 'GB 绿',
    desc: 'Game Boy 原生绿',
    colors: ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'],
  },
  {
    key: 'pico8-dusk',
    label: 'PICO-8 Dusk',
    desc: '深夜开发机的霓虹余晖',
    colors: ['#1D2B53', '#5F574F', '#FFA300', '#FFF1E8'],
  },
  {
    key: 'sweetie16',
    label: 'Sweetie Sixteen',
    desc: '暖灯画室',
    colors: ['#1A1C2C', '#333C57', '#FFCD75', '#F4F4F4'],
  },
  {
    key: 'dawnbringer-ember',
    label: 'DawnBringer Ember',
    desc: '余烬铁匣',
    colors: ['#45283C', '#663931', '#DF7126', '#EEC39A'],
  },
  {
    key: 'nes-punch',
    label: 'NES Punch',
    desc: '红白冲击（浅色）',
    colors: ['#f7f2e8', '#efe7d3', '#b91d1d', '#2a2a31'],
  },
  {
    key: 'sms-surf',
    label: 'SMS Surf',
    desc: '世嘉蓝橙浪',
    colors: ['#0e1526', '#182337', '#3f86e6', '#e9edf7'],
  },
  {
    key: 'neogeo-gold',
    label: 'Neo Geo Gold',
    desc: '黑金街机',
    colors: ['#151207', '#221d10', '#d8a52c', '#f4ecd8'],
  },
  {
    key: 'inkpaper',
    label: 'Inkpaper',
    desc: '纸墨屏（明灰）',
    colors: ['#e8e6dd', '#dcd8c9', '#9e1a0f', '#141414'],
  },
  {
    key: 'amber-phosphor',
    label: 'Amber Phosphor',
    desc: '琥珀磷光',
    colors: ['#1a0f05', '#33200c', '#ff7a1a', '#ffb454'],
  },
  {
    key: 'mono-tube',
    label: 'Mono Tube',
    desc: '阴极单色（暗灰）',
    colors: ['#0a0a0a', '#202020', '#bfbfb8', '#f2f2ee'],
  },
  {
    key: 'midnight-arcade',
    label: 'Midnight Arcade',
    desc: '午夜街机',
    colors: ['#0b0b1a', '#16162e', '#ff2a6d', '#f4f1ff'],
  },
  {
    key: 'vapor-files',
    label: 'Vapor Files',
    desc: '紫雾档案',
    colors: ['#0d0221', '#1b0a36', '#ff71ce', '#f6f3ff'],
  },
  {
    key: 'sunset-racer',
    label: 'Sunset Racer',
    desc: '落日疾驰',
    colors: ['#120725', '#1d0b33', '#ff007f', '#fff4e8'],
  },
] as const;

/** 判断某值是否为已知主题 key（防止 localStorage 中的脏数据命中未知块） */
export function isValidTheme(value: unknown): value is string {
  return typeof value === 'string' && THEMES.some((t) => t.key === value);
}