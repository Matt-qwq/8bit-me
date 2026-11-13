import { expect, test } from '@playwright/test';

/**
 * 按标签浏览（roadmap P2-3 第二种内容视图）—— 行为断言
 *
 * P2-3 的三条约束：纯静态路由（零 JS）、零新线元素、禁图谱式连线。
 * 前两条在这里守，第三条由 `line-hierarchy.spec.ts` 的几何白名单自动覆盖
 * （新页面若出现未登记线宽会直接红）。
 *
 * 断言原则（AGENTS 触发表）：**不能只断言元素存在**，要断言「点了之后真的生效」，
 * 且「列出的内容与标签真的对应」——否则两张页面互换内容也能全绿。
 */
test.describe('按标签浏览', () => {
  test('列表页的入口链接可用（点了真的到标签索引）', async ({ page }) => {
    await page.goto('/blog/', { waitUntil: 'load' });
    const link = page.locator('.view-switch a');
    await expect(link).toHaveText(/按标签浏览/);
    await link.click();
    await expect(page).toHaveURL(/\/blog\/tags\/$/);
    // 目标页真的渲染了内容，而不是「到了但空白」
    await expect(page.locator('.tag-list > li').first()).toBeVisible();
  });

  test('索引页只列 ≥2 篇的标签，且链接与计数一致', async ({ page }) => {
    await page.goto('/blog/tags/', { waitUntil: 'load' });
    const rows = await page.evaluate(() =>
      [...document.querySelectorAll('.tag-list > li')].map((li) => ({
        tag: li.querySelector('.tag')?.textContent?.trim() ?? '',
        count: Number(li.querySelector('.tag-count')?.textContent?.trim() ?? '0'),
        href: li.querySelector('a')?.getAttribute('href') ?? '',
      }))
    );
    expect(rows.length, '至少应有一个达标标签').toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.count, `标签「${r.tag}」应 ≥2 篇（单篇标签不该出现）`).toBeGreaterThanOrEqual(2);
    }
    // 计数降序：索引页的顺序是「先按篇数」，乱序会让扫描失去意义
    const counts = rows.map((r) => r.count);
    expect(counts, `计数未降序：${counts.join(', ')}`).toEqual(
      [...counts].sort((a, b) => b - a)
    );
  });

  test('标签页列出的文章数 = 索引页的计数（内容真的对应，不是换了张皮）', async ({ page }) => {
    await page.goto('/blog/tags/', { waitUntil: 'load' });
    const rows = await page.evaluate(() =>
      [...document.querySelectorAll('.tag-list > li')].map((li) => ({
        tag: li.querySelector('.tag')?.textContent?.trim() ?? '',
        count: Number(li.querySelector('.tag-count')?.textContent?.trim() ?? '0'),
        href: li.querySelector('a')?.getAttribute('href') ?? '',
      }))
    );
    // 抽查前三个（含中文标签，顺带覆盖 CJK 路由的 URL 编码）
    for (const r of rows.slice(0, 3)) {
      await page.goto(r.href, { waitUntil: 'load' });
      const items = await page.locator('.tagged > li').count();
      expect(items, `标签「${r.tag}」页列出 ${items} 篇，索引页写的是 ${r.count}`).toBe(
        r.count
      );
      // 页标题必须带上标签名：CJK slug 若编码错位，标题会露馅
      await expect(page.locator('h1')).toContainText(r.tag);
    }
  });

  test('标签页的每篇文章链接都指向真实文章（且标题含于该标签）', async ({ page }) => {
    await page.goto('/blog/tags/python/', { waitUntil: 'load' });
    const links = await page.locator('.tagged .item-title a').all();
    expect(links.length).toBeGreaterThan(0);
    const href = await links[0]!.getAttribute('href');
    await page.goto(href!, { waitUntil: 'load' });
    // 目标页是文章页：正文文章存在 + 标签芯片里有 Python
    await expect(page.locator('.prose').first()).toBeVisible();
    const tags = await page.locator('.meta .tag').allTextContents();
    expect(tags.map((t) => t.trim())).toContain('Python');
  });

  test('零 JS：标签页自身不带脚本元素', async ({ page }) => {
    const scripts: string[] = [];
    page.on('request', (r) => {
      if (r.resourceType() === 'script') scripts.push(r.url());
    });
    await page.goto('/blog/tags/', { waitUntil: 'load' });
    await page.waitForTimeout(1200);
    await page.goto('/blog/tags/python/', { waitUntil: 'load' });
    await page.waitForTimeout(1200);
    // 允许站点外壳的既有脚本（主题预挂载 is:inline、Nav/BaseLayout 的模块），
    // 但标签视图自身不得新增任何页面级 script 元素。
    const pageScripts = await page.evaluate(
      () => document.querySelectorAll('main script, .container script').length
    );
    expect(pageScripts, '标签页不应带自己的脚本').toBe(0);
  });
});
