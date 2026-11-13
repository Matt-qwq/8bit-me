import { expect, test } from '@playwright/test';

/**
 * footer 空心像素字标（homepage-optimization-v1 · B2）。
 *
 * 实现 = Zpix 48px + 填充透明 + 1px `-webkit-text-stroke`（描边走 --c-line token）。
 * 判据与被守的东西同源：**声明色 vs 实际画出来** —— computed stroke-color 必须
 * 等于 :root 上解析后的 --c-line（token 跟随，零字面量），填充必须真透明
 * （透明 = 空心；实心即实现跑偏），字号档位 48px（typography 白名单内）。
 */

test('字标：空心填充 + 1px --c-line 描边 + Zpix 48px + aria-hidden', async ({ page }) => {
  await page.goto('/');
  const mark = page.locator('footer .foot-mark');
  await expect(mark).toHaveText('8BIT-ME');
  await expect(mark).toBeVisible();
  await expect(mark).toHaveAttribute('aria-hidden', 'true');

  const s = await mark.evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      color: cs.color,
      strokeColor: cs.getPropertyValue('-webkit-text-stroke-color').trim(),
      strokeWidth: cs.getPropertyValue('-webkit-text-stroke-width').trim(),
      fontFamily: cs.fontFamily,
      fontSize: cs.fontSize,
    };
  });
const line = await page.evaluate(() =>
  getComputedStyle(document.documentElement).getPropertyValue('--c-line').trim()
);
// computed style 返回 rgb() 形式，token 源是 #hex —— 归一后比对（同 scrollbar.spec 手法）
const hexToRgb = (hex: string): string => {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
};

expect(s.color, '填充必须透明（空心）').toBe('rgba(0, 0, 0, 0)');
expect(s.strokeWidth).toBe('1px');
expect(s.strokeColor, '描边色 = 解析后的 --c-line（token 跟随，不许字面量）').toBe(
  hexToRgb(line)
);
  expect(s.fontFamily).toContain('Zpix');
  expect(s.fontSize).toBe('48px');
});
