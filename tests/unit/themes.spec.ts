/**
 * themes.spec —— 「夜晚房间」单档主题契约。
 * 旧 13 套主题的身份距离体系随 13 套主题一并退役；
 * 2026-09-23 作者裁决「不要浅色主题了」：LIGHT 档退役，站点恒暗。
 * 现在守的是：暗档对比度底线 + 从天空采样的同源性 + 单档结构。
 * 「跟随太阳」只属于窗外世界（sky-time / sky-scene），与 UI 主题无关。
 */
import { describe, it, expect } from 'vitest';
import {
  MODES,
  DARK,
  DEFAULT_MODE,
  isValidMode,
  modeDef,
  modeContrastOk,
  meetsContrast,
  relativeLuminance,
} from '../../src/lib/themes';
import { SKY_FRAMES } from '../../src/lib/sky-palette';

const hexToRgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(1, 3 + 2), 16),
  parseInt(hex.slice(5, 7), 16),
];

/** 亮度差 ΔL（0..1），用于「面板必须与底可辨」「线必须可见」类断言 */
const lumDelta = (a: string, b: string) =>
  Math.abs(relativeLuminance(a) - relativeLuminance(b));

describe('单档模式：结构契约', () => {  it('恰好一档：dark（LIGHT 已退役，作者 2026-09-23「不要浅色主题了」）', () => {
    expect(MODES.map((m) => m.key)).toEqual(['dark']);
  });

  it('默认档 = dark（夜晚房间）', () => {
    expect(DEFAULT_MODE).toBe('dark');
  });

  it('五槽齐全且为合法 hex', () => {
    for (const m of MODES) {
      for (const v of Object.values(m.colors)) {
        expect(v).toMatch(/^#[0-9a-fA-F]{6}$/);
      }
    }
  });

  it('isValidMode：只有 dark 算合法（旧 light/auto 偏好一律不认）；modeDef 任何 key 回暗档', () => {
    expect(isValidMode('dark')).toBe(true);
    expect(isValidMode('light')).toBe(false);
    expect(isValidMode('pico8-dusk')).toBe(false);
    expect(isValidMode(null)).toBe(false);
    expect(modeDef('light').key).toBe('dark');
    expect(modeDef('不知道什么').key).toBe(DEFAULT_MODE);
  });
});

describe('暗档的可读性底线（WCAG AA）', () => {
  it('正文 vs 底 / 正文 vs 面板 ≥ 4.5:1', () => {
    for (const m of MODES) {
      expect(modeContrastOk(m)).toBe(true);
    }
  });

  it('次级文字（text 84% 混底）vs 底 ≥ 4.5:1 —— 与 global.css 的 --color-text-dim 同口径', () => {
    // color-mix 模拟：84% text + 16% bg，逐通道线性混色（srgb 空间）
    // 2026-10-29：78% → 84%（impeccable 检测器在蓝面板上命中 gray-on-color）。
    // 两条都要守：84% 仍明显暗于正文（层级），且仍 ≥ 4.5:1（可读）。
    const dim = (m: typeof DARK) => {
      const t = hexToRgb(m.colors.text);
      const b = hexToRgb(m.colors.bg);
      const mix = t.map((c, i) => Math.round(c * 0.84 + b[i]! * 0.16));
      return `#${mix.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
    };
    for (const m of MODES) {
      expect(
        meetsContrast(dim(m), m.colors.bg, 4.5),
        `${m.key} 的 dim 文字跌破 AA`
      ).toBe(true);
      // 层级不塌：dim 必须比正文暗（否则「次级」名存实亡）
      expect(lumDelta(dim(m), m.colors.text), `${m.key} 的 dim 与正文已同级`).toBeGreaterThan(
        0.05
      );
    }
  });

  it('面板与底可辨（亮度差 ≥ 0.02）；结构线与底可辨（亮度差 ≥ 0.04）', () => {
    for (const m of MODES) {
      expect(
        lumDelta(m.colors.panel, m.colors.bg),
        `${m.key} 面板糊进底色`
      ).toBeGreaterThanOrEqual(0.02);
      expect(
        lumDelta(m.colors.line, m.colors.bg),
        `${m.key} 结构线不可见`
      ).toBeGreaterThanOrEqual(0.04);
    }
  });

  it('强调色 vs 底 ≥ 3:1（线/游标/技能条的最低可辨档）', () => {
    for (const m of MODES) {
      expect(
        meetsContrast(m.colors.accent, m.colors.bg, 3),
        `${m.key} 强调色太弱`
      ).toBe(true);
    }
  });
});

describe('从天空采样（同源性）', () => {
  /** 在 SKY_FRAMES 全部色值（含 bands 展平）里查找 */
  const allSkyColors = new Set<string>(
    SKY_FRAMES.flatMap((f) => [
      ...f.bands,
      f.sun,
      f.moon,
      f.windowLit,
      f.water,
      f.ridgeFar,
      f.ridgeNear,
      f.cloudHi,
      f.cloudLo,
      f.sunGlow,
    ])
  );

  it('暗档的 accent = 窗灯金 #ffd27a（sky-palette windowLit，夜里唯一的暖色）', () => {
    expect(DARK.colors.accent).toBe('#ffd27a');
    expect(allSkyColors.has(DARK.colors.accent)).toBe(true);
  });

  it('暗档的 text = 月光 #e8ecf5（sky-palette moon）', () => {
    expect(DARK.colors.text).toBe('#e8ecf5');
  });

  it('bg 落在夜空的明度域内（色带 + 云 = 这个世界全部的「亮」）', () => {
    const domain = SKY_FRAMES.flatMap((f) => [...f.bands, f.cloudHi]);
    const lums = domain.map(relativeLuminance);
    const min = Math.min(...lums);
    const max = Math.max(...lums);
    for (const m of MODES) {
      const l = relativeLuminance(m.colors.bg);
      // 允许 ±0.04 的收敛余量（室内蓝比色带略收敛是刻意的）
      expect(l).toBeGreaterThanOrEqual(min - 0.04);
      expect(l).toBeLessThanOrEqual(max + 0.04);
    }
  });
});

describe('单一数据源：global.css 不保留五槽字面量副本', () => {
  /** 背景（2026-09-23 单档化实测）：global.css 曾手写一份 :root 五槽色值兜底，
   *  与 themes.ts 漂移（--c-panel #141b42 vs #202a5e）且无人察觉 —— 两档时代
   *  `:root[data-mode]` 特异性恒压住它；单档后按级联顺序它反而赢了，
   *  e2e 的五槽断言当场红。修法 = 删副本，五槽只由 BaseLayout 注入块定义。 */
  it('global.css 里不再出现 --c-* 五槽的赋值（只有语义别名 var(--c-*)）', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const css = readFileSync(join(process.cwd(), 'src/styles/global.css'), 'utf-8');
    for (const slot of ['--c-bg', '--c-panel', '--c-line', '--c-accent', '--c-text']) {
      expect(
        css.match(new RegExp(`${slot.replace(/-/g, '\-')}\s*:`)),
        `global.css 不得再写死 ${slot}（颜色唯一数据源 = themes.ts → BaseLayout 注入块）`
      ).toBeNull();
      expect(css).toContain(`var(${slot})`); // 语义别名仍在
    }
  });
});
