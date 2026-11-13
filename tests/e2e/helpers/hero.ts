import type { Page } from '@playwright/test';

/**
 * ADR-0027（作者 2026-09-26 裁决）：首页首屏 = 一整扇窗 `#window`，
 * 原 `#hero`（站点标题/说明/CTA/站况/工位）整体下移成**第二章**。
 *
 * 因此两类用例必须先「滚到 #hero 顶对齐」再量：
 * ① 工位（canvas 桌/CRT/暖光 + DOM 头像/卡带/铭牌）——BgFx 的 deskAlpha 门
 *    只在这一章进视口时打开，屏外时 canvas 一个工位像素都不画；
 * ② 打字机——Hero 的打字机用 `IntersectionObserver(threshold 0.5)` 等这一章
 *    进视口才打，停在首屏时三行永远保持裁切。
 *
 * 用 `behavior: 'instant'`（不走 global.css 的 smooth）：测试要的是确定性的
 * 「顶对齐」状态，不是滚动动画中间态。
 */
export async function scrollHeroToTop(page: Page): Promise<void> {
  await page.evaluate(() => {
    const hero = document.getElementById('hero');
    if (!hero) throw new Error('缺少 #hero（ADR-0027 后它应是第二章）');
    const top = hero.getBoundingClientRect().top + window.scrollY;
    window.scrollTo({ top, behavior: 'instant' as ScrollBehavior });
  });
  await page.waitForFunction(
    () => {
      const hero = document.getElementById('hero');
      return !!hero && Math.abs(hero.getBoundingClientRect().top) <= 1;
    },
    undefined,
    { timeout: 5000 }
  );
  // 滚动到位 ≠ 画布已重画：deskAlpha 是在 BgFx 的下一帧 rAF 里算的，
  // 立刻采样会捕到「旧一帧」（世界/工位门还没切）。留出几帧让门与场景落定。
  await page.waitForTimeout(150);
}

/**
 * 滚到 #hero 顶对齐并等打字机落定（`dataset.tw === 'done'`）。
 * 截图类用例（hero-contrast / text-veil）必须用这条：裁切中的文字
 * `clip-path` 会连字影一起裁掉，直接截会量到「空背景」。
 */
export async function scrollHeroToTopAndWaitTypewriter(page: Page): Promise<void> {
  await scrollHeroToTop(page);
  await page.waitForFunction(
    () => document.documentElement.dataset.tw === 'done',
    undefined,
    { timeout: 10000 }
  );
}
