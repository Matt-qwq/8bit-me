import { describe, expect, it } from 'vitest';
import {
  TRANS,
  toothForHeight,
  beamHeightFor,
  curtainHeightFor,
  curtainKeyframes,
  type TransDir,
} from '../../src/lib/trans-math';

describe('toothForHeight 极小屏钳制', () => {
  it('常规视口 = 16（08-28 深优验收细齿定稿值）', () => {
    expect(toothForHeight(768)).toBe(16);
    expect(toothForHeight(1080)).toBe(16);
    expect(toothForHeight(2560)).toBe(16);
  });
  it('H=320 → 13（min(16, max(8, round(13.33)))）', () => {
    expect(toothForHeight(320)).toBe(13);
  });
  it('H=240 → 10；H=100 → 8 封底', () => {
    expect(toothForHeight(240)).toBe(10);
    expect(toothForHeight(100)).toBe(8);
  });
});

describe('beamHeightFor 光束随齿等比 + 8px 封底', () => {
  it('t=16 → 10；t=13 → 8；t=8 → 8 封底', () => {
    expect(beamHeightFor(16)).toBe(10);
    expect(beamHeightFor(13)).toBe(8);
    expect(beamHeightFor(8)).toBe(8);
  });
});

describe('curtainHeightFor 对格 + 覆盖率', () => {
  const heights = [320, 375, 414, 768, 900, 1080, 1440, 2560];
  for (const H of heights) {
    it(`H=${H}: hFull 整齿对格、全覆盖视口、偏离名义覆盖 ≤ 半齿`, () => {
      const t = toothForHeight(H);
      const hFull = curtainHeightFor(H, t);
      expect(hFull % t, '永远对格').toBe(0);
      // 抗转屏露缝：对齐后允许最多偏离半齿（Math.round 的固有属性，非 bug）
      expect(hFull, '与名义 1.3× 覆盖偏离 ≤ 半齿').toBeGreaterThanOrEqual(
        H * TRANS.COVER - t / 2
      );
      expect(hFull, '全覆盖当前视口').toBeGreaterThanOrEqual(H);
      expect(hFull).toBeGreaterThanOrEqual(t);
    });
  }
  it('H=768: 对齐后 992 < 名义 998（得 62 齿而非 63，偏差 6px ≤ 半齿=8px）', () => {
    const t = toothForHeight(768); // 16
    expect(curtainHeightFor(768, t)).toBe(992);
  });
  it('H=1080, t=16 → 1408（1404/16 向上取整对格）', () => {
    expect(curtainHeightFor(1080, 16)).toBe(1408);
  });
});

describe('curtainKeyframes 变齿分段与步数守恒', () => {
  const cases: { dir: TransDir; steps: number }[] = [
    { dir: 'out', steps: 88 },
    { dir: 'in', steps: 88 },
    { dir: 'out', steps: 43 },
    { dir: 'in', steps: 2 },
    { dir: 'out', steps: 1 },
  ];
  for (const { dir, steps } of cases) {
    it(`${dir} steps=${steps}: 首末高度、两段步数守恒、变齿方向`, () => {
      const t = 16;
      const hFull = steps * t;
      const kf = curtainKeyframes(dir, hFull, steps, t);
      const start = dir === 'out' ? 0 : hFull;
      const end = dir === 'out' ? hFull : 0;
      expect(kf[0].height).toBe(`${start}px`);
      expect(kf[kf.length - 1].height).toBe(`${end}px`);
      if (kf.length === 3) {
        // 两段总步数守恒（nA + nB === steps）；前段比例为出 35% / 入 65%
        const segA = Number((kf[0].easing as string).match(/\d+/)?.[0] ?? 0);
        const segB = Number((kf[1].easing as string).match(/\d+/)?.[0] ?? 0);
        expect(segA + segB).toBe(steps);
        const fracA = dir === 'out' ? 0.35 : 0.65;
        expect(segA).toBe(Math.max(1, Math.round(steps * fracA)));
      }
    });
  }
  it('steps=1（nB<1）回退单段整齿', () => {
    const kf = curtainKeyframes('out', 16, 1, 16);
    expect(kf).toHaveLength(2);
    expect(kf[0].easing).toBe('steps(1)');
  });
});