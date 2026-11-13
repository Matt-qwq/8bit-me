import { describe, expect, it } from 'vitest';
import {
  bootAlt,
  BOOT_ALT,
  fallbackAnchors,
  phaseLabel,
  saneAnchors,
  skyMoment,
  sunAltAt,
} from '../../src/lib/sky-time';

/** 2026-09-21 本地某时刻（构造器取本机时区，与实现同口径） */
const at = (h: number, m = 0) => new Date(2026, 8, 21, h, m).getTime();
const ANCHORS = { sunriseMs: at(6, 30), sunsetMs: at(18, 30) };

describe('sunAltAt：日弧/夜弧正弦', () => {
  it('正午日弧中点 alt = 1', () => {
    expect(sunAltAt(at(12, 30), ANCHORS)).toBeCloseTo(1, 5);
  });
  it('午夜夜弧中点 alt = -1', () => {
    expect(sunAltAt(at(0, 30), ANCHORS)).toBeCloseTo(-1, 5);
  });
  it('日出 / 日落恰在地平线（alt ≈ 0）', () => {
    expect(Math.abs(sunAltAt(at(6, 30), ANCHORS))).toBeLessThan(1e-9);
    expect(Math.abs(sunAltAt(at(18, 30), ANCHORS))).toBeLessThan(1e-9);
  });
  it('上午为正、凌晨为负', () => {
    expect(sunAltAt(at(10), ANCHORS)).toBeGreaterThan(0.4);
    expect(sunAltAt(at(3), ANCHORS)).toBeLessThan(-0.3);
  });
  it('全天连续：相邻分钟 |Δalt| < 0.01（晨昏漂移无跳变）', () => {
    for (let m = 0; m < 24 * 60; m += 7) {
      const a = sunAltAt(at(0) + m * 60e3, ANCHORS);
      const b = sunAltAt(at(0) + (m + 1) * 60e3, ANCHORS);
      expect(Math.abs(a - b)).toBeLessThan(0.01);
    }
  });
});

describe('anchors：近似与校验', () => {
  it('fallbackAnchors = 本地 6:30 / 18:30', () => {
    const a = fallbackAnchors(at(15));
    expect(new Date(a.sunriseMs).getHours()).toBe(6);
    expect(new Date(a.sunsetMs).getHours()).toBe(18);
  });
  it('脏数据（日落 ≤ 日出 / 昼长 30h）回退近似值', () => {
    const bad = { sunriseMs: at(18), sunsetMs: at(6) };
    const fixed = saneAnchors(bad, at(15));
    expect(fixed.sunsetMs).toBeGreaterThan(fixed.sunriseMs);
  });
});

describe('skyMoment：绘制层唯一输入', () => {
  it('正午：daylight=1 / starlight=0 / 太阳可见', () => {
    const m = skyMoment(at(12, 30), ANCHORS);
    expect(m.daylight).toBe(1);
    expect(m.starlight).toBe(0);
    expect(m.sunX).toBeCloseTo(0.5, 1);
    expect(m.sunY).toBeGreaterThan(0.9);
    expect(m.moonX).toBe(-1);
  });
  it('深夜：starlight=1 / 月亮可见 / 太阳在地平线下', () => {
    const m = skyMoment(at(0, 30), ANCHORS);
    expect(m.daylight).toBe(0);
    expect(m.starlight).toBe(1);
    expect(m.sunX).toBe(-1);
    expect(m.moonX).toBeCloseTo(0.5, 1);
    expect(m.moonY).toBeGreaterThan(0.9);
  });
  it('暮光带：starlight 介于 0..1 之间（渐暗不突变）', () => {
    const m = skyMoment(at(18, 42), ANCHORS);
    expect(m.starlight).toBeGreaterThan(0);
    expect(m.starlight).toBeLessThan(1);
  });
});

describe('bootAlt：首访点亮仪式', () => {
  it('p=0 在深夜地板，p=1 到真实值', () => {
    expect(bootAlt(0.9, 0)).toBe(BOOT_ALT);
    expect(bootAlt(0.9, 1)).toBeCloseTo(0.9, 10);
  });
  it('中途单调插值', () => {
    const mid = bootAlt(0.9, 0.5);
    expect(mid).toBeGreaterThan(BOOT_ALT);
    expect(mid).toBeLessThan(0.9);
  });
});

