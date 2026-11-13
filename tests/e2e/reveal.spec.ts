import { test, expect } from '@playwright/test';
import { mockWeather } from './helpers/mock-weather';

// 天气请求（Open-Meteo）一律 mock：离线可跑 + 零 resource error
test.beforeEach(async ({ page }) => {
  await mockWeather(page);
});

/**
 * 章节进场编排（一镜到底版，2026-09 拆 fullpage 翻页骨架）：
 * docs/plans/home-scroll-reveal-redesign-2026-09.md（候选 A）。
 *
 * 守五类行为（全部行为性断言，不守「元素存在」）：
 *  ① 进入视口**依次**浮现：rAF 逐帧采样必须出现错峰混合态（老手法沿用——
 *     poll 碰 ~70ms 窗口是靠运气，逐帧采样才不漏帧）
 *  ② **一次性揭示**（Q2）：滚离再回不重放、不切出（连续滚动下重放 = 闪烁）
 *  ③ 快速往返滚动：采样序列终态收敛，一旦全可见永不回落
 *  ④ 无 JS 全可见：不藏卡片、网格平铺、受光带满宽、无分页器残留
 *  ⑤ 标题受光带真的以 steps() **整齿阶跃**扫入（pause + seek 量化采样）
 * 外加：reduced-motion 豁免护栏（WAAPI 不被 CSS !important 压制）与
 *      「wheel 不再被劫持」的原生滚动回归护栏。
 */

const CARDS = '#projects .pixel-panel.card';

test('进入视口依次浮现：逐帧采样出现错峰混合态，最终全部落定', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto('/');
  await page.waitForLoadState('networkidle');

  // 初始：projects 在首屏外 → 未揭示（0），不是「一开始就全亮」
  const before = await page.$$eval(CARDS, (els) =>
    els.map((e) => +getComputedStyle(e).opacity)
  );
  expect(before).toHaveLength(6);
  expect(before.every((o) => o === 0), `初始应全隐藏（实际 ${before.join(',')}）`).toBe(true);

  // 页内 rAF 逐帧采样（stagger 60ms + DUR 380ms 的混合窗口只有几百 ms，
  // 用 poll 去碰是赌时序——2026-09-08 字体时序一变就稳定翻红的旧教训）
  await page.evaluate(() => {
    const w = window as unknown as { __ops?: number[][]; __raf?: number };
    w.__ops = [];
    const tick = () => {
      const els = document.querySelectorAll('#projects .pixel-panel.card');
      w.__ops!.push([...els].map((e) => +getComputedStyle(e).opacity));
      w.__raf = requestAnimationFrame(tick);
    };
    tick();
  });

  await page.evaluate(() => document.querySelector('#projects')!.scrollIntoView({ block: 'center' }));

  await expect
    .poll(
      async () =>
        page.$$eval(CARDS, (els) => els.every((e) => +getComputedStyle(e).opacity > 0.95)),
      { timeout: 5000 }
    )
    .toBeTruthy();

  const sawCascade = await page.evaluate(() => {
    const w = window as unknown as { __ops?: number[][]; __raf?: number };
    if (w.__raf) cancelAnimationFrame(w.__raf);
    return (w.__ops ?? []).some((ops) => ops.some((o) => o > 0.6) && ops.some((o) => o < 0.4));
  });
  expect(sawCascade, '逐帧采样里没出现「部分已入场 / 部分未入场」的错峰中间态').toBe(true);

  expect(errors).toEqual([]);
});

