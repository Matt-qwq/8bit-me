import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lerpHex } from '../../src/lib/sky-palette';
import type { Palette } from '../../src/lib/palette';
import {
  frameProfile,
  frost,
  glassTint,
  indoorReflection,
  reflectionLayers,
  mistGlass,
  moonSpill,
  wallFace,
  wallLit,
  sunlitFrame,
  warmEdgeAlpha,
  glassWarm,
  GLASS_WARM_DAY,
  REFLECT_STAR,
} from '../../src/lib/window-light';

/**
 * window-light 单测 —— 窗光学纯函数的契约层。
 *
 * 判据口径：几何整数 / alpha 两位小数 / 颜色由入参派生（零字面量色，除两个
 * lerp 锚点）。装饰与绘制接线在后续任务，本文件只锁函数行为。
 */

const P: Palette = { bg: '#101020', accent: '#ff8800', light: '#e0e0ff' };
const HOLE = { x: 100, y: 50, w: 400, h: 300 };

describe('window-light / 确定性', () => {
  it('indoorReflection 同一入参两次调用深相等（t=0..6000 步长 137）', () => {
    for (let t = 0; t <= 6000; t += 137) {
      const a = indoorReflection(t, 0.8, P);
      const b = indoorReflection(t, 0.8, P);
      expect(a).toEqual(b);
    }
  });

  it('moonSpill / frameProfile / wall 派生同样确定', () => {
    expect(moonSpill(HOLE, 250, 0.9)).toEqual(moonSpill(HOLE, 250, 0.9));
    expect(frameProfile(P, '#0d1640')).toEqual(frameProfile(P, '#0d1640'));
    expect(wallFace(P)).toBe(wallFace(P));
    expect(wallLit(P)).toBe(wallLit(P));
  });
});

describe('window-light / 阈值域', () => {
  it('moonSpill：starlight<0.5 不可见，≥0.5 可见', () => {
    expect(moonSpill(HOLE, 250, 0.4)).toBeNull();
    expect(moonSpill(HOLE, 250, 0.5)).not.toBeNull();
    expect(moonSpill(HOLE, 250, 0.6)).not.toBeNull();
  });

  it('indoorReflection：starlight<REFLECT_STAR 不可见，≥REFLECT_STAR 可见（2026-10-05 起深夜门）', () => {
    expect(indoorReflection(100, 0.3, P)).toBeNull();
    expect(indoorReflection(100, REFLECT_STAR - 0.1, P)).toBeNull(); // 黄昏/黎明关门（旧 0.45 档在这里可见）
    expect(indoorReflection(100, REFLECT_STAR, P)).not.toBeNull();
    expect(indoorReflection(100, 0.8, P)).not.toBeNull();
  });

  it('frost：有雨时（rain=0.5）不结露', () => {
    expect(frost(0.9, 0.5)).toBeNull();
    expect(frost(0.9, 0.0)).toEqual({ edge: true, cornerBoost: true });
    expect(frost(0.5, 0.0)).toBeNull();
  });

  it('mistGlass：rain<0.85 → 0，rain=1 → 0.12（封顶）', () => {
    expect(mistGlass(0.5)).toBe(0);
    expect(mistGlass(0.85)).toBe(0);
    expect(mistGlass(1)).toBe(0.12);
    expect(mistGlass(1.5)).toBe(0.12);
  });
});

