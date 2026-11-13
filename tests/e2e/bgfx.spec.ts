import { expect, test, type Page } from '@playwright/test';
import { mockWeather } from './helpers/mock-weather';

// 天气请求（Open-Meteo）一律 mock：离线可跑 + 零 resource error
test.beforeEach(async ({ page }) => {
  await mockWeather(page);
});

/**
 * bg-fx 自证矩阵（轨道 A，方案 §5 精神扩展）：
 * - 3 视口 × 4 路由：canvas 存在、已绘制非空白（getImageData 采样去重计数 ≥ 4）、零 console error
 * - 恒暗单档抽查：additive 门控不崩溃、仍出像素
 * - prefers-reduced-motion 抽查：半速降频不冻结、仍出像素、零报错
 * 注意：抓的是 canvas 元素本身（clearRect 后透明底 + additive 辉光合成），
 * 非页面合成截图——scrim 是否遮蔽不在此断言范围（由 DOM 断言 + 作者视觉验收覆盖）。
 */
const ROUTES = [
  { name: 'home', path: '/' },
  { name: 'blog-list', path: '/blog' },
  { name: 'post', path: '/blog/2026-08-27-8bit-me-v2-refactor-notes' },
  { name: '404', path: '/404' },
];

const VIEWPORTS = [
  { name: '375', width: 375, height: 667 },
  { name: '768', width: 768, height: 900 },
  { name: '1440', width: 1440, height: 900 },
];

/** 全图扫描 canvas 像素：非透明像素计数 + 去重颜色数（星空稀疏，不能网格采样——
 *  8px 步进会几乎全落在透明像素上；全量扫一次 getImageData 单次调用，几百万像素可接受） */
async function sampleCanvas(page: Page) {
  return page.evaluate(() => {
    const c = document.getElementById('bgfx-canvas') as HTMLCanvasElement;
    const wrap = document.querySelector<HTMLElement>('.bgfx-canvas');
    if (!c || !c.getContext) return { found: false, drawn: 0, distinct: 0 };
    const ctx = c.getContext('2d')!;
    const W = c.width;
    const H = c.height;
    const data = ctx.getImageData(0, 0, W, H).data;
    const seen = new Set<number>();
    let drawn = 0;
    for (let i = 0; i < data.length; i += 4) {
      // 忽略全透明像素（clearRect 底），只数真实绘制色
      if (data[i + 3] === 0) continue;
      drawn++;
      seen.add(((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]) >>> 0);
    }
    return {
      found: true,
      drawn,
      distinct: seen.size,
      wrapDisplay: wrap ? getComputedStyle(wrap).display : 'none',
    };
  });
}

async function openAndCheckCanvas(page: Page, path: string) {
  // 显式落 world，保证矩阵各视口/路由行为确定（默认即 world；core 已退役，脏存档会被归一）
  await page.addInitScript(() => {
    try {
      localStorage.setItem('8bitme:bgfx', 'world');
    } catch {
      /* ignore */
    }
  });
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  await page.goto(path, { waitUntil: 'load' });
  // 等至少一帧 rAF 绘制落盘
  await page.waitForTimeout(180);

  expect(errors, `${path} 控制台零 JS 报错`).toEqual([]);

  const sample = await sampleCanvas(page);
  expect(sample.found, `${path} 存在 bgfx canvas`).toBe(true);
  if (path === '/') {
    // 首页首屏 = 世界唯一在场地：星空稀疏，断言「确实画了足够像素」而非颜色数
    expect(sample.drawn, `${path} canvas 已绘制非空白（drawn≥30）`).toBeGreaterThanOrEqual(30);
    expect(sample.distinct, `${path} 至少两色（天空/山/水层）`).toBeGreaterThanOrEqual(2);
  } else {
    // 内页按设计是**空画布**：世界只住首页 hero（滚动即淡出，见 drawWorld 的 worldAlpha）。
    // core 时代这些路由有走线可画；模式退役后「空」才是正确行为——判据从「非空白」改成
    // 「零报错 + 确认没有悄悄画东西」（天气 mock 为晴，无粒子）。
    expect(sample.drawn, `${path} 内页画布应为空（世界只在首页 hero）`).toBe(0);
  }
}

