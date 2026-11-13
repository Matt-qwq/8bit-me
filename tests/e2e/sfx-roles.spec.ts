import { expect, test } from '@playwright/test';

/**
 * chip-tune SFX 中央委托链路（ADR-0007）：
 * 断言「点了真的派发」，不只看元素存在。按 8bit:fx detail kind 分类计数——
 * 真实点击会附带 hover tick（鼠标移动触发）与面板展开后的新 hover，总计数不可用。
 * 声音本身 headless 不可断言，听感由作者 audition。
 */

async function fxLog(page: import('@playwright/test').Page) {
  return page.evaluate(() => (window as unknown as { __fx: string[] }).__fx ?? []);
}

/** 统计指定 kind 的派发次数 */
async function countKind(page: import('@playwright/test').Page, kind: string) {
  return (await fxLog(page)).filter((k) => k === kind).length;
}

/** 每个用例独立状态：清 localStorage（sfx 默认开）+ 挂 8bit:fx 计数器 */
async function setup(page: import('@playwright/test').Page, path = '/') {
  await page.addInitScript(() => {
    localStorage.clear();
    (window as unknown as { __fx: string[] }).__fx = [];
    window.addEventListener('8bit:fx', ((e: CustomEvent) => {
      (window as unknown as { __fx: string[] }).__fx.push(String(e.detail));
    }) as EventListener);
  });
  await page.goto(path);
}

/**
 * 2026-09-25：右侧 SET 仓（含它的 toggle 按钮）整体只在 DEV 构建存在，生产没有可点的
 * toggle 了 —— 本文件的 hover/click 用例改用**生产真实存在的**目标（导航链接），
 * toggle 角色那条随之退役（生产里已无 data-sfx-role="toggle" 的元素）。
 */

test('hover 角色：悬停导航链接 → 派发 8bit:fx(hover)（证明 data-sfx-hover 已接线）', async ({ page }) => {
  await setup(page);
  const before = await countKind(page, 'hover');
  await page.hover('.nav a[href="#about"]');
  await expect.poll(() => countKind(page, 'hover')).toBe(before + 1);
});

test('click 角色：点页脚外链 → 派发 8bit:fx(click)（生产真实存在的 click 角色元素）', async ({ page }) => {
  await setup(page);
  const before = await countKind(page, 'click');
  const target = page.locator('footer .foot-credit a');
  await target.scrollIntoViewIfNeeded();
  await target.click();
  await expect.poll(() => countKind(page, 'click')).toBe(before + 1);
});

test('nav 角色：首页纯锚点导航点击 → 派发 8bit:fx(nav) 且不跳页（PageTrans 对 # 放行）', async ({ page }) => {
  await setup(page);
  const before = await countKind(page, 'nav');
  const target = page.locator('.nav a[href="#projects"]');
  await target.click();
  await expect.poll(() => countKind(page, 'nav')).toBe(before + 1);
  // 纯锚点点击会写 location.hash（锚点正常行为），但必须仍在首页（未跳页）
  await expect(page).toHaveURL(/\/#projects$/);
});

test('game 角色：404 START 点击 → 派发 8bit:fx(click)', async ({ page }) => {
  await setup(page, '/404');
  const before = await countKind(page, 'click');
  await page.click('#mole-start');
  await expect.poll(() => countKind(page, 'click')).toBe(before + 1);
});

test('SFX 关闭后：点击不再派发 8bit:fx', async ({ page }) => {
  // 生产没有 SFX 开关了（右侧仓只在 DEV 构建），偏好仍从 localStorage 读 —— 直接写键。
  // 注意不能复用 setup()：它自己的 init script 会 localStorage.clear()，把本用例预置的
  // sfx=off 抹掉（第一版就这么假红过），所以这里自给自足地装脚本。
  await page.addInitScript(() => {
    try {
      localStorage.clear();
      localStorage.setItem('8bitme:sfx', 'off');
    } catch {
      /* ignore */
    }
    const w = window as unknown as { __fx: string[] };
    w.__fx = [];
    window.addEventListener('8bit:fx', ((e: CustomEvent) => {
      w.__fx.push(String(e.detail));
    }) as EventListener);
  });
  await page.goto('/');
  await page.click('.nav a[href="#about"]');
  await page.waitForTimeout(400);
  expect(await fxCount(page), 'sfx 偏好为 off 时仍派发了音效事件').toBe(0);
});

async function fxCount(page: import('@playwright/test').Page) {
  return (await fxLog(page)).length;
}