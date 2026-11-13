import { expect, test } from '@playwright/test';

/**
 * 右侧 SET 仓（SideDock）**生产退役契约**（2026-09-25 作者：「右侧那个按钮
 * [#side-dock-trigger] 这整个都不要，不能上线这个」——它跟 DEV 调试台一样是作者自己的
 * 开发工具）。
 *
 * 原来本文件守的是「点开关 → 状态翻转 + 落盘」（SFX / Cursor / BgFx 三组）。右侧仓整体
 * 只在 DEV 构建存在之后，生产已经没有可点的开关了，覆盖改成两件事：
 *  ① **生产不含右侧仓任何节点**（SSR HTML + 运行期 DOM，多路由）
 *  ② 偏好仍然生效（开关没了，`8bitme:*` 键还在被读）：sfx 关掉后点击静默
 * 纯逻辑（键名 / 归一 / 默认值）由 tests/unit/prefs.spec.ts 与 tests/e2e/debug.spec.ts 守。
 */

const ROUTES = ['/', '/blog', '/404'] as const;
/** 右侧仓的标识片段：id / class / 各开关 id，任何一个出现在生产产物里都是违规 */
const FORBIDDEN = [
  'side-dock',
  'side-dock-trigger',
  'bgfx-toggle',
  'cursor-toggle',
  'sfx-toggle',
] as const;

test('生产构建不含右侧 SET 仓（SSR 与 DOM 双查，多路由）', async ({ page, request }) => {
  for (const route of ROUTES) {
    const html = await (await request.get(route)).text();
    for (const frag of FORBIDDEN) {
      expect(html, `${route} 的 SSR HTML 出现 ${frag}`).not.toContain(frag);
    }

    await page.goto(route, { waitUntil: 'load' });
    await expect(
      page.locator('#side-dock, #side-dock-trigger, #side-dock-panel, .side-dock'),
      `${route} 生产 DOM 里出现右侧 SET 仓`
    ).toHaveCount(0);
  }
});

test('偏好仍生效：sfx=off → 点击静默（开关下线了，键还在被读）', async ({ page }) => {
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
  await page.goto('/', { waitUntil: 'load' });

  await page.click('.nav a[href="#projects"]');
  await page.waitForTimeout(400);
  expect(
    await page.evaluate(() => (window as unknown as { __fx: string[] }).__fx.length),
    'sfx 偏好为 off 时仍派发了音效事件'
  ).toBe(0);
});
