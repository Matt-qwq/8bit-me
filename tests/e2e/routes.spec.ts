import { expect, test, type Page } from '@playwright/test';

/**
 * 冒烟断言：页面渲染 + 控制台零 error / 零 pageerror
 * 方案 §5 验证清单：四路由渲染 + console.error/pageerror 计数 0。
 * - 隐藏页面的每个访客 JS 都要过 headless Chrome；console.error 记入后统一断言
 * - Chrome 对 404 响应会自动记一条 "Failed to load resource: 404" 资源日志——
 *   这是导航结构性产物、非 JS 报错，未知路径用例用 ignoreConsoleError 精确放行，
 *   其余任何 console.error / pageerror 照抓（保证防线不聋）
 */
async function openAndCheck(
  page: Page,
  path: string,
  opts: {
    expectTitle?: RegExp | string;
    expectHeading?: RegExp;
    allowStatus?: number[];
    ignoreConsoleError?: RegExp[];
  } = {}
) {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  const res = await page.goto(path, { waitUntil: 'networkidle' });
  const allowed = opts.allowStatus ?? [200];
  expect(res, `${path} 应返回 HTTP 响应`).not.toBeNull();
  expect(allowed, `${path} 状态码`).toContain(res!.status());
  if (opts.expectTitle) await expect(page).toHaveTitle(opts.expectTitle);
  if (opts.expectHeading)
    await expect(page.locator('h1, h2').first()).toContainText(opts.expectHeading);
  const fatal = errors.filter(
    (e) => !(opts.ignoreConsoleError ?? []).some((re) => re.test(e))
  );
  expect(fatal, `${path} 控制台零 JS 报错`).toEqual([]);
}

test('冒烟：首页 / 渲染且零报错', async ({ page }) => {
  await openAndCheck(page, '/', {
    expectTitle: '8bit-me',
    expectHeading: /8bit-me/,
  });
});

test('冒烟：博客列表 /blog 渲染且零报错', async ({ page }) => {
  await openAndCheck(page, '/blog', {
    expectTitle: /博客 \| 8bit-me/,
  });
});

test('冒烟：文章页 /blog/[slug] 渲染且零报错', async ({ page }) => {
  await openAndCheck(page, '/blog/2026-08-27-8bit-me-v2-refactor-notes', {
    expectTitle: /8bit-me v2 重构手记/,
    expectHeading: /8bit-me v2 重构手记/,
  });
});

test('冒烟：404 页直达 /404 渲染且零报错', async ({ page }) => {
  await openAndCheck(page, '/404', {
    expectHeading: /404/,
    allowStatus: [200, 404],
  });
});

test('文章页头部：封面与标题横向并排且间距 > 0（死规则回归）', async ({
  page,
}) => {
  // 2026-09 作者反馈「标题跟封面挨太近」：.head .cover-block 的 margin-bottom
  // 因 Astro scoped 规则打不进 CoverBlock 子组件而从不生效（间隙实测 0px），
  // 全站文章共用模板全部受影响。修复后头部为 flex：封面左、标题/meta 右。
  await page.goto('/blog/2026-08-29-data-pipeline-engineering', {
    waitUntil: 'load',
  });
  const box = await page.evaluate(() => {
    const cover = document
      .querySelector('.head .cover-block')
      ?.getBoundingClientRect();
    const h1 = document.querySelector('.head h1')?.getBoundingClientRect();
    const meta = document
      .querySelector('.head .meta')
      ?.getBoundingClientRect();
    if (!cover || !h1 || !meta) return null;
    return {
      coverRight: Math.round(cover.right),
      h1Left: Math.round(h1.left),
      h1Top: Math.round(h1.top),
      coverTop: Math.round(cover.top),
      coverW: Math.round(cover.width),
      metaBelowH1: meta.top >= h1.bottom,
    };
  });
  expect(box).not.toBeNull();
  // 横向并排：封面整块在标题左侧，且真实间距 > 0（竖排贴边时 coverRight > h1Left）
  expect(box!.coverRight).toBeLessThan(box!.h1Left);
  // 封面 lg 档 = 6rem（与列表 md 拇指图同尺寸，解 lg<md 悖论）
  expect(box!.coverW).toBe(96);
  // 标题顶格对齐（装饰不压语义锚点）
  expect(box!.h1Top).toBeLessThanOrEqual(box!.coverTop + 4);
  // meta 仍在标题下方
  expect(box!.metaBelowH1).toBe(true);
});

test('冒烟：未知路径回退 404 页且无 JS 报错', async ({ page }) => {
  await openAndCheck(page, '/no-such-page-9x7', {
    expectHeading: /404/,
    allowStatus: [200, 404],
    // 仅放行导航自身 404 的资源日志，任何 JS 报错仍触发失败
    ignoreConsoleError: [
      /Failed to load resource: the server responded with a status of 404/,
    ],
  });
});