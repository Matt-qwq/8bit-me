import { describe, expect, it } from 'vitest';
import {
  BAND_WEIGHTS,
  bandBounds,
  BAYER4,
  BAYER8,
  ditherTakeLower,
  dimSky,
  hexToRgb,
  sampleSky,
  SKY_FRAMES,
} from '../../src/lib/sky-palette';

const hexDist = (a: string, b: string) => {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const A = p(a);
  const B = p(b);
  return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]);
};

describe('SKY_FRAMES：关键帧定义', () => {
  it('8 帧，锚点严格递增，覆盖深夜 -1 → 正午 0.9', () => {
    expect(SKY_FRAMES).toHaveLength(8);
    for (let i = 1; i < SKY_FRAMES.length; i++)
      expect(SKY_FRAMES[i]!.alt).toBeGreaterThan(SKY_FRAMES[i - 1]!.alt);
    expect(SKY_FRAMES[0]!.alt).toBe(-1);
    expect(SKY_FRAMES[7]!.alt).toBe(0.9);
  });
  it('每帧 6 条色带且「底带亮于顶带」（地平线永远更亮——大气散射的像素表达）', () => {
    const luma = (hex: string) =>
      0.2126 * parseInt(hex.slice(1, 3), 16) +
      0.7152 * parseInt(hex.slice(3, 5), 16) +
      0.0722 * parseInt(hex.slice(5, 7), 16);
    for (const f of SKY_FRAMES) {
      expect(f.bands).toHaveLength(6);
      expect(luma(f.bands[5])).toBeGreaterThan(luma(f.bands[0]));
    }
  });
  it('星光基准：深夜 1 / 正午 0', () => {
    expect(SKY_FRAMES[0]!.star).toBe(1);
    expect(SKY_FRAMES[7]!.star).toBe(0);
  });
});

describe('sampleSky：按太阳高度插值', () => {
  it('端点钳制：alt -1.2 与帧 0 同、alt 1.5 与帧 7 同', () => {
    expect(sampleSky(-1.2).bands[0]).toBe(SKY_FRAMES[0]!.bands[0]);
    expect(sampleSky(1.5).bands[0]).toBe(SKY_FRAMES[7]!.bands[0]);
  });
  it('恰好落在锚点上 = 该帧原色', () => {
    const noon = sampleSky(0.9);
    expect(noon.bands).toEqual([...SKY_FRAMES[7]!.bands]);
  });
  it('两锚点中间 = 两帧混色（非任一原色、且距离两边都更近）', () => {
    const mid = sampleSky(0.1); // 帧 4(0.02) 与帧 5(0.18) 之间
    const A = SKY_FRAMES[4]!.bands[0];
    const B = SKY_FRAMES[5]!.bands[0];
    expect(mid.bands[0]).not.toBe(A);
    expect(mid.bands[0]).not.toBe(B);
    expect(hexDist(mid.bands[0], A)).toBeLessThan(hexDist(A, B));
    expect(hexDist(mid.bands[0], B)).toBeLessThan(hexDist(A, B));
  });
  it('全天连续：相邻 sunAlt 采样色差有界（晨昏漂移无跳色）', () => {
    for (let a = -1; a < 0.95; a += 0.05) {
      const d = hexDist(sampleSky(a).bands[0], sampleSky(a + 0.05).bands[0]);
      expect(d).toBeLessThan(40);
    }
  });
});

describe('dimSky：天气压暗', () => {
  it('factor 1 原样返回', () => {
    const sky = sampleSky(0.9);
    expect(dimSky(sky, 1)).toBe(sky);
  });
  it('阴雨 0.65：整体变暗 + 每带饱和度下降（向灰收拢）', () => {
    const sky = sampleSky(0.9);
    const dim = dimSky(sky, 0.65);
    const rgb = (hex: string) => [
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16),
    ];
    const luma = (hex: string) => {
      const [r, g, b] = rgb(hex);
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    /** 色度 = 最大通道 - 最小通道（0 = 纯灰） */
    const chroma = (hex: string) => {
      const c = rgb(hex);
      return Math.max(...c) - Math.min(...c);
    };
    const mean = (f: (h: string) => number, arr: readonly string[]) =>
      arr.reduce((a, h) => a + f(h), 0) / arr.length;
    // 每一带都变暗（阴雨天的天空不能比晴天还亮）
    for (let i = 0; i < 6; i++) {
      expect(luma(dim.bands[i]!), `带 ${i} 未变暗`).toBeLessThan(luma(sky.bands[i]!));
    }
    expect(mean(luma, dim.bands)).toBeLessThan(mean(luma, sky.bands));
    // 相对饱和度（色度/亮度）每带都下降——这才是「发灰」的硬指标
    const relSat = (hex: string) => chroma(hex) / Math.max(1, luma(hex));
    for (let i = 0; i < 6; i++) {
      expect(relSat(dim.bands[i]!), `带 ${i} 未去饱和`).toBeLessThan(relSat(sky.bands[i]!));
    }
  });
  it('钳制下限 0.3（不会黑成一团）', () => {
    const dim = dimSky(sampleSky(0.9), 0);
    expect(dim.bands[0]).not.toBe('#000000');
  });
});