for (const vp of VIEWPORTS) {
  test.describe(`bg-fx 矩阵 @${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });
    for (const route of ROUTES) {
      test(`${route.name} ${route.path} 零报错（首页有世界 / 内页按设计为空）`, async ({ page }) => {
        await openAndCheckCanvas(page, route.path);
      });
    }
  });
}

test('bg-fx prefers-reduced-motion：半速降频不冻结、仍出像素、零报错', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  // 必须挑首页：只有那里有世界可画（降频的判据是「仍出像素」）
  await openAndCheckCanvas(page, '/');
});

test('bg-fx 默认开机（world「窗外」）：canvas 与 scrim 可见', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await page.goto('/', { waitUntil: 'load' });
  await page.waitForTimeout(200);
  const state = await page.evaluate(() => {
    const c = document.getElementById('bgfx-canvas') as HTMLCanvasElement | null;
    const s = document.querySelector('.bgfx-scrim') as HTMLElement | null;
    return { canvasHidden: c ? c.hidden : null, scrimHidden: s ? s.hidden : null };
  });
  expect(errors).toEqual([]);
  expect(state.canvasHidden, '默认 world → canvas 可见').not.toBe(true);
  expect(state.scrimHidden, '默认 world → scrim 在（压暗玻璃层）').not.toBe(true);
});

test('bg-fx 偏好 off 仍可退场：显式 off → canvas 与 scrim 隐藏', async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('8bitme:bgfx', 'off');
    } catch {
      /* ignore */
    }
  });
  await page.goto('/', { waitUntil: 'load' });
  await page.waitForTimeout(200);
  const state = await page.evaluate(() => {
    const c = document.getElementById('bgfx-canvas') as HTMLCanvasElement | null;
    const s = document.querySelector('.bgfx-scrim') as HTMLElement | null;
    return { canvasHidden: c ? c.hidden : null, scrimHidden: s ? s.hidden : null };
  });
  expect(state.canvasHidden, '偏好 off → canvas 隐藏').toBe(true);
  expect(state.scrimHidden, '偏好 off → scrim 隐藏').toBe(true);
});

test('bg-fx 滚动视差接线：滚动后 canvas 仍持续绘制（非空白）', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => {
    try {
      localStorage.setItem('8bitme:bgfx', 'world');
    } catch {
      /* ignore */
    }
  });
  await page.goto('/', { waitUntil: 'load' });
  await page.waitForTimeout(150);
  // 首屏内滚动（世界只住 hero；滚太远 worldAlpha 归零就不是「视差接线」了）
  await page.evaluate(() => window.scrollTo(0, 200));
  await page.waitForTimeout(150);
  const sample = await sampleCanvas(page);
  expect(sample.drawn).toBeGreaterThanOrEqual(30);
});

test('bg-fx scrim 几何：长页面首屏以下仍全覆盖（body 定位祖先，锚页尾）', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => {
    try {
      localStorage.setItem('8bitme:bgfx', 'world');
    } catch {
      /* ignore */
    }
  });
  await page.goto('/blog', { waitUntil: 'load' });
  // 文章列表页足够长，滚过一屏后再断言 scrim 仍盖满视口
  await page.evaluate(() => window.scrollTo(0, 1200));
  await page.waitForTimeout(100);
  const cover = await page.evaluate(() => {
    const el = document.querySelector('.bgfx-scrim') as HTMLElement | null;
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.top <= 0 && r.bottom >= window.innerHeight;
  });
  expect(cover, '滚动 1200px 后 scrim 仍覆盖整个视口').toBe(true);
});

/**
 * 2026-09-25 退役（作者：「core 退役换成 world 背景」）：
 *   · 「section 重组（ADR-0004）」用例 —— 机箱 core 的 5 种机器态已随模式一起删除，
 *     该用例量的 `__bgfxDebug.section/cam` 不复存在（不是改成 world 能守的东西：
 *     world 不按 section 重组）。
 *   · 「单档（恒暗）canvas 阶跃」用例 —— 它的判据主体是 **core 走线**引起的局部亮度
 *     阶跃（阈值 0.13）。world 的天空是整片色带（阶跃极大），换到 world 只会把判据
 *     变成「天空不许有色带」，与设计矛盾；故连判据一起退役，不留空心断言。
 * 若日后重做「背景亮度纪律」，请针对 world 的**新口径**重写判据，不要复活这两条。
 */
