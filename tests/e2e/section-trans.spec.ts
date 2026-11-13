import { expect, test, type Page } from '@playwright/test';
import { mockWeather } from './helpers/mock-weather';

/**
 * 章节切换·抖动溶解转场（docs/specs/section-trans-v1.md / ADR-0026）e2e：
 * - 只挂首页；加载零炮；同章不重放；reduced 零像素；零布局位移
 * - 跨章时画布真的出格网、且逐帧在变（不是一帧静态贴图）
 * - 首次 window→hero 的破/聚两种闪色都可辨（text 极性 vs accent）——ADR-0027
 *   后首炮改成 window→hero（旧 hero→about 成了第二炮，且不再走完整双阶段）
 * - 仪式中滚动继续前进（不劫持滚动、不锁 body）
 * 判据一律从源码/实测派生：颜色取 computedStyle 的 --c-*，不写死色值。
 */

test.beforeEach(async ({ page }) => {
  await mockWeather(page);
});

/** 画布采样：非透明像素数 + 去重色数 + 像素校验和（全画布扫，dpr=1 时像素=CSS px） */
async function sample(page: Page) {
  return page.evaluate(() => {
    const c = document.getElementById('sectionfx-canvas') as HTMLCanvasElement | null;
    if (!c || c.width === 0) return { drawn: 0, distinct: 0, hash: 0 };
    const ctx = c.getContext('2d');
    if (!ctx) return { drawn: 0, distinct: 0, hash: 0 };
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const seen = new Set<number>();
    let drawn = 0;
    let hash = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      drawn++;
      const v = (((d[i]! << 16) | (d[i + 1]! << 8) | d[i + 2]!) >>> 0);
      seen.add(v);
      hash = (Math.imul(hash, 31) + v) >>> 0;
    }
    return { drawn, distinct: seen.size, hash };
  });
}

/** 把某章的顶推到视口中线之下 20px —— 激活章换班（触发转场） */
async function crossInto(page: Page, sel: string): Promise<void> {
  await page.evaluate((s) => {
    const el = document.querySelector(s) as HTMLElement;
    const top = el.getBoundingClientRect().top + window.scrollY;
    window.scrollTo({
      top: top - window.innerHeight * 0.5 + 20,
      behavior: 'instant' as ScrollBehavior,
    });
  }, sel);
}

test('覆盖层只挂首页：内页零残留', async ({ page }) => {
  await page.goto('/blog', { waitUntil: 'load' });
  expect(await page.locator('#sectionfx-canvas').count()).toBe(0);
  await page.goto('/', { waitUntil: 'load' });
  expect(await page.locator('#sectionfx-canvas').count()).toBe(1);
  const box = await page.evaluate(() => {
    const el = document.querySelector('.section-fx') as HTMLElement;
    const cs = getComputedStyle(el);
    return { position: cs.position, pointerEvents: cs.pointerEvents, zIndex: cs.zIndex };
  });
  expect(box.position).toBe('fixed');
  expect(box.pointerEvents).toBe('none');
  expect(Number(box.zIndex)).toBe(90);
});

test('加载/入场零炮：首屏静置画布全空', async ({ page }) => {
  await page.goto('/', { waitUntil: 'load' });
  await page.waitForTimeout(450);
  expect((await sample(page)).drawn).toBe(0);
});

test('跨章时 canvas 出现格网，且逐帧在变（不是静态贴图）', async ({ page }) => {
  await page.goto('/', { waitUntil: 'load' });
  await page.waitForTimeout(150);
  const frames = await page.evaluate(async () => {
    const c = document.getElementById('sectionfx-canvas') as HTMLCanvasElement;
    const ctx = c.getContext('2d')!;
    const snap = () => {
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let drawn = 0;
      let hash = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] === 0) continue;
        drawn++;
        hash = (Math.imul(hash, 31) + (((d[i]! << 16) | (d[i + 1]! << 8) | d[i + 2]!) >>> 0)) >>> 0;
      }
      return { drawn, hash };
    };
    const about = document.querySelector('#about') as HTMLElement;
    const top = about.getBoundingClientRect().top + window.scrollY - window.innerHeight * 0.5 + 20;
    window.scrollTo({ top, behavior: 'instant' as ScrollBehavior });
    const out: { drawn: number; hash: number }[] = [];
    await new Promise<void>((resolve) => {
      let n = 0;
      const tick = () => {
        const s = snap();
        if (s.drawn > 0) out.push(s);
        if (out.length >= 2 || n++ > 240) resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    return out;
  });
  expect(frames.length, '跨章应真的放出格网').toBe(2);
  expect(frames[0]!.drawn).toBeGreaterThan(0);
  expect(frames[1]!.hash, '相邻两帧应不同（波在推进）').not.toBe(frames[0]!.hash);
});

