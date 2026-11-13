import { expect, test, type Page } from '@playwright/test';
import { windowSpec } from '../../src/lib/window-room';
import { scrollHeroToTop } from './helpers/hero';

/**
 * 精修 roadmap 守卫（2026-10-30）
 *
 * 一条测试对应 roadmap 的一个条目；每条都带**反例思路**写进注释——
 * 改回旧写法必须红。
 */

const DESKTOP = { width: 1440, height: 900 };
const NARROW = { width: 390, height: 844 };

async function canvasSize(page: Page) {
  return page.evaluate(() => {
    const wrap = document.querySelector('.bgfx-canvas') as HTMLElement;
    const r = wrap.getBoundingClientRect();
    return { w: Math.max(1, Math.round(r.width)), h: Math.max(1, Math.round(r.height)) };
  });
}

const lum = (r: number, g: number, b: number) => {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};

test.describe('W1 · 导航与首屏', () => {
  test.use({ viewport: DESKTOP });

  test('N2 锚点跳转后标题不被导航压住（nav 底边 + 24px 呼吸）', async ({ page }) => {
    await page.goto('/', { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    for (const id of ['about', 'projects', 'skills', 'contact']) {
      await page.click(`header a[href="#${id}"]`);
      await page.waitForTimeout(1500);
      const m = await page.evaluate((sel) => {
        const t = document.querySelector(sel + ' .section-title')!.getBoundingClientRect();
        const n = document.querySelector('header.nav')!.getBoundingClientRect();
        return { titleTop: Math.round(t.top), navBottom: Math.round(n.bottom) };
      }, '#' + id);
      // 反例：把 scroll-margin-top 改回 0 → titleTop ≈ navBottom-1，差 < 24
      expect(
        m.titleTop - m.navBottom,
        `#${id} 标题顶边 ${m.titleTop} / 导航底边 ${m.navBottom} —— 差不足 24px，标题被压在导航上`
      ).toBeGreaterThanOrEqual(24);
    }
  });

  test('N3 首屏有滚动提示（窗台上），滚过 1/3 屏后消失', async ({ page }) => {
    await page.goto('/', { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(2200);
    const size = await canvasSize(page);
    const win = windowSpec(size.w, size.h);
    // 提示画在窗台台体 40% 处，中心 = 窗玻璃水平中心
    const cx = Math.round(win.x + win.w / 2);
    const cy = Math.round(win.y + win.h + win.sill * 0.4);
    const sample = async () => {
      const buf = await page.screenshot();
      const { PNG } = await import('pngjs');
      const png = PNG.sync.read(buf);
      let max = 0;
      for (let y = cy - 2; y <= cy + 5; y++)
        for (let x = cx - 6; x <= cx + 6; x++) {
          const i = (y * png.width + x) * 4;
          max = Math.max(max, lum(png.data[i]!, png.data[i + 1]!, png.data[i + 2]!));
        }
      return max;
    };
    const atLoad = await sample();
    await page.evaluate(() => window.scrollTo(0, window.innerHeight * 0.5));
    await page.waitForTimeout(600);
    const afterScroll = await sample();
    // 反例：删掉提示绘制 → atLoad 落到窗台底色，两者相等
    expect(
      atLoad - afterScroll,
      `滚动提示的亮度差只有 ${(atLoad - afterScroll).toFixed(4)} —— 首屏没有任何「往下」的信号`
    ).toBeGreaterThan(0.05);
  });
});

test.describe('W2 · 一条脊柱', () => {
  test.use({ viewport: DESKTOP });

  test('S1 首页五节标题左缘同一条竖线（±1px）', async ({ page }) => {
    await page.goto('/', { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    const lefts = await page.evaluate(() => {
      const out: Record<string, number> = {};
      for (const id of ['hero', 'about', 'projects', 'skills', 'contact']) {
        const t = document.querySelector('#' + id + ' .section-title');
        if (t) out[id] = Math.round(t.getBoundingClientRect().left);
      }
      return out;
    });
    const vals = Object.values(lefts);
    // 反例：把 about/contact 改回 container--prose 居中 → 388 vs 276
    expect(Math.max(...vals) - Math.min(...vals), `脊柱左缘不一致：${JSON.stringify(lefts)}`).toBeLessThanOrEqual(1);
  });
});

test.describe('W4 · 不空转', () => {
  test.use({ viewport: DESKTOP });

  test('S2 技能条与分数不再隔着半张面板', async ({ page }) => {
    await page.goto('/', { waitUntil: 'load' });
    await page.evaluate(() => document.getElementById('skills')!.scrollIntoView());
    await page.waitForTimeout(1200);
    const m = await page.evaluate(() => {
      const row = document.querySelector('#skills .row')!;
      const bar = row.querySelector('.skill-bar')!.getBoundingClientRect();
      const lvl = row.querySelector('.level')!.getBoundingClientRect();
      const cells = [...row.querySelectorAll('.skill-bar i')].map((i) => i.getBoundingClientRect().width);
      return {
        gap: Math.round(lvl.left - bar.right),
        barW: Math.round(bar.width),
        cellMin: Math.round(Math.min(...cells)),
      };
    });
    // 条本身必须真的画出来（2026-10-30 实测踩坑：width:100% 落在 auto 轨道里解成 0，
    // 条整个消失，而只量「右缘到分数」的判据照样绿 —— 元素存在 ≠ 画出来了）
    expect(m.barW, `技能条宽 ${m.barW}px —— 条没画出来`).toBeGreaterThan(200);
    expect(m.cellMin, `最小格宽 ${m.cellMin}px —— 格子塌了`).toBeGreaterThan(12);
    // 反例：grid 改回 `9rem 1fr auto` → 差 ~490px
    expect(m.gap, `技能条右缘到分数左缘 ${m.gap}px —— 眼睛连不上「条」和「4/5」`).toBeLessThan(80);
  });

  test('S3 404 待机态不是黑屏（START 前就有画面）', async ({ page }) => {
    await page.goto('/nope-xyz/', { waitUntil: 'load' });
    await page.waitForTimeout(900);
    const buf = await page.screenshot();
    const { PNG } = await import('pngjs');
    const png = PNG.sync.read(buf);
    const box = await page.evaluate(() => {
      const c = document.getElementById('mole-canvas')!.getBoundingClientRect();
      return { x: Math.round(c.x), y: Math.round(c.y), w: Math.round(c.width), h: Math.round(c.height) };
    });
    let lit = 0;
    for (let y = box.y + 2; y < box.y + box.h - 2; y++)
      for (let x = box.x + 2; x < box.x + box.w - 2; x++) {
        const i = (y * png.width + x) * 4;
        if (lum(png.data[i]!, png.data[i + 1]!, png.data[i + 2]!) > 0.08) lit++;
      }
    // 反例：删掉待机那一帧 draw() → canvas 全黑，lit = 0
    expect(lit, '404 待机态是一块黑屏——看起来像加载失败').toBeGreaterThan(200);
  });
});

test.describe('W3 · 一套光', () => {
  test.use({ viewport: DESKTOP });

  test('S6 桌面灯池边缘是抖动过渡，不是硬台阶', async ({ page }) => {
    await page.goto('/', { waitUntil: 'load' });
    await scrollHeroToTop(page);
    await page.waitForTimeout(1400);
    const size = await canvasSize(page);
    const buf = await page.screenshot();
    const { PNG } = await import('pngjs');
    const png = PNG.sync.read(buf);
    // 沿桌面受光面扫一行，数「亮度跳变 > 0.02 且无中间值」的硬边
    const y = await page.evaluate(() => {
      const wrap = document.querySelector('.bgfx-canvas') as HTMLElement;
      return Math.round(wrap.getBoundingClientRect().top);
    });
    void y;
    const scanY = Math.round(size.h * 0.83); // 桌面受光带附近
    const vals: number[] = [];
    for (let x = 40; x < size.w - 40; x++) {
      const i = (scanY * png.width + x) * 4;
      vals.push(lum(png.data[i]!, png.data[i + 1]!, png.data[i + 2]!));
    }
    let hard = 0;
    for (let i = 1; i < vals.length - 1; i++) {
      const a = vals[i - 1]!, b = vals[i]!;
      if (Math.abs(b - a) > 0.02) {
        const prev = vals[i - 2] ?? a;
        if (Math.abs(a - prev) < 0.002) hard++;
      }
    }
    // 反例：灯池改回三块 fillRect → 每阶两端各出一个硬跳变
    expect(hard, `桌面受光带上有 ${hard} 个硬台阶 —— 灯池和梯形光斑是两套画法`).toBeLessThan(6);
  });
});

test.describe('W5 · 窄屏', () => {
  test.use({ viewport: NARROW });

  test('S7 窄屏导航只留当前项的实心下划线（不再是一排虚线）', async ({ page }) => {
    await page.goto('/', { waitUntil: 'load' });
    await page.waitForTimeout(500);
    const dashed = await page.evaluate(() => {
      const links = [...document.querySelectorAll('header.nav a')];
      return links.filter((a) => {
        const c = getComputedStyle(a).borderBottomColor;
        return c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent';
      }).length;
    });
    // 反例：删掉 @media (max-width:560px) 那段 → 7 条虚线全在
    expect(dashed, `窄屏有 ${dashed} 条虚线下划线 —— 当前项被淹没`).toBe(0);
  });
});

test.describe('W6 · 首屏水面（S8）', () => {
  test.use({ viewport: DESKTOP });

  test('S8 水面与夜暖晕是连续渐变，不是硬边色带（时钟拨到凌晨 1 点）', async ({ page }) => {
    // glassWarm 只在夜里起晕（白昼返 null），所以必须把时钟拨到凌晨——
    // 用的是站内自己的时间旅行键 8bitme:clock-offset（src/lib/debug.ts 唯一键名源）
    const now = new Date();
    const target = new Date(now);
    target.setHours(1, 0, 0, 0);
    if (target <= now) target.setDate(target.getDate() + 1);
    await page.addInitScript(
      (off) => {
        try {
          localStorage.setItem('8bitme:clock-offset', String(off));
        } catch {
          /* ignore */
        }
      },
      target.getTime() - now.getTime()
    );
    await page.goto('/', { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(2400);

    const size = await canvasSize(page);
    const win = windowSpec(size.w, size.h);
    const buf = await page.screenshot();
    const { PNG } = await import('pngjs');
    const png = PNG.sync.read(buf);

    // 开阔水列：避开月亮倒影列（画面中偏右）与岸边芦苇
    const col = Math.round(win.x + win.w * 0.28);
    // 夜暖晕带 = 窗底往上 18%（glassWarm 的 total 口径）
    const glowTop = Math.round(win.y + win.h - win.h * 0.18);

    let run = 1;
    let maxRun = 1;
    let maxStep = 0;
    let prev: number | null = null;
    for (let y = glowTop; y < win.y + win.h - 1; y++) {
      const i = (y * png.width + col) * 4;
      const l = lum(png.data[i]!, png.data[i + 1]!, png.data[i + 2]!);
      if (prev !== null) {
        const d = Math.abs(l - prev);
        run = d < 0.0002 ? run + 1 : 1;
        maxRun = Math.max(maxRun, run);
        maxStep = Math.max(maxStep, d);
      }
      prev = l;
    }

    // 反例 1（改回三段 fillRect）：段内 50 行同色 → maxRun ≈ 50
    expect(maxRun, `水面最长同色段 ${maxRun} 行 —— 这是一条色带，不是渐变`).toBeLessThan(20);
    // 反例 2（段间硬边）：相邻行亮度跳变 ≈ 0.03–0.07
    expect(maxStep, `相邻行亮度跳变 ${maxStep.toFixed(4)} —— 渐变里有硬边`).toBeLessThan(0.012);
  });
});

test.describe('W7 · 文章目录（D3）', () => {
  test.use({ viewport: DESKTOP });

  test('D3 目录每条锚点都真的指向正文标题（id 与 Astro 同源）', async ({ page }) => {
    await page.goto('/blog/2026-09-19-ai-bottleneck-shift-postmortem', { waitUntil: 'load' });
    await page.waitForTimeout(600);
    const res = await page.evaluate(() => {
      const links = [...document.querySelectorAll('.toc a')].map((a) => a.getAttribute('href') ?? '');
      const missing = links.filter((h) => !document.querySelector(h));
      return { count: links.length, missing };
    });
    // 反例：把 buildToc 换成自己写的 slugify（去掉标点的方式不同）→ 锚点全部落空
    expect(res.count, '长文应当有目录（≥3 个 h2）').toBeGreaterThanOrEqual(3);
    expect(res.missing, `这些目录锚点在正文里不存在：${res.missing.join(', ')}`).toEqual([]);

    // 点第一条，目标标题要真的进入视口（不信 hash —— 目标不存在时浏览器也会写 hash）
    const first = page.locator('.toc a').first();
    const href = (await first.getAttribute('href'))!;
    await first.click();
    await page.waitForTimeout(600);
    await expect(page.locator(href)).toBeInViewport();
  });
});