test('首次揭示后不重放：滚离再回不隐藏、不闪（Q2）', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  await page.evaluate(() => document.querySelector('#projects')!.scrollIntoView({ block: 'center' }));
  await expect
    .poll(async () => page.$$eval(CARDS, (els) => els.every((e) => +getComputedStyle(e).opacity > 0.95)), {
      timeout: 5000,
    })
    .toBeTruthy();

  // 滚离：一次性揭示 = 没有 exit 动画，内容保持可见
  await page.evaluate(() => document.querySelector('#hero')!.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(700);
  const afterLeave = await page.$$eval(CARDS, (els) => els.map((e) => +getComputedStyle(e).opacity));
  expect(
    afterLeave.every((o) => o > 0.95),
    `滚离后卡片被切出/回落了（${afterLeave.map((o) => o.toFixed(2)).join(',')}）——旧翻页模型的 exit 重放回归了`
  ).toBe(true);

  // 再回来：逐帧采样不得出现任何回落（重放会从 0 起，第一帧就低于 0.95）
  await page.evaluate(() => document.querySelector('#projects')!.scrollIntoView({ block: 'center' }));
  const frames = await page.evaluate(
    () =>
      new Promise<number[][]>((resolve) => {
        const ops: number[][] = [];
        let n = 0;
        const tick = () => {
          const els = document.querySelectorAll('#projects .pixel-panel.card');
          ops.push([...els].map((e) => +getComputedStyle(e).opacity));
          if (++n < 24) requestAnimationFrame(tick);
          else resolve(ops);
        };
        tick();
      })
  );
  const dips = frames.filter((f) => f.some((o) => o < 0.95));
  expect(dips.length, `回看时出现 ${dips.length} 帧回落 = 揭示被重放了`).toBe(0);
});

test('快速往返滚动：采样序列终态收敛，全可见后永不回落', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  await page.evaluate(() => {
    const w = window as unknown as { __ops?: number[][]; __raf?: number };
    w.__ops = [];
    const tick = () => {
      const els = document.querySelectorAll('#projects .pixel-panel.card');
      w.__ops!.push([...els].map((e) => +getComputedStyle(e).opacity));
      w.__raf = requestAnimationFrame(tick);
    };
    tick();
  });

  // 快速往返 4 轮（instant；每站停 250ms——IO 按帧投递，不停留会漏投，
  // 那测的就不是「重放/闪烁」而是「IO 有没有看到」）
  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => {
      window.scrollTo({ top: document.querySelector('#projects')!.getBoundingClientRect().top + window.scrollY, behavior: 'instant' });
    });
    await page.waitForTimeout(250);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await page.waitForTimeout(250);
  }
  await page.evaluate(() => {
    window.scrollTo({ top: document.querySelector('#projects')!.getBoundingClientRect().top + window.scrollY, behavior: 'instant' });
  });

  await expect
    .poll(async () => page.$$eval(CARDS, (els) => els.every((e) => +getComputedStyle(e).opacity > 0.95)), {
      timeout: 5000,
    })
    .toBeTruthy();
  await page.waitForTimeout(500); // 让采样再多收几帧再判终态

  const ops = await page.evaluate(() => {
    const w = window as unknown as { __ops?: number[][]; __raf?: number };
    if (w.__raf) cancelAnimationFrame(w.__raf);
    return w.__ops ?? [];
  });
  expect(ops.length, '采样在空跑').toBeGreaterThan(30);

  const full = (f: number[]) => f.every((o) => o > 0.95);
  const firstFull = ops.findIndex(full);
  expect(firstFull, '采样序列从未到达全可见').toBeGreaterThanOrEqual(0);
  const laterDips = ops.slice(firstFull).filter((f) => !full(f));
  expect(laterDips.length, `全可见之后又出现 ${laterDips.length} 帧回落（闪烁残留）`).toBe(0);
  expect(full(ops[ops.length - 1]), '终态应收敛到全可见').toBe(true);
});