test('首次 window→hero：破闪 text 极性、聚闪 accent，两色都可辨（ADR-0027 首炮）', async ({ page }) => {
  await page.goto('/', { waitUntil: 'load' });
  const colors = await page.evaluate(async () => {
    const c = document.getElementById('sectionfx-canvas') as HTMLCanvasElement;
    const ctx = c.getContext('2d')!;
    const seen = new Set<number>();
    // 首炮 = 从第 0 章（#window，整扇窗）跨进第 1 章（#hero，工位）——
    // isFullCeremony 只认这一对（破+聚+光束），hero→about 只是「仅聚」。
    const hero = document.querySelector('#hero') as HTMLElement;
    const top = hero.getBoundingClientRect().top + window.scrollY - window.innerHeight * 0.5 + 20;
    const t0 = performance.now();
    let scrolled = false;
    await new Promise<void>((resolve) => {
      const tick = () => {
        if (!scrolled && performance.now() - t0 > 50) {
          scrolled = true;
          window.scrollTo({ top, behavior: 'instant' as ScrollBehavior });
        }
        const d = ctx.getImageData(0, 0, c.width, c.height).data;
        for (let i = 0; i < d.length; i += 16) {
          if (d[i + 3]! > 200) {
            seen.add((((d[i]! << 16) | (d[i + 1]! << 8) | d[i + 2]!) >>> 0));
          }
        }
        if (performance.now() - t0 < 1600) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
    return [...seen];
  });
  const vars = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    return {
      text: cs.getPropertyValue('--c-text').trim(),
      accent: cs.getPropertyValue('--c-accent').trim(),
    };
  });
  const rgb = (h: string): number =>
    (((parseInt(h.slice(1, 3), 16) << 16) |
      (parseInt(h.slice(3, 5), 16) << 8) |
      parseInt(h.slice(5, 7), 16)) >>>
      0);
  // 破阶段的闪用 --c-text（冷暗脉，灯丝断）；只有完整双阶段才有破——
  // 若首炮退化成「仅聚」（比如 window→hero 的配对没接上），这里会红。
  expect(colors, '破阶段应出现 --c-text 极性的闪').toContain(rgb(vars.text));
  expect(colors, '聚阶段应出现 --c-accent 的闪').toContain(rgb(vars.accent));
});

test('仪式进行中滚动继续前进（不劫持、不锁 body）', async ({ page }) => {
  await page.goto('/', { waitUntil: 'load' });
  await crossInto(page, '#about');
  await expect
    .poll(async () => (await sample(page)).drawn, { timeout: 4000 })
    .toBeGreaterThan(0);
  const before = await page.evaluate(() => window.scrollY);
  await page.evaluate(() => window.scrollBy(0, 120));
  await page.waitForTimeout(80);
  const after = await page.evaluate(() => window.scrollY);
  expect(after, '仪式中滚动不被劫持').toBeGreaterThan(before);
  const locked = await page.evaluate(() => {
    const b = getComputedStyle(document.body).overflow;
    const h = getComputedStyle(document.documentElement).overflow;
    return b === 'hidden' || h === 'hidden';
  });
  expect(locked).toBe(false);
});

test('零布局位移：仪式期间文档高度与参照元素的布局位不变（transform 不算）', async ({ page }) => {
  await page.goto('/', { waitUntil: 'load' });
  // 用 offsetTop 链（布局量）而非 getBoundingClientRect：后者会被入场 reveal 的
  // translateY 污染——那不是布局位移，是同一套进场动画。
  const probe = () =>
    page.evaluate(() => {
      const el = document.querySelector('#about .section-title') as HTMLElement;
      let top = 0;
      for (let n: HTMLElement | null = el; n; n = n.offsetParent as HTMLElement | null) {
        top += n.offsetTop;
      }
      return {
        docH: document.documentElement.scrollHeight,
        top,
        width: el.offsetWidth,
      };
    });
  const before = await probe();
  await crossInto(page, '#about');
  await expect
    .poll(async () => (await sample(page)).drawn, { timeout: 4000 })
    .toBeGreaterThan(0);
  const during = await probe();
  expect(during.docH).toBe(before.docH);
  expect(during.top).toBe(before.top);
  expect(during.width).toBe(before.width);
});

test('同章内重复滚动不重放（换班才放炮）', async ({ page }) => {
  await page.goto('/', { waitUntil: 'load' });
  await crossInto(page, '#about');
  await expect
    .poll(async () => (await sample(page)).drawn, { timeout: 4000 })
    .toBeGreaterThan(0);
  // 等这一场跑完（整场 ≤750ms）
  await page.waitForTimeout(1100);
  expect((await sample(page)).drawn, '仪式应收场（画布清空）').toBe(0);
  await page.evaluate(() => window.scrollBy(0, 140));
  await page.waitForTimeout(350);
  expect((await sample(page)).drawn, '同章不重放').toBe(0);
});

test('prefers-reduced-motion：跨章零像素（瞬切、零仪式）', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/', { waitUntil: 'load' });
  await crossInto(page, '#about');
  await page.waitForTimeout(400);
  expect((await sample(page)).drawn, 'reduced 下零像素').toBe(0);
  await crossInto(page, '#projects');
  await page.waitForTimeout(400);
  expect((await sample(page)).drawn, 'reduced 下换章也不放炮').toBe(0);
});
