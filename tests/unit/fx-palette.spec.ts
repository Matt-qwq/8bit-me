import { describe, expect, it } from 'vitest';
import { DARK_THRESHOLD, hexToRgba, isDark } from '../../src/lib/palette';

describe('hexToRgba（#rrggbb → rgba()）', () => {
  it('pico8-dusk bg #1D2B53 a=0.22 → rgba(29,43,83,0.22)', () => {
    expect(hexToRgba('#1D2B53', 0.22)).toBe('rgba(29,43,83,0.22)');
  });
  it('全白 a=1 → rgba(255,255,255,1)', () => {
    expect(hexToRgba('#ffffff', 1)).toBe('rgba(255,255,255,1)');
  });
  it('全黑 a=0 → rgba(0,0,0,0)', () => {
    expect(hexToRgba('#000000', 0)).toBe('rgba(0,0,0,0)');
  });
  it('强调色 pico8-dusk accent #FFA300 a=0.5', () => {
    expect(hexToRgba('#FFA300', 0.5)).toBe('rgba(255,163,0,0.5)');
  });
});

describe('isDark（加权亮度 < 128 = 深色）', () => {
  it('暗背景 #1D2B53 → true', () => {
    expect(isDark('#1D2B53')).toBe(true);
  });
  it('全黑 → true', () => {
    expect(isDark('#000000')).toBe(true);
  });
  it('全白 → false', () => {
    expect(isDark('#ffffff')).toBe(false);
  });
  it('浅背景 nes-punch bg #f7f2e8 → false', () => {
    expect(isDark('#f7f2e8')).toBe(false);
  });
  it('#909090（亮度 144）> 阈值 → false', () => {
    expect(isDark('#909090')).toBe(false);
  });
  it('#7f7f7f（亮度 127）< 阈值 → true', () => {
    expect(isDark('#7f7f7f')).toBe(true);
  });
  it('pico8-dusk accent #FFA300（亮度≈172）→ false —— 漂移案证据：accent 不作门控', () => {
    expect(isDark('#FFA300')).toBe(false);
  });
});

it('DARK_THRESHOLD = 128（语义常数，防误改）', () => {
  expect(DARK_THRESHOLD).toBe(128);
});