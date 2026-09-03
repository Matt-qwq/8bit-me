import { expect, test } from '@playwright/test';

/**
 * 导航与内链（nav / internal links）—— 通用不变量防线
 *
 * 背景（2026-08-29 作者发现的真实 bug）：
 *   src/lib/config.ts 的 siteConfig.nav 是纯锚点（#hero / #about / …），
 *   而 Nav.astro 由 BaseLayout 全站挂载；博客页与 404 页的 DOM 里没有这些 id，
 *   点击「首页/关于/作品/技能/联系」静默失效 —— 没有任何报错，也没有任何跳转。
 *   而原有 e2e 只断言「渲染 + 控制台零报错 + 标题文本」，因此 100% 漏掉。
 *
 * 本文件守两类不变量：
 *   1. 锚点闭合：页面上任一 a[href^="#"] 的 fragment 必须能在当前 DOM 解析到元素
 *      （一次 $$eval 覆盖整页，是这类 bug 的最小充分断言）
 *   2. 行为生效：点击锚点后目标 section 真的进入视口
 *      注意：不能用 hash 判定 —— 目标不存在时浏览器仍会写 location.hash 并滚到顶部，
 *      waitForURL(/#about/) 会假绿（本站真实教训）。
 */

const ROUTES = [
  '/',
  '/blog',
  '/blog/2026-08-27-8bit-me-v2-refactor-notes',
  '/404',
] as const;

/** 纯锚点链接（排除裸 "#" 与空串） */
const ANCHOR_SELECTOR = 'a[href^="#"]';

for (const route of ROUTES) {
  test(`锚点闭合：${route} 上每个 a[href^="#"] 的目标元素都存在`, async ({
    page,
  }) => {
    await page.goto(route, { waitUntil: 'load' });

    const broken = await page.$$eval(ANCHOR_SELECTOR, (anchors) =>
      anchors
        .map((a) => a.getAttribute('href') ?? '')
        // 裸 "#" 与 "#" 后无内容不算锚点目标
        .filter((href) => href.length > 1)
        .filter((href) => document.getElementById(href.slice(1)) === null)
    );

    expect(
      broken,
      `${route} 存在指向不存在元素的锚点链接（点击会静默失效）`
    ).toEqual([]);
  });
}

test('首页：导航锚点点击后目标 section 真的进入视口', async ({ page }) => {
  await page.goto('/', { waitUntil: 'load' });
  await page.click('.nav a[href="#about"]');
  // 用「元素进入视口」而非 hash 判定：目标缺失时 hash 也会变，会假绿
  await expect(page.locator('#about')).toBeInViewport();
});

test('首页：#hero 与 #main 停靠位一致（hero 顶贴视口顶，不落在 nav 下方）', async ({
  page,
}) => {
  // 2026-09 作者反馈：#hero 有 scroll-margin-top 落 scrollY=0、#main 无则落 60，
  // 同内容两个位。修复后所有入口应同一点：hero 顶贴视口顶（=wheel 翻页/自然加载）。
  const heroTopAfterNav = async (url: string) => {
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForTimeout(600); // 等 smooth scroll 落定
    return page.$eval('#hero', (el) => Math.round(el.getBoundingClientRect().top));
  };
  // 顺序执行：同一 page 对象上并发 goto 会互相中止（net::ERR_ABORTED）
  const heroTopViaHero = await heroTopAfterNav('/#hero');
  const heroTopViaMain = await heroTopAfterNav('/#main');
  expect(heroTopViaHero).toBe(0);
  expect(heroTopViaMain).toBe(0);
});

test('跨页锚点：博客页点「关于」→ 跳回首页并定位到 #about', async ({
  page,
}) => {
  await page.goto('/blog', { waitUntil: 'load' });
  await page.click('.nav a[href*="#about"]');
  await expect(page.locator('#about')).toBeInViewport();
});

/**
 * 路由激活态：博客页必须高亮「博客」导航项。
 *
 * scrollspy 靠 `main section[id]` 驱动（见 Nav.astro），博客页与文章页没有这些
 * section，整段逻辑直接跳过 —— 于是全站 nav 一个激活态都没有，访客看不出自己
 * 在哪（2026-08-29 视觉评审发现）。section 级的激活归 scrollspy，路由级的激活
 * 必须由服务端按 pathname 定，两者互补而不是替代。
 */
for (const route of [
  '/blog',
  '/blog/2026-08-27-8bit-me-v2-refactor-notes',
] as const) {
  test(`路由激活态：${route} 上「博客」导航项高亮`, async ({ page }) => {
    await page.goto(route, { waitUntil: 'load' });
    await expect(page.locator('.nav a[href$="/blog"]')).toHaveClass(/is-active/);
  });
}

test('路由激活态不越界：首页的「博客」项不高亮', async ({ page }) => {
  await page.goto('/', { waitUntil: 'load' });
  await expect(page.locator('.nav a[href$="/blog"]')).not.toHaveClass(
    /is-active/
  );
});

test('站内链接可达：首页作品卡 VIEW → 文章页 h1 与卡片标题一致', async ({
  page,
}) => {
  await page.goto('/', { waitUntil: 'load' });
  const card = page.locator('.card', { hasText: 'RPA 迁移方法论' });
  const link = card.locator('a.pixel-btn');
  await expect(link).toHaveAttribute(
    'href',
    '/blog/2026-08-29-rpa-migration-methodology'
  );
  // 作品卡现在按“章节内翻页”分屏，只有激活子屏可见：先把 projects 滚进视口
  // 让子屏 0 激活，否则卡片 display:none 点不动（这本身也是真实可达性护栏）。
  await page.evaluate(() =>
    document.querySelector('#projects')!.scrollIntoView({ block: 'center' })
  );
  await expect(link).toBeVisible({ timeout: 5000 });
  await link.click();
  await page.waitForURL(/\/blog\/2026-08-29-rpa-migration-methodology/);
  // 文章页有两个 h1（页头标题 + 目录锚点标题），取第一个
  await expect(page.locator('h1').first()).toContainText('RPA');
});
