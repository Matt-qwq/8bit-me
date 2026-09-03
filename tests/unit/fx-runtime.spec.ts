import { describe, expect, it } from 'vitest';
import {
  additiveFor,
  clampDpr,
  shouldRunFor,
} from '../../src/lib/fx-runtime';

const darkTheme = { bg: '#1D2B53', accent: '#FFA300', light: '#FFF1E8' };
const lightTheme = { bg: '#f7f2e8', accent: '#d93b2f', light: '#2a2a31' };

describe('additiveFor —— 门控唯一裁决点 = isDark(bg)（漂移修复语义）', () => {
  it('暗背景 + 亮 accent（pico8-dusk）→ true（按 bg，不按 accent；漂移案即 accent 误判）', () => {
    expect(additiveFor(darkTheme)).toBe(true);
  });
  it('浅背景（nes-punch）→ false', () => {
    expect(additiveFor(lightTheme)).toBe(false);
  });
});

describe('clampDpr（≤1.5 性能约定）', () => {
  it('2.5 → 1.5；1.5 → 1.5', () => {
    expect(clampDpr(2.5)).toBe(1.5);
    expect(clampDpr(1.5)).toBe(1.5);
  });
  it('1（常规）→ 1；0.5 → 0.5；0/undefined → 1（回退）', () => {
    expect(clampDpr(1)).toBe(1);
    expect(clampDpr(0.5)).toBe(0.5);
    expect(clampDpr(0)).toBe(1);
    expect(clampDpr(NaN)).toBe(1);
  });
});

describe('shouldRunFor —— 启停节流裁决（幂等谓词表）', () => {
  it('外部可跑 ∧ 页面可见 → true', () => {
    expect(shouldRunFor(true, false)).toBe(true);
  });
  it('页面隐藏 → false（无论外部）', () => {
    expect(shouldRunFor(true, true)).toBe(false);
    expect(shouldRunFor(false, true)).toBe(false);
  });
  it('外部不可跑 → false', () => {
    expect(shouldRunFor(false, false)).toBe(false);
  });
});