test('原生滚动回归：wheel 不再被劫持（连续累积、无整屏跳变、无滚动锁）', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  const h = page.viewportSize()!.height;
  const y0 = await page.evaluate(() => Math.round(window.scrollY));

  await page.mouse.wheel(0, 240);
  await page.waitForTimeout(500);
  const y1 = await page.evaluate(() => Math.round(window.scrollY));
  expect(y1, '一手势必须真的滚动（不许被 preventDefault 吞掉）').toBeGreaterThan(y0);
  // 旧 fullpage 骨架一手势必翻 ≥0.85 视口（busy 锁最多 1.6）；原生滚动远小于它
  expect(y1 - y0, `一手势翻了 ${y1 - y0}px，疑似整屏翻页骨架复活`).toBeLessThan(h * 0.8);

  await page.mouse.wheel(0, 240);
  await page.waitForTimeout(500);
  const y2 = await page.evaluate(() => Math.round(window.scrollY));
  expect(y2, '第二手势必须继续累积（busy 锁复活会吃掉它）').toBeGreaterThan(y1);
});

test('无 JS：内容全可见（不藏卡片、受光带满宽、无分页器残留）', async ({ browser }) => {
  const ctx = await browser.newContext({ javaScriptEnabled: false });
  const page = await ctx.newPage();
  await page.goto('/');

  // 没有 JS 就没有 reveal-card（隐藏只由 JS 加类承担）
  expect(await page.$$eval('.reveal-card', (els) => els.length)).toBe(0);

  const cards = await page.$$eval(CARDS, (els) =>
    els.map((e) => ({
      op: +getComputedStyle(e).opacity,
      h: e.getBoundingClientRect().height,
      w: e.getBoundingClientRect().width,
    }))
  );
  expect(cards, '6 卡应全部平铺').toHaveLength(6);
  expect(
    cards.every((c) => c.op > 0.95 && c.h > 0 && c.w > 0),
    '无 JS 下有卡片被藏（display:none / opacity:0）'
  ).toBe(true);

  // 标题受光带：无 JS = 满宽可见（一次性揭示不藏结构）
  const rule = await page.evaluate(() => {
    const t = document.querySelector('#about .section-title')!;
    return {
      after: parseFloat(getComputedStyle(t, '::after').width),
      box: t.getBoundingClientRect().width,
      titleOp: +getComputedStyle(t).opacity,
    };
  });
  expect(rule.titleOp).toBeGreaterThan(0.95);
  expect(rule.after, `无 JS 下受光带应满宽（${rule.after} / ${rule.box}）`).toBeCloseTo(rule.box, 0);

  // 翻页骨架残留：分页器/子屏必须已退役
  expect(await page.$$eval('.proj-pager, .proj-page, .subpages', (els) => els.length)).toBe(0);

  await ctx.close();
});

