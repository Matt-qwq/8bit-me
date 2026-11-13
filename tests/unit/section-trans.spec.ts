import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BAYER8,
  CELL_CLEAR,
  CELL_FLASH,
  CELL_PENDING,
  CELL_VEIL,
  MAX_TOTAL,
  SECTION_TRANS,
  alive,
  ditherPhase,
  hash32,
  isFullCeremony,
  makeCeremony,
  reachFrom,
  reanchor,
  shouldFire,
  step,
  threshold,
  type BandRect,
  type Ceremony,
  type CeremonyRects,
  type GridPoint,
} from '../../src/lib/section-trans';

/**
 * section-trans —— 章节切换·抖动溶解转场的纯函数契约（规格 docs/specs/section-trans-v1.md）。
 * 守五类东西：
 *  ① 公式：阈值单调（同相位格比距离）、方向语义（破向外/聚向内）、无撞顶（收尾不硬切）
 *  ② 几何：整数格、格尺寸 = 视口宽/96、格铺满视口
 *  ③ 生命：四态转换、闪只活 1 步、有限步收敛（alive 到点即死）
 *  ④ 签名：同 (from,to) 恒同图案（hash32 + 相位），异章换一套
 *  ⑤ 接线：放炮节流矩阵 + 源码级契约（lib 零 DOM、仅 index 挂载、z 90、不劫持滚动）
 */

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf-8').replace(/\r\n/g, '\n');

/** 标准场景：960×800 视口，两章各占半屏（边界在 400） */
const RECTS: CeremonyRects = {
  w: 960,
  h: 800,
  from: { y0: 0, y1: 400 },
  to: { y0: 400, y1: 800 },
  originY: 400,
};

const SEED_HERO_ABOUT = hash32('hero', 'about');

function make(full = true, rects: CeremonyRects = RECTS): Ceremony {
  return makeCeremony('hero', 'about', 1, rects, SEED_HERO_ABOUT, full);
}

/** 按 16ms 帧推进到指定时刻（模拟真实帧循环，闪格有落定机会） */
function advanceTo(st: Ceremony, t: number): void {
  let guard = 0;
  while (st.t < t && st.phase !== 'done' && guard++ < 10000) step(st, 16);
}

function dist(st: Ceremony, c: number, r: number, center: GridPoint): number {
  return Math.hypot(c + 0.5 - center.gx, r + 0.5 - center.gy);
}

function cellsAt(st: Ceremony, center: GridPoint, min: number, max: number): number[] {
  const out: number[] = [];
  const reach = center === st.breakCenter ? st.breakReach : st.gatherReach;
  for (let r = 0; r < st.rows; r++) {
    for (let c = 0; c < st.cols; c++) {
      const d = dist(st, c, r, center) / reach;
      if (d >= min && d <= max) out.push(r * st.cols + c);
    }
  }
  return out;
}

const bayerAt = (st: Ceremony, c: number, r: number) =>
  BAYER8[(c + st.ox) & 7]![(r + st.oy) & 7]!;

describe('BAYER8 —— 8×8 拜耳矩阵（0..63 每个值恰一次）', () => {
  it('8 行 × 8 列、全部整数、0..63 各一次', () => {
    expect(BAYER8).toHaveLength(8);
    for (const row of BAYER8) expect(row).toHaveLength(8);
    const flat = BAYER8.flat();
    expect([...flat].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 64 }, (_, i) => i)
    );
  });
});