describe('phaseLabel：实况读数晨昏标签', () => {
  it('四档边界', () => {
    expect(phaseLabel(0.9)).toBe('DAY');
    expect(phaseLabel(0.1)).toBe('DAWN');
    expect(phaseLabel(-0.08)).toBe('DUSK');
    expect(phaseLabel(-0.5)).toBe('NIGHT');
  });
});

// ===================== 月相：阴晴圆缺（2026-09-21 作者提出） =====================

import { moonLitRow, moonPhase, SYNODIC_MS } from '../../src/lib/sky-time';

describe('moonPhase：从真实时钟推出月相', () => {
  it('值域 [0,1) 且确定', () => {
    for (let i = 0; i < 200; i++) {
      const p = moonPhase(i * 977_000_000);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThan(1);
      expect(moonPhase(i * 977_000_000)).toBe(p);
    }
  });
  it('周期性：一个朔望月之后回到同相', () => {
    const t = Date.UTC(2026, 8, 21, 4, 0);
    expect(moonPhase(t + SYNODIC_MS)).toBeCloseTo(moonPhase(t), 10);
  });
  it('参考纪元处是新月（0 附近）', () => {
    const p = moonPhase(NEW_MOON_EPOCH_MS);
    expect(p < 0.01 || p > 0.99).toBe(true);
  });
});

import { NEW_MOON_EPOCH_MS } from '../../src/lib/sky-time';

describe('moonLitRow：受光区几何（明暗界线与盘共弦）', () => {
  const R = 11;
  it('满月（0.5）全盘受光，新月（0）不可见', () => {
    const [x0, x1] = moonLitRow(0, R, 0.5)!;
    expect(x0).toBe(-R);
    expect(x1).toBe(R);
    expect(moonLitRow(0, R, 0)).toBeNull();
  });
  it('上弦右半受光、下弦左半受光（北半球：盈右亏左），宽度同为半弦', () => {
    const wax = moonLitRow(0, R, 0.25)!;
    const wan = moonLitRow(0, R, 0.75)!;
    expect(wax[1] - wax[0]).toBe(wan[1] - wan[0]); // 受光宽度同为半弦
    expect(wax[0]).toBe(0); // 盈月从月心向右亮
    expect(wan[1]).toBe(0); // 亏月亮到月心为止
  });
  it('娥眉月窄、盈亏对称（ph 与 1−ph 受光宽度相等），细弦亮侧贴各自缘', () => {
    for (const ph of [0.08, 0.12]) {
      const wax = moonLitRow(0, R, ph)!;
      const wan = moonLitRow(0, R, 1 - ph)!;
      expect(wax[1] - wax[0]).toBe(wan[1] - wan[0]);
      expect(wax[0], '盈月娥眉亮在右缘：受光区起点在正半轴').toBeGreaterThan(0);
      expect(wan[1], '亏月娥眉亮在左缘：受光区终点在负半轴').toBeLessThan(0);
    }
    // 盈凸月（>0.25）：受光跨过月心向左推，但右缘永远亮着
    const gib = moonLitRow(0, R, 0.35)!;
    expect(gib[1]).toBe(R);
    expect(gib[0]).toBeLessThan(0);
  });
  it('受光宽度随相位单调不减（新月→满月），行弦外返 null', () => {
    let prev = 0;
    for (let ph = 0.08; ph < 0.5; ph += 0.05) {
      const w = moonLitRow(0, R, ph)!;
      expect(w[1] - w[0], `ph=${ph} 应比上一档更宽（或持平）`).toBeGreaterThanOrEqual(prev);
      prev = w[1] - w[0];
    }
    expect(moonLitRow(R + 1, R, 0.5)).toBeNull();
  });
  it('整数像素（像素语言）', () => {
    for (let dy = -R; dy <= R; dy++) {
      for (const ph of [0.2, 0.5, 0.8]) {
        const s = moonLitRow(dy, R, ph);
        if (s) {
          expect(Number.isInteger(s[0])).toBe(true);
          expect(Number.isInteger(s[1])).toBe(true);
        }
      }
    }
  });
});
