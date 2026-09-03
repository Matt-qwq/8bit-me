import { describe, expect, it } from 'vitest';
import { THEMES, DEFAULT_THEME, isValidTheme, meetsContrast } from '../../src/lib/themes';

describe('THEMES 单一数据源（CSS 色块 / 面板 / head 白名单三处共用）', () => {
  it('恰好 13 套主题', () => {
    expect(THEMES).toHaveLength(13);
  });
  it('key 全局唯一（否则 localStorage 脏数据会命中错主题）', () => {
    const keys = THEMES.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it('每套恰好 4 色且为合法 6 位 hex', () => {
    for (const t of THEMES) {
      expect(t.colors).toHaveLength(4);
      for (const c of t.colors) expect(c).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });
  it('DEFAULT_THEME 属于 THEMES（无记录时兜底必须存在）', () => {
    expect(THEMES.map((t) => t.key)).toContain(DEFAULT_THEME);
  });
});

describe('isValidTheme 白名单（防脏数据命中未知块）', () => {
  it('已知 key 通过', () => {
    expect(isValidTheme('gb-green')).toBe(true);
    expect(isValidTheme(DEFAULT_THEME)).toBe(true);
  });
  it('未知/空/非字符串一律拒绝', () => {
    expect(isValidTheme('hacker-x')).toBe(false);
    expect(isValidTheme('')).toBe(false);
    expect(isValidTheme(null)).toBe(false);
    expect(isValidTheme(undefined)).toBe(false);
    expect(isValidTheme(42)).toBe(false);
    expect(isValidTheme({})).toBe(false);
  });
});

describe('对比度契约（像素字笔画细，正文必须守 WCAG AA）', () => {
  it('每套主题正文(--gb-3) vs 底(--gb-0) 对比度 ≥ 4.5:1（AA）', () => {
    for (const t of THEMES) {
      expect(meetsContrast(t.colors[3], t.colors[0], 4.5), `${t.key} 正文对比度`).toBe(true);
    }
  });
  it('默认主题应冲 AAA 7:1（像素字漏光，越稳越好）', () => {
    const def = THEMES.find((t) => t.key === DEFAULT_THEME)!;
    expect(meetsContrast(def.colors[3], def.colors[0], 7)).toBe(true);
  });
});