describe('window-light / moonSpill 几何', () => {
  it('x 区间随 moonX 单调不降（扫全域步长 8）', () => {
    let prevX0 = -Infinity;
    let prevX1 = -Infinity;
    for (let mx = HOLE.x - 200; mx <= HOLE.x + HOLE.w + 200; mx += 8) {
      const s = moonSpill(HOLE, mx, 0.9);
      expect(s).not.toBeNull();
      expect(s!.x0).toBeGreaterThanOrEqual(prevX0);
      expect(s!.x1).toBeGreaterThanOrEqual(prevX1);
      prevX0 = s!.x0;
      prevX1 = s!.x1;
    }
  });

  it('亮带永远完整落在 hole 内（各种窗宽 x 全区间）', () => {
    for (const w of [40, 120, 400, 1000]) {
      const hole = { x: 100, y: 50, w, h: 300 };
      for (let mx = hole.x - 100; mx <= hole.x + hole.w + 100; mx += 8) {
        const s = moonSpill(hole, mx, 0.9);
        expect(s).not.toBeNull();
        expect(s!.x0).toBeGreaterThanOrEqual(hole.x);
        expect(s!.x1).toBeLessThanOrEqual(hole.x + hole.w);
        expect(Number.isInteger(s!.x0)).toBe(true);
        expect(Number.isInteger(s!.x1)).toBe(true);
      }
    }
  });

  it('alpha 随 starlight 升、两位小数，alphaLow = alphaTop*0.55', () => {
    const lo = moonSpill(HOLE, 250, 0.6)!;
    const hi = moonSpill(HOLE, 250, 1.0)!;
    expect(hi.alphaTop).toBeGreaterThanOrEqual(lo.alphaTop);
    expect(hi.alphaTop).toBeLessThanOrEqual(0.1);
    expect(hi.alphaLow).toBeCloseTo(hi.alphaTop * 0.55, 2);
    expect(hi.alphaLow).toBeLessThan(hi.alphaTop);
  });
});

describe('window-light / indoorReflection 漂移', () => {
  it('全程逐样漂移有界、输出整数、alpha ≤0.24（0.1 档暖金盖不住夜空蓝底，2026-10-06 提亮）', () => {
    let prev = indoorReflection(0, 0.9, P);
    expect(prev).not.toBeNull();
    for (let t = 137; t <= 6000; t += 137) {
      const cur = indoorReflection(t, 0.9, P);
      expect(cur).not.toBeNull();
      expect(Math.abs(cur!.x - prev!.x)).toBeLessThanOrEqual(10);
      expect(Math.abs(cur!.y - prev!.y)).toBeLessThanOrEqual(4);
      for (const v of [cur!.x, cur!.y, cur!.w, cur!.h]) {
        expect(Number.isInteger(v)).toBe(true);
      }
      expect(cur!.alpha).toBeLessThanOrEqual(0.24);
      expect(cur!.alpha).toBeGreaterThanOrEqual(0);
      prev = cur;
    }
  });

  it('深夜满档时足够亮到读出暖色（alpha ≥ 0.2，旧 0.1 档必红）', () => {
    expect(indoorReflection(100, 1.0, P)!.alpha).toBeGreaterThanOrEqual(0.2);
  });

  it('形状是纵向灯柱晕：全程 w < h（旧 18×10 横板在这里必红）', () => {
    for (let t = 0; t <= 6000; t += 137) {
      const cur = indoorReflection(t, 0.9, P)!;
      expect(cur.w, `t=${t} 时 w=${cur.w} 不小于 h=${cur.h}`).toBeLessThan(cur.h);
    }
  });

  it('alpha 随 starlight 升且颜色为 accent 少混白的纯暖（2026-10-06：0.35 混白读不出暖）', () => {
    const a = indoorReflection(100, REFLECT_STAR + 0.05, P)!;
    const b = indoorReflection(100, 1.0, P)!;
    expect(b.alpha).toBeGreaterThanOrEqual(a.alpha);
    expect(b.color).toBe(lerpHex(P.accent, '#ffffff', 0.15));
  });
});

describe('window-light / reflectionLayers 三层软边', () => {
  const core = { x: 100, y: 80, w: 12, h: 26, alpha: 0.24 };

  it('三层：核心原样 + 两圈外扩 (3,6)/(6,12)，alpha 乘 0.6/0.3（两位小数）', () => {
    const ls = reflectionLayers(core);
    expect(ls).toHaveLength(3);
    expect(ls[0]).toEqual(core);
    expect(ls[1]).toEqual({ x: 97, y: 74, w: 18, h: 38, alpha: 0.14 });
    expect(ls[2]).toEqual({ x: 94, y: 68, w: 24, h: 50, alpha: 0.07 });
  });

  it('逐层严格包含（外圈完整包住内圈）且 alpha 严格递减', () => {
    const [a, b, c] = reflectionLayers(core);
    for (const [inner, outer] of [
      [a!, b!],
      [b!, c!],
    ]) {
      expect(outer.x).toBeLessThanOrEqual(inner.x);
      expect(outer.y).toBeLessThanOrEqual(inner.y);
      expect(outer.x + outer.w).toBeGreaterThanOrEqual(inner.x + inner.w);
      expect(outer.y + outer.h).toBeGreaterThanOrEqual(inner.y + inner.h);
      expect(outer.alpha).toBeLessThan(inner.alpha!);
    }
    for (const L of reflectionLayers(core)) {
      for (const v of [L.x, L.y, L.w, L.h]) expect(Number.isInteger(v)).toBe(true);
    }
  });

  it('alpha=0 的核心仍出三层全零（绘制侧免判）', () => {
    const ls = reflectionLayers({ ...core, alpha: 0 });
    expect(ls.map((L) => L.alpha)).toEqual([0, 0, 0]);
  });
});

describe('window-light / 颜色派生契约', () => {
  it('frameProfile 五色互不相同且逐字等于 lerpHex 派生', () => {
    const skyBand = '#0d1640';
    const fp = frameProfile(P, skyBand);
    const face = lerpHex(P.bg, P.light, 0.34);
    expect(fp.face).toBe(face);
    expect(fp.faceShade).toBe(lerpHex(face, '#000000', 0.38));
    expect(fp.faceLit).toBe(lerpHex(face, '#ffffff', 0.22));
    expect(fp.reveal).toBe(lerpHex(P.light, skyBand, 0.34));
    expect(fp.lip).toBe(lerpHex(P.bg, '#000000', 0.7));

    const all = [fp.face, fp.faceShade, fp.faceLit, fp.reveal, fp.lip];
    expect(new Set(all).size).toBe(5);
  });

  it('wallFace / wallLit 派生正确且亮阶递进', () => {
    expect(wallFace(P)).toBe(lerpHex(P.bg, P.light, 0.12));
    expect(wallLit(P)).toBe(lerpHex(wallFace(P), P.light, 0.1));
    expect(wallLit(P)).not.toBe(wallFace(P));
  });

  it('glassTint 原样透传冷带色，alpha 0.04', () => {
    expect(glassTint('#0d1640')).toEqual({ color: '#0d1640', alpha: 0.04 });
  });

  it('源码零字面量色：除 #000000/#ffffff 两个 lerp 锚点外无其它 #rrggbb', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/window-light.ts'), 'utf-8');
    const hits = src.match(/#[0-9a-fA-F]{6}/g) ?? [];
    const offenders = hits.filter((h) => h.toLowerCase() !== '#000000' && h.toLowerCase() !== '#ffffff');
    expect(offenders).toEqual([]);
  });
});

// ---- ⑤ 框棂接光 + 夜暖晕（去铁窗，2026-10-02） ----

