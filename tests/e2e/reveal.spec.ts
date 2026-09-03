import { test, expect } from '@playwright/test';

// 整屏翻页式 PPT（作者指定）：用 WAAPI，故不受 reduced-motion 的 CSS !important
// 压制——作者系统开“减少动态效果”时，卡片仍须「切入」且滚离后「切出」。
// 回归护栏：一旦有人重新用 reduced-motion 门控禁掉，或把切出删掉只留一次性入场，此测变红。
test.describe('整屏翻页 PPT：切入 + 切出（reduced-motion 豁免）', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' } });

  test('01–04 卡片在 reduced-motion 下仍依次切入，且滚离后切出', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(String(e)));

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.evaluate(() => document.querySelector('#projects')!.scrollIntoView({ block: 'center' }));

    // 1) 切入 stagger 梯度：cascade 进行中应同时存在“已入场”与“未入场”的卡
    await expect
      .poll(
        async () => {
          const ops = await page.$$eval('#projects .proj-page.is-active li.pixel-panel.card', (els) =>
            els.map((e) => +getComputedStyle(e).opacity)
          );
          return ops.filter((o) => o > 0.6).length > 0 && ops.filter((o) => o < 0.4).length > 0;
        },
        { timeout: 5000 }
      )
      .toBeTruthy();

    // 2) 稳定后全部入场（证明 WAAPI 未被 reduced-motion 压制）
    await expect
      .poll(
        async () =>
          page.$$eval('#projects .proj-page.is-active li.pixel-panel.card', (els) =>
            els.every((e) => +getComputedStyle(e).opacity > 0.95)
          ),
        { timeout: 5000 }
      )
      .toBeTruthy();

    // 3) 切出：滚离 projects（回到 hero）后，卡片应淡出（opacity 回落）
    await page.evaluate(() => document.querySelector('#hero')!.scrollIntoView({ block: 'center' }));
    await expect
      .poll(
        async () =>
          page.$$eval('#projects .proj-page.is-active li.pixel-panel.card', (els) =>
            els.every((e) => +getComputedStyle(e).opacity < 0.4)
          ),
        { timeout: 5000 }
      )
      .toBeTruthy();

    expect(errors).toEqual([]);
  });

  test('严格硬切：一次 wheel 恰好翻一屏（不卡半截、不跳多屏）', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const h = await page.evaluate(() => window.innerHeight);
    const before = await page.evaluate(() => Math.round(window.scrollY));

    // 向下滚一手势（reduced-motion 下翻页即时，无平滑等待）
    await page.mouse.wheel(0, 120);
    await page.waitForTimeout(150);

    const after = await page.evaluate(() => Math.round(window.scrollY));
    const delta = after - before;
    // 至少翻满一整屏——证明没有“卡在半截”被拉回
    expect(delta).toBeGreaterThan(h * 0.85);
    // 至多翻一整屏——证明一次手势没有连跳多屏（busy 锁生效）
    expect(delta).toBeLessThan(h * 1.6);
  });

  test('Projects 子屏翻页：一次 wheel 翻一子屏，到末屏才翻整章', async ({ page }) => {
    // 宽视口确保每子屏（2 张卡）可容纳，不触发屏内滚动，专测子屏翻页
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // 跳到 projects（instant，等滚动稳定后读基准）
    await page.evaluate(() => {
      const sec = document.querySelector('#projects') as HTMLElement;
      const top = Math.round(sec.getBoundingClientRect().top + window.scrollY);
      window.scrollTo({ top, behavior: 'instant' });
    });
    await page.waitForTimeout(800); // 等初始滚动彻底稳定，避免取值落在平滑中途
    const before = await page.evaluate(() => Math.round(window.scrollY));
    const h = await page.evaluate(() => window.innerHeight);
    const activeOf = () =>
      page.evaluate(() =>
        Array.from(document.querySelectorAll('#projects .proj-page')).findIndex((p) =>
          p.classList.contains('is-active')
        )
      );
    // 子屏翻页不应翻整章：窗口滚动偏移远小于一整屏（Playwright 的 CDP wheel 会
    // 漏 ~38px 原生滚动，真实鼠标下 preventDefault 已拦截，故用 0.4h 容差）。
    const notFlipped = (y: number) => Math.abs(y - before) < h * 0.4;

    // 第 1 次 wheel：子屏 0 → 1，整章不翻
    await page.mouse.wheel(0, 120);
    await page.waitForTimeout(560); // 子屏切换有 busy 锁（DUR+30≈490ms）
    expect(await activeOf()).toBe(1);
    expect(notFlipped(await page.evaluate(() => Math.round(window.scrollY)))).toBeTruthy();

    // 第 2 次 wheel：子屏 1 → 2
    await page.mouse.wheel(0, 120);
    await page.waitForTimeout(560);
    expect(await activeOf()).toBe(2);
    expect(notFlipped(await page.evaluate(() => Math.round(window.scrollY)))).toBeTruthy();

    // 第 3 次 wheel：已在末屏，应翻整章到 skills（scrollY 跳约一整屏）
    await page.mouse.wheel(0, 120);
    await page.waitForTimeout(560);
    const after = await page.evaluate(() => Math.round(window.scrollY));
    expect(after - before).toBeGreaterThan(h * 0.85); // 真翻了整章
  });
});
