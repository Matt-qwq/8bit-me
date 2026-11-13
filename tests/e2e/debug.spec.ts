import { expect, test, type Page } from '@playwright/test';
import { skyMoment } from '../../src/lib/sky-time';
import { mockWeather } from './helpers/mock-weather';

/**
 * 天空调试台（src/lib/debug.ts）—— **生产退役契约** + 调试机制的运行期接线。
 *
 * 2026-09-25 作者裁决「不要把 dev 功能上线」：DEV 入口与子面板**只在 DEV 构建渲染**
 * （SideDock 里 `import.meta.env.DEV` 双门：模板不渲染 + 脚本不接线）。于是本文件守两件事：
 *
 *  ① **生产不含 DEV UI**：SSR HTML 与 DOM 里都没有 #wx-debug-toggle / #wx-debug-panel，
 *     侧仓只剩 3 个开关（BG / CUR / SFX）。这条把「dev 功能偷偷上线」钉死。
 *  ② **调试机制仍可用**：作者本地要能改值看画面——直接写 debug.ts 的三个键
 *     （`8bitme:wxdebug` / `8bitme:wx-kind` / `8bitme:clock-offset`）驱动，无需 UI。
 *     判据与画面同源：天气比 `__bgfxDebug.weather`，太阳高度用纯函数
 *     `skyMoment(假时钟 + 偏移, mock 锚点)` 算出期望再比 `__bgfxDebug.alt`
 *     （不是「值变没变」这种间接特征——那条在 +1h 撞日弧顶点时会静默假绿）。
 *  纯逻辑由 tests/unit/debug.spec.ts 守（键名与归一规则）。
 */

const HOUR = 3_600_000;
/** 钉死的「此刻」：2026-09-21 09:15（本地）；理由见文件末尾注释 */
const FAKE = new Date(2026, 8, 21, 9, 15, 0);
const FAKE_DAY = '2026-09-21';
/** mock Open-Meteo 返回的晨昏锚点（与页面假时钟同日，否则 sunAlt 落夜弧） */
const ANCHORS = {
  sunriseMs: new Date(2026, 8, 21, 6, 12, 0).getTime(),
  sunsetMs: new Date(2026, 8, 21, 18, 28, 0).getTime(),
};

/** BgFx 的调试钩子（每个世界帧重写） */
async function dbg(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(
    () =>
      (window as unknown as { __bgfxDebug?: Record<string, unknown> }).__bgfxDebug ?? {}
  );
}
async function altOf(page: Page): Promise<number> {
  return Number((await dbg(page)).alt);
}
async function weatherOf(page: Page): Promise<string> {
  return String((await dbg(page)).weather);
}

/**
 * 调试键落盘（生产没有 DEV 面板，这是作者本地改值的唯一入口）。
 * 注意**不用 addInitScript**：它在每次 reload 都会重放，会把用例中途 evaluate 改的
 * 值又写回去（本文件第一版就这么踩的：关掉开关后 reload 又被 init script 打开）。
 * 手法 = 先访问一次站点建立 origin → evaluate 写键 → reload 让模块重新读。
 */
async function setDebug(page: Page, kind: string | null, offsetMs = 0): Promise<void> {
  if (!page.url().startsWith('http')) await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(
    ([k, o]) => {
      localStorage.setItem('8bitme:wxdebug', 'on');
      if (k === null) localStorage.removeItem('8bitme:wx-kind');
      else localStorage.setItem('8bitme:wx-kind', k);
      if (o === 0) localStorage.removeItem('8bitme:clock-offset');
      else localStorage.setItem('8bitme:clock-offset', String(o));
    },
    [kind, offsetMs] as const
  );
}

/** 期望太阳高度（同源纯函数：与 BgFx 的 skyMoment(debugNow(), anchors) 完全一致） */
const expectAlt = (ms: number): number => skyMoment(ms, ANCHORS).sunAlt;

/** 等画面太阳高度收敛到期望值（容差 0.0005：dbg.alt 三位小数 + 稳态缓动 <0.001 归零） */
async function expectAltAt(page: Page, ms: number): Promise<void> {
  await expect
    .poll(async () => Math.abs((await altOf(page)) - expectAlt(ms)), { timeout: 12000 })
    .toBeLessThan(0.0005);
}

