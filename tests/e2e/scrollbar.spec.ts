import { expect, test } from '@playwright/test';
import { MODES } from '../../src/lib/themes';

/**
 * 像素滚动条（ADR-0012）——**能自动化的部分只有级联，不是绘制**。
 *
 * 实测结论（Chrome 152 headless）：headless 一律用 overlay 滚动条，
 * 既不占布局宽度（innerWidth - clientWidth === 0）也不被截图捕获，
 * 所以「滚动条画成什么样」测不了、也别浪费用例。但
 * `getComputedStyle(el, '::-webkit-scrollbar-thumb')` 能取到**级联后的值**，
 * 足以拦住所有静默失效：主题没跟随、隐藏滚动条被 scrollbar-color 反杀、
 * Gecko 门误开、窄屏 token 没生效。绘制观感仍由作者本地预览验收。
 */

const hexToRgb = (hex: string): string => {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
};

const readScrollbar = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const g = (el: Element, sel: string, prop: string) =>
      getComputedStyle(el, sel).getPropertyValue(prop);
    const root = document.documentElement;
    return {
      thumbBg: g(root, '::-webkit-scrollbar-thumb', 'background-color'),
      thumbShadow: g(root, '::-webkit-scrollbar-thumb', 'box-shadow'),
      thumbMin: g(root, '::-webkit-scrollbar-thumb', 'min-height'),
      trackBg: g(root, '::-webkit-scrollbar-track', 'background-color'),
      size: g(root, '::-webkit-scrollbar', 'width'),
      standardScrollbarColor: getComputedStyle(root).scrollbarColor,
    };
  });

test('滚动条级联：两档模式各取本档 accent 游标 / bg 空芯', async ({ page }) => {
  await page.goto('/');
  for (const t of MODES) {
    await page.evaluate((key) => {
      document.documentElement.dataset.mode = key;
    }, t.key);
    const sb = await readScrollbar(page);
    expect(sb.thumbShadow, `${t.key} 游标框 = 2px accent`).toContain(hexToRgb(t.colors.accent));
    expect(sb.thumbBg, `${t.key} 未点亮空芯 = bg`).toBe(hexToRgb(t.colors.bg));
    expect(sb.trackBg, `${t.key} 轨道底 = bg`).toBe(hexToRgb(t.colors.bg));
    expect(sb.size, `${t.key} 滚动条宽度`).toBe('16px');
  }
});

test('Gecko 门没误开：Chromium 下 scrollbar-color 必须是 auto', async ({ page }) => {
  // 若标准属性在 Chromium 生效，::-webkit-scrollbar 像素化会被丢弃，
  // 且 Nav / theme-panel 的隐藏滚动条会复活（实测过）。这是本特性最脆的一环。
  await page.goto('/');
  const sb = await readScrollbar(page);
  expect(sb.standardScrollbarColor).toBe('auto');
});

test('既有隐藏滚动条不回归：Nav 横向条仍隐藏', async ({ page }) => {
  await page.goto('/');
  const hidden = await page.evaluate(() => {
    const g = (el: Element | null) =>
      el ? getComputedStyle(el, '::-webkit-scrollbar').display : 'missing';
    return { nav: g(document.querySelector('nav ul')) };
  });
  expect(hidden.nav).toBe('none');
});

test('窄屏降级：375px 下滚动条宽度 12px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  const sb = await readScrollbar(page);
  expect(sb.size).toBe('12px');
});
