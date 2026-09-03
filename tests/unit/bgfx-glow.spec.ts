import { describe, expect, it } from 'vitest';
import {
  GLOW,
  coreGlow,
  scrimCoverage,
  type GlowLayer,
  type GlowSlot,
} from '../../src/lib/bgfx-motion';

const slots = (ls: GlowLayer[]): GlowSlot[] => ls.map((l) => l.slot);
const core = (ls: GlowLayer[]): GlowLayer | undefined => ls.find((l) => l.grow === 0 && !l.compensation);
const halo = (ls: GlowLayer[]): GlowLayer[] => ls.filter((l) => l.grow > 0);

describe('coreGlow 白芯门控', () => {
  it('lit=0.92（常态信号包）出 --gb-3 白热芯', () => {
    // 信号包把所在段点亮到 0.92（BgFx.astro stepCore）
    const coreLayer = core(coreGlow(0.92, { kind: 'packet' }));
    expect(coreLayer?.slot).toBe('core');
  });

  it('lit=0.70（开机仪式峰值）不出白芯 —— 门控防回归', () => {
    // coreBoost() 开机仪式峰值 = 0.7：若门控被误删，2.5s 开机仪式会整板白热
    const ls = coreGlow(0.7, { kind: 'trace' });
    expect(ls.length).toBeGreaterThan(0); // 仍出蓝晕（仪式感保留）
    expect(core(ls)?.slot).toBe('accent');
    expect(slots(ls)).not.toContain('core');
  });

  it('门控边界：正好 0.85 不白热，越过才白热', () => {
    expect(core(coreGlow(GLOW.whiteGate, { kind: 'packet' }))?.slot).toBe('accent');
    expect(core(coreGlow(GLOW.whiteGate + 0.001, { kind: 'packet' }))?.slot).toBe('core');
  });

  it('lit=0.30（预热态）完全不出辉光', () => {
    // 未达辉光地板 → 调用方退回 dim / 预热处理
    expect(coreGlow(0.3, { kind: 'trace' })).toEqual([]);
    expect(coreGlow(GLOW.glowFloor, { kind: 'trace' })).toEqual([]);
  });
});

describe('coreGlow 几何约束（8px 网格）', () => {
  it('线状走线段不出外晕（px+4 会与邻线相糊）', () => {
    const grows = halo(coreGlow(0.92, { kind: 'trace' })).map((l) => l.grow);
    expect(grows).toEqual([GLOW.midGrow]); // 只有中晕
    expect(grows).not.toContain(GLOW.outerGrow);
  });

  it('点状信号包出两级晕，绘制顺序外→中→芯', () => {
    const ls = coreGlow(0.92, { kind: 'packet' });
    expect(halo(ls).map((l) => l.grow)).toEqual([GLOW.outerGrow, GLOW.midGrow]);
    expect(ls[ls.length - 1]?.grow).toBe(0); // 芯最后画（叠在晕之上）
  });

  it('所有层 alpha 落在 (0,1]，且芯最亮', () => {
    for (const lit of [0.51, 0.7, 0.85, 0.92, 1]) {
      const ls = coreGlow(lit, { kind: 'packet' });
      for (const l of ls) {
        expect(l.alpha).toBeGreaterThan(0);
        expect(l.alpha).toBeLessThanOrEqual(1);
      }
      const c = core(ls)!;
      for (const h of halo(ls)) expect(c.alpha).toBeGreaterThan(h.alpha);
    }
  });
});

describe('coreGlow 抗 scrim 压暗补偿', () => {
  it('scrim=0（hero 免遮区）不补画，scrim=1 多一层补偿', () => {
    const bare = coreGlow(0.92, { kind: 'packet', scrim: 0 });
    const full = coreGlow(0.92, { kind: 'packet', scrim: 1 });
    expect(bare.some((l) => l.compensation)).toBe(false);
    expect(full.length).toBe(bare.length + 1);
    expect(full[full.length - 1]?.compensation).toBe(true);
  });

  it('补偿 alpha 随 scrim 覆盖度线性（翻页时无亮度突跳）', () => {
    const at = (scrim: number) =>
      coreGlow(0.92, { kind: 'packet', scrim }).find((l) => l.compensation)?.alpha ?? 0;
    expect(at(0.25)).toBeCloseTo(at(1) / 4, 6);
    expect(at(0.5)).toBeCloseTo(at(1) / 2, 6);
    expect(at(0)).toBe(0);
  });

  it('补偿层与芯同色槽、同宽度（只提亮不改形）', () => {
    const ls = coreGlow(0.92, { kind: 'packet', scrim: 1 });
    const c = core(ls)!;
    const comp = ls.find((l) => l.compensation)!;
    expect(comp.slot).toBe(c.slot);
    expect(comp.grow).toBe(c.grow);
    expect(comp.alpha).toBeLessThan(c.alpha);
  });
});

describe('scrimCoverage', () => {
  it('content 模式（blog/文章）整页覆盖 → 恒 1', () => {
    expect(scrimCoverage(0, 800, false)).toBe(1);
    expect(scrimCoverage(9999, 800, false)).toBe(1);
  });

  it('hero-vivid（index）随滚动 0 → 1 线性，并钳在 [0,1]', () => {
    expect(scrimCoverage(0, 800, true)).toBe(0);
    expect(scrimCoverage(400, 800, true)).toBeCloseTo(0.5, 6);
    expect(scrimCoverage(800, 800, true)).toBe(1);
    expect(scrimCoverage(2000, 800, true)).toBe(1);
    expect(scrimCoverage(-100, 800, true)).toBe(0);
  });

  it('viewportH 为 0 时不产生 NaN/Infinity', () => {
    expect(Number.isFinite(scrimCoverage(100, 0, true))).toBe(true);
  });
});
