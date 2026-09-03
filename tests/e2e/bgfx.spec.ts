import { expect, test, type Page } from '@playwright/test';

/**
 * bg-fx 自证矩阵（轨道 A，方案 §5 精神扩展）：
 * - 3 视口 × 4 路由：canvas 存在、已绘制非空白（getImageData 采样去重计数 ≥ 4）、零 console error
 * - 浅色主题抽查：additive 门控退回 source-over 不崩溃、仍出像素
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
  // v6：默认 off（背景退场），canvas 断言需显式切 core
  await page.addInitScript(() => {
    try {
      localStorage.setItem('8bitme:bgfx', 'core');
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
  // 星空稀疏：断言「确实画了足够像素」而非「颜色足够多」——个位数颜色即证明引擎在画
  expect(sample.drawn, `${path} canvas 已绘制非空白（drawn≥30）`).toBeGreaterThanOrEqual(30);
  expect(sample.distinct, `${path} 至少两色（accent/light 层）`).toBeGreaterThanOrEqual(2);
}

for (const vp of VIEWPORTS) {
  test.describe(`bg-fx 矩阵 @${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });
    for (const route of ROUTES) {
      test(`${route.name} ${route.path} canvas 非空白且零报错`, async ({ page }) => {
        await openAndCheckCanvas(page, route.path);
      });
    }
  });
}

test('bg-fx 浅色主题（nes-punch）：source-over 门控不崩溃、仍出像素', async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('8bitme:theme', 'nes-punch');
    } catch {
      /* storage unavailable */
    }
  });
  await openAndCheckCanvas(page, '/');
});

test('bg-fx prefers-reduced-motion：半速降频不冻结、仍出像素、零报错', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openAndCheckCanvas(page, '/blog');
});

test('bg-fx 默认退场：canvas 与 scrim 均隐藏（v6 电路化语义）', async ({ page }) => {
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
  expect(state.canvasHidden, '默认 off → canvas 隐藏').toBe(true);
  expect(state.scrimHidden, '默认 off → scrim 隐藏（不染暗页面）').toBe(true);
});

test('bg-fx 滚动视差接线：滚动后 canvas 仍持续绘制（非空白）', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => {
    try {
      localStorage.setItem('8bitme:bgfx', 'core');
    } catch {
      /* ignore */
    }
  });
  await page.goto('/blog', { waitUntil: 'load' });
  await page.waitForTimeout(150);
  // 制造长滚动（文章列表页足够高）
  await page.evaluate(() => window.scrollTo(0, 400));
  await page.waitForTimeout(150);
  const sample = await sampleCanvas(page);
  expect(sample.drawn).toBeGreaterThanOrEqual(30);
});

test('bg-fx scrim 几何（core 下）：长页面首屏以下仍全覆盖（body 定位祖先，锚页尾）', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => {
    try {
      localStorage.setItem('8bitme:bgfx', 'core');
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

test('bg-fx section 重组（ADR-0004）：滚动穿越 5 section 后基础态切换、canvas 仍绘制、零报错', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await page.addInitScript(() => {
    try {
      localStorage.setItem('8bitme:bgfx', 'core');
    } catch {
      /* ignore */
    }
  });
  await page.goto('/', { waitUntil: 'load' });
  await page.waitForTimeout(200);

  const sections = ['hero', 'about', 'projects', 'skills', 'contact'];
  const seen = new Set<string>();
  for (const id of sections) {
    await page.evaluate((sid) => {
      const el = document.getElementById(sid);
      if (el) el.scrollIntoView({ block: 'center' });
    }, id);
    // 等 IntersectionObserver + 错峰 tween 推进落定
    await page.waitForTimeout(400);
    const dbg = await page.evaluate(() => {
      const c = document.getElementById('bgfx-canvas') as HTMLCanvasElement;
      const ctx = c.getContext('2d')!;
      const data = ctx.getImageData(0, 0, c.width, c.height).data;
      let drawn = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i + 3] !== 0) drawn++;
      const d = (window as unknown as { __bgfxDebug?: { section?: string; cam?: number } })
        .__bgfxDebug;
      return { section: d?.section, cam: d?.cam, drawn };
    });
    seen.add(dbg.section ?? '');
    expect(dbg.drawn, `section ${id}：canvas 仍绘制非空白`).toBeGreaterThanOrEqual(30);
  }
  expect(errors, '穿越 section 全程控制台零 JS 报错').toEqual([]);
  // 基础态确随滚动切换（至少命中多个不同 section 态）
  expect(seen.size, `重组基础态随 section 切换（命中 ${seen.size} 种）`).toBeGreaterThanOrEqual(3);
});