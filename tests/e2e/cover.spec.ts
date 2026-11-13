import { expect, test } from '@playwright/test';

/**
 * 封面像素图（cover art）—— 跨页一致性与主题跟随
 *
 * 背景：2026-09 把 emoji 封面（文本字形、不随主题变）换成确定性像素图；
 * 2026-09-10 又把**构图语言**从 identicon 噪点矩阵换成「轮廓 / 剪影型」
 * （`src/lib/cover-glyphs.ts` 手工符号 + 版本跳线，组装在 `src/lib/cover-art.ts`）。
 * 视觉观感无法自动化（作者本地预览），但四件事能在浏览器里硬验：
 *   1. 列表拇指图与单篇头图**逐格一致**（同 spec → 同 path d）
 *   2. 切主题后填充色真的变（--gb-2 / --gb-3 跟随，不是写死颜色），且图形不变
 *   3. 结构没退化（每张封面 ≤ 2 条 path、无残留 .cover-glyph 文本字形）
 *   4. **轮廓签名**：浅墨 path 成块（≥20 格）、强调 path 只做焦点（≤14 格）
 *      —— 旧 identicon 每张 30 个孤立单点、强调格最多 42 格，这条在旧实现下必红
 *
 * 按 开发流程文档 测试触发表：跨文件契约（同一篇文章两处封面同图）优先用
 * 能跑浏览器的断言钉死，而不是靠肉眼在两个页面之间来回看。
 */

test.describe('封面像素图', () => {
  test('列表拇指图与单篇头图逐格一致（同 seed → 同 path d）', async ({
    page,
  }) => {
    await page.goto('/blog', { waitUntil: 'load' });
    const first = page.locator('.tl-item').first();
    const href = await first.locator('.card h3 a').getAttribute('href');
    expect(href, '列表首篇应有内链').toMatch(/\/blog\/.+/);

    const listPaths = await first
      .locator('.cover-block path')
      .evaluateAll((els) => els.map((el) => el.getAttribute('d')));
    expect(listPaths.length, '封面应有 path').toBeGreaterThan(0);
    expect(listPaths[0], 'accent 路径不应为空').not.toBe('');
    const listBox = await first.locator('.cover-block').boundingBox();
    const listArt = await first.locator('.cover-block svg').boundingBox();

    await page.goto(href!, { waitUntil: 'load' });
    const postPaths = await page
      .locator('.head .cover-block path')
      .evaluateAll((els) => els.map((el) => el.getAttribute('d')));

    // 硬契约：两条 path（accent / light）的 d 必须逐字符相同
    expect(postPaths).toEqual(listPaths);

    // 「同尺寸再现」：两处封面盒都是 6rem（96px）
    const postBox = await page.locator('.head .cover-block').boundingBox();
    expect(Math.round(listBox!.width)).toBe(96);
    expect(Math.round(postBox!.width)).toBe(96);

    // 图案本体也必须同尺寸（不是只有外盒同宽）：列表页不渲染 COVER 丝印，
    // 像素图铺满铭牌，与单篇 .lg 档拿到同一渲染尺寸。
    const postArt = await page.locator('.head .cover-block svg').boundingBox();
    expect(Math.round(listArt!.width), '列表与单篇的像素图宽度应一致').toBe(
      Math.round(postArt!.width)
    );
    expect(Math.round(listArt!.height), '列表与单篇的像素图高度应一致').toBe(
      Math.round(postArt!.height)
    );
  });

  test('恒暗：封面 accent path fill 恒为暗档窗灯金（LIGHT 已退役）', async ({ page }) => {
    await page.goto('/blog', { waitUntil: 'load' });
    const accentPath = page
      .locator('.tl-item')
      .first()
      .locator('.cover-block path')
      .first();

    // 恒暗档 --c-accent = themes.ts DARK.accent #ffd27a（窗灯金），不再随模式翻转
    const fill = await accentPath.evaluate((el) => getComputedStyle(el).fill);
    expect(fill, '封面 accent path fill 应恒为暗档 accent').toBe('rgb(255, 210, 122)');
  });

  test('结构：每张封面 ≤ 2 条 path，且无残留 .cover-glyph', async ({ page }) => {
    await page.goto('/blog', { waitUntil: 'load' });
    const covers = page.locator('.cover-block');
    const count = await covers.count();
    expect(count, '列表页应有多个封面').toBeGreaterThanOrEqual(5);

    const pathCounts = await covers.evaluateAll((els) =>
      els.map((el) => el.querySelectorAll('path').length)
    );
    for (const n of pathCounts) expect(n).toBeLessThanOrEqual(2);
    expect(pathCounts.every((n) => n > 0), '每张封面至少一条 path').toBe(true);

    // 轮廓签名（2026-09-10 换构图语言时新增）：浅墨 path 必须成块、强调 path 只做焦点。
    // 旧 identicon 在这里必红：它是 30 个孤立单点拼的，强调格最多 42 格（焦点变主角）。
    const cells = await covers.evaluateAll((els) =>
      els.map((el) => {
        const paths = [...el.querySelectorAll('path')];
        return {
          accent: (paths[0]?.getAttribute('d') ?? '').split('M').length - 1,
          light: (paths[1]?.getAttribute('d') ?? '').split('M').length - 1,
        };
      })
    );
    for (const c of cells) {
      expect(c.light, '浅墨应是成块轮廓（≥20 格）').toBeGreaterThanOrEqual(20);
      expect(c.accent, '强调色只做焦点（≤14 格）').toBeLessThanOrEqual(14);
    }

    // 旧的文本字形已删除（元素不存在即没有死样式可回归）
    expect(await page.locator('.cover-glyph').count()).toBe(0);

    // 像素图必须是硬边缩放（crispEdges）+ 装饰性（aria-hidden）
    const svg = covers.first().locator('svg');
    expect(await svg.getAttribute('shape-rendering')).toBe('crispEdges');
    expect(await svg.getAttribute('aria-hidden')).toBe('true');

    // 单篇页同样没有残留字形
    const href = await page
      .locator('.tl-item .card h3 a')
      .first()
      .getAttribute('href');
    await page.goto(href!, { waitUntil: 'load' });
    expect(await page.locator('.cover-glyph').count()).toBe(0);
    expect(
      await page.locator('.head .cover-block path').count()
    ).toBeLessThanOrEqual(2);
  });
});
