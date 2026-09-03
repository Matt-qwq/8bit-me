import { expect, test } from '@playwright/test';

/**
 * 转场 e2e（transition e2e，P2 提取 PageTrans 时补入）：
 * 点站内链接 → CRT 幕布宿主出现 → URL 变更 → 新页幕布清除，全程零 console.error。
 * 三层防线之一：数学单测（逻辑等价）+ 本用例（DOM 链路存活）+ 作者视觉验收（观感）。
 */
test('转场 e2e：点站内链接 → 幕布 → 到位 → 清除，零报错', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  await page.goto('/', { waitUntil: 'networkidle' });

  // 作品卡按“章节内翻页”分屏，只有激活子屏可见：先滚到 projects 激活子屏 0
  const blogLink = page.locator('a[href^="/blog/"]').first();
  await page.evaluate(() =>
    document.querySelector('#projects')!.scrollIntoView({ block: 'center' })
  );
  await expect(blogLink).toBeVisible({ timeout: 5000 });

  // 点击站内文章链接：劫持处理器同步 build() 出场幕布（340ms 动画窗口）
  await blogLink.click();
  await expect(page.locator('#ptrans-host .crt-curtain')).toBeAttached({
    timeout: 2000,
  });

  // 出场完 → 真实跳转（location.href）
  await page.waitForURL(/\/blog\//, { timeout: 5000 });

  // 新页入场幕布（280ms）播完自动 clean
  await expect(page.locator('#ptrans-host .crt-curtain')).toHaveCount(0, {
    timeout: 3000,
  });

  expect(errors, '转场全程控制台零 JS 报错').toEqual([]);
});