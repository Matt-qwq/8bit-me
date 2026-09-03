import { expect, test } from '@playwright/test';

async function pref(page: import('@playwright/test').Page, key: string) {
  return page.evaluate((k) => localStorage.getItem(k), key);
}
async function openDock(page: import('@playwright/test').Page) {
  // 幂等：若仓已经展开（可能被 reload 恢复或上一个测试遗留），不再点触发按钮
  // ——否则会把已开仓再点成关，触发 toBeVisible 假红。
  const isOpen = await page.evaluate(
    () => document.getElementById('side-dock')?.dataset.open === 'true'
  );
  if (!isOpen) await page.click('#side-dock-trigger');
  await expect(page.locator('#side-dock-panel')).toBeVisible();
}

test('CRT 开关：点击 → 状态翻转 + 落盘 + reload 复现', async ({ page }) => {
  await page.goto('/', { waitUntil: 'load' });
  await openDock(page);
  const btn = page.locator('#crt-toggle');
  const overlay = page.locator('#crt-overlay');
  await expect(btn).toHaveAttribute('aria-pressed', 'true');
  await expect(overlay).not.toHaveAttribute('hidden', '');
  await btn.click();
  await expect(btn).toHaveAttribute('aria-pressed', 'false');
  await expect(btn).toHaveClass(/off/);
  await expect(overlay).toHaveAttribute('hidden', '');
  expect(await pref(page, '8bitme:crt')).toBe('off');
  await page.reload({ waitUntil: 'load' });
  await openDock(page);
  await expect(page.locator('#crt-toggle')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#crt-overlay')).toHaveAttribute('hidden', '');
});

test('SFX 开关：点击 → 状态翻转 + 落盘 + reload 复现', async ({ page }) => {
  await page.goto('/', { waitUntil: 'load' });
  await openDock(page);
  const btn = page.locator('#sfx-toggle');
  await expect(btn).toHaveAttribute('aria-pressed', 'true');
  await btn.click();
  await expect(btn).toHaveAttribute('aria-pressed', 'false');
  await expect(btn).toHaveClass(/off/);
  expect(await pref(page, '8bitme:sfx')).toBe('off');
  await page.reload({ waitUntil: 'load' });
  await openDock(page);
  await expect(page.locator('#sfx-toggle')).toHaveAttribute('aria-pressed', 'false');
});

test('Cursor 形态循环：点击 → label 变化 + 落盘', async ({ page }) => {
  await page.goto('/', { waitUntil: 'load' });
  await openDock(page);
  const btn = page.locator('#cursor-toggle');
  const label = page.locator('#cursor-toggle .cursor-label');
  await expect(label).toHaveText('FRAME');
  await btn.click();
  await expect(label).toHaveText('DOT');
  expect(await pref(page, '8bitme:cursor')).toBe('dot');
  await btn.click();
  await expect(label).toHaveText('BLK');
});

test('BgFx 模式循环：点击 → label 变化 + 落盘', async ({ page }) => {
  await page.goto('/', { waitUntil: 'load' });
  await openDock(page);
  const btn = page.locator('#bgfx-toggle');
  const label = page.locator('#bgfx-toggle .bgfx-label');
  await expect(label).toHaveText('OFF');
  await btn.click();
  await expect(label).toHaveText('CORE');
  expect(await pref(page, '8bitme:bgfx')).toBe('core');
});

test('SSR 首帧：开关按钮初始文本与默认模式一致', async ({ request }) => {
  const html = await (await request.get('/')).text();
  expect(html, 'cursor 按钮初始文本应为 FRAME').toMatch(/cursor-label[^>]*>FRAME</);
  expect(html, 'bgfx 按钮初始文本应为 OFF').toMatch(/bgfx-label[^>]*>OFF</);
});

test('主题切换：选主题 → 立即生效 + 落盘 + reload 复现', async ({ page }) => {
  await page.goto('/', { waitUntil: 'load' });
  await openDock(page);
  const btn = page.locator('#theme-toggle');
  const panel = page.locator('#theme-panel');
  await expect(panel).toBeHidden();
  await btn.click();
  await expect(panel).toBeVisible();
  await page.locator('.theme-item[data-theme-key="nes-punch"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'nes-punch');
  expect(await pref(page, '8bitme:theme')).toBe('nes-punch');
  await expect(panel).toBeHidden();
  await page.reload({ waitUntil: 'load' });
  await openDock(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'nes-punch');
});

test('侧边仓：默认收起 → 点触发按钮展开 → 落盘 + reload 复现', async ({ page }) => {
  await page.goto('/', { waitUntil: 'load' });
  await expect(page.locator('#side-dock-panel')).toBeHidden();
  await expect(page.locator('#side-dock-trigger')).toHaveAttribute('aria-expanded', 'false');
  await page.click('#side-dock-trigger');
  await expect(page.locator('#side-dock-panel')).toBeVisible();
  await expect(page.locator('#side-dock-trigger')).toHaveAttribute('aria-expanded', 'true');
  expect(await pref(page, '8bitme:dock')).toBe('on');
  await page.reload({ waitUntil: 'load' });
  await expect(page.locator('#side-dock-panel')).toBeVisible();
  await page.click('main#main', { position: { x: 200, y: 200 } });
  await expect(page.locator('#side-dock-panel')).toBeHidden();
  expect(await pref(page, '8bitme:dock')).toBe('off');
});
