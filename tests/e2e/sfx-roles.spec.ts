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

async function openDock(page: import('@playwright/test').Page) {
  const isOpen = await page.evaluate(
    () => document.getElementById('side-dock')?.dataset.open === 'true'
  );
  if (!isOpen) await page.click('#side-dock-trigger');
  await expect(page.locator('#side-dock-panel')).toBeVisible();
}

test('hover 角色：悬停 dock 触发器 → 派发 8bit:fx(hover)（此前全站死代码，本节证明已接线）', async ({ page }) => {
  await setup(page);
  const before = await countKind(page, 'hover');
  await page.hover('#side-dock-trigger');
  await expect.poll(() => countKind(page, 'hover')).toBe(before + 1);
});

test('toggle 角色：dock 触发器点击 → 派发 8bit:fx(click)', async ({ page }) => {
  await setup(page);
  const before = await countKind(page, 'click');
  await page.click('#side-dock-trigger');
  await expect.poll(() => countKind(page, 'click')).toBe(before + 1);
});

test('select 角色：主题项点击 → 派发 8bit:fx(click)', async ({ page }) => {
  await setup(page);
  await openDock(page);
  await page.click('#theme-toggle');
  await expect(page.locator('#theme-panel')).toBeVisible();
  const before = await countKind(page, 'click');
  await page.locator('.theme-item').first().click();
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
  await setup(page);
  await openDock(page);
  await page.click('#sfx-toggle'); // 关掉：关闭瞬间本身应静默（pref 先落，委托后读）
  const before = await fxCount(page);
  await page.click('#bgfx-toggle');
  await expect.poll(() => fxCount(page)).toBe(before);
});

async function fxCount(page: import('@playwright/test').Page) {
  return (await fxLog(page)).length;
}