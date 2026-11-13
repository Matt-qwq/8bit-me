import { describe, expect, it } from 'vitest';
import {
  CLOUD,
  BIRD,
  birdWingUp,
  boatPose,
  BOAT,
  cloudBob,
  cloudGust,
  genBolt,
  genClouds,
  glassStreamCount,
  glassStreakCount,
  morphCloud,
  rainLook,
  sillWaterHeight,
  windowShake,
  genScenery,
  mulberry32,
  nextThunderStrike,
  THUNDER_CLUSTER_P,
  THUNDER_CLUSTER_MAX,
  rainDropCount,
  rainSpeed,
  reflectAlpha,
  reflectGap,
  reflectShear,
  REFLECT,
  ridgeAt,
  ridgeLine,
  rippleCap,
  RIPPLE_LIFE,
  snowDrift,
  snowFlakeCount,
} from '../../src/lib/sky-scene';

const W = 1440;
const H = 900;

describe('mulberry32：确定性', () => {
  it('同种子同序列，异种子异序列', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const c = mulberry32(43);
    const sa = [a(), a(), a()];
    expect(sa).toEqual([b(), b(), b()]);
    expect(sa).not.toEqual([c(), c(), c()]);
    for (const v of sa) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('ridgeLine：山脊线', () => {
  it('确定性；采样覆盖 0..w；恒在基准线之上', () => {
    const base = 600;
    const a = ridgeLine(W, base, 90, 2, 7);
    expect(a).toEqual(ridgeLine(W, base, 90, 2, 7));
    expect(a[0]![0]).toBe(0);
    expect(a[a.length - 1]![0]).toBeGreaterThanOrEqual(W - 6);
    for (const [, y] of a) expect(y).toBeLessThan(base);
  });
  it('振幅越大山越高（最小 y 更小）', () => {
    const low = ridgeLine(W, 600, 40, 3, 5);
    const high = ridgeLine(W, 600, 120, 3, 5);
    const minY = (p: [number, number][]) => Math.min(...p.map(([, y]) => y));
    expect(minY(high)).toBeLessThan(minY(low));
  });
  it('峰是尖的（三角波），不是沙丘（正弦）：峰顶两侧陡降', () => {
    const amp = 140;
    const pts = ridgeLine(W, 600, amp, 3, 9);
    // 量「峰顶两侧 ±14px 水平窗内的陡降」——用 ridgeAt 在 x 空间取值，
    // 判据与采样密度解耦（否则 step 从 w/220 改 w/440 就假红）
    let sharpPeaks = 0;
    for (const [x, y] of pts) {
      if (x < W * 0.02 || x > W * 0.98) continue;
      const l = ridgeAt(pts, x - 14);
      const r = ridgeAt(pts, x + 14);
      if (y < l && y < r && Math.min(l, r) - y >= amp * 0.03) sharpPeaks++;
    }
    expect(sharpPeaks).toBeGreaterThanOrEqual(3);
  });
  it('峰数影响起伏次数（peaks 越多，脊线方向反转越频繁）', () => {
    const turns = (p: [number, number][]) => {
      let n = 0;
      for (let i = 2; i < p.length; i++) {
        const d1 = p[i - 1]![1] - p[i - 2]![1];
        const d2 = p[i]![1] - p[i - 1]![1];
        if (d1 * d2 < 0) n++;
      }
      return n;
    };
    expect(turns(ridgeLine(W, 600, 80, 5, 3))).toBeGreaterThan(turns(ridgeLine(W, 600, 80, 1, 3)));
  });
});

describe('ridgeAt：脊线插值', () => {
  const pts: [number, number][] = [
    [0, 500],
    [100, 400],
    [200, 450],
  ];
  it('端点与中点插值正确', () => {
    expect(ridgeAt(pts, 0)).toBe(500);
    expect(ridgeAt(pts, 100)).toBe(400);
    expect(ridgeAt(pts, 50)).toBeCloseTo(450, 5);
    expect(ridgeAt(pts, 150)).toBeCloseTo(425, 5);
  });
  it('越界钳到端点（任何 x 都安全）', () => {
    expect(ridgeAt(pts, -50)).toBe(500);
    expect(ridgeAt(pts, 9999)).toBe(450);
  });
  it('空数组不抛', () => {
    expect(ridgeAt([], 10)).toBe(0);
  });
});

describe('genScenery：远山与湖面', () => {
  it('确定性：同参同画面', () => {
    expect(genScenery(W, H)).toEqual(genScenery(W, H));
  });
  it('地平线压在 0.78–0.86h：山与湖整条带落在 hero 面板下方，全宽可见', () => {
    // 2026-09-21 作者：「#hero 的第一块遮挡了窗外的景色」——山脊原本正落在
    // hero 面板（约 0.32h–0.71h）的下缘后面，中央的山全被挡掉、只剩左右两条边。
    const s = genScenery(W, H);
    expect(s.horizonY).toBeGreaterThan(H * 0.78);
    expect(s.horizonY).toBeLessThan(H * 0.86);
  });
  it('山脊最高点也在 0.7h 以下（面板下缘之下），否则中央的山又会被面板吃掉', () => {
    const s = genScenery(W, H);
    const minY = (p: [number, number][]) => Math.min(...p.map(([, y]) => y));
    expect(minY(s.farRidge)).toBeGreaterThan(H * 0.7);
    expect(minY(s.nearRidge)).toBeGreaterThan(H * 0.7);
  });
  it('远 / 中 / 近三层逐级更低（三层错开才有纵深），都不越界', () => {
    const s = genScenery(W, H);
    const minY = (p: [number, number][]) => Math.min(...p.map(([, y]) => y));
    expect(minY(s.farRidge)).toBeLessThan(minY(s.midRidge));
    expect(minY(s.midRidge)).toBeLessThan(minY(s.nearRidge));
    // 三层必须真的分开：挨在一起会糊成一条厚边（<6px 就没有「层」）
    expect(minY(s.midRidge) - minY(s.farRidge)).toBeGreaterThan(6);
    expect(minY(s.nearRidge) - minY(s.midRidge)).toBeGreaterThan(6);
    for (const p of [...s.farRidge, ...s.midRidge, ...s.nearRidge]) {
      expect(p[1]).toBeLessThan(s.horizonY);
      expect(p[1]).toBeGreaterThan(0);
      expect(p[0]).toBeGreaterThanOrEqual(0);
      expect(p[0]).toBeLessThanOrEqual(W);
    }
  });
  it('芦苇在左右两侧，画面中央 60% 留空（不挡天空与湖面）', () => {
    const s = genScenery(W, H);
    expect(s.reeds.length).toBeGreaterThanOrEqual(4);
    for (const r of s.reeds) {
      const center = r.x > W * 0.2 && r.x < W * 0.8;
      expect(center, `芦苇 x=${r.x} 不应落在画面中央`).toBe(false);
    }
  });
  it('每丛有 5+ 根杆、高度为正、纵深 0..1', () => {
    for (const r of genScenery(W, H).reeds) {
      expect(r.stalks.length).toBeGreaterThanOrEqual(5);
      for (const st of r.stalks) expect(st.h).toBeGreaterThan(0);
      expect(r.depth).toBeGreaterThanOrEqual(0);
      expect(r.depth).toBeLessThanOrEqual(1);
    }
  });
  it('同丛的杆要散开（dx 不全相等），否则一丛会叠成一根线', () => {
    for (const r of genScenery(W, H).reeds) {
      const dxs = new Set(r.stalks.map((s) => s.dx));
      expect(dxs.size, `丛 x=${r.x} 的杆全叠在同一条线上`).toBeGreaterThanOrEqual(3);
      const spread = Math.max(...r.stalks.map((s) => s.dx)) - Math.min(...r.stalks.map((s) => s.dx));
      expect(spread).toBeGreaterThan(H * 0.02);
    }
  });

  it('岸树：4+ 丛、有树冠块、贴地平线；两树间距 ≥9%w（不挤成一团）', () => {
    const s = genScenery(W, H);
    const shore = s.trees.filter((t) => !t.isle);
    expect(shore.length).toBeGreaterThanOrEqual(4);
    for (const t of shore) {
      expect(t.baseY).toBe(s.horizonY);
      expect(t.blocks.length).toBeGreaterThanOrEqual(2);
      expect(t.trunk).toBeGreaterThan(0);
      // 树冠在树干顶以上（dy ≤ -trunk），不悬空也不埋进岸里
      for (const [, dy] of t.blocks) expect(dy).toBeLessThanOrEqual(-t.trunk);
    }
    const xs = shore.map((t) => t.x).sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) {
      expect(xs[i]! - xs[i - 1]!, `树 ${xs[i - 1]} 与 ${xs[i]} 挤在一起`).toBeGreaterThanOrEqual(W * 0.09);
    }
  });

  it('小岛：在水面内（不与岸树同侧挤死）、载一棵岛树；岛宽不顶到窗框', () => {
    const s = genScenery(W, H);
    expect(s.isle.w).toBeGreaterThanOrEqual(24);
    // 2026-10-05 评审⑤：「中景锚点」必须读得出来——旧 0.028–0.052w 在 1440 下不可见
    expect(s.isle.w).toBeGreaterThanOrEqual(W * 0.05);
    expect(s.isle.h).toBeGreaterThanOrEqual(3);
    expect(s.isle.x - s.isle.w / 2).toBeGreaterThan(0);
    expect(s.isle.x + s.isle.w / 2).toBeLessThan(W);
    const isleTrees = s.trees.filter((t) => t.isle);
    expect(isleTrees.length).toBe(1);
    expect(isleTrees[0]!.baseY).toBeLessThan(s.horizonY); // 岛面 = 地平线 - 岛高
  });

  it('近山要有山的体量：最厚山体 ≥ 0.045h（旧 0.03h 振幅读作绿篱笆，必红）', () => {
    const s = genScenery(W, H);
    let maxBody = 0;
    for (const [x] of s.nearRidge) {
      maxBody = Math.max(maxBody, s.horizonY - ridgeAt(s.nearRidge, x));
    }
    expect(maxBody).toBeGreaterThanOrEqual(H * 0.045);
  });

  it('皴纹：贴在近山脊线下、地平线上；长度 3–14；偏山脚分布（受光边保持干净）', () => {
    const s = genScenery(W, H);
    expect(s.hatch.length).toBeGreaterThan(30);
    let lit = 0;
    for (const st of s.hatch) {
      const ridgeY = ridgeAt(s.nearRidge, st.x);
      expect(st.y).toBeGreaterThanOrEqual(ridgeY);
      expect(st.y).toBeLessThan(s.horizonY - 4);
      // 受光边净空：纹顶不进山体上部 25%（那是亮棱+暗棱双线的地盘；
      // 旧版纹顶从脊线下 2px 就开始，梳齿感来源之一，必红）
      expect(st.y - ridgeY).toBeGreaterThanOrEqual(0.25 * (s.horizonY - ridgeY));
      expect(st.len).toBeGreaterThanOrEqual(3);
      expect(st.y + st.len).toBeLessThanOrEqual(s.horizonY);
      if (st.shade) lit++;
    }
    expect(lit, '皴纹应明暗两色都有（全暗 = 死黑刷子）').toBeGreaterThan(0);
    expect(s.hatch.length - lit).toBeGreaterThan(0);
  });
});

describe('渔舟与飞鸟（2026-09-23「景色太简单」加密度）', () => {
  it('船位确定性与整数性；恒在水面内（地平线下、画布上）', () => {
    const hy = Math.round(H * 0.8);
    expect(boatPose(1000, W, hy, H)).toEqual(boatPose(1000, W, hy, H));
    for (let t = 0; t < 200000; t += 617) {
      const { x, y } = boatPose(t, W, hy, H);
      expect(Number.isInteger(x)).toBe(true);
      expect(Number.isInteger(y)).toBe(true);
      expect(x).toBeGreaterThan(W * 0.15);
      expect(x).toBeLessThan(W * 0.85);
      expect(y).toBeGreaterThan(hy);
      expect(y).toBeLessThan(H);
    }
  });
  it('船在游移（不同时刻位置不同），不是锚死的一点', () => {
    const hy = Math.round(H * 0.8);
    const xs = new Set(Array.from({ length: 40 }, (_, i) => boatPose(i * 3000, W, hy, H).x));
    expect(xs.size, '船位完全不变（游移失效）').toBeGreaterThan(20);
  });
  it('船灯阈值：starlight ≥ BOAT.LAMP_STAR 才亮（白天不点灯）', () => {
    expect(BOAT.LAMP_STAR).toBeGreaterThan(0);
    expect(BOAT.LAMP_STAR).toBeLessThan(0.6);
  });
  it('飞鸟参数：扑翼频率在可信区间；首群在 5–8s 内出现（e2e 等得到）', () => {
    expect(BIRD.SPEED).toBeGreaterThan(0.8);
    expect(BIRD.SPEED).toBeLessThan(3);
    expect(BIRD.FIRST_AT).toBeGreaterThanOrEqual(240);
    expect(BIRD.FIRST_AT).toBeLessThanOrEqual(60 * 10);
    const ups = new Set(Array.from({ length: 60 }, (_, i) => birdWingUp(i * 7)));
    expect(ups.size, '扑翼只有一个朝向（扑翼失效）').toBe(2);
  });
});

describe('倒影：随波扭曲 + 柔化（2026-09-23 二轮「湖面倒影随波扭曲的柔化」）', () => {
  it('确定性 + 整数错位 + 错位不超上限（像素语言不许抗锯齿）', () => {
    expect(reflectShear(800, 1000, 0, 0.5)).toEqual(reflectShear(800, 1000, 0, 0.5));
    for (let y = 720; y < 900; y += 3) {
      for (let t = 0; t < 20000; t += 617) {
        const s = reflectShear(y, t, 0, (y - 720) / 180);
        expect(Number.isInteger(s)).toBe(true);
        expect(Math.abs(s)).toBeLessThanOrEqual(REFLECT.SHEAR_MAX);
      }
    }
  });
  it('纵深放大：近观者的错位幅度大于贴岸（远近平波）', () => {
    const near = new Set(
      Array.from({ length: 200 }, (_, i) => Math.abs(reflectShear(750 + i, i * 97, 0, 0.95)))
    );
    const far = Array.from({ length: 200 }, (_, i) => Math.abs(reflectShear(750 + i, i * 97, 0, 0.05)));
    expect(Math.max(...near)).toBeGreaterThan(Math.max(...far));
  });
  it('透明度：随纵深单调衰减（贴岸最实）、恒在 (0, ALPHA] 内', () => {
    for (let t = 0; t < 9000; t += 71) {
      const a0 = reflectAlpha(0, t, 0);
      const a1 = reflectAlpha(1, t, 0);
      expect(a1).toBeLessThan(a0);
      expect(a0).toBeLessThanOrEqual(REFLECT.ALPHA + 1e-9);
      expect(a1).toBeGreaterThan(0);
    }
  });
  it('不透明度在呼吸（不是恒定透明度——柔化的另一半）', () => {
    const vals = new Set(
      Array.from({ length: 120 }, (_, i) => reflectAlpha(0.4, i * 40, 0).toFixed(3))
    );
    expect(vals.size, '倒影透明度恒定（呼吸失效）').toBeGreaterThan(30);
  });
  it('破镜行：有破有不破，且破镜图案随时间流动（不是静止水纹）', () => {
    let gaps = 0;
    for (let y = 720; y < 900; y += 2) if (reflectGap(y, 5000, 0)) gaps++;
    expect(gaps).toBeGreaterThan(4);
    expect(80 - gaps).toBeGreaterThan(4); // 也得有不破的行
    const pattern1 = new Set(
      Array.from({ length: 90 }, (_, i) => reflectGap(720 + i, 3000, 0) ? i : -1)
    );
    const pattern2 = new Set(
      Array.from({ length: 90 }, (_, i) => reflectGap(720 + i, 9000, 0) ? i : -1)
    );
    expect(
      [...pattern1].filter((i) => i >= 0 && pattern2.has(i)).length,
      '破镜图案完全不随时间移动（冻结水纹）'
    ).toBeLessThan(75);
  });
  it('云是分瓣积云：平底满宽、向上分瓣（一行可以有多段）、块高 2–4px、没有悬空块', () => {
    for (const c of genClouds(W, H, 0.5)) {
      expect(c.blocks.length, '分瓣云至少 3 块').toBeGreaterThanOrEqual(3);
      const bottom = c.blocks[0]!;
      expect(bottom[0], '底排从左缘起（平底满宽）').toBe(0);
      expect(bottom[2]).toBe(c.w);
      expect(bottom[1] + bottom[3], '最低的一块必须贴云底').toBe(c.h);
      // 块高 2–4px（2px 排 + 纵向合并，最多并两排）
      for (const [, , , bh] of c.blocks) {
        expect(bh).toBeGreaterThanOrEqual(2);
        expect(bh).toBeLessThanOrEqual(4);
      }
      // 没有悬空块：除贴底那块外，每块下方必须有一块托着（历史上「长板 + 悬空方块」的坑）
      for (const [bx, by, bw, bh] of c.blocks) {
        if (by + bh >= c.h) continue;
        const supported = c.blocks.some(
          ([ox, oy, ow, oh]) =>
            oy <= by + bh && oy + oh > by + bh && ox < bx + bw && bx < ox + ow
        );
        expect(supported, `块 [${bx},${by},${bw},${bh}] 悬空`).toBe(true);
      }
      // 比例：不许再出现 15:1 的长板（旧版实测 8–12px 高 / 150–300px 宽）
      expect(c.w / c.h, `云宽高比 ${(c.w / c.h).toFixed(1)} 仍像长板`).toBeLessThanOrEqual(6);
    }
    // 分瓣：暴露在外的「瓣顶」出现在 ≥2 个不同高度 = 这朵云有多个鼓包。
    // 小云（cw 70 上下）两瓣高度接近、合成一个圆顶是正常的，所以按**比例**守，
    // 不逐朵硬要求——真退化成「一排横条」时这个比例会掉到 0。
    const multi = genClouds(W, H, 0.5).filter((c) => {
      const caps = new Set(
        c.blocks
          .filter(
            ([bx, by, bw]) =>
              !c.blocks.some(
                ([ox, oy, ow, oh]) => oy < by && oy + oh >= by && ox < bx + bw && bx < ox + ow
              )
          )
          .map(([, by]) => by)
      );
      return caps.size >= 2;
    }).length;
    const all = genClouds(W, H, 0.5).length;
    expect(multi / all, `只有 ${multi}/${all} 朵云是多瓣的（云又成了一排横条）`).toBeGreaterThanOrEqual(
      0.6
    );
  });
  it('参数哨兵：行步长 2、基准不透明度 ≤ 0.35、错位上限 ≤ 4（太大会把山形错碎）', () => {
    expect(REFLECT.STEP).toBeGreaterThanOrEqual(2);
    expect(REFLECT.ALPHA).toBeLessThanOrEqual(0.35);
    expect(REFLECT.SHEAR_MAX).toBeLessThanOrEqual(4);
    expect(REFLECT.ALPHA_FLOOR).toBeGreaterThan(0);
  });
});

describe('genClouds：云量随天气', () => {
  it('晴天少云，阴天满云', () => {
    expect(genClouds(W, H, 0.15).length).toBeLessThanOrEqual(6);
    expect(genClouds(W, H, 0.9).length).toBeGreaterThanOrEqual(10);
  });
  it('密云档（≥0.6）是满云：数量下限抬到 11 起，块头更大（「晴天里下了一场雨」的反例）', () => {
    // 分档本体：0.6 是台阶——两侧的数量公式不同（3+12c vs 11+30(c-0.6)），
    // 台阶两侧必须拉开，否则「雨天满云」只是线性微调
    const light = genClouds(W, H, 0.45).length;
    const heavy = genClouds(W, H, 0.85).length;
    expect(heavy, `密云 ${heavy} 朵 / 疏云 ${light} 朵（密云没比疏云多 1.5 倍）`).toBeGreaterThanOrEqual(18);
    expect(heavy).toBeGreaterThanOrEqual(light * 1.5);
    expect(genClouds(W, H, 0.61).length, '0.61 还在用旧线性公式（台阶没接上）').toBeGreaterThan(light);
    // 块头：密云 cw = round(cw0 × 1.25)，cw0 最小 56 → 密云里不可能出现 < 70 的云宽；
    // 疏云档最窄的云就是 56 出头（不乘 1.25 时这条窗口守不住）
    const tiny = genClouds(W, H, 0.85).filter((c) => c.w < 70).length;
    expect(tiny, `密云里还有 ${tiny} 朵宽度 < 70 的云（cw 没乘 1.25）`).toBe(0);
    const tinyLight = genClouds(W, H, 0.45).filter((c) => c.w < 70).length;
    expect(tinyLight, '疏云档本来就该有窄云（对照组）').toBeGreaterThan(0);
  });
  it('密云压得更低更沉：y 可以落到 0.44h 以下（旧的 0.04–0.44h 窗口容不下雨云）', () => {
    const ys = genClouds(W, H, 0.95).map((c) => c.y);
    expect(Math.max(...ys), '密云全都挤在 0.44h 以上 → 还是疏云的高度窗口').toBeGreaterThan(H * 0.44);
    expect(Math.max(...ys)).toBeLessThan(H * 0.53);
  });
  it('云在上半屏，速度为正（向右飘），确定性', () => {
    const clouds = genClouds(W, H, 0.5);
    expect(clouds).toEqual(genClouds(W, H, 0.5));
    for (const c of clouds) {
      expect(c.y).toBeLessThan(H * 0.5);
      expect(c.vx).toBeGreaterThan(0);
      expect(c.blocks.length).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('云的运动：不匀速、不固定形状（作者 2026-09-21 三条反馈）', () => {
  it('阵风倍率恒正且在 0.3–1.2（云不倒退、也不静止）', () => {
    const ph = 1.234;
    for (let t = 0; t < 40000; t += 137) {
      const g = cloudGust(t, ph);
      expect(g).toBeGreaterThan(0.29);
      expect(g).toBeLessThan(1.21);
    }
  });
  it('阵风真的在变（不是恒定倍率 = 匀速），且云与云之间不同步', () => {
    const a = Array.from({ length: 40 }, (_, i) => cloudGust(i * 300, 0));
    expect(new Set(a.map((v) => v.toFixed(3))).size).toBeGreaterThan(30);
    // 同一时刻、不同相位 → 不同倍率（否则「整片云一起加速」照样像传送带）
    expect(cloudGust(5000, 0)).not.toBeCloseTo(cloudGust(5000, 2.5), 2);
  });
  it('阵风是低频的：1 秒内不会走完一个来回（否则读作抖动）', () => {
    const span = Math.max(...Array.from({ length: 60 }, (_, i) => cloudGust(i, 0))) -
      Math.min(...Array.from({ length: 60 }, (_, i) => cloudGust(i, 0)));
    expect(span).toBeLessThan(0.35);
  });
  it('上下起伏是整数像素且不超幅度', () => {
    for (let t = 0; t < 9000; t += 61) {
      const b = cloudBob(t, 0.7, 3);
      expect(Number.isInteger(b)).toBe(true);
      expect(Math.abs(b)).toBeLessThanOrEqual(3);
    }
  });
  it('形状会变：不同时刻的块不完全相同（云不是贴纸）', () => {
    const c = genClouds(W, H, 0.5)[0]!;
    const a = JSON.stringify(morphCloud(c, 0));
    const seen = new Set([a]);
    for (let t = 400; t < 4000; t += 400) seen.add(JSON.stringify(morphCloud(c, t)));
    expect(seen.size, '云形随时间完全不变').toBeGreaterThan(1);
  });
  it('变形是整数像素、底边固定（底平是云的标志）、块不消失', () => {
    const c = genClouds(W, H, 0.5)[0]!;
    for (let t = 0; t < 6000; t += 311) {
      const m = morphCloud(c, t);
      expect(m.length).toBe(c.blocks.length);
      m.forEach(([x, y, bw, bh], k) => {
        const [ox, oy, obw, obh] = c.blocks[k]!;
        for (const v of [x, y, bw, bh]) expect(Number.isInteger(v)).toBe(true);
        expect(bw).toBeGreaterThanOrEqual(2);
        expect(bh).toBeGreaterThanOrEqual(2);
        // 底边（y+bh）不动：云从下面长、不从天上掉
        expect(y + bh).toBe(oy + obh);
      });
    }
  });
  it('每朵云的形状各不相同（初版是写死的比例模板，所有云只是缩放不同）', () => {
    const clouds = genClouds(W, H, 0.9);
    // ① 块数本身要变（模板版恒为 4 块：底座 + 主体 + 1 凸 + 侧翼）
    const counts = new Set(clouds.map((c) => c.blocks.length));
    expect(counts.size, `云的块数只有 ${counts.size} 种（形状是同一套模板）`).toBeGreaterThanOrEqual(3);
    // ② 尺度无关的形状签名也要散开。**只留 1 位小数**：2 位小数会假绿——
    // 模板版的归一化比例本就随随机的 ch 抖动，量出来「各不相同」，其实形状是同一个。
    const sig = (c: (typeof clouds)[number]) =>
      c.blocks
        .map(([x, y, bw, bh]) => [x / c.w, y / c.h, bw / c.w, bh / c.h].map((v) => v.toFixed(1)).join(','))
        .join('|');
    const sigs = clouds.map(sig);
    expect(new Set(sigs).size, `形状签名只有 ${new Set(sigs).size}/${clouds.length} 种`).toBeGreaterThan(
      clouds.length * 0.6
    );
  });
  it('漂移比初版慢（初版近层 0.34 px/帧 = 26 px/s，读作贴纸在滑）', () => {
    expect(CLOUD.SPEED_NEAR).toBeLessThan(0.25);
    expect(CLOUD.SPEED_NEAR).toBeGreaterThan(0.08);
    expect(CLOUD.SPEED_FAR).toBeLessThan(CLOUD.SPEED_NEAR);
    for (const c of genClouds(W, H, 0.5)) expect(c.vx).toBeLessThan(CLOUD.SPEED_NEAR * 1.4);
  });
});

describe('天气粒子参数', () => {
  it('雨数随宽度与雨强，且钳 320', () => {
    expect(rainDropCount(W, 0.7)).toBeGreaterThan(150);
    expect(rainDropCount(8000, 1)).toBe(320);
    expect(rainDropCount(375, 0.35)).toBeGreaterThan(10);
  });
  it('雪比雨稀；近层雨比远层快；雪有摇摆', () => {
    expect(snowFlakeCount(W, 0.8)).toBeLessThan(rainDropCount(W, 0.8));
    expect(rainSpeed(1)[0]).toBeGreaterThan(rainSpeed(0)[0]);
    expect(snowDrift(1).amp).toBeGreaterThan(snowDrift(0).amp);
  });
  it('涟漪上限随雨强增长且封顶（像素湖面不是沸水）', () => {
    expect(rippleCap(0)).toBeLessThan(rippleCap(0.7));
    expect(rippleCap(1)).toBeLessThanOrEqual(40);
    expect(rippleCap(0)).toBeGreaterThanOrEqual(4);
  });
  it('涟漪寿命 0.3–0.6s（@60fps）', () => {
    expect(RIPPLE_LIFE).toBeGreaterThanOrEqual(18);
    expect(RIPPLE_LIFE).toBeLessThanOrEqual(36);
  });
  it('簇式随机雷暴：确定性 / 簇内与常规区间 / 连击概率 / streak≥3 强制常规', () => {
    // 确定性：同 seed 同序列
    const rngA = mulberry32(1);
    const rngB = mulberry32(1);
    for (let i = 0; i < 12; i++) {
      expect(nextThunderStrike(1000, 0, rngA)).toEqual(nextThunderStrike(1000, 0, rngB));
    }
    // 400 签的统计口径（seed 固定 = 确定性断言，不是概率断言）
    const rng = mulberry32(42);
    let clustered = 0;
    let inClusterMin = Infinity;
    let inClusterMax = -Infinity;
    let normMin = Infinity;
    let normMax = -Infinity;
    for (let i = 0; i < 400; i++) {
      const s = nextThunderStrike(0, 0, rng);
      const sec = s.frames / 60;
      if (s.inCluster) {
        clustered++;
        inClusterMin = Math.min(inClusterMin, sec);
        inClusterMax = Math.max(inClusterMax, sec);
      } else {
        normMin = Math.min(normMin, sec);
        normMax = Math.max(normMax, sec);
      }
      expect(Number.isInteger(s.frames), '帧数必须整数（像素语言）').toBe(true);
    }
    // 连击概率 ≈ 0.35（THUNDER_CLUSTER_P），固定 seed 下 0.27–0.43
    expect(THUNDER_CLUSTER_P).toBe(0.35);
    expect(clustered / 400).toBeGreaterThanOrEqual(0.27);
    expect(clustered / 400).toBeLessThanOrEqual(0.43);
    // 簇内 1.8–5s / 常规 3.5–16.5s
    expect(inClusterMin).toBeGreaterThanOrEqual(1.8 - 0.02);
    expect(inClusterMax).toBeLessThanOrEqual(5 + 0.02);
    expect(normMin).toBeGreaterThanOrEqual(3.5 - 0.02);
    expect(normMax).toBeLessThanOrEqual(16.5 + 0.02);
  });

  it('簇最多 3 击：streak ≥ MAX 必出常规（防无限连击）', () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 50; i++) {
      expect(nextThunderStrike(0, THUNDER_CLUSTER_MAX, rng).inCluster, 'streak 到顶不许再连').toBe(
        false
      );
      expect(nextThunderStrike(0, THUNDER_CLUSTER_MAX + 5, rng).inCluster).toBe(false);
    }
  });

  it('常规段平方分布：短间隔多于长间隔（打破匀速循环感）', () => {
    const rng = mulberry32(99);
    let short = 0;
    const n = 400;
    for (let i = 0; i < n; i++) {
      const s = nextThunderStrike(0, 0, rng);
      if (!s.inCluster && s.frames / 60 < 8) short++;
    }
    // rng()*rng() 平方分布下 <8s 占常规段过半；均匀分布只会给 ~35%
    expect(short / n).toBeGreaterThan(0.2);
  });
});

describe('rainLook：雨强决定长短 / 快慢 / 斜度（毛毛雨与暴雨不是同一场雨换个密度）', () => {
  it('三条观感量都随 intensity 严格递增，且斜度恒 ≥ 0.05', () => {
    const pts = [0.35, 0.7, 1];
    const looks = pts.map((k) => rainLook(k));
    for (const key of ['lenMul', 'vyMul', 'slantK'] as const) {
      expect(looks[1]![key], `${key} 在 0.35→0.7 没涨`).toBeGreaterThan(looks[0]![key]);
      expect(looks[2]![key], `${key} 在 0.7→1 没涨`).toBeGreaterThan(looks[1]![key]);
    }
    for (const k of [0, 0.35, 0.7, 1]) {
      expect(rainLook(k).slantK, '雨丝垂直无风 → 与 fx.wind 的设计相悖').toBeGreaterThanOrEqual(0.05);
      expect(rainLook(k).lenMul).toBeGreaterThan(0);
      expect(rainLook(k).vyMul).toBeGreaterThan(0);
    }
  });
  it('确定性（同参同果）', () => {
    expect(rainLook(0.7)).toEqual(rainLook(0.7));
  });
});

describe('玻璃上的雨：滑痕 / 水股 / 窗台积水（雨天的第三层）', () => {
  it('滑痕：< 0.15 不画（雾/阴天玻璃是干的），0.35 < 0.7 ≤ 上限 26；确定性', () => {
    expect(glassStreakCount(W, 0)).toBe(0);
    expect(glassStreakCount(W, 0.1)).toBe(0);
    expect(glassStreakCount(W, 0.35)).toBeGreaterThan(0);
    expect(glassStreakCount(W, 0.35)).toBeLessThan(glassStreakCount(W, 0.7));
    expect(glassStreakCount(20000, 1), '滑痕必须封顶（否则玻璃结霜）').toBeLessThanOrEqual(26);
    expect(glassStreakCount(W, 0.35)).toBe(glassStreakCount(W, 0.35));
  });
  it('水股：只有暴雨级（≥0.85）才有；中雨 0.7 是 0', () => {
    expect(glassStreamCount(0.7), '中雨就挂不住水了？').toBe(0);
    expect(glassStreamCount(0.85)).toBeGreaterThanOrEqual(0);
    expect(glassStreamCount(1)).toBeGreaterThan(0);
    // 0.85 是严格边界：它之下全是 0，之上才有水股
    expect(glassStreamCount(0.849)).toBe(0);
    expect(glassStreamCount(0.851)).toBeGreaterThanOrEqual(0);
    expect(glassStreamCount(0.95)).toBeGreaterThanOrEqual(glassStreamCount(0.86));
  });
  it('窗台积水：中雨 0、暴雨 3px，恒在 0..3', () => {
    expect(sillWaterHeight(0.7)).toBe(0);
    expect(sillWaterHeight(0.849)).toBe(0);
    expect(sillWaterHeight(1)).toBe(3);
    for (let k = 0; k <= 1.0001; k += 0.01) {
      const v = sillWaterHeight(k);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(3);
      expect(Number.isInteger(v)).toBe(true);
    }
  });
});

describe('windowShake：风拍窗（整数位移、周期性、确定性）', () => {
  it('风小（0.3）恒 0；风大（0.85）在 210 帧周期内必有非零帧', () => {
    for (let f = 0; f < 420; f++) expect(windowShake(f, 0.3)).toBe(0);
    const hits = Array.from({ length: 210 }, (_, f) => windowShake(f, 0.85)).filter((v) => v !== 0);
    expect(hits.length, '210 帧里窗一次都没颤（风大却纹丝不动）').toBeGreaterThan(0);
    // 只在周期前 12 帧颤（每 3.5s 一阵），不是一直在抖
    for (let f = 12; f < 210; f++) expect(windowShake(f, 0.85)).toBe(0);
    expect(windowShake(100, 0.85), 'f ≥ 12 必须归零').toBe(0);
  });
  it('位移恒为整数、|dx| ≤ 2（像素语言不收半像素抖动）', () => {
    for (let f = 0; f < 420; f++) {
      for (const wind of [0.5, 0.6, 0.85, 1]) {
        const v = windowShake(f, wind);
        expect(Number.isInteger(v)).toBe(true);
        expect(Math.abs(v), `wind=${wind} frame=${f} 位移 ${v} 超出 ±2`).toBeLessThanOrEqual(2);
      }
    }
  });
  it('确定性：同参同果（不是逐帧随机抖）', () => {
    for (let f = 0; f < 210; f += 7) expect(windowShake(f, 0.85)).toBe(windowShake(f, 0.85));
    // 相邻周期的同一相位必须一致（真的有 210 帧周期）
    expect(windowShake(3, 0.85)).toBe(windowShake(3 + 210, 0.85));
    expect(windowShake(3, 0.85)).toBe(windowShake(3 + 420, 0.85));
  });
});

describe('genBolt：像素闪电折线', () => {
  const hy = 720;
  it('顶点全整数、x 落在安全边距内、y 单调向下、首点高、末点低', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const pts = genBolt(W, hy, mulberry32(seed));
      expect(pts.length).toBeGreaterThanOrEqual(2);
      expect(pts.length).toBeLessThanOrEqual(40); // 40 点上限（劈得到山后）
      for (const [k, p] of pts.entries()) {
        expect(Number.isInteger(p.x)).toBe(true);
        expect(Number.isInteger(p.y)).toBe(true);
        expect(p.x, `x=${p.x} 出界`).toBeGreaterThanOrEqual(8);
        expect(p.x).toBeLessThanOrEqual(W - 8);
        if (k > 0) expect(p.y, '闪电往上走了').toBeGreaterThanOrEqual(pts[k - 1]!.y);
      }
      expect(pts[0]!.y, '首点没落在云里').toBeLessThan(hy * 0.2);
      const last = pts[pts.length - 1]!;
      expect(
        last.y >= hy * 0.7 || pts.length === 14,
        `末点 y=${last.y}（hy*0.7=${hy * 0.7}）且只有 ${pts.length} 点`
      ).toBe(true);
    }
  });
  it('确定性：同 rng 同折线；不同 rng 不同折线（不是每次同一道闪电）', () => {
    expect(genBolt(W, hy, mulberry32(42))).toEqual(genBolt(W, hy, mulberry32(42)));
    expect(genBolt(W, hy, mulberry32(42))).not.toEqual(genBolt(W, hy, mulberry32(7)));
  });
  it('折线真的在折：x 有横向变化（不是一根竖直/斜棍）', () => {
    const pts = genBolt(W, hy, mulberry32(3));
    const xs = pts.map((p) => p.x);
    expect(Math.max(...xs) - Math.min(...xs), '闪电是一条直线').toBeGreaterThan(3);
  });
});