describe('window-light / 框棂接光（sunlitFrame）', () => {
  // 旧 face = lerp(bg, light, 0.34) 与昼长无关 → 正午深灰横条（铁栅）、深夜泛灰光铁条。
  // 接光后：窗是屋里唯一接太阳的面，白天晒暖晒亮、夜里沉暗。
  const lum = (hex: string) =>
    [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).reduce((s, v) => s + v, 0);
  const warm = (hex: string) =>
    parseInt(hex.slice(1, 3), 16) - parseInt(hex.slice(5, 7), 16);
  const baseFace = frameProfile(P, '#ffffff').face; // 旧基线（与 skyBand 无关的档）

  it('正午 = 暖亮木（比旧基线亮且偏暖）；深夜 = 沉暗木（比旧基线暗）', () => {
    const day = sunlitFrame(P, 1).face;
    const night = sunlitFrame(P, 0).face;
    expect(lum(day), '正午该被太阳晒亮').toBeGreaterThan(lum(baseFace));
    expect(warm(day), '正午该掺太阳暖（R−B 抬升）').toBeGreaterThan(warm(baseFace));
    expect(lum(night), '深夜该沉暗（解除「夜里泛灰光」）').toBeLessThan(lum(baseFace));
    expect(lum(night), '深夜必须真的暗（lum < 200）').toBeLessThan(200);
  });

  it('昼长单调：0→1 亮度不降；越界钳位（5≡1、−1≡0）', () => {
    const lums = [0, 0.25, 0.5, 0.75, 1].map((d) => lum(sunlitFrame(P, d).face));
    for (let i = 1; i < lums.length; i++) {
      expect(lums[i]!).toBeGreaterThanOrEqual(lums[i - 1]!);
    }
    expect(sunlitFrame(P, 5).face).toBe(sunlitFrame(P, 1).face);
    expect(sunlitFrame(P, -1).face).toBe(sunlitFrame(P, 0).face);
  });

  it('d=0 与 frameProfile 基线连续可比：faceShade/faceLit 相对 face 保持剖面语义', () => {
    for (const d of [0, 0.4, 1]) {
      const s = sunlitFrame(P, d);
      expect(lum(s.faceLit)).toBeGreaterThan(lum(s.face));
      expect(lum(s.faceShade)).toBeLessThan(lum(s.face));
    }
  });
});

describe('window-light / 夜里内缘暖受光带（warmEdgeAlpha）', () => {
  it('昼 0（≥0.35 一根不画）、深夜 1、线性渐入且随昼长单调降', () => {
    expect(warmEdgeAlpha(1)).toBe(0);
    expect(warmEdgeAlpha(0.35)).toBe(0);
    expect(warmEdgeAlpha(0)).toBe(1);
    expect(warmEdgeAlpha(0.2)).toBe(0.43); // round2(0.15/0.35)
    const seq = [0, 0.1, 0.2, 0.3].map(warmEdgeAlpha);
    for (let i = 1; i < seq.length; i++) {
      expect(seq[i]!).toBeLessThan(seq[i - 1]!);
    }
  });
});

describe('window-light / 夜暖晕（glassWarm，ADR-0028）', () => {
  const hole = { x: 18, y: 18, w: 1324, h: 890 };

  it('白昼返 null（与灯同门）；夜里返回三段、贴窗底向上排布', () => {
    expect(glassWarm(hole, GLASS_WARM_DAY)).toBeNull();
    expect(glassWarm(hole, 1)).toBeNull();
    const bands = glassWarm(hole, 0)!;
    expect(bands).toHaveLength(3);
    const total = Math.round(hole.h * 0.18);
    expect(bands[0]!.y + bands[0]!.h).toBe(hole.y + hole.h); // 最下段贴窗底
    expect(bands[2]!.y).toBe(hole.y + hole.h - total); // 晕顶 = 窗底 − 总高
    expect(bands[1]!.y + bands[1]!.h).toBe(bands[0]!.y); // 段间无缝
    for (const b of bands) {
      expect(Number.isInteger(b.y) && Number.isInteger(b.h)).toBe(true);
      expect(b.alpha).toBeGreaterThan(0);
      expect(b.alpha).toBeLessThanOrEqual(0.31);
    }
    // alpha 向上递减（最下段最暖）
    expect(bands[0]!.alpha).toBeGreaterThan(bands[1]!.alpha!);
    expect(bands[1]!.alpha).toBeGreaterThan(bands[2]!.alpha!);
    // 最下段要真的读得出暖：alpha ≥ 0.28（旧 0.1 档 + 0.35 混白合成后 R−B 为负，必红）
    expect(bands[0]!.alpha).toBeGreaterThanOrEqual(0.28);
  });

  it('强度随夜深与灯同步渐入（半程 alpha 减半）', () => {
    const full = glassWarm(hole, 0)!;
    const half = glassWarm(hole, GLASS_WARM_DAY / 2)!;
    expect(half[0]!.alpha).toBe(round2of(full[0]!.alpha / 2));
  });

  function round2of(v: number): number {
    return Math.round(v * 100) / 100;
  }
});