describe('章节签名：hash32 + 抖动相位', () => {
  it('hash32 确定性：同 (from,to) 恒同值；方向/顺序敏感（a→b ≠ b→a）', () => {
    expect(hash32('hero', 'about')).toBe(hash32('hero', 'about'));
    expect(hash32('hero', 'about')).not.toBe(hash32('about', 'hero'));
    expect(hash32('about', 'projects')).not.toBe(hash32('about', 'skills'));
    for (const v of [hash32('hero', 'about'), hash32('about', 'projects')]) {
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(2 ** 32);
    }
  });

  it('相位 (ox,oy) ∈ 0..7 且由 seed 唯一决定（同一场永远同一套图案）', () => {
    for (const [a, b] of [
      ['hero', 'about'],
      ['about', 'projects'],
      ['projects', 'skills'],
      ['skills', 'contact'],
    ] as const) {
      const p1 = ditherPhase(hash32(a, b));
      const p2 = ditherPhase(hash32(a, b));
      expect(p1).toEqual(p2);
      expect(p1.ox).toBeGreaterThanOrEqual(0);
      expect(p1.ox).toBeLessThanOrEqual(7);
      expect(p1.oy).toBeGreaterThanOrEqual(0);
      expect(p1.oy).toBeLessThanOrEqual(7);
    }
  });

  it('相位会散开（不是所有章都同一套）：四对章至少出现 2 种相位', () => {
    const pairs = [
      ['hero', 'about'],
      ['about', 'projects'],
      ['projects', 'skills'],
      ['skills', 'contact'],
    ] as const;
    const set = new Set(pairs.map(([a, b]) => JSON.stringify(ditherPhase(hash32(a, b)))));
    expect(set.size).toBeGreaterThanOrEqual(2);
  });

  it('makeCeremony 的图案是种子的确定性函数（同 seed 同图案）', () => {
    const a = make();
    const b = make();
    expect(a.ox).toBe(b.ox);
    expect(a.oy).toBe(b.oy);
    expect(a.cells.length).toBe(b.cells.length);
    const va: number[] = [];
    const vb: number[] = [];
    for (let r = 0; r < a.rows; r++) {
      for (let c = 0; c < a.cols; c++) {
        va.push(threshold(c, r, a.breakCenter, SECTION_TRANS.K_BREAK, a.breakReach, a.ox, a.oy));
        vb.push(threshold(c, r, b.breakCenter, SECTION_TRANS.K_BREAK, b.breakReach, b.ox, b.oy));
      }
    }
    expect(va).toEqual(vb);
  });
});