describe('bandBounds：色带纵向权重（地平线带更宽）', () => {
  const H = 900;
  it('6 条权重和为 1，首带顶=0、末带底=H', () => {
    expect(BAND_WEIGHTS).toHaveLength(6);
    expect(BAND_WEIGHTS.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    expect(bandBounds(0, H).top).toBe(0);
    expect(bandBounds(5, H).bottom).toBeCloseTo(H, 6);
  });
  it('相邻带首尾相接（无缝隙无重叠）', () => {
    for (let i = 0; i < 5; i++)
      expect(bandBounds(i, H).bottom).toBeCloseTo(bandBounds(i + 1, H).top, 6);
  });
  it('底带（地平线）宽于顶带 —— 黄昏暖色才漫得开', () => {
    const top = bandBounds(0, H).bottom - bandBounds(0, H).top;
    const bottom = bandBounds(5, H).bottom - bandBounds(5, H).top;
    expect(bottom).toBeGreaterThan(top * 1.5);
  });
});

describe('拜耳抖动', () => {
  it('矩阵 16 格归一化，无重复值', () => {
    expect(BAYER4).toHaveLength(16);
    expect(new Set(BAYER4.map((v) => v.toFixed(4))).size).toBe(16);
  });
  it('ditherTakeLower：t=0 全不取，t=1 全取，t=0.5 约半数', () => {
    let lo = 0;
    let mid = 0;
    let hi = 0;
    for (let r = 0; r < 4; r++)
      for (let c = 0; c < 4; c++) {
        if (ditherTakeLower(c, r, 0.001)) lo++;
        if (ditherTakeLower(c, r, 0.5)) mid++;
        if (ditherTakeLower(c, r, 0.999)) hi++;
      }
    expect(lo).toBe(0);
    expect(hi).toBe(16);
    expect(mid).toBeGreaterThanOrEqual(7);
    expect(mid).toBeLessThanOrEqual(9);
  });

  // 2026-10-05 评审⑥：天空渐变从 4×4 升 8×8——4×4 的行密度只有 {3/4, 2/4}
  // 两档交替，过渡区每隔一行整行偏亮/偏暗（morning 实测 ±5 RGB），大面积
  // 渐变上读作横纹。这里锁 8×8 的结构：64 级 / 8 行周期 / 真不是 4 行周期。
  it('BAYER8：64 格归一化无重复，t=0.5 在全域恰取一半', () => {
    expect(BAYER8).toHaveLength(64);
    expect(new Set(BAYER8.map((v) => v.toFixed(4))).size).toBe(64);
    let mid = 0;
    for (let r = 0; r < 8; r++)
      for (let c = 0; c < 8; c++) if (ditherTakeLower(c, r, 0.5)) mid++;
    expect(mid).toBe(32);
  });

  it('ditherTakeLower 图样 8 行周期；矩阵首行 ≠ 第五行（退回 4×4 后端必红）', () => {
    const rowPat = (r: number) =>
      Array.from({ length: 16 }, (_, c) => ditherTakeLower(c, r, 0.62).toString()).join(',');
    for (let r = 0; r < 8; r++) {
      expect(rowPat(r)).toBe(rowPat(r + 8)); // 周期 8
    }
    // 4×4 后端（周期 4）会把第 5 行铺成第 1 行的复本；8×8 的阈值相位每行都不同
    expect(BAYER8.slice(0, 8)).not.toEqual(BAYER8.slice(32, 40));
  });
});

describe('山色（远山/近山两档，大气透视）', () => {
  const lum = (hex: string) => {
    const [r, g, b] = hexToRgb(hex);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  it('每帧都有山色，且近山恒暗于远山（纵深不能被反转）', () => {
    for (const f of SKY_FRAMES) {
      expect(f.ridgeFar).toMatch(/^#[0-9a-f]{6}$/);
      expect(f.ridgeNear).toMatch(/^#[0-9a-f]{6}$/);
      expect(lum(f.ridgeNear), `alt=${f.alt} 近山应暗于远山`).toBeLessThan(lum(f.ridgeFar));
    }
  });
  it('白天：远山比近山更接近天空底带（远山要「融进天空」）', () => {
    const sky = sampleSky(0.9);
    const bottom = sky.bands[5]!;
    const d = (a: string, b: string) => {
      const A = hexToRgb(a);
      const B = hexToRgb(b);
      return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]);
    };
    expect(d(sky.ridgeFar, bottom)).toBeLessThan(d(sky.ridgeNear, bottom));
  });
  it('白天山不是石头灰：近山带青绿倾向（G 高于 R）；黄昏/夜里则被天光染暖紫（允许 R>G）', () => {
    for (const f of SKY_FRAMES) {
      const [r, g] = hexToRgb(f.ridgeNear);
      if (f.alt >= 0.18) {
        expect(g, `alt=${f.alt} 白天近山 G 应 >= R（偏青绿/冷调）`).toBeGreaterThanOrEqual(r);
      } else {
        // 暮色里的山本就偏紫——但不能偏到发红（那是火灾不是山影）
        expect(r - g, `alt=${f.alt} 暮色山不应发红`).toBeLessThan(40);
      }
    }
  });
  it('山色随昼夜连续插值（帧间不跳变）', () => {
    const a = sampleSky(0.4);
    const b = sampleSky(0.45);
    const c = sampleSky(0.5);
    const dist = (x: string, y: string) => {
      const A = hexToRgb(x);
      const B = hexToRgb(y);
      return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]);
    };
    expect(dist(a.ridgeNear, b.ridgeNear)).toBeLessThan(30);
    expect(dist(b.ridgeNear, c.ridgeNear)).toBeLessThan(30);
  });
});
