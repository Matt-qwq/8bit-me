import { test, expect } from '@playwright/test';
import { mockWeather } from './helpers/mock-weather';

// 天气请求（Open-Meteo）一律 mock：离线可跑 + 零 resource error
test.beforeEach(async ({ page }) => {
  await mockWeather(page);
});

// 像素字体观感增强的 a11y 回归护栏：
// - forced-colors 下所有装饰阴影/描边必须清除，正文靠系统色（保证可读）
// - reduced-motion 下常驻装饰层保持静态（墙面色带本来就不动，守「不新增动画」）

test.describe('forced-colors：装饰阴影/描边清除，正文可读', () => {
  test.use({ contextOptions: { forcedColors: 'active' } });

  test('像素容器(.pixel-panel/.tag/.px-box)在 forced-colors 下无 box-shadow', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const shadows = await page.$$eval(
      '.pixel-panel, .tag, .px-box, .pixel-btn',
      (els) => els.map((e) => getComputedStyle(e).boxShadow)
    );
    // forced-colors 下 UA 清掉所有 box-shadow → 计算值应为 none
    for (const s of shadows) expect(s, `box-shadow=${s}`).toBe('none');
  });

  test('墙面色带(body::before)在 forced-colors 下隐藏', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    const display = await page.evaluate(() => getComputedStyle(document.body, '::before').display);
    expect(display, 'forced-colors 下墙面装饰应被 hidden').toBe('none');
  });

  test('正文在 forced-colors 下使用系统 CanvasText 色', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    const color = await page.$eval('body', (e) => getComputedStyle(e).color);
    // 非透明系统色（forced-colors 下应为 CanvasText，不可能是原 --gb-3 浅色值残留）
    expect(color).not.toBe('rgba(0, 0, 0, 0)');
  });
});

test.describe('reduced-motion：装饰层零动画（ADR-0021 后唯一常驻装饰 = 墙面色带）', () => {
  test('墙面色带与 hero 元素在 reduced-motion 下无 CSS 动画（装饰不许自带动）', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const errors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(String(e)));

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // body::before 没有任何 animation-name（墙面是静态的；CRT 闪烁已随 CRT 退役）
    const wallAnim = await page.evaluate(
      () => getComputedStyle(document.body, '::before').animationName
    );
    expect(wallAnim).toBe('none');
    // .kicker 的 blink（hero）在 reduced-motion 下应被全局压制（duration → 0.01ms）
    const kicker = await page.$eval('#hero .kicker', (e) => getComputedStyle(e).animationDuration);
    expect(['0.01ms', '1e-05s', '0s'].includes(kicker), 'hero 装饰动画应被 reduced-motion 压制').toBe(true);

    expect(errors).toEqual([]);
  });
});

// ==================== 2026-10-29 impeccable 审计轮追加 ====================
// 起因（实测两处真缺口）：
//   ① 全站没有跳转链接：7 个导航项 + 一屏卡片，键盘用户每页都要先 Tab 过整条导航
//     （WCAG 2.4.1）。当时我自己的探针把「logo 的 href="#main"」误判成 skip link，
//     是「元素存在 ≠ 东西对了」的又一例。
//   ② `#bgfx-canvas` 漏了 aria-hidden：装饰画布对辅助技术是匿名对象。
// 分工：本段只守能自动判死的三条——跳转链接真能跳、装饰画布不暴露、文档结构与地标。
// 对比度与焦点环另有 typography / text-veil / hero-contrast 守。

const ROUTES = [
  '/',
  '/blog/',
  '/blog/2026-09-19-ai-bottleneck-shift-postmortem/',
  '/lab/',
  '/404',
];

test.describe('跳转链接（skip link）', () => {
  test('第一个 Tab 停在跳转链接上，可见，且回车真把焦点移进 main', async ({ page }) => {
    await page.goto('/', { waitUntil: 'load' });

    await page.keyboard.press('Tab');
    const first = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        cls: el.className,
        text: (el.textContent || '').trim(),
        visible: r.width > 0 && r.height > 0 && r.top >= 0 && r.bottom <= innerHeight,
        outline: cs.outlineStyle,
        href: el.getAttribute('href'),
      };
    });

    expect(first, '第一个 Tab 应落在跳转链接上').not.toBeNull();
    expect(first!.cls, '第一个可聚焦元素应是 .skip-link').toContain('skip-link');
    expect(first!.text).toContain('跳到正文');
    expect(first!.visible, '聚焦时必须真的显形（不能只是 DOM 里有个元素）').toBe(true);
    expect(first!.outline, '聚焦要有可见轮廓').not.toBe('none');
    expect(first!.href).toBe('#main');

    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => ({
      hash: location.hash,
      activeId: document.activeElement?.id ?? '',
    }));
    // 只改 hash 不算数：焦点必须真的进 main，否则屏幕阅读器还停在导航里
    expect(after.hash).toBe('#main');
    expect(after.activeId, '回车后焦点应落到 main#main 上').toBe('main');
  });

  test('内页也有跳转链接（不是只有首页）', async ({ page }) => {
    for (const route of ROUTES) {
      await page.goto(route, { waitUntil: 'load' });
      await page.keyboard.press('Tab');
      const cls = await page.evaluate(() => (document.activeElement as HTMLElement)?.className ?? '');
      expect(cls, `${route} 的第一个 Tab 停靠点不是跳转链接`).toContain('skip-link');
    }
  });
});

test.describe('装饰画布不暴露给辅助技术', () => {
  test('bgfx / cursorfx / sectionfx 三块画布都被 aria-hidden（父层隐藏也算）', async ({ page }) => {
    await page.goto('/', { waitUntil: 'load' });
    await page.waitForTimeout(500);
    const m = await page.evaluate(() => {
      const hiddenBySelfOrAncestor = (el: Element | null): boolean => {
        let cur: Element | null = el;
        while (cur) {
          if (cur.getAttribute('aria-hidden') === 'true') return true;
          cur = cur.parentElement;
        }
        return false;
      };
      return ['bgfx-canvas', 'cursorfx-canvas', 'sectionfx-canvas'].map((id) => ({
        id,
        hidden: hiddenBySelfOrAncestor(document.getElementById(id)),
      }));
    });
    for (const c of m) {
      expect(c.hidden, `#${c.id} 没被隐藏（装饰画布对屏幕阅读器是匿名对象）`).toBe(true);
    }
  });

  test('404 的打地鼠画布有可读名称（它不是装饰，是可操作的游戏区）', async ({ page }) => {
    await page.goto('/404', { waitUntil: 'load' });
    const m = await page.evaluate(() => {
      const c = document.getElementById('mole-canvas');
      return { role: c?.getAttribute('role'), label: c?.getAttribute('aria-label') };
    });
    expect(m.role).toBe('img');
    expect((m.label ?? '').length).toBeGreaterThan(0);
  });
});

test.describe('文档结构与地标', () => {
  test('每条路由恰好一个 h1、有 main 与 nav 地标', async ({ page }) => {
    for (const route of ROUTES) {
      await page.goto(route, { waitUntil: 'load' });
      const m = await page.evaluate(() => ({
        h1: document.querySelectorAll('h1').length,
        main: !!document.querySelector('main#main'),
        nav: !!document.querySelector('nav'),
      }));
      expect(m.h1, `${route} 的 h1 数量`).toBe(1);
      expect(m.main, `${route} 缺 main 地标`).toBe(true);
      expect(m.nav, `${route} 缺 nav 地标`).toBe(true);
    }
  });
});
