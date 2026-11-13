import { expect, test } from '@playwright/test';
import { HUD_BAR_CELLS, hudBarCells } from '../../src/lib/site-hud';

/**
 * SiteHud（右下常驻挂件，homepage-optimization-v1 · B1）。
 *
 * 判据口径：**数据链同源** —— 挂件的 LOG n / UPDATED 必须与 about .meta 的
 * POSTS 行出自同一份 getPublishedPosts（构建期静态算出），e2e 在页面上
 * 互相印证，不硬编码文章数；进度条实心格数用同一纯函数 hudBarCells 推导。
 * 「元素存在」不等于「对了」：数值对不上 = 红。
 *
 * 首屏门控（ADR-0027 守线）：#window 在视口内时挂件必须退场（nav-links 的
 * 「首屏没有任何文字」），整扇离开后才出现——所以所有「可见」断言都先滚过首屏。
 */

test('首屏门控：#window 在视口内时退场，滚过首屏出现', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.locator('aside.site-hud')).toBeHidden();

  await page.evaluate(() => {
    document.getElementById('hero')?.scrollIntoView({ behavior: 'instant' });
  });
  await expect(page.locator('aside.site-hud')).toBeVisible();
});

test('桌面挂件：LOG n / 进度条格数 / UPDATED 与 about .meta 同一条数据链', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.evaluate(() => {
    document.getElementById('about')?.scrollIntoView({ behavior: 'instant' });
  });

  const hud = page.locator('aside.site-hud');
  await expect(hud).toBeVisible();

  const logText = (await hud.locator('.hud-line').first().textContent()) ?? '';
  const m = logText.match(/LOG\s+(\d+)/);
  expect(m, `LOG 行应含文章数（实际：「${logText.trim()}」）`).toBeTruthy();
  const count = Number(m![1]);
  expect(count).toBeGreaterThanOrEqual(0);

  // 进度条：总格数恒定，实心格数 = 同一纯函数推导（逐格 DOM 计数，不量像素）
  const cells = hud.locator('.hud-cell');
  await expect(cells).toHaveCount(HUD_BAR_CELLS);
  const filled = await hud.locator('.hud-cell.on').count();
  expect(filled).toBe(hudBarCells(count));

  // 数据链互证：about .meta 的 POSTS 行与 UPDATED 行同源
  const postsLine =
    (await page.locator('#about .meta li:has(.meta-k:text-is("POSTS")) .meta-v').textContent()) ??
    '';
  expect(postsLine).toContain(`${count} 篇`);
  const updatedText = (await hud.locator('.hud-line').nth(1).textContent()) ?? '';
  const hudDate = updatedText.match(/UPDATED\s+(\d{4}-\d{2}-\d{2})/);
  expect(hudDate, `UPDATED 行应含日期（实际：「${updatedText.trim()}」）`).toBeTruthy();
  expect(postsLine).toContain(hudDate![1]);
});

test('挂件是非交互层：pointer-events none（不挡右下角点击/指针）', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const pe = await page
    .locator('aside.site-hud')
    .evaluate((el) => getComputedStyle(el).pointerEvents);
  expect(pe).toBe('none');
});

test('窄屏 480×800：挂件退场（display none）', async ({ page }) => {
  await page.setViewportSize({ width: 480, height: 800 });
  await page.goto('/');
  await expect(page.locator('aside.site-hud')).toBeHidden();
});