test('标题受光带以 steps() 整齿阶跃扫入（pause + seek 量化采样）', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.querySelector('#about')!.scrollIntoView({ block: 'center' }));
  // 等本章揭示落定（title delay 0 + DUR 380ms，fill:both 停在满宽）
  await expect
    .poll(
      async () =>
        page.$eval('#about .section-title', (e) => +getComputedStyle(e).opacity),
      { timeout: 5000 }
    )
    .toBeGreaterThan(0.95);

  const r = await page.evaluate(() => {
    const t = document.querySelector('#about .section-title') as HTMLElement;
    // 受光带是 ::after 上的 WAAPI 动画（reveal 接线）；此刻只有 about 被揭示过
    const anims = document
      .getAnimations()
      .filter(
        (a): a is Animation =>
          (a.effect as KeyframeEffect | null)?.pseudoElement === '::after'
      );
    if (anims.length !== 1) return { err: `::after 动画数 = ${anims.length}` };
    const anim = anims[0]!;
    anim.pause();
    const dur = (anim.effect as KeyframeEffect).getTiming().duration as number;
    if (!dur) return { err: 'duration = 0' };
    const box = t.getBoundingClientRect().width;
    const teeth = Math.max(1, Math.ceil(box / 16)); // 与 sweepTeeth 同式（宽度/TOOTH 上取整）
    const unit = box / teeth; // 整齿步长：steps() 的每次跳变 = 1 齿
    const N = teeth * 2; // 2× 齿数采样：量化值必然出现重复（线性插值不会）
    const widths: number[] = [];
    for (let i = 0; i <= N; i++) {
      anim.currentTime = (dur * i) / N;
      widths.push(parseFloat(getComputedStyle(t, '::after').width));
    }
    anim.finish();
    return { box, teeth, unit, widths };
  });

  expect(r.err, r.err ?? '').toBeFalsy();
  const { box, teeth, unit, widths } = r as { box: number; teeth: number; unit: number; widths: number[] };

  // 首帧 0、末帧满宽
  expect(widths[0], `首帧应为 0（实际 ${widths[0]}）`).toBeLessThan(1);
  expect(widths[widths.length - 1], '终帧应满宽').toBeCloseTo(box, 0);
  // 单调不减（只朝一个方向扫）
  for (let i = 1; i < widths.length; i++) {
    expect(widths[i], `第 ${i} 帧回退了（${widths[i - 1]} → ${widths[i]}）`).toBeGreaterThanOrEqual(
      widths[i - 1]! - 0.5
    );
  }
  // 量化（steps 的硬签名）：每一帧都落在整齿格点上（±1px 浮点容差）
  const offGrid = widths.filter((w) => {
    const k = Math.round(w / unit);
    return Math.abs(w - k * unit) > 1;
  });
  expect(offGrid.length, `${offGrid.length} 帧不在整齿格点上（疑似线性插值冒充 steps）`).toBe(0);
  // 阶跃足够多（不是 2 格装样子）
  const distinct = new Set(widths.map((w) => Math.round(w / unit))).size;
  expect(distinct, `可见阶跃数只有 ${distinct}（齿数 ${teeth}）`).toBeGreaterThanOrEqual(
    Math.min(10, teeth)
  );
});

test.describe('reduced-motion 豁免护栏', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' } });

  test('WAAPI 揭示照常播，且一次性不切出', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(String(e)));

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // 逐帧采样（同 ① 手法）
    await page.evaluate(() => {
      const w = window as unknown as { __ops?: number[][]; __raf?: number };
      w.__ops = [];
      const tick = () => {
        const els = document.querySelectorAll('#projects .pixel-panel.card');
        w.__ops!.push([...els].map((e) => +getComputedStyle(e).opacity));
        w.__raf = requestAnimationFrame(tick);
      };
      tick();
    });

    await page.evaluate(() => document.querySelector('#projects')!.scrollIntoView({ block: 'center' }));

    // reduced-motion 下仍须依次切入（WAAPI 天然绕过 CSS !important 压制；
    // 若有人改用 CSS transition/class 门控揭示，此断言变红 = 护栏生效）
    await expect
      .poll(async () => page.$$eval(CARDS, (els) => els.every((e) => +getComputedStyle(e).opacity > 0.95)), {
        timeout: 5000,
      })
      .toBeTruthy();

    const sawCascade = await page.evaluate(() => {
      const w = window as unknown as { __ops?: number[][]; __raf?: number };
      if (w.__raf) cancelAnimationFrame(w.__raf);
      return (w.__ops ?? []).some((ops) => ops.some((o) => o > 0.6) && ops.some((o) => o < 0.4));
    });
    expect(sawCascade, 'reduce 下逐帧采样没出现错峰中间态（揭示被压成瞬时/被禁）').toBe(true);

    // 滚离再回：reduce 下同样一次性，不切出不重放
    await page.evaluate(() => document.querySelector('#hero')!.scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(600);
    await page.evaluate(() => document.querySelector('#projects')!.scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(600);
    const ops = await page.$$eval(CARDS, (els) => els.map((e) => +getComputedStyle(e).opacity));
    expect(
      ops.every((o) => o > 0.95),
      `reduce 下滚离再回出现回落（${ops.map((o) => o.toFixed(2)).join(',')}）`
    ).toBe(true);

    expect(errors).toEqual([]);
  });
});