describe('阈值公式：单调、方向、无撞顶', () => {
  it('同相位格沿射线比距离：破 k>0 越远阈值越高、聚 k<0 越远阈值越低', () => {
    const st = make();
    let checkedBreak = 0;
    let checkedGather = 0;
    for (let r = 4; r < st.rows - 4; r += 3) {
      for (let c = 4; c < st.cols - 4; c += 3) {
        const c2 = c + 8;
        const r2 = r + 8;
        if (c2 >= st.cols || r2 >= st.rows) continue;
        // 同相位（+8 的整数倍不改变 (x&7)）
        expect(bayerAt(st, c2, r2)).toBe(bayerAt(st, c, r));
        const vNear = threshold(c, r, st.breakCenter, SECTION_TRANS.K_BREAK, st.breakReach, st.ox, st.oy);
        const vFar = threshold(c2, r2, st.breakCenter, SECTION_TRANS.K_BREAK, st.breakReach, st.ox, st.oy);
        if (dist(st, c2, r2, st.breakCenter) > dist(st, c, r, st.breakCenter)) {
          expect(vFar).toBeGreaterThan(vNear); // 破：远心阈值高 = 后切 = 波向外扩
          checkedBreak++;
        }
        const gNear = threshold(c, r, st.gatherCenter, SECTION_TRANS.K_GATHER, st.gatherReach, st.ox, st.oy);
        const gFar = threshold(c2, r2, st.gatherCenter, SECTION_TRANS.K_GATHER, st.gatherReach, st.ox, st.oy);
        if (dist(st, c2, r2, st.gatherCenter) > dist(st, c, r, st.gatherCenter)) {
          expect(gFar).toBeLessThan(gNear); // 聚：远心阈值低 = 先切 = 波从边缘收
          checkedGather++;
        }
      }
    }
    expect(checkedBreak).toBeGreaterThan(50);
    expect(checkedGather).toBeGreaterThan(50);
  });

  it('无撞顶：整幅格网的最大阈值 < 1（不会挤在 progress=1 同一帧爆开）', () => {
    for (const [center, k, reach] of [
      ['breakCenter', SECTION_TRANS.K_BREAK, 'breakReach'],
      ['gatherCenter', SECTION_TRANS.K_GATHER, 'gatherReach'],
    ] as const) {
      const st = make();
      let maxV = 0;
      let minV = 1;
      for (let r = 0; r < st.rows; r++) {
        for (let c = 0; c < st.cols; c++) {
          const v = threshold(c, r, st[center], k, st[reach], st.ox, st.oy);
          maxV = Math.max(maxV, v);
          minV = Math.min(minV, v);
        }
      }
      expect(maxV).toBeLessThan(1);
      expect(minV).toBeGreaterThanOrEqual(0);
    }
  });

  it('射程 = 波心到四角最远距离；阈值永远钳在 [0,1]', () => {
    const st = make();
    expect(st.breakReach).toBeCloseTo(reachFrom(st.breakCenter, st.cols, st.rows), 6);
    expect(st.breakReach).toBeGreaterThan(0);
    // 极端参数（斜率拉满）也不会越界
    for (const k of [5, -5, 0]) {
      for (let r = 0; r < st.rows; r += 7) {
        for (let c = 0; c < st.cols; c += 7) {
          const v = threshold(c, r, st.breakCenter, k, st.breakReach, st.ox, st.oy);
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});

describe('几何：整数格、格尺寸 = 视口宽/96、铺满视口', () => {
  it('1440 → 15px 整；格尺寸恒为整数；格列/行数铺满视口', () => {
    for (const w of [320, 375, 768, 1024, 1440, 2560]) {
      const st = make(true, { ...RECTS, w, h: 900 });
      expect(st.cell).toBe(Math.max(1, Math.round(w / SECTION_TRANS.CELLS_ACROSS)));
      expect(Number.isInteger(st.cell)).toBe(true);
      expect(st.cell).toBeGreaterThanOrEqual(1);
      expect(st.cols * st.cell).toBeGreaterThanOrEqual(w);
      expect(st.rows * st.cell).toBeGreaterThanOrEqual(900);
      expect(st.cells.length).toBe(st.cols * st.rows);
    }
    expect(make(true, { ...RECTS, w: 1440, h: 900 }).cell).toBe(15);
  });

  it('格坐标全是 cell 的整数倍（fillRect 整数格）', () => {
    const st = make();
    for (const c of [0, 1, 47, st.cols - 1]) expect(Number.isInteger(c * st.cell)).toBe(true);
    expect(st.cell).toBeGreaterThan(0);
  });

  it('波心 = 两章可见带的中心（x 取格网中线）', () => {
    const st = make();
    expect(st.breakCenter.gy).toBeCloseTo(400 / 2 / st.cell, 6);
    expect(st.gatherCenter.gy).toBeCloseTo((400 + 800) / 2 / st.cell, 6);
    expect(st.breakCenter.gx).toBeCloseTo((st.cols - 1) / 2, 6);
    expect(st.gatherCenter.gx).toBe(st.breakCenter.gx);
  });
});

describe('方向性（规格 §6 的核心用例）：破向外、聚向内', () => {
  it('破阶段 t≈1/3：近心格已切、远心格未动', () => {
    const st = make();
    advanceTo(st, 80); // progress ≈ 0.333
    expect(st.phase).toBe('break');
    const near = cellsAt(st, st.breakCenter, 0, 0.15);
    const far = cellsAt(st, st.breakCenter, 0.85, 1);
    expect(near.length).toBeGreaterThan(0);
    expect(far.length).toBeGreaterThan(0);
    const switched = (i: number) => st.cells[i] === CELL_FLASH || st.cells[i] === CELL_VEIL;
    expect(near.some(switched), '破：近心区应有格已熄').toBe(true);
    expect(far.every((i) => st.cells[i] === CELL_PENDING), '破：远心区应全未灭').toBe(true);
  });

  it('聚阶段 t≈1/3：远心格已点亮、近心格仍未灭（反向）', () => {
    const st = make();
    advanceTo(st, SECTION_TRANS.BREAK_DUR + 80); // 破走完 + 聚 progress ≈ 0.333
    expect(st.phase).toBe('gather');
    const near = cellsAt(st, st.gatherCenter, 0, 0.15);
    const far = cellsAt(st, st.gatherCenter, 0.85, 1);
    const lit = (i: number) => st.cells[i] === CELL_FLASH || st.cells[i] === CELL_CLEAR;
    expect(far.some(lit), '聚：远心区应有格已点亮').toBe(true);
    expect(
      near.every((i) => st.cells[i] === CELL_VEIL),
      '聚：近心区应仍全在暗处'
    ).toBe(true);
  });

  it('破走完时全场已在暗处（破→聚 交接把没来得及切的格补成暖暗）', () => {
    const st = make();
    advanceTo(st, SECTION_TRANS.BREAK_DUR + 16);
    expect(st.phase).toBe('gather');
    expect([...st.cells].some((s) => s === CELL_PENDING)).toBe(false);
    expect([...st.cells].some((s) => s === CELL_VEIL)).toBe(true);
  });

  it('仅聚（常规章界）：开场满格暖暗，没有破阶段', () => {
    const st = make(false);
    expect(st.full).toBe(false);
    expect(st.phase).toBe('gather');
    expect(st.total).toBe(SECTION_TRANS.GATHER_ONLY_DUR);
    expect([...st.cells].every((s) => s === CELL_VEIL)).toBe(true);
    expect([...st.cells].some((s) => s === CELL_PENDING)).toBe(false);
  });
});

describe('格生命：闪只活 1 步、有限步收敛', () => {
  it('本步新闪的格，下一步一律落定（冷暗），且闪格不再留在 flash', () => {
    const st = make();
    step(st, 16);
    const flashed = [...st.flashed].flatMap((v, i) => (v ? [i] : []));
    expect(flashed.length).toBeGreaterThan(0);
    step(st, 16);
    for (const i of flashed) expect(st.cells[i]).toBe(CELL_VEIL);
    expect([...st.flashed].length).toBe(st.cells.length);
  });

  it('整场 ≤750ms 预算；16ms 帧推进有限步收敛到 done', () => {
    expect(MAX_TOTAL).toBeLessThanOrEqual(750);
    const st = make();
    let frames = 0;
    while (alive(st) && frames++ < 1000) step(st, 16);
    expect(alive(st)).toBe(false);
    expect(st.phase).toBe('done');
    expect(frames).toBeLessThanOrEqual(Math.ceil(st.total / 16) + 2);
    expect(st.t).toBeGreaterThanOrEqual(st.total);
  });

  it('巨大 dt 一炮到底；done 后再 step 不改状态（幂等）', () => {
    const st = make();
    step(st, 100000);
    expect(st.phase).toBe('done');
    const snapshot = [...st.cells];
    step(st, 16);
    expect([...st.cells]).toEqual(snapshot);
  });

  it('alive：null / done 都是 false，只有进行中才是 true', () => {
    expect(alive(null)).toBe(false);
    const st = make();
    expect(alive(st)).toBe(true);
    step(st, 100000);
    expect(alive(st)).toBe(false);
  });

  it('步进过程里没有任何格永远留在 pending（收敛契约）', () => {
    const st = make();
    let frames = 0;
    while (alive(st) && frames++ < 1000) step(st, 16);
    expect([...st.cells].some((s) => s === CELL_PENDING)).toBe(false);
  });
});

describe('滚动联动：几何重锚 + 进度滚动项（「与滚动同一物理」）', () => {
  it('reanchor：波心跟着两章可见带中心走（滚动时仪式不飘在屏幕上）', () => {
    const st = make();
    const gy0 = st.breakCenter.gy;
    // 向下滚 200px：from 带变矮且中心上移，to 带变高；边界（起源线）跟着上移
    reanchor(st, {
      w: RECTS.w,
      h: RECTS.h,
      from: { y0: -200, y1: 200 },
      to: { y0: 200, y1: 800 },
      originY: 200,
    });
    expect(st.breakCenter.gy).toBeCloseTo(0 / st.cell, 6);
    expect(st.breakCenter.gy).toBeLessThan(gy0);
    expect(st.gatherCenter.gy).toBeCloseTo(500 / st.cell, 6);
    expect(st.originY).toBe(200);
    expect(st.breakReach).toBeCloseTo(reachFrom(st.breakCenter, st.cols, st.rows), 6);
    expect(st.gatherReach).toBeCloseTo(reachFrom(st.gatherCenter, st.cols, st.rows), 6);
  });

  it('reanchor 只动几何、不动格状态（格只会朝前走，不因波心移动而闪回）', () => {
    const st = make();
    advanceTo(st, 80);
    const before = [...st.cells];
    reanchor(st, {
      w: RECTS.w,
      h: RECTS.h,
      from: { y0: -300, y1: 100 },
      to: { y0: 100, y1: 800 },
      originY: 100,
    });
    expect([...st.cells]).toEqual(before);
  });

  it('滚动项推进：同样 dt 下带滚动量的场次走得更快（快滚被压缩）', () => {
    const slow = make();
    const fast = make();
    step(slow, 16);
    step(fast, 16, 60);
    expect(fast.t).toBeGreaterThan(slow.t);
    expect(fast.progress).toBeGreaterThan(slow.progress);
  });

  it('滚动项封顶：一帧跳几千像素也不能把整场仪式跳过（仍会经过破阶段）', () => {
    const st = make();
    step(st, 16, 99999);
    expect(st.phase).toBe('break');
    expect(st.progress).toBeGreaterThan(0);
    expect(st.progress).toBeLessThan(1);
  });

  it('滚动项不破收敛上界：连续大滚动仍有限步收敛到 done，且无格留在 pending', () => {
    const st = make();
    let n = 0;
    while (alive(st) && n++ < 200) step(st, 16, 500);
    expect(alive(st)).toBe(false);
    expect([...st.cells].some((s) => s === CELL_PENDING)).toBe(false);
  });

  it('滚动项不影响纯时间口径：不带滚动量时行为与从前一致', () => {
    const st = make();
    step(st, 80);
    expect(st.phase).toBe('break');
    expect(st.progress).toBeCloseTo(80 / SECTION_TRANS.BREAK_DUR, 6);
  });
});

describe('放炮裁决 shouldFire：节流矩阵', () => {
  const now = 10_000;
  it('同章不重放 / cur 空 / reduced 恒 false', () => {
    expect(shouldFire('about', 'about', now, 0, false)).toBe(false);
    expect(shouldFire(null, null, now, 0, false)).toBe(false);
    expect(shouldFire('hero', 'about', now, 0, true)).toBe(false);
    expect(shouldFire('hero', 'about', now, 0, true)).toBe(false);
  });
  it('两次仪式间隔 <900ms 不放；≥900ms 放', () => {
    expect(shouldFire('hero', 'about', now, now - 899, false)).toBe(false);
    expect(shouldFire('hero', 'about', now, now - 900, false)).toBe(true);
    expect(shouldFire('hero', 'about', now, now - 5000, false)).toBe(true);
  });
  it('从未放过（-Infinity）→ 第一次换班放炮', () => {
    expect(shouldFire('hero', 'about', now, Number.NEGATIVE_INFINITY, false)).toBe(true);
  });
  it('非法 now（NaN）不放炮（防定时器漂移炸出怪炮）', () => {
    expect(shouldFire('hero', 'about', Number.NaN, 0, false)).toBe(false);
  });
  it('仪式梯度：只有首次 window→hero 是完整双阶段（首屏现在是「窗」那一章，ADR-0027）', () => {
    expect(isFullCeremony(false, 'window', 'hero')).toBe(true);
    expect(isFullCeremony(true, 'window', 'hero')).toBe(false);
    // 旧的首次交接 hero→about 现在是第二次，只剩「仅聚」
    expect(isFullCeremony(false, 'hero', 'about')).toBe(false);
    expect(isFullCeremony(false, 'about', 'projects')).toBe(false);
    expect(isFullCeremony(false, 'about', 'hero')).toBe(false);
    // 反向（hero→window）也不是完整双阶段
    expect(isFullCeremony(false, 'hero', 'window')).toBe(false);
  });
});

describe('源码级契约（引用不指向不存在的东西）', () => {
  const lib = read('src/lib/section-trans.ts');
  const comp = read('src/components/SectionFx.astro');
  const index = read('src/pages/index.astro');
  const layout = read('src/layouts/BaseLayout.astro');

  it('纯逻辑模块零 DOM（不许出现 document / window / addEventListener）', () => {
    for (const banned of ['document.', 'window.', 'addEventListener', 'requestAnimationFrame']) {
      expect(lib.includes(banned), `section-trans.ts 出现 "${banned}"`).toBe(false);
    }
  });

  it('SectionFx 只在 index 页挂载（章节转场只属于一镜到底首页）', () => {
    expect(index).toContain('SectionFx');
    expect(index).toMatch(/<SectionFx\s*\/>/);
    expect(layout.includes('SectionFx')).toBe(false);
    for (const p of ['src/pages/404.astro', 'src/pages/blog/index.astro', 'src/pages/lab/index.astro']) {
      expect(read(p).includes('SectionFx'), `${p} 不该挂 SectionFx`).toBe(false);
    }
  });

  it('覆盖层契约：z 90、pointer-events none、fixed、接线 fx-runtime 的 alive', () => {
    expect(comp).toMatch(/z-index:\s*90/);
    expect(comp).toMatch(/pointer-events:\s*none/);
    expect(comp).toMatch(/position:\s*fixed/);
    expect(comp).toContain('createFxRuntime');
    expect(comp).toMatch(/shouldRun:\s*\(\)\s*=>\s*alive\(/);
    expect(comp).toContain("main#main > section[id]");
  });

  it('不劫持滚动：不锁 wheel/touch/keydown，不 preventDefault', () => {
    for (const banned of ["'wheel'", "'touchstart'", "'touchmove'", "'keydown'", 'preventDefault']) {
      expect(comp.includes(banned), `SectionFx 出现 "${banned}"`).toBe(false);
    }
  });

  it('窗口宽高与格尺寸来自源码常量（格数 96，不是写死的 px 表）', () => {
    expect(SECTION_TRANS.CELLS_ACROSS).toBe(96);
    expect(comp).toContain('SECTION_TRANS');
    expect(comp).not.toMatch(/cell\s*=\s*\d+\s*;/);
  });
});
