import { expect, test } from '@playwright/test';

/**
 * 博客列表时间线（blog timeline）—— 行为与几何契约
 *
 * 背景：2026-09 作者定稿「日期移出卡片、改由左侧时间线（PCB 总线）承载，
 * 时间线与卡片互相点亮」。视觉观感无法自动化（作者本地预览），但两件事能测：
 *   1. 结构契约：日期只在时间线里、不在卡片里；走线真的接在卡片边缘上
 *   2. 交互生效：滚动读数与悬停通电**真的改变了渲染**（不是只加了个 class）
 *
 * 按 开发流程文档 测试触发表：改列表结构 → 补内链与对齐断言；
 * 组件交互 → 断言「生效」，不能只断言元素存在。
 */

const POSTS_MIN = 5; // 已发布文章数下限（实际 13，加文章不该让此测变红）

test.describe('博客列表：时间线', () => {
  test('日期在时间线丝印里，不在卡片里', async ({ page }) => {
    await page.goto('/blog', { waitUntil: 'load' });

    const marks = await page.locator('.tl-mark time').count();
    const cards = await page.locator('.tl-item .card').count();
    const datesInCard = await page.locator('.tl-item .card time').count();

    expect(cards).toBeGreaterThanOrEqual(POSTS_MIN);
    // 每条卡片配一个丝印日期
    expect(marks).toBe(cards);
    // 这条是作者本轮改动的核心：卡片里不再有日期
    expect(datesInCard).toBe(0);

    // 丝印日期必须是合法 datetime，且与展示文本同源
    const first = page.locator('.tl-item').first();
    const iso = await first.locator('.tl-mark time').getAttribute('datetime');
    const text = await first.locator('.tl-mark time').innerText();
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(iso!.slice(5)).toBe(text.trim());
  });

  test('走线几何：焊盘中线 = 分支中线 = 丝印中心，分支右端 = 卡片左缘', async ({
    page,
  }) => {
    await page.goto('/blog', { waitUntil: 'load' });

    const box = await page.locator('.tl-item').first().evaluate((item) => {
      const rect = (sel: string) =>
        item.querySelector(sel)!.getBoundingClientRect();
      const pad = rect('.tl-pad');
      const branch = rect('.tl-branch');
      const card = rect('.card');
      const year = rect('.tl-year');
      const date = rect('.tl-date');
      return {
        padCy: pad.top + pad.height / 2,
        branchCy: branch.top + branch.height / 2,
        branchRight: branch.right,
        cardLeft: card.left,
        markCy: (year.top + date.bottom) / 2,
      };
    });

    // 焊盘与分支同轴（±1px：分支 2px 高，取整余量）
    expect(Math.abs(box.branchCy - box.padCy)).toBeLessThanOrEqual(1);
    // 丝印两行的垂直中心落在焊盘中线上（±2px）
    expect(Math.abs(box.markCy - box.padCy)).toBeLessThanOrEqual(2);
    // 分支必须真的碰到卡片左缘（断开即视觉断链）
    expect(Math.abs(box.branchRight - box.cardLeft)).toBeLessThanOrEqual(1);
  });

  test('滚动读数生效：视口中心那一篇通电（焊盘真的填实）', async ({ page }) => {
    await page.goto('/blog', { waitUntil: 'load' });
    await expect(page.locator('.tl-item').first()).toBeVisible();

    const idleBg = await page
      .locator('.tl-item')
      .nth(3)
      .locator('.tl-pad')
      .evaluate((el) => getComputedStyle(el).backgroundColor);

    // 把第 4 篇滚到视口中心
    await page.locator('.tl-item').nth(3).evaluate((el) => {
      const r = el.getBoundingClientRect();
      window.scrollTo({ top: window.scrollY + r.top - window.innerHeight * 0.3 });
    });

    const item = page.locator('.tl-item').nth(3);
    await expect(item).toHaveClass(/is-live/);

    // 生效断言：焊盘底色必须真的变了（不是只有 class）
    await expect
      .poll(async () =>
        item
          .locator('.tl-pad')
          .evaluate((el) => getComputedStyle(el).backgroundColor)
      )
      .not.toBe(idleBg);

    // 只有一篇处于读数态
    expect(await page.locator('.tl-item.is-live').count()).toBe(1);
  });

  test('悬停通电：走线加粗 + 焊盘白热芯 + 卡片左缘焊点', async ({ page }) => {
    await page.goto('/blog', { waitUntil: 'load' });
    const item = page.locator('.tl-item').nth(2);

    const before = await item.evaluate((el) => ({
      branchH: el.querySelector('.tl-branch')!.getBoundingClientRect().height,
      padBg: getComputedStyle(el.querySelector('.tl-pad')!).backgroundColor,
    }));

    await item.locator('.card').hover();

    // 面积变化（2px → 4px）才是像素语言里可靠的「通电」信号。
    // 过渡是 steps(2) 的 80ms，必须 poll（hover 后立刻读会拍到过渡首帧）。
    await expect
      .poll(async () =>
        item
          .locator('.tl-branch')
          .evaluate((el) => el.getBoundingClientRect().height)
      )
      .toBeGreaterThan(before.branchH);

    await expect
      .poll(async () =>
        item
          .locator('.tl-pad')
          .evaluate((el) => getComputedStyle(el).backgroundColor)
      )
      .not.toBe(before.padBg);

    // 卡片左缘焊点由 hover 点亮
    await expect
      .poll(async () =>
        item
          .locator('.card')
          .evaluate((el) => getComputedStyle(el, '::after').opacity)
      )
      .toBe('1');
  });

  test('内链可达：卡片标题点击后进入对应文章页', async ({ page }) => {
    await page.goto('/blog', { waitUntil: 'load' });
    const first = page.locator('.tl-item').first();
    const href = await first.locator('.card h3 a').getAttribute('href');
    const listTitle = await first.locator('.card h3 a').innerText();
    expect(href).toMatch(/\/blog\/.+/);

    await first.locator('.card h3 a').click();
    await page.waitForURL(new RegExp(href!.replace(/[/.]/g, '\\$&') + '$'));
    // 目的地 h1 与列表卡标题同源
    await expect(page.locator('h1').first()).toContainText(listTitle.slice(0, 8));
  });
});
