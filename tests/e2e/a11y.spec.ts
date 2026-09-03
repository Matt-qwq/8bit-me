import { test, expect } from '@playwright/test';

// 像素字体观感增强的 a11y 回归护栏：
// - forced-colors 下所有装饰阴影/描边/扫描层必须清除，正文靠系统色（保证可读）
// - reduced-motion 下 CRT 闪烁动画必须停止（保留静态扫描线，符合作者「装饰降级」意图）

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

  test('扫描层(.crt-overlay)与角点(.pp-pad)在 forced-colors 下隐藏', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('#crt-overlay')).toBeHidden();
  });

  test('正文在 forced-colors 下使用系统 CanvasText 色', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    const color = await page.$eval('body', (e) => getComputedStyle(e).color);
    // 非透明系统色（forced-colors 下应为 CanvasText，不可能是原 --gb-3 浅色值残留）
    expect(color).not.toBe('rgba(0, 0, 0, 0)');
  });
});

test.describe('reduced-motion：CRT 闪烁停（静态扫描线留）', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' } });

  test('crt-overlay 在 reduced-motion 下 animation 为 none（闪烁停，静态留）', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(String(e)));

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const anim = await page.$eval('#crt-overlay', (e) => getComputedStyle(e).animationName);
    expect(anim).toBe('none');
    // 静态扫描线仍在：层可见但不闪
    await expect(page.locator('#crt-overlay')).toBeVisible();

    expect(errors).toEqual([]);
  });
});