test('生产构建不含 DEV 入口（作者：不要把 dev 功能上线）', async ({ page, request }) => {
  // ① SSR 产物里连标记都不能有（构建期就该整段消失，而不是靠 CSS 藏）
  const html = await (await request.get('/')).text();
  expect(html, 'SSR HTML 出现 DEV 开关 id').not.toContain('wx-debug-toggle');
  expect(html, 'SSR HTML 出现 DEV 子面板 id').not.toContain('wx-debug-panel');
  // 属性级判据（不查裸文案：模板里的 HTML 注释会正当提到调试台，注释不算 UI）
  expect(html, 'SSR HTML 出现 DEV 可访问名').not.toContain('aria-label="天空调试');
  // 2026-09-25 起右侧 SET 仓整体也不上线（trigger / 面板 / 全部开关）
  expect(html, 'SSR HTML 出现右侧仓').not.toContain('side-dock');

  // ② 运行期 DOM：右侧仓与 DEV 相关节点一个都不许有
  await mockWeather(page);
  await page.goto('/', { waitUntil: 'load' });
  expect(
    await page.locator('#side-dock, #side-dock-trigger, #wx-debug-toggle, #wx-debug-panel').count(),
    '生产 DOM 里出现了本该只属于 DEV 构建的调试 UI'
  ).toBe(0);
});

test('调试机制仍可用：天气覆写改画面 + 丝印同步，关掉回实况', async ({ page }) => {
  await mockWeather(page); // 实况 = 晴（code=0）
  await setDebug(page, 'rain');
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(800);

  // 覆写生效：画面（__bgfxDebug.weather）与 hero 丝印（[data-live-wx]）同源同刻
  await expect.poll(() => weatherOf(page), { timeout: 5000 }).toBe('rain');
  await expect(page.locator('[data-live-wx]')).toHaveText('RAIN');

  // 关掉总开关（写 'off'）→ 画面与丝印都回实况（开关只是让它失效，不删覆写记忆）
  await page.evaluate(() => localStorage.setItem('8bitme:wxdebug', 'off'));
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(800);
  await expect.poll(() => weatherOf(page), { timeout: 5000 }).toBe('clear');
  await expect(page.locator('[data-live-wx]')).toHaveText('CLEAR');
});

test('调试机制仍可用：时间旅行 +1H 真的推了太阳（同源纯函数比对）', async ({ page }) => {
  await mockWeather(page, 0, 1, FAKE_DAY);
  await page.clock.setFixedTime(FAKE); // 钉假时钟（timers 照常跑，只有 Date 定住）

  // ① 基准：无偏移时画面太阳高度 = 纯函数算出的「此刻」值
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await setDebug(page, null, 0);
  await page.reload({ waitUntil: 'load' });
  await expectAltAt(page, FAKE.getTime());
  // 反例自检：时钟静止时 alt 必须一字不动（否则「变了」可能只是画面本来在飘）
  const still = await altOf(page);
  await page.waitForTimeout(400);
  expect(await altOf(page), '时钟静止时 alt 不得漂移').toBe(still);

  // ② +1H：偏移落盘 → 画面太阳高度 = 纯函数在「此刻 + 1h」的值
  await page.evaluate((h) => {
    localStorage.setItem('8bitme:wxdebug', 'on');
    localStorage.setItem('8bitme:clock-offset', String(h));
  }, HOUR);
  await page.reload({ waitUntil: 'load' });
  await expectAltAt(page, FAKE.getTime() + HOUR);
  expect(
    Math.abs(expectAlt(FAKE.getTime() + HOUR) - expectAlt(FAKE.getTime())),
    '假时钟选点必须让 +1H 的日弧位移显著（否则「等于期望值」是句废话）'
  ).toBeGreaterThan(0.05);
});

/**
 * 为什么钉 09:15 而不是让用例跑在真实时刻上：
 * `|sunAlt(t+1h) − sunAlt(t)|` 在「t+0.5h 恰为日弧/夜弧顶点」时趋近 0
 * （mock 锚点 06:12/18:28 下是本地 11:50 与 23:50 附近，实测邻域内差值可低到
 * 0.0005 以下 = dbg.alt 三位小数看不出变化）。真实时间跑用例会在这个窗口里
 * 静默假红/假绿，钉死一个离平点 2.6h 的上午时刻是唯一确定的做法。
 */
