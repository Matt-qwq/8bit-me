import { expect, test, type Page } from '@playwright/test';
import { bandBounds, hexToRgb, lerpHex, sampleSky } from '../../src/lib/sky-palette';
import { daylightFor, moonLitRow, moonPhase, skyMoment } from '../../src/lib/sky-time';
import { genScenery, ridgeAt } from '../../src/lib/sky-scene';
import { windowSpec } from '../../src/lib/window-room';
import {
  glassTint,
  mistGlass,
  moonSpill,
  frameProfile,
  wallFace,
  sunlitFrame,
  glassWarm,
} from '../../src/lib/window-light';
import { DESK, deskSpec } from '../../src/lib/desk-room';
import { DARK } from '../../src/lib/themes';
import { mockWeather } from './helpers/mock-weather';
import { scrollHeroToTop } from './helpers/hero';

/**
 * 「窗外」世界 e2e（ADR-0020）——守浏览器里真的发生了的事：
 *   ① 首屏画出的是**天空**（大片非透明像素 + 多色带），不是空白；
 *   ② 世界只住首屏：滚动离开 hero 后 worldAlpha → 0（回到主题底色的房间）；
 *   ③ 天气真的接上了：mock 雨天 → 雨粒子存在；雪天 → 雪存在且无雨；
 *      且粒子**全站**飘（blog 阅读页也下——worldAlpha=0 但天气层照画）；
 *   ④ 实况读数行渲染作者城市时刻与天气词；
 *   ⑤ 首访点亮仪式：?show 重播且 bootP 从 0 递增（冻结 rAF 抓中间态）；
 *   ⑥ reduced-motion：跳过仪式（直接稳态），不冻结；
 *   ⑦ 场景契约（ADR-0020 A 案「远山与湖面」）：画面下半部有**山脊轮廓**（逐列亮度
 *      突变 = 山体与天空的分界），且地平线以上是天空、以下是水面——不是一整块平涂。
 */

async function sampleCanvas(page: Page) {
  return page.evaluate(() => {
    const c = document.getElementById('bgfx-canvas') as HTMLCanvasElement;
    const ctx = c.getContext('2d')!;
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let drawn = 0;
    const cols = new Set<number>();
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] !== 0) {
        drawn++;
        cols.add((d[i]! << 16) | (d[i + 1]! << 8) | d[i + 2]!);
      }
    }
    return { drawn, distinct: cols.size };
  });
}

async function debugState(page: Page) {
  return page.evaluate(
    () => (window as unknown as { __bgfxDebug?: Record<string, unknown> }).__bgfxDebug ?? {}
  );
}

/** 窗台小植物（T6）微摆采样：页内 rAF 逐帧拍「顶部 2 行叶尖带」，与**首帧**逐像素比，
 *  返回出现过的「变化列」x 集合（叶尖 ±1px 换位 → 新列亮出/旧列熄灭 → 列即位置）。
 *  判据刻意**不做颜色-基线比对**（2026-10-03 教训）：拆棂/去铁窗轮后框面色调随时段
 *  变（夜里 ≈ face×0.55、白天接光又是暖木色），解析 face 基线与实画颜色整带超差，
 *  「最左叶尖」恒等于带左缘（假信号）；帧间差分只看「什么变了」，对任何时段色调免疫。
 *  前提：叶尖在该时段**可见**（白天 drizzle 下叶 vs 框面差 ~18，标定值）——
 *  用例侧用 openWorldAt 钉正午。deadline 是兜底：到点交卷让断言说话。 */
async function sampleSwayColumns(
  page: Page,
  px0: number,
  top: number,
  opts: { reads?: number; distinct?: number; deadlineMs?: number } = {}
): Promise<number[]> {
  const { reads = 240, distinct = 2, deadlineMs = 38000 } = opts;
  return page.evaluate(
    ({ px0, top, reads, distinct, deadlineMs }) =>
      new Promise<number[]>((res) => {
        const c = document.getElementById('bgfx-canvas') as HTMLCanvasElement;
        const ctx = c.getContext('2d')!;
        const x0 = Math.round(px0) - 2; // 含 ±1px 摆幅余量
        const W = 8, H = 2; // 右缘留在左框面上（不碰 reveal/洞内景物）
        const first = ctx.getImageData(x0, Math.round(top), W, H).data.slice();
        const movers = new Set<number>();
        let n = 0;
        const t0 = performance.now();
        const finish = () => res([...movers].sort((a, b) => a - b));
        const tick = () => {
          const im = ctx.getImageData(x0, Math.round(top), W, H).data;
          for (let x = 0; x < W; x++) {
            for (let yy = 0; yy < H; yy++) {
              const i = (yy * W + x) * 4;
              if (
                Math.abs(im[i]! - first[i]!) > 6 ||
                Math.abs(im[i + 1]! - first[i + 1]!) > 6 ||
                Math.abs(im[i + 2]! - first[i + 2]!) > 6
              ) {
                movers.add(x0 + x);
                break;
              }
            }
          }
          n += 1;
          if (
            n >= reads ||
            performance.now() - t0 >= deadlineMs ||
            (movers.size >= distinct && n >= 24)
          )
            finish();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    { px0, top, reads, distinct, deadlineMs }
  );
}

// ---- T5 光交换/玻璃物性 e2e 的取样小工具（几何一律从 windowSpec 派生） ----

/** 钉死页面时钟（Fake Date）+ mock 天气 + 进首页稳态。
 *  光交换层（月光带/室内反光/结露）都是「夜里才有」——不钉时刻判据不可复现。
 *  用独立 page 而不是同页重载：addInitScript 会累积，两个时钟会互相覆盖。 */
async function openWorldAt(page: Page, hh: number, mm: number, code = 0, isDay = 0) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(
    ([Y, MO, D, HH, MM]) => {
      try {
        localStorage.removeItem('8bitme:weather');
      } catch {
        /* about:blank 首次导航前 */
      }
      const Real = Date;
      const t = new Real(Y, MO, D, HH, MM, 0).getTime();
      const Fake = class extends Real {
        constructor(...a: never[]) {
          if (a.length === 0) super(t);
          else super(...(a as []));
        }
        static now() {
          return t;
        }
      };
      window.Date = Fake as unknown as DateConstructor;
    },
    [2026, 8, 21, hh, mm] as const
  );
  await mockWeather(page, code, isDay, '2026-09-21');
  await page.goto('/', { waitUntil: 'load' });
  await page.waitForTimeout(2200);
}

/** 画布单像素（RGB） */
async function pixelAt(page: Page, x: number, y: number) {
  return page.evaluate(
    ([x, y]) => {
      const c = document.getElementById('bgfx-canvas') as HTMLCanvasElement;
      const d = c.getContext('2d')!.getImageData(Math.round(x), Math.round(y), 1, 1).data;
      return [d[0]!, d[1]!, d[2]!] as [number, number, number];
    },
    [x, y] as const
  );
}

const lumOf = (p: readonly number[]) => 0.2126 * p[0]! + 0.7152 * p[1]! + 0.0722 * p[2]!;

/** 行均值亮度（同一行多列取均：抵消天空拜耳抖动的逐像素起伏） */
async function rowMeanLum(page: Page, y: number, x0: number, x1: number) {
  return page.evaluate(
    ([y, x0, x1]) => {
      const c = document.getElementById('bgfx-canvas') as HTMLCanvasElement;
      const img = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      let s = 0;
      let n = 0;
      for (let x = Math.round(x0); x < Math.round(x1); x++) {
        const i = (Math.round(y) * c.width + x) * 4;
        s += 0.2126 * img[i]! + 0.7152 * img[i + 1]! + 0.0722 * img[i + 2]!;
        n++;
      }
      return s / n;
    },
    [y, x0, x1] as const
  );
}

/** 列均值亮度（同一列多行取均） */
async function colMeanLum(page: Page, x: number, y0: number, y1: number) {
  return page.evaluate(
    ([x, y0, y1]) => {
      const c = document.getElementById('bgfx-canvas') as HTMLCanvasElement;
      const img = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      let s = 0;
      let n = 0;
      for (let y = Math.round(y0); y < Math.round(y1); y++) {
        const i = (y * c.width + Math.round(x)) * 4;
        s += 0.2126 * img[i]! + 0.7152 * img[i + 1]! + 0.0722 * img[i + 2]!;
        n++;
      }
      return s / n;
    },
    [x, y0, y1] as const
  );
}

/** 矩形均值亮度 */
async function rectMeanLum(page: Page, x: number, y: number, w: number, h: number) {
  return page.evaluate(
    ([x, y, w, h]) => {
      const c = document.getElementById('bgfx-canvas') as HTMLCanvasElement;
      const img = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      let s = 0;
      let n = 0;
      for (let yy = Math.round(y); yy < Math.round(y + h); yy++)
        for (let xx = Math.round(x); xx < Math.round(x + w); xx++) {
          const i = (yy * c.width + xx) * 4;
          s += 0.2126 * img[i]! + 0.7152 * img[i + 1]! + 0.0722 * img[i + 2]!;
          n++;
        }
      return s / n;
    },
    [x, y, w, h] as const
  );
}

/** 行中位色（逐通道取中位数：星星/云等离群像素不会把纯带色带偏） */
async function medianRowRgb(page: Page, y: number, x0: number, x1: number) {
  return page.evaluate(
    ([y, x0, x1]) => {
      const c = document.getElementById('bgfx-canvas') as HTMLCanvasElement;
      const img = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      const ch: number[][] = [[], [], []];
      for (let x = Math.round(x0); x < Math.round(x1); x++) {
        const i = (Math.round(y) * c.width + x) * 4;
        for (let k = 0; k < 3; k++) ch[k]!.push(img[i + k]!);
      }
      return ch.map((a) => {
        a.sort((u, v) => u - v);
        return a[a.length >> 1]!;
      });
    },
    [y, x0, x1] as const
  );
}

/** 夜/昼共用的一套假时钟与晨昏锚点（与 mockWeather 的 dayOverride 同日，否则 sunAlt 落到夜弧） */
const T5_NIGHT_MS = new Date(2026, 8, 21, 23, 30, 0).getTime();
const T5_ANCHORS = {
  sunriseMs: new Date('2026-09-21T06:12').getTime(),
  sunsetMs: new Date('2026-09-21T18:28').getTime(),
};

test.beforeEach(async ({ page }) => {
  await mockWeather(page); // 默认晴：确定性起点
});

test('world 默认：首屏画出天空（大片非透明像素 + 多色带），零报错', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/', { waitUntil: 'load' });
  await page.waitForTimeout(2200); // 点亮仪式 1.6s 走完 → 稳态
  const d = await debugState(page);
  expect(d.mode, '默认模式 = world').toBe('world');
  expect(Number(d.worldAlpha), '首屏 worldAlpha = 1（世界全亮）').toBeGreaterThan(0.9);
  const s = await sampleCanvas(page);
  // 天空铺满全屏：非透明像素数量级远大于「没画世界」的空画布
  expect(s.drawn, `天空已铺开（drawn=${s.drawn}）`).toBeGreaterThan(20000);
  expect(s.distinct, `色带层次（distinct=${s.distinct}）`).toBeGreaterThanOrEqual(4);
  expect(errors).toEqual([]);
});

test('世界只住首屏：滚到第二屏后 worldAlpha → 0', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/', { waitUntil: 'load' });
  await page.waitForTimeout(2000);
  expect(Number((await debugState(page)).worldAlpha)).toBeGreaterThan(0.9);
  await page.evaluate(() => window.scrollTo(0, window.innerHeight));
  await page.waitForTimeout(400);
  const d = await debugState(page);
  expect(Number(d.worldAlpha), '离开首屏（#window）后世界淡出（回到主题底色的房间）').toBeLessThan(0.1);
});

/**
 * ADR-0027 两扇门：窗外世界只住首屏 `#window`，工位只住第二章 `#hero`——
 * BgFx.drawWorld 按两章各自的可见度算 worldAlpha / deskAlpha，两者不同屏。
 *
 * 注：`__bgfxDebug` 只暴露了 worldAlpha，**没有 deskAlpha**（与 ADR-0027 的
 * 「两个都有读数」不符，已上报源码侧）；这里用两条独立同源判据守工位门：
 * ① canvas 真像素——CRT 屏块（色值从源码 lerpHex(frameProfile(…),黑,0.62)
 *    派生）在首屏一个都没有、在 #hero 顶对齐时铺满；
 * ② DOM 侧 `--scene-a`（Hero.syncScene 与 deskAlpha 逐字同公式）。
 */
test('两扇门（ADR-0027）：世界只住 #window，工位只住 #hero（屏块像素 + --scene-a）', async ({
  page,
}) => {
  await openWorldAt(page, 12, 0, 0, 1); // 正午晴：屏色判据不被夜色/暗天干扰
  const size = await canvasSize(page);
  const d = deskSpec(size.w, size.h)!;
  const palette = { bg: DARK.colors.bg, accent: DARK.colors.accent, light: DARK.colors.text };
  const screenCol = lerpHex(frameProfile(palette, '#ffffff').face, '#000000', 0.62);
  const s = d.crt.screen;
  const area = s.w * s.h;
  const countScreen = () => countColor(page, screenCol, s.y + s.h, s.x, s.x + s.w, 4);
  const sceneA = () =>
    page.$eval('#hero', (e) => Number(getComputedStyle(e).getPropertyValue('--scene-a')));

  // ① 首屏：世界满亮、工位不在场
  expect(Number((await debugState(page)).worldAlpha), '首屏 worldAlpha 应≈1').toBeGreaterThan(0.9);
  const n0 = await countScreen();
  expect(n0, `首屏出现 ${n0}/${area} 个屏色像素 → 工位没被 deskAlpha 门挡住`).toBeLessThan(
    Math.floor(area * 0.05)
  );
  expect(await sceneA(), '首屏 --scene-a 应≈0（DOM 工位层也不在场）').toBeLessThan(0.1);

  // ② 滚到 about：世界归零（工位也不同屏）
  await page.evaluate(() => {
    const a = document.getElementById('about')!;
    window.scrollTo({
      top: a.getBoundingClientRect().top + window.scrollY,
      behavior: 'instant' as ScrollBehavior,
    });
  });
  await page.waitForTimeout(400);
  expect(Number((await debugState(page)).worldAlpha), '滚到 about 后世界应淡尽').toBeLessThan(0.1);

  // ③ #hero 顶对齐：世界退场、工位满亮
  await scrollHeroToTop(page);
  await page.waitForTimeout(200);
  expect(Number((await debugState(page)).worldAlpha), '#hero 顶对齐时世界应不在').toBeLessThan(0.1);
  const n1 = await countScreen();
  expect(n1, `#hero 顶对齐时屏块只有 ${n1}/${area} → 工位门没开`).toBeGreaterThanOrEqual(
    Math.floor(area * 0.95)
  );
  expect(await sceneA(), '#hero 顶对齐时 --scene-a 应≈1').toBeGreaterThan(0.9);
});

test('天气接线：雨天 → 雨粒子（全站飘，含阅读页）', async ({ page }) => {
  await mockWeather(page, 61, 1);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/', { waitUntil: 'load' });
  await page.waitForTimeout(1200);
  const d = await debugState(page);
  expect(d.weather, 'mock 61 → rain').toBe('rain');
  expect(Number(d.rain), '雨粒子已播种').toBeGreaterThan(50);
  expect(Number(d.snow)).toBe(0);
  // 阅读页：worldAlpha=0（世界不在）但天气层照画 —— 且画布真的落了像素
  await page.goto('/blog', { waitUntil: 'load' });
  await page.waitForTimeout(1200);
  const d2 = await debugState(page);
  expect(Number(d2.worldAlpha), '阅读页世界不在').toBe(0);
  expect(Number(d2.rain), '阅读页仍在下雨').toBeGreaterThan(50);
  const s = await sampleCanvas(page);
  expect(s.drawn, '阅读页画布有雨丝像素').toBeGreaterThan(200);
});

test('天气接线：雪天 → 雪粒子且无雨；雷暴 → 雨 + thunder 标记', async ({ page }) => {
  await mockWeather(page, 71, 0);
  await page.goto('/', { waitUntil: 'load' });
  await page.waitForTimeout(1200);
  const snow = await debugState(page);
  expect(snow.weather).toBe('snow');
  expect(Number(snow.snow)).toBeGreaterThan(30);
  expect(Number(snow.rain)).toBe(0);

  // 换天气：清掉 30min 缓存（否则 readCache 命中雪，mock 根本不会被请求）
  await page.evaluate(() => localStorage.removeItem('8bitme:weather'));
  await page.unroute('**/api.open-meteo.com/**');
  await mockWeather(page, 95, 1);
  await page.goto('/', { waitUntil: 'load' });
  await page.waitForTimeout(1200);
  const storm = await debugState(page);
  expect(storm.weather).toBe('thunder');
  expect(Number(storm.rain)).toBeGreaterThan(50);

  // **首闪要很快**：切到雷暴后 ~1.5s 必闪（首闪近、后续 9–16s 常态节奏）；
  // 没有这条，切过来看几秒只有雨没有雷（作者实抓「没看见闪电」）。bolt = 闪电线顶点数。
  // 闪白窗只有 ~300ms——node 侧 100ms 轮询会与窗口赛跑（实抓假红），改页内 rAF 逐帧锁存。
  const seenBolt = await page.evaluate(
    () =>
      new Promise<boolean>((res) => {
        const t0 = performance.now();
        const tick = () => {
          const d = (window as unknown as { __bgfxDebug?: { bolt?: number } }).__bgfxDebug;
          if (Number(d?.bolt ?? 0) > 0) return res(true);
          if (performance.now() - t0 > 5000) return res(false);
          requestAnimationFrame(tick);
        };
        tick();
      })
  );
  expect(seenBolt, '切到雷暴后 5s 内必须出现闪电线（首闪 ~1.5s + 余量）').toBe(true);

  // reduced-motion 不再杀死雷闪（合规天气现象，见 applyWx 注释）——
  // 作者实抓：reduce 环境下「完全看不到闪电听不到雷」。这条锁住豁免不被回收。
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1500);
  const seenBoltReduce = await page.evaluate(
    () =>
      new Promise<boolean>((res) => {
        const t0 = performance.now();
        const tick = () => {
          const d = (window as unknown as { __bgfxDebug?: { bolt?: number } }).__bgfxDebug;
          if (Number(d?.bolt ?? 0) > 0) return res(true);
          if (performance.now() - t0 > 5000) return res(false);
          requestAnimationFrame(tick);
        };
        tick();
      })
  );
  expect(seenBoltReduce, 'reduced-motion 下雷闪仍应出现（≤3闪/s 合规，天气现象豁免）').toBe(true);
});

test('实况读数行：LOCAL 时刻 + 城市 + 天气词（丝印语言）', async ({ page }) => {
  await page.goto('/', { waitUntil: 'load' });
  await page.waitForTimeout(600);
  const live = page.locator('.hero-live');
  await expect(live).toBeVisible();
  await expect(live.locator('[data-live-time]')).toHaveText(/^LOCAL \d{2}:\d{2}$/);
  await expect(live).toContainText('GUANGZHOU');
  await expect(live.locator('[data-live-wx]')).toHaveText('CLEAR');
});

test('首访点亮仪式：?show 重播，bootP 从 0 递增（冻结 rAF 抓中间态）', async ({ page }) => {
  // 冻结 rAF 到前 12 帧：bootP 只推进 ~0.125（1/96 × 12）
  await page.addInitScript(() => {
    let k = 0;
    const orig = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb: FrameRequestCallback) => {
      if (k++ < 12) return orig(cb);
      return 0;
    };
  });
  await page.goto('/?show', { waitUntil: 'load' });
  await page.waitForTimeout(400);
  const mid = await debugState(page);
  expect(Number(mid.bootP), '仪式进行中（未到 1）').toBeLessThan(0.6);
  expect(Number(mid.alt), '仪式起点 = 深夜地板附近').toBeLessThan(0);
});

test('reduced-motion：跳过点亮仪式（直接稳态）、不冻结、零报错', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?show', { waitUntil: 'load' });
  await page.waitForTimeout(700);
  const d = await debugState(page);
  expect(Number(d.bootP), 'reduced-motion 不做仪式').toBe(1);
  expect(errors).toEqual([]);
});

/**
 * 场景探针。
 *
 * 山体真的画了（硬指标）：把**山色本身**拿到画布上数像素。判据取自
 * `sampleSky(alt)`（源码唯一事实源），所以「把近山画成天空色 / 干脆不画」
 * 这类退化一定红——而所有「比上方天空暗」式的间接判据都会假绿
 * （天空从顶到底本来就在变亮，bands[2] 恰好比 0.5h 处的 bands[4] 暗）。
 *
 * 山脊起伏：逐列从下往上找「相邻两行亮度骤降」= 天空→山体的分界，
 * 要求高度有变化（把山画成一条水平线必红）。
 *
 * 走过的假绿坑（别再用）：
 *   ① 颜色判据（B-G / 饱和度）：天空本身 6 条色带，底带偏白；夜里近山与天空
 *      都是深蓝——分不开。
 *   ② 扫描窗放到地平线以下：命中**山影倒影**（镜像的山形同样有起伏）。
 *   ③ 只测「有亮度骤降」：近山脊线的**受光边**（亮线）到山体本身就是一次骤降，
 *      近山画成天空色时它照样存在。
 *   ④ 只测「比上方天空暗」：天空纵向本就渐亮，bands[2] 比 bands[4] 暗 → 假绿。
 */
async function sceneProbe(
  page: Page,
  win: { x: number; y: number; w: number; h: number },
  ridgeTop: number,
  ridgeBottom: number
) {
  return page.evaluate(
    ([wx, wy, ww, top, bottom]) => {
      const c = document.getElementById('bgfx-canvas') as HTMLCanvasElement;
      const ctx = c.getContext('2d')!;
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      const lum = (x: number, y: number) => {
        const i = (y * c.width + x) * 4;
        return 0.2126 * d[i]! + 0.7152 * d[i + 1]! + 0.0722 * d[i + 2]!;
      };
      // 只扫窗洞内（左右各留 24px 避开窗框与内阴影带）——框宽 18px，扫到框上会量错
      const x0 = Math.round(wx + 24);
      const x1 = Math.round(wx + ww - 24);
      const prof: number[] = [];
      for (let x = x0; x < x1; x += 16) {
        let hit = -1;
        for (let y = bottom; y > top; y--) {
          if (lum(x, y) < lum(x, y - 1) * 0.88) {
            hit = y;
            break;
          }
        }
        // 返回**洞坐标** y（世界已 translate 到洞原点）：断言直接用 genScenery 的几何量
        prof.push(hit > 0 ? hit - wy : hit);
      }
      return { prof, h: c.height, w: c.width, alt: 0 };
    },
    [win.x, win.y, win.w, ridgeTop, ridgeBottom] as const
  );
}

/** 画布内部分辨率（注意 ≠ 视口宽：竖滚动条吃掉 clientWidth 的差） */
async function canvasSize(page: Page) {
  return page.evaluate(() => {
    const c = document.getElementById('bgfx-canvas') as HTMLCanvasElement;
    return { w: c.width, h: c.height };
  });
}

/**
 * 画布上「与给定色值几乎相同」的像素数（±3 容差，canvas 无插值所以能精确匹配）。
 * 只扫 y < horizonY 的**地平线以上**区域：水面有山影倒影（同一套山色、面积相当），
 * 不排除它的话「把近山画成天空色」会因为倒影仍匹配而假绿。
 */
async function countColor(page: Page, hex: string, yMax: number, xMin: number, xMax: number, tol = 3) {
  return page.evaluate(
    ([h, yMax, xMin, xMax, tol]) => {
      const c = document.getElementById('bgfx-canvas') as HTMLCanvasElement;
      const ctx = c.getContext('2d')!;
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      const R = parseInt(h.slice(1, 3), 16);
      const G = parseInt(h.slice(3, 5), 16);
      const B = parseInt(h.slice(5, 7), 16);
      let n = 0;
      const rows = Math.min(c.height, yMax);
      const cols = Math.min(c.width, xMax);
      for (let y = 0; y < rows; y++) {
        for (let x = Math.max(0, xMin); x < cols; x++) {
          const i = (y * c.width + x) * 4;
          if (Math.abs(d[i]! - R) <= tol && Math.abs(d[i + 1]! - G) <= tol && Math.abs(d[i + 2]! - B) <= tol)
            n++;
        }
      }
      return n;
    },
    [hex, yMax, xMin, xMax, tol] as const
  );
}

test('场景契约：远山与近山真的画在画布上（色值取自源码），且山脊有起伏', async ({ page }) => {
  // 固定到正午：深夜的天空顶部色（#05081a）与近山色（#070b1e）只差 2–4/通道，
  // 会撞进色值匹配的容差里；正午两者差 23–49/通道，判据才干净
  await page.addInitScript(() => {
    const Real = Date;
    const t = new Real(2026, 8, 21, 12, 0, 0).getTime();
    // 覆写全局 Date：测试里刻意为之
    const Fake = class extends Real {
      constructor(...a: never[]) {
        if (a.length === 0) super(t);
        else super(...(a as []));
      }
      static now() {
        return t;
      }
    };
    window.Date = Fake as unknown as DateConstructor;
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/', { waitUntil: 'load' });
  await page.waitForTimeout(2200);
  const dbg = await debugState(page);
  expect(dbg.weather).toBe('clear'); // 晴天 dim=1，山色未被天气压暗
  const sky = sampleSky(Number(dbg.alt));
  // ① 两档山色都在画布上大面积出现（近山体 + 远山体）
  // **近山判据 = 「雾坡容差」**（2026-09-23 画法精化后）：山脚雾坡（mistTopY 以下）
  // 逐行把近山体溶进天色——近山体整体在雾坡带内，纯色 #3f6b5c 在地平线以上
  // 已不存在（这是设计不是回归）。容差由雾坡上限 alpha 推导：色偏 ≤ MIST 最大
  // 不透明度 × 源色与天色的通道最大差（≈ 0.16 × ~160 ≈ 26）——容差仍与源码同源，
  // 不是拍脑袋放宽。远山在雾坡上方，仍用纯色口径。
  const size = await canvasSize(page);
  const win = windowSpec(size.w, size.h);
  const sc = genScenery(win.w, win.h);
  // 山色只出现在窗洞内：取样限制在洞内（左右各留 22px 避开框/内阴影），
  // 否则墙面色可能撞进色值容差（间接判据假绿）。
  const xLo = win.x + 22;
  const xHi = win.x + win.w - 22;
  const yMax = win.y + sc.horizonY - 4;
  const nNear = await countColor(page, sky.ridgeNear, yMax, xLo, xHi, 26);
  const nFar = await countColor(page, sky.ridgeFar, yMax, xLo, xHi);
  expect(
    nNear,
    `近山色 ${sky.ridgeNear}（雾容差 26）只找到 ${nNear} 像素（山没画或颜色不对）`
  ).toBeGreaterThan(2000);
  expect(nFar, `远山色 ${sky.ridgeFar} 只找到 ${nFar} 像素`).toBeGreaterThan(2000);
  // ② 山脊有起伏：不是一条水平线
  // 扫描窗由山脊几何派生（曾写死 0.5h–0.66h：山体整体下移后窗口落空，判据必红）
  const minRidgeY = Math.min(...sc.farRidge.map(([, y]) => y), ...sc.nearRidge.map(([, y]) => y));
  const { prof } = await sceneProbe(page, win, win.y + minRidgeY - 24, win.y + sc.horizonY - 6);
  const found = prof.filter((y) => y > 0);
  expect(found.length, `多数列都该找到山脊（找到 ${found.length}/${prof.length}）`).toBeGreaterThan(
    prof.length * 0.6
  );
  expect(Math.max(...found) - Math.min(...found), '山脊有起伏').toBeGreaterThan(8);
  // 山脊必须在地平线以上（是山不是水面），且在山体带内（用几何派生，不写死比例）
  const mean = found.reduce((a, b) => a + b, 0) / found.length;
  expect(mean, '山脊在地平线以上').toBeLessThan(sc.horizonY);
  expect(mean, '山脊在山体带内').toBeGreaterThan(Math.min(...sc.farRidge.map(([, y]) => y)));
});

test('场景契约：地平线以下是水面（暗于紧邻的天空且有水平条纹），不是天空的延续', async ({ page }) => {
  // 时钟钉正午晴日（openWorldAt 惯例）：夜里湖面镜像贴近天色，「水面暗于天空 ×0.9」
  // 的阈值随钟点翻脸（实测 2026-10-03 夜间 0.94 红、午后全绿）。
  await openWorldAt(page, 12, 0, 0, 1);
  await page.waitForFunction(
    () => ((window as unknown as { __bgfxDebug?: Record<string, unknown> }).__bgfxDebug ?? {}).bootP === 1,
    undefined,
    { timeout: 10000 }
  );
  // 取样点与山脊相对（不是固定比例高度）：山脊最高点最低的那一列，
  // 它上方 4px 一定是天空。**不能用「比天顶暗」当判据**——真实夜空本就近地平线最亮
  // （湖面镜像是地平线色带），夜里水面确实亮过天顶，那种判据必然随钟点翻脸。
  // 几何必须用**画布真实尺寸**算：canvas 宽 = clientWidth（不含滚动条），
  // 写 1440 会和 1424 的画布错开，取样列落到另一座山脊上。
  const size = await canvasSize(page);
  const win = windowSpec(size.w, size.h);
  const sc = genScenery(win.w, win.h);
  // 取样列必须在**窗洞内**（洞坐标）：窗框宽 18px，取到框上会量到框体色
  // （三个取样点全同色，判据变成「框 == 框」恒假红/恒假绿）。再各内缩 24px 避开内阴影带。
  const lo = 24;
  const hi = win.w - 24;
  // **必须用 ridgeAt(pts, x) 而不是 pts[x]**：ridgeLine 按 step≈w/440 抽点，
  // 数组下标不是 x 坐标，直接索引会取到另一座山脊的标高
  let x0 = lo;
  let top = -1;
  for (let x = lo; x < hi; x++) {
    // min 而非 max：山体是「脊线 → 地平线」填充，天空在**两条脊线都更低**的那一侧，
    // 取 max 会把取样点落到远山体内部（远山更高时），量到的是山不是天空
    const t = Math.min(ridgeAt(sc.farRidge, x), ridgeAt(sc.nearRidge, x));
    if (t > top) {
      top = t;
      x0 = x;
    }
  }
  const r = await page.evaluate(
    ([sx, skyY, hy, wx, ww, waterBottom]) => {
      const c = document.getElementById('bgfx-canvas') as HTMLCanvasElement;
      const ctx = c.getContext('2d')!;
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      const lum = (x: number, y: number) => {
        const i = (y * c.width + x) * 4;
        return 0.2126 * d[i]! + 0.7152 * d[i + 1]! + 0.0722 * d[i + 2]!;
      };
      // 逐行均值只扫窗洞内（墙与窗台不是水）
      const rowMean = (y: number) => {
        let s = 0;
        let n = 0;
        for (let x = Math.round(wx); x < Math.round(wx + ww); x += 8) {
          s += lum(x, y);
          n++;
        }
        return s / n;
      };
      // 水面区（地平线以下 → 洞底以上）的逐行亮度标准差：水平反光条纹 → 行间明暗交替。
      const vals: number[] = [];
      for (let y = hy + 8; y < waterBottom; y += 3) vals.push(rowMean(y));
      const m = vals.reduce((a, b) => a + b, 0) / vals.length;
      const sd = Math.sqrt(vals.reduce((a, v) => a + (v - m) ** 2, 0) / vals.length);
      return { sky: lum(sx, skyY - 4), water: lum(sx, hy + 20), sd };
    },
    [win.x + x0, win.y + top, win.y + sc.horizonY, win.x, win.w, win.y + win.h - 8] as const
  );
  expect(r.water, `水面暗于紧邻的天空（${r.water.toFixed(1)} vs ${r.sky.toFixed(1)}）`).toBeLessThan(
    r.sky * 0.9
  );
  expect(r.sd, `水面有水平反光条纹（行间亮度 sd=${r.sd.toFixed(2)}）`).toBeGreaterThan(0.4);
});

test('窗：景色被框住（四边是框、下边是窗台），且框取主题色、景色不随主题（单档恒暗）', async ({ page }) => {
  // 时钟钉正午晴日（openWorldAt 同款手法）：接光后夜里框/窗台压暗，与暗水面
  // 的对照会掉到阈值边缘（2026-10-02 实测差 24 == 阈值）；正午框台亮、水蓝，
  // 「框 ≠ 景 / 窗台 ≠ 水」的结构对照最锐利。守的是结构，与时段无关。
  await openWorldAt(page, 12, 0, 0, 1);
  await page.waitForTimeout(2200);
  const size = await canvasSize(page);
  const win = windowSpec(size.w, size.h);
  const probe = async () =>
    page.evaluate(
      ([win]) => {
        const c = document.getElementById('bgfx-canvas') as HTMLCanvasElement;
        const ctx = c.getContext('2d')!;
        const d = ctx.getImageData(0, 0, c.width, c.height).data;
        const px = (x: number, y: number) => {
          const i = (Math.round(y) * c.width + Math.round(x)) * 4;
          return [d[i]!, d[i + 1]!, d[i + 2]!] as [number, number, number];
        };
        // 逐通道色差：clear 白天 + dark 房间时，中灰框面与亮蓝天带的**亮度**可能撞车
        // （2026-09-22 实测差仅 3.3），但颜色明不同——亮度单一判据会假红。
        const cd = (p: [number, number, number], q: [number, number, number]) =>
          Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2]);
        // 取样点全部从 win 派生（真窗化后框不再贴视口边）：框取**洞外框带**中点，
        // 洞内对照点取到「洞深阶梯 + 内阴影」之内（否则量到的是阶梯不是景）。
        const midX = Math.round(win.x + win.w / 2);
        const midY = win.y + Math.round(win.h / 2);
        const depth = win.revealSteps.reduce((a, b) => a + b, 0);
        const inTop = win.y + depth + win.shadow + 6;
        const frameTop = px(midX, win.y - win.frame / 2);
        const sill = px(midX, win.y + win.h + Math.round(win.sill * 0.3));
        const water = px(midX, win.y + win.h - 12);
        return {
          // ① 框（洞外框带四边中点）
          frameTop,
          frameLeft: px(win.x - win.frame / 2, midY),
          frameRight: px(win.x + win.w + win.frame / 2, midY),
          // ② 窗洞内同一高度（若没有框，这里和上面是同一片天空）
          insideTop: px(midX, inTop),
          // ③ 窗台（下边中点）与紧邻上方的水面
          sill,
          water,
          diffFrameInside: cd(frameTop, px(midX, inTop)),
          diffSillWater: cd(sill, water),
        };
      },
      [win] as const
    );
  const a = await probe();
  // ① 框是实心带：左右框同色（不是被景色透过去的）
  expect(a.frameLeft, '左右窗框不同色 → 不是一条框').toEqual(a.frameRight);
  // ② 上边确实是框：与紧邻的窗洞内颜色明显不同（没有框时两者都是天空 → 相等）。
  // 量逐通道色差而不是亮度：clear 白天 + dark 房间时中灰框面与亮蓝天的亮度可能撞车。
  expect(
    a.diffFrameInside,
    `上框与窗洞内几乎同色（色差 ${a.diffFrameInside}）→ 窗框没画`
  ).toBeGreaterThan(24);
  // ③ 下边是窗台不是水：窗台行与水面行不同色
  expect(a.diffSillWater, '窗台与水同色 → 下边没有窗台').toBeGreaterThan(24);
  // ④ 框取主题色、景色不随主题（ADR-0021 单档恒暗：没有第二档可翻，「窗内随身 /
  // 窗外实景固定」这条旧意图落在静态契约上——框色来自 CSS token，而不是天空中那片颜色）。
  expect(a.frameTop, '窗框取主题色（与窗洞内的天空不同 = 框真的画了）').not.toEqual(
    a.insideTop
  );
});

test('窗（窄屏 480×800）：洞对称居中、四边框都在，窗台不与水混', async ({ page }) => {
  // 真窗化后窄屏是一套独立的墙厚比例：洞必须左右对称居中（小屏没有 hero 侧栏要避让），
  // 且四边框、洞深阶梯、窗台都画得出来——不破版是窄屏的唯一验收线。
  // 时钟钉正午晴日（openWorldAt 惯例）：夜里框/窗台压暗与水面趋同，窗台/水色差
  // 阈值（>24）随钟点翻脸（实测 2026-10-03 夜间 23 红、午后全绿）。
  await openWorldAt(page, 12, 0, 0, 1);
  await page.waitForFunction(
    () => ((window as unknown as { __bgfxDebug?: Record<string, unknown> }).__bgfxDebug ?? {}).bootP === 1,
    undefined,
    { timeout: 10000 }
  );
  await page.setViewportSize({ width: 480, height: 800 });
  await page.waitForTimeout(400);
  const size = await canvasSize(page);
  const win = windowSpec(size.w, size.h);
  expect(win.x, '窄屏洞不居中（左右墙不等）').toBe(size.w - win.x - win.w);
  const r = await page.evaluate(
    ([win]) => {
      const c = document.getElementById('bgfx-canvas') as HTMLCanvasElement;
      const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      const px = (x: number, y: number) => {
        const i = (Math.round(y) * c.width + Math.round(x)) * 4;
        return [d[i]!, d[i + 1]!, d[i + 2]!] as [number, number, number];
      };
      const cd = (p: [number, number, number], q: [number, number, number]) =>
        Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2]);
      const midX = Math.round(win.x + win.w / 2);
      const midY = win.y + Math.round(win.h / 2);
      const depth = win.revealSteps.reduce((a, b) => a + b, 0);
      const inTop = win.y + depth + win.shadow + 6;
      const frameTop = px(midX, win.y - win.frame / 2);
      const sill = px(midX, win.y + win.h + Math.round(win.sill * 0.3));
      const water = px(midX, win.y + win.h - 12);
      return {
        frameTop,
        frameLeft: px(win.x - win.frame / 2, midY),
        frameRight: px(win.x + win.w + win.frame / 2, midY),
        insideTop: px(midX, inTop),
        diffFrameInside: cd(frameTop, px(midX, inTop)),
        diffSillWater: cd(sill, water),
      };
    },
    [win] as const
  );
  expect(r.frameLeft, '窄屏左右框不同色 → 不是一条框').toEqual(r.frameRight);
  expect(
    r.diffFrameInside,
    `窄屏上框与洞内几乎同色（色差 ${r.diffFrameInside}）→ 窄屏框没画`
  ).toBeGreaterThan(24);
  expect(r.diffSillWater, `窄屏窗台与水同色（色差 ${r.diffSillWater}）`).toBeGreaterThan(24);
});

test('洞深阶梯：窗洞上缘从框向玻璃逐级变暗（窗真的凹进墙里，不是贴墙的画框）', async ({ page }) => {
  // 真窗语法靠「洞深」成立：洞缘（近室内、被灯照亮）→ 贴玻璃（深、最暗）逐级变暗。
  // 判据从 WINDOW.revealSteps 派生（每阶中点），不写死阶厚；
  // 防假绿：洞缘阶与紧邻洞内更深处天空的**逐通道色差**（天空纵向本就有渐变，
  // 只看亮度会误判成阶梯）。
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/', { waitUntil: 'load' });
  await page.waitForTimeout(2200);
  const size = await canvasSize(page);
  const win = windowSpec(size.w, size.h);
  const r = await page.evaluate(
    ([win]) => {
      const c = document.getElementById('bgfx-canvas') as HTMLCanvasElement;
      const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      const rgbAt = (x: number, y: number) => {
        const i = (Math.round(y) * c.width + Math.round(x)) * 4;
        return [d[i]!, d[i + 1]!, d[i + 2]!] as [number, number, number];
      };
      const lum = (p: [number, number, number]) => 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
      const midX = Math.round(win.x + win.w / 2);
      // 每阶取样 y 从 revealSteps 派生（洞缘 → 玻璃）：取每阶中点
      const steps: number[] = [];
      let cursor = win.y;
      for (let k = win.revealSteps.length - 1; k >= 0; k--) {
        const th = win.revealSteps[k]!;
        steps.push(cursor + Math.floor(th / 2));
        cursor += th;
      }
      const depth = win.revealSteps.reduce((a, b) => a + b, 0);
      const refY = win.y + depth + win.shadow + 6; // 阶梯 + 内阴影之内的玻璃区天空
      const ref = rgbAt(midX, refY);
      const outer = rgbAt(midX, steps[0]!);
      return {
        steps,
        vals: steps.map((y) => lum(rgbAt(midX, y))),
        diffOuterRef:
          Math.abs(outer[0] - ref[0]) + Math.abs(outer[1] - ref[1]) + Math.abs(outer[2] - ref[2]),
      };
    },
    [win] as const
  );
  // ① 从洞缘向玻璃单调变暗（贴玻璃最暗）——每阶中点亮度严格递减
  for (let i = 0; i + 1 < r.vals.length; i++) {
    expect(
      r.vals[i]!,
      `洞深阶梯第 ${i} 阶（y=${r.steps[i]}）不比下一阶亮（${r.vals[i]!.toFixed(1)} vs ${r.vals[i + 1]!.toFixed(1)}）→ 阶梯没画或方向反了`
    ).toBeGreaterThan(r.vals[i + 1]! + 3);
  }
  // ② 洞缘阶与紧邻洞内更深处天空明显不同色（不画阶梯时同列全是天空渐变）
  expect(
    r.diffOuterRef,
    `洞缘阶与洞内天空几乎同色（色差 ${r.diffOuterRef}）→ 阶梯没画（或只有天空渐变）`
  ).toBeGreaterThan(24);
});

test('拆棂观景窗（ADR-0028）：旧棂位是连续玻璃——窄条均值与紧邻玻璃同亮度，无条状物', async ({ page }) => {
  // 拆棂后「这是窗」由框 + 洞深阶梯 + 窗台承担（作者 2026-10-02「铁窗/监狱」反馈）。
  // 判据：旧棂位（横棂 0.52 洞高、竖棂 0.38 洞宽——旧 windowSpec 公式内联钉位）的
  // **窄条均值亮度** vs 紧邻玻璃同宽窄条——若棂还在，整条 6px 的色差在均值里稳稳
  // 显形；拆干净了差值≈0。钉深夜 + 窄条均值（9px 宽）是为了稀释星点/云缘/高光带
  // 的瞬时干扰：高光斜带在 0.58w 以右，两个旧棂采样区都在其左。
  await openWorldAt(page, 23, 30);
  const size = await canvasSize(page);
  const win = windowSpec(size.w, size.h);
  const r = await page.evaluate(
    ([win]) => {
      const c = document.getElementById('bgfx-canvas') as HTMLCanvasElement;
      const ctx = c.getContext('2d')!;
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      const lum = (x: number, y: number) => {
        const i = (Math.round(y) * c.width + Math.round(x)) * 4;
        return 0.2126 * d[i]! + 0.7152 * d[i + 1]! + 0.0722 * d[i + 2]!;
      };
      const stripRow = (y: number, xc: number) => {
        let s = 0;
        for (let dx = -4; dx <= 4; dx++) s += lum(xc + dx, y);
        return s / 9;
      };
      const stripCol = (x: number, yc: number) => {
        let s = 0;
        for (let dy = -4; dy <= 4; dy++) s += lum(x, yc + dy);
        return s / 9;
      };
      const ty = win.y + Math.round(win.h * 0.52); // 旧横棂中心线
      const mx = win.x + Math.round(win.w * 0.38); // 旧竖棂中心 x
      const y0 = win.y + Math.round(win.h * 0.15);
      const y1 = win.y + Math.round(win.h * 0.45);
      let mullion = 0;
      let mullionRef = 0;
      for (let y = y0; y <= y1; y += 4) {
        mullion += stripCol(mx, y);
        mullionRef += stripCol(mx - 16, y) + stripCol(mx + 16, y);
      }
      return {
        transom: stripRow(ty, win.x + Math.round(win.w * 0.25)),
        transomAbove: stripRow(ty - 16, win.x + Math.round(win.w * 0.25)),
        transomBelow: stripRow(ty + 16, win.x + Math.round(win.w * 0.25)),
        mullion: mullion / ((y1 - y0) / 4 + 1),
        mullionRef: mullionRef / (((y1 - y0) / 4 + 1) * 2),
      };
    },
    [win] as const
  );
  expect(
    Math.abs(r.transom - r.transomAbove),
    `旧横棂位与上方 16px 均值差 ${Math.abs(r.transom - r.transomAbove)} → 棂没拆干净`
  ).toBeLessThanOrEqual(8);
  expect(
    Math.abs(r.transom - r.transomBelow),
    `旧横棂位与下方 16px 均值差 ${Math.abs(r.transom - r.transomBelow)} → 棂没拆干净`
  ).toBeLessThanOrEqual(8);
  expect(
    Math.abs(r.mullion - r.mullionRef),
    `旧竖棂位与两侧均值差 ${Math.abs(r.mullion - r.mullionRef)} → 棂没拆干净`
  ).toBeLessThanOrEqual(8);
});

test('场景加密度：岸树/小岛/渔舟真的画在画布上（2026-09-23「景色太简单」）', async ({ page }) => {
  // 固定到正午晴日：岸树/岛/船是近山色压暗，夜里近山与天空只差 2–4/通道，
  // 色值匹配会撞容差；正午才有干净判据。
  await page.addInitScript(() => {
    try { localStorage.removeItem('8bitme:weather'); } catch {}
    const Real = Date;
    const t = new Real(2026, 8, 21, 12, 0, 0).getTime();
    const Fake = class extends Real {
      constructor(...a: never[]) {
        if (a.length === 0) super(t);
        else super(...(a as []));
      }
      static now() {
        return t;
      }
    };
    window.Date = Fake as unknown as DateConstructor;
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockWeather(page, 0, 1, '2026-09-21'); // 显式晴天：dim=1，船/树/岛色值不被天气压暗；
  // 日期必须与上面的假时钟同日（默认“今天”会随真实日期翻页，而假时钟钉死 09-21——曾因此跨午夜后整条用例假红）
  await page.goto('/', { waitUntil: 'load' });
  // 等点亮仪式走完（bootP = 1 后 alt 才是正午，夜帧近山与判据色差 2–4/通道会假红）
  await page.waitForFunction(
    () => Number((window as unknown as { __bgfxDebug?: { bootP?: number } }).__bgfxDebug?.bootP) >= 1,
    undefined,
    { timeout: 15000 }
  );
  await page.waitForTimeout(400);
  const size = await canvasSize(page);
  const win = windowSpec(size.w, size.h);
  const sc = genScenery(win.w, win.h);
  const sky = sampleSky(0.55); // 正午帧（与 Fake Date 对齐）
  const r = await page.evaluate(
    ([sc, sky, wx, wy, ww, wh]) => {
      const c = document.getElementById('bgfx-canvas') as HTMLCanvasElement;
      const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      const hex = (h: string): [number, number, number] => [
        parseInt(h.slice(1, 3), 16),
        parseInt(h.slice(3, 5), 16),
        parseInt(h.slice(5, 7), 16),
      ];
      const lerpHex = (
        a: [number, number, number],
        b: [number, number, number],
        k: number
      ): [number, number, number] => [
        Math.round(a[0] + (b[0] - a[0]) * k),
        Math.round(a[1] + (b[1] - a[1]) * k),
        Math.round(a[2] + (b[2] - a[2]) * k),
      ];
      const nearRgb = hex(sky.ridgeNear);
      const black = hex('#000000');
      const treeCol = lerpHex(nearRgb, black, 0.32);
      const isleCol = lerpHex(nearRgb, black, 0.18);
      const hullCol = lerpHex(nearRgb, black, 0.42);
      const match = (x: number, y: number, rgb: [number, number, number], tol = 6) => {
        const i = (y * c.width + x) * 4;
        return (
          Math.abs(d[i]! - rgb[0]) <= tol &&
          Math.abs(d[i + 1]! - rgb[1]) <= tol &&
          Math.abs(d[i + 2]! - rgb[2]) <= tol
        );
      };
      const countIn = (
        rgb: [number, number, number],
        x0: number,
        x1: number,
        y0: number,
        y1: number
      ) => {
        let n = 0;
        for (let y = Math.max(0, y0); y < Math.min(c.height, y1); y++)
          for (let x = Math.max(0, x0); x < Math.min(c.width, x1); x++) if (match(x, y, rgb)) n++;
        return n;
      };
      const hy = sc.horizonY;
      // 世界在窗洞里：所有几何都加洞偏移 (wx, wy)（与 BgFx 的 translate 一致）
      // ① 岸树：逐丛在树冠邻域数树冠色像素（不画树 = 0）
      let treePx = 0;
      for (const tr of sc.trees) {
        if (tr.isle) continue;
        const topY = tr.baseY + Math.min(...tr.blocks.map((b) => b[1]));
        treePx += countIn(
          treeCol,
          wx + tr.x - 12,
          wx + tr.x + 12,
          wy + topY - 2,
          wy + hy - tr.trunk + 2
        );
      }
      // ② 小岛：滩涂色像素（岛体矩形邻域，不画岛 = 0）
      const islePx = countIn(
        isleCol,
        wx + sc.isle.x - Math.floor(sc.isle.w / 2) - 2,
        wx + sc.isle.x + Math.ceil(sc.isle.w / 2) + 2,
        wy + hy - sc.isle.h - 2,
        wy + hy + 2
      );
      // ③ 渔舟：船道带（地平线下 30–55% 水高）找船体色的水平密集暗块；
      // 船在游移所以全带扫，但色值与绘制层同源（lerpHex 同参）；扫窗限在洞内
      const y0 = wy + hy + Math.round((wh - hy) * 0.3);
      const y1 = wy + hy + Math.round((wh - hy) * 0.55);
      let hullPx = 0;
      for (let y = y0; y < y1; y++)
        for (let x = wx + 24; x < wx + ww - 24; x++) if (match(x, y, hullCol, 8)) hullPx++;
      return { treePx, islePx, hullPx };
    },
    [sc, sky, win.x, win.y, win.w, win.h] as const
  );
  expect(r.treePx, `岸树树冠色像素只有 ${r.treePx}（岸树没画）`).toBeGreaterThan(30);
  expect(r.islePx, `小岛滩涂色像素只有 ${r.islePx}（岛没画）`).toBeGreaterThan(20);
  expect(r.hullPx, `船道带内没有船体色像素（渔舟没画）`).toBeGreaterThan(12);
});

test('场景加密度：晴日飞鸟小队真的出现并移动（阴雨不出）', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/', { waitUntil: 'load' });
  // 首群在 frame ≥ 300 出现（BIRD.FIRST_AT）：轮询至多 18s，等到队伍在屏内
  let saw = 0;
  for (let k = 0; k < 36; k++) {
    await page.waitForTimeout(500);
    const d = await debugState(page);
    saw = Number(d.flock ?? 0);
    if (saw > 0) break;
  }
  expect(saw, '晴日 18s 内没有出现飞鸟小队').toBeGreaterThan(0);
  // 移动性：队头 x 随时间增长（鸟不是贴在原地扇翅）
  const d1 = await debugState(page);
  await page.waitForTimeout(800);
  const d2 = await debugState(page);
  expect(Number(d2.flockX), '鸟群位置完全没动').toBeGreaterThan(Number(d1.flockX));
});

test('场景加密度：倒影随波扭曲（水面镜像带随时间真的在变形）', async ({ page }) => {
  // 采样窗避开活物：x ∈ [0.24w, 0.44w]（避开芦苇 < 0.16w 与日光柱 sparkle ±0.07w）、
  // y ∈ [0.845h, 0.92h]（倒影带深水段，贴岸行与窗台都不到）。晴天 default mock。
  // **必须钉正午**（用与场景契约同一套 Date 覆写）：倒影的不透明度随天色变——
  // 黄昏的暗紫山影叠在粉水上本来就淡，两天采样差会跌到阈值以下 → 按真实钟点的 flake。
  await page.addInitScript(() => {
    const Real = Date;
    const t = new Real(2026, 8, 21, 12, 0, 0).getTime();
    const Fake = class extends Real {
      constructor(...a: never[]) {
        if (a.length === 0) super(t);
        else super(...(a as []));
      }
      static now() {
        return t;
      }
    };
    window.Date = Fake as unknown as DateConstructor;
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/', { waitUntil: 'load' });
  await page.waitForTimeout(2600);
  // 采样窗从几何派生（洞坐标 + 洞偏移）：倒影带从地平线向下 span 行；
  // x 避开芦苇（洞 0.16w 外）与日光柱 sparkle（正午柱 ≈ 洞 0.5w）。
  const size = await canvasSize(page);
  const win = windowSpec(size.w, size.h);
  const sc = genScenery(win.w, win.h);
  const ridgeTop = Math.min(
    ...sc.farRidge.map(([, y]) => y),
    ...sc.nearRidge.map(([, y]) => y)
  );
  const reflSpan = Math.min(2 * (sc.horizonY - ridgeTop), win.h - sc.horizonY - 4);
  const rx0 = win.x + Math.round(win.w * 0.24);
  const rx1 = win.x + Math.round(win.w * 0.44);
  const ry0 = win.y + sc.horizonY + 8;
  const ry1 = win.y + sc.horizonY + Math.max(16, reflSpan - 6);
  const snap = () =>
    page.evaluate(
      ([x0, y0, x1, y1]) => {
        const c = document.getElementById('bgfx-canvas') as HTMLCanvasElement;
        const d = c.getContext('2d')!.getImageData(x0, y0, x1 - x0, y1 - y0).data;
        let sum = 0;
        for (let i = 0; i < d.length; i += 4) sum += d[i]! + d[i + 1]! + d[i + 2]!;
        return sum;
      },
      [rx0, ry0, rx1, ry1] as const
    );
  const a = await snap();
  await page.waitForTimeout(900);
  const b = await snap();
  expect(
    Math.abs(b - a),
    `倒影带两次采样几乎不变（差 ${Math.abs(b - a)}，扭曲失效或被冻住）`
  ).toBeGreaterThan(3000);
});
test('场景加密度：雨天不出飞鸟（阴雨鸟不飞）', async ({ page }) => {
  await mockWeather(page, 61, 1);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/', { waitUntil: 'load' });
  await page.waitForTimeout(9000);
  const d = await debugState(page);
  expect(d.weather).toBe('rain');
  expect(Number(d.flock ?? 0), '雨天出现了飞鸟小队').toBe(0);
});

test('首屏底部不能有暗玻璃硬边：scrim 顶边必须落在 #window 底边（含窄屏 nav 变高）', async ({ page }) => {
  // 2026-09-21 作者问「底部的灰色的框是什么」——就是这条硬边。
  // 成因：nav 是 sticky 占流、章节因此从文档 y=navH 起；而 CSS 里 scrim 写死
  // `top: 100vh`，于是它切在章节底部上方 navH 处。
  // ADR-0027：首屏是整扇窗 #window——scrim 顶边必须 = **窗那一屏的底边**
  //（BgFx 实测写入）。nav 高度随断点变（桌面 57 / 窄屏更高），不能用常数。
  for (const [width, height] of [
    [1440, 900],
    [390, 844],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.goto('/', { waitUntil: 'load' });
    await page.waitForTimeout(1200);
    const r = await page.evaluate(() => {
      const win = document.getElementById('window')!.getBoundingClientRect();
      const scrim = document.querySelector('.bgfx-scrim')!.getBoundingClientRect();
      return {
        winBottom: win.bottom + window.scrollY,
        scrimTop: scrim.top + window.scrollY,
        scrimTopInViewport: scrim.top,
        vh: window.innerHeight,
      };
    });
    expect(r.scrimTop, `${width}x${height}：scrim 顶边不在 #window 底边`).toBeCloseTo(r.winBottom, 0);
    // 首屏内不许出现 scrim（出现即硬边）
    expect(
      r.scrimTopInViewport,
      `${width}x${height}：scrim 顶边落进了首屏（视口 y=${r.scrimTopInViewport}），底部会有暗玻璃硬边`
    ).toBeGreaterThanOrEqual(r.vh - 1);
  }
});

test('天气影响天体可见度：雨天不该有一轮全亮大太阳（云遮日）', async ({ page }) => {
  await mockWeather(page, 61, 1); // 正午的雨
  // 本测试量的是「天空」的亮度分位。UI 恒暗（ADR-0021 单档），窗框恒为深色、
  // 不抢 p99 —— 量到的是纯天空。
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/', { waitUntil: 'load' });
  await page.waitForTimeout(2000);
  const d = await debugState(page);
  expect(d.weather).toBe('rain');
  // 用 99 分位而不是最大值：雨丝是稀疏细线（占屏 ~0.2%），最大值会被它抢走，
  // 而「太阳有没有被遮」是**天空背景**的性质
  const p99 = await page.evaluate(() => {
    const c = document.getElementById('bgfx-canvas') as HTMLCanvasElement;
    const ctx = c.getContext('2d')!;
    const d = ctx.getImageData(0, 0, c.width, Math.round(c.height * 0.5)).data;
    const lums: number[] = [];
    for (let i = 0; i < d.length; i += 4) {
      lums.push(0.2126 * d[i]! + 0.7152 * d[i + 1]! + 0.0722 * d[i + 2]!);
    }
    lums.sort((a, b) => a - b);
    return lums[Math.floor(lums.length * 0.99)]!;
  });
  // 阴雨天空不该接近纯白（晴天正午的太阳光晕会把大片天空推到 220+）
  expect(p99, `雨天天空 99 分位亮度 ${p99.toFixed(1)} 过亮（太阳没被云遮）`).toBeLessThan(190);
});

test('月相：月亮真的缺一块（盘上受光侧与 moonPhase 纯函数同源，非永远满盘）', async ({ page }) => {
  // 钉假时钟（取 2026-09-21 正午：moonPhase 纯函数算出该刻相位，断言从它派生——
  // 判据与被守者同源，不写死「今天月亮长什么样」）。
  const FAKE_MS = new Date(2026, 8, 21, 23, 30, 0).getTime();
  await page.addInitScript(() => {
    const Real = Date;
    const t = new Real(2026, 8, 21, 23, 30, 0).getTime();
    const Fake = class extends Real {
      constructor(...a: never[]) {
        if (a.length === 0) super(t);
        else super(...(a as []));
      }
      static now() {
        return t;
      }
    };
    window.Date = Fake as unknown as DateConstructor;
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  // **必须把 mock 的晨昏锚点也钉到同一天**（2026-09-25 修）：本文件的 beforeEach 用
  // mockWeather(page) 默认给「今天」的日出日落，而本用例的假时钟钉在 2026-09-21 ——
  // 两者不同日时 sunAlt 与月亮弧位不再同源，判据恒红（日期腐化：用例写于 09-21，
  // 真实日期一过就失效；改前红/改后绿已在 HEAD 与本次改动后双版本复验）。
  await mockWeather(page, 0, 0, '2026-09-21');
  await page.goto('/', { waitUntil: 'load' });
  // 深夜才有月亮：假时钟已钉在 23:30（夜），等窗外世界进稳态
  await page.waitForTimeout(2200);
  const dbg = await debugState(page);
  expect(Number(dbg.starlight), '夜里才量月亮').toBeGreaterThan(0.5);
  const ph = moonPhase(FAKE_MS);
  const lit = moonLitRow(0, 11, ph)!;
  // 月盘色要过一层**玻璃冷罩**（T5 起洞内整幅叠 glassTint@0.04）——扫描色必须同源
  // 地算上这层，否则会扫不到月盘（实测裸 moon 色偏移 ~9/通道，超出 ±4 容差）。
  const skyNow = sampleSky(Number(dbg.alt));
  const moonCol = lerpHex(skyNow.moon, glassTint(skyNow.bands[0]).color, glassTint(skyNow.bands[0]).alpha);
  // 找月亮：全画布扫 moon 色，取其 bounding box，再分左右两半数像素
  // 月亮的画布 x 由 bodyPos 同一映射给出（源码 0.12w + arcX·0.76w）；
  // arcX 来自 skyMoment（同一套纯函数）——判据与被守者完全同源
  const anchors = {
    sunriseMs: new Date('2026-09-21T06:12').getTime(),
    sunsetMs: new Date('2026-09-21T18:28').getTime(),
  };
  const m = skyMoment(FAKE_MS, anchors);
  const size = await canvasSize(page);
  const win = windowSpec(size.w, size.h);
  const sc2 = genScenery(win.w, win.h);
  // 月亮画在窗洞里：bodyPos 的映射是**洞内**量，屏幕坐标要加洞偏移（与 BgFx translate 一致）
  const moonCx = win.x + Math.round(win.w * 0.12 + m.moonX * win.w * 0.76);
  const moonCy = win.y + Math.round(sc2.horizonY - m.moonY * (sc2.horizonY - win.h * 0.14));
  // 受光 bbox（像素级）：扫描天空带内 moon 色的连续段，取月盘行（段长 ≥ 4，滤掉光晕点/星点）
  const rows = await page.evaluate(
    ([hex, yTop, yBottom, xLo, xHi]) => {
      const c = document.getElementById('bgfx-canvas') as HTMLCanvasElement;
      const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      const R = parseInt(hex.slice(1, 3), 16), G = parseInt(hex.slice(3, 5), 16), B = parseInt(hex.slice(5, 7), 16);
      const out: Array<[number, number]> = []; // [x0, x1] 全部月盘段的并集范围逐段记录
      for (let y = yTop; y < yBottom; y++) {
        let runStart = -1;
        for (let x = xLo; x <= xHi; x++) {
          let hit = false;
          if (x < xHi) {
            const i = (y * c.width + x) * 4;
            hit =
              Math.abs(d[i]! - R) <= 4 && Math.abs(d[i + 1]! - G) <= 4 && Math.abs(d[i + 2]! - B) <= 4;
          }
          if (hit && runStart < 0) runStart = x;
          if (!hit && runStart >= 0) {
            if (x - runStart >= 4) out.push([runStart, x]); // 滤掉星点/光晕点（≤3px）
            runStart = -1;
          }
        }
      }
      return out;
    },
    [moonCol, Math.max(0, moonCy - 20), moonCy + 12, win.x, win.x + win.w] as const
  );
  expect(rows.length, '月亮受光区应有多段实心行').toBeGreaterThan(5);
  // 受光 bbox 必须落在纯函数给的 [moonCx + ex0, moonCx + ex1] 窗内（含方向 + 宽度）
  const bx0 = Math.min(...rows.map(([a]) => a));
  const bx1 = Math.max(...rows.map(([, b]) => b));
  const expLeft = moonCx + lit[0];
  const expRight = moonCx + lit[1];
  expect(
    Math.abs(bx0 - expLeft),
    `受光左缘 ${bx0} 应 ≈ moonCx + moonLitRow 左端 ${expLeft}（盈亏方向 + 宽度）`
  ).toBeLessThanOrEqual(2);
  expect(
    Math.abs(bx1 - expRight),
    `受光右缘 ${bx1} 应 ≈ moonCx + moonLitRow 右端 ${expRight}`
  ).toBeLessThanOrEqual(2);
  // **不是满盘**（阴晴圆缺本体判据）：受光宽 < 盘宽 23，除非相位真是满月
  expect(bx1 - bx0, '受光宽应等于 moonLitRow 的行宽（不满盘）').toBe(lit[1] - lit[0]);
});

test('下雪：山脊积雪（雪天最强的视觉信号，不是「蓝天 + 白点」）', async ({ page }) => {
  await mockWeather(page, 71, 0);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/', { waitUntil: 'load' });
  await page.waitForTimeout(2000);
  const d = await debugState(page);
  expect(d.weather).toBe('snow');
  const size = await canvasSize(page);
  const win = windowSpec(size.w, size.h);
  const sc = genScenery(win.w, win.h);
  const ridgeTop = win.y + Math.min(...sc.farRidge.map(([, y]) => y)) - 4;
  const ridgeBottom = win.y + sc.horizonY - 4;
  const r = await page.evaluate(
    ([ridgeTop, ridgeBottom, wx, wxEnd]) => {
      const c = document.getElementById('bgfx-canvas') as HTMLCanvasElement;
      const ctx = c.getContext('2d')!;
      const img = ctx.getImageData(0, 0, c.width, c.height).data;
      const lum = (x: number, y: number) => {
        const i = (y * c.width + x) * 4;
        return 0.2126 * img[i]! + 0.7152 * img[i + 1]! + 0.0722 * img[i + 2]!;
      };
      // 山脊区（由 geometry 派生）里「明显亮于邻域」的像素 = 积雪。
      // 只扫窗洞内：墙面色不带雪，扫进去会稀释占比。
      let snowPx = 0;
      let total = 0;
      for (let y = ridgeTop; y < ridgeBottom; y += 2) {
        for (let x = wx; x < wxEnd; x += 2) {
          total++;
          const l = lum(x, y);
          const around = (lum(x, Math.max(0, y - 10)) + lum(x, y + 10)) / 2;
          if (l > around + 18) snowPx++;
        }
      }
      return { ratio: snowPx / total };
    },
    [ridgeTop, ridgeBottom, win.x, win.x + win.w] as const
  );
  expect(r.ratio, `山脊积雪像素占比 ${(r.ratio * 100).toFixed(2)}% 过低（雪天看起来会像晴天）`).toBeGreaterThan(0.01);
});

/** 数画布上「与给定色值各通道差 ≤ tol」的像素数（canvas 无插值，同源色值能精确匹配） */
async function countCanvasColor(page: Page, hex: string, tol = 4) {
  return page.evaluate(([h, tol]) => {
    const c = document.getElementById('bgfx-canvas') as HTMLCanvasElement;
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    const R = parseInt(h.slice(1, 3), 16);
    const G = parseInt(h.slice(3, 5), 16);
    const B = parseInt(h.slice(5, 7), 16);
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (Math.abs(d[i]! - R) <= tol && Math.abs(d[i + 1]! - G) <= tol && Math.abs(d[i + 2]! - B) <= tol) n++;
    }
    return n;
  }, [hex, tol] as const);
}

test('雷暴：闪电真的劈下来（像素折线画在闪白之上，不是只把屏幕刷白）', async ({ page }) => {
  // 手动触发而不是等 9–16s 的随机调度——但走的必须是**同一条路径**
  // （`flash` 钩子 = flashT 置 9 + genBolt，与 stepWorld 里的调度同源）。
  // 钉深夜跑（2026-10-05 实抓）：旧版用真实时钟，黄昏窄窗（~18:30–19:00）的
  // 天色色带抖动本底能撞进 #f2f6ff±4 容差几百像素，闪白渐变一洗反而净增为负
  // ——「光交换/天象类判据必须钉时刻」是本文件 115 行自己立的规矩。
  await openWorldAt(page, 23, 30, 95, 0); // code 95 = thunder：rain 1、wind 0.85、thunder true
  await page.waitForFunction(
    () => Number((window as unknown as { __bgfxDebug?: { bootP?: number } }).__bgfxDebug?.bootP) >= 1,
    undefined,
    { timeout: 15000 }
  );
  // 雷暴下首闪 ~1.5s 就到、后续 9–16s 一次：取样前必须**先等一个「无折线」的安静帧**，
  // 否则会在自然闪的窗口里撞上「触发前不该有折线」而假红（2026-09-25 实抓：bolt=40）。
  await expect
    .poll(async () => Number((await debugState(page)).bolt), { timeout: 15000 })
    .toBe(0);
  const d0 = await debugState(page);
  expect(d0.weather).toBe('thunder');
  expect(Number(d0.bolt), '触发前不该有折线').toBe(0);
  // 前测：画面里本来有多少 #f2f6ff（若本来就有，下面的判据会假绿）
  const before = await countCanvasColor(page, '#f2f6ff');
  // **在页面内**逐帧采样（不在 node 侧轮询）：flashT 只亮 9 帧（≈150ms），
  // node↔page 往返会把整个窗口跑完，采样一定落空（第一版就是这么假红的）
  const r = await page.evaluate(
    () =>
      new Promise<{ bolts: number[]; px: number }>((resolve) => {
        const dbg = () => (window as unknown as { __bgfxDebug: Record<string, unknown> }).__bgfxDebug;
        (dbg().flash as () => void)();
        const bolts: number[] = [];
        let px = -1;
        const step = () => {
          const b = Number(dbg().bolt);
          bolts.push(b);
          if (b > 0 && px < 0) {
            // dbg.bolt > 0 = 上一帧真的把折线画上去了 → 这一帧的 canvas 就是带折线的那帧
            const c = document.getElementById('bgfx-canvas') as HTMLCanvasElement;
            const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
            let n = 0;
            for (let i = 0; i < d.length; i += 4) {
              if (
                Math.abs(d[i]! - 0xf2) <= 4 &&
                Math.abs(d[i + 1]! - 0xf6) <= 4 &&
                Math.abs(d[i + 2]! - 0xff) <= 4
              )
                n++;
            }
            px = n;
          }
          if (bolts.length < 24) requestAnimationFrame(step);
          else resolve({ bolts, px });
        };
        requestAnimationFrame(step);
      })
  );
  expect(Math.max(...r.bolts), `flash() 之后 24 帧内 dbg.bolt 一直是 0（折线没生成）`).toBeGreaterThan(0);
  // 折线真的画在画布上：核心色 #f2f6ff 的像素数**显著多于**触发前的本底
  expect(r.px, `#f2f6ff 像素 ${r.px}（触发前本底 ${before}）——闪电没画出来`).toBeGreaterThanOrEqual(
    before + 10
  );
  expect(r.px, '闪电核心像素太少（只有闪白没有折线）').toBeGreaterThanOrEqual(10);
  // 闪白归零后折线一起收走（不留残影）
  await page.waitForTimeout(400);
  const after = await debugState(page);
  expect(Number(after.bolt), '闪白结束折线没收走（会留一道常驻白线）').toBe(0);
});

test('玻璃上的雨：滑痕随雨强增密、暴雨才有水股与窗台积水，且全落在窗洞内', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  // 钉正午：夜暖晕只在夜里（daylight<0.22）染玻璃底缘，会破坏
  // 「晴日窗台 5px 受光带是纯色」的行间均匀判据（2026-10-02 实测 -1.20）。
  await page.addInitScript(() => {
    const Real = Date;
    const t = new Real(2026, 8, 21, 12, 0, 0).getTime();
    const Fake = class extends Real {
      constructor(...a: never[]) {
        if (a.length === 0) super(t);
        else super(...(a as []));
      }
      static now() {
        return t;
      }
    };
    window.Date = Fake as unknown as DateConstructor;
  });
  /**
   * 窗台像素探针：量「水层行」与「紧邻的无水行」的蓝偏（B−R 均值）。
   * 窗台顶面的 5px 受光带是**纯色填充**（无水时两行逐像素相同，差值恒 0）；
   * 积水（#a8cde2 @α0.4）会把这行的蓝偏抬上去——判据与被守的绘制同源，
   * 而不是只读 dbg 里那个由纯函数算出来的 sillWater 数字（那只证明「算了」，
   * 不证明「画了」）。
   */
  const sillProbe = async (win: ReturnType<typeof windowSpec>) =>
    page.evaluate(
      ([wy, wd, x0, x1]) => {
        const c = document.getElementById('bgfx-canvas') as HTMLCanvasElement;
        const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
        // 只扫**窗体宽**（真窗化后窗台只占窗体宽，积水不漫到墙上）——
        // 扫全宽会把墙面色算进去、稀释蓝偏差
        const blueDom = (y: number) => {
          let s = 0;
          let n = 0;
          for (let x = Math.round(x0); x < Math.round(x1); x++) {
            const i = (y * c.width + x) * 4;
            s += d[i + 2]! - d[i]!; // B − R：积水偏蓝
            n++;
          }
          return s / n;
        };
        return { water: blueDom(wy), dry: blueDom(wd) };
      },
      [
        win.y + win.h + 1,
        win.y + win.h + 4,
        win.x - win.frame,
        win.x + win.w + win.frame,
      ] as const
    );
  const load = async (code: number) => {
    // 清 30min 缓存，否则 readCache 命中上一场天气，mock 根本不会被请求
    await page.evaluate(() => {
      try {
        localStorage.removeItem('8bitme:weather');
      } catch {
        /* about:blank 首次导航前 */
      }
    });
    await page.unroute('**/api.open-meteo.com/**');
    await mockWeather(page, code, 1);
    await page.goto('/', { waitUntil: 'load' });
    await page.waitForTimeout(1200); // 等天气到达 + seedPrecip
    return debugState(page);
  };
  // ① clear（默认 mock）：玻璃是干的
  const clearD = await load(0);
  expect(clearD.weather).toBe('clear');
  expect(Number(clearD.glassStreaks), '晴天玻璃上不该有雨痕').toBe(0);
  expect(Number(clearD.glassStreams)).toBe(0);
  expect(Number(clearD.sillWater)).toBe(0);
  const size = await canvasSize(page);
  const win = windowSpec(size.w, size.h);
  const clearSill = await sillProbe(win);
  // 对照：无水时两行都是同一块纯色受光带 → 蓝偏差为 0
  expect(
    Math.abs(clearSill.water - clearSill.dry),
    `晴天窗台行间蓝偏差 ${(clearSill.water - clearSill.dry).toFixed(2)}（本该是同一块纯色）`
  ).toBeLessThan(0.5);
  // ② drizzle（51）：细滑痕已经有，但比中雨少
  const drizzle = await load(51);
  expect(drizzle.weather).toBe('drizzle');
  const nDrizzle = Number(drizzle.glassStreaks);
  expect(nDrizzle, '毛毛雨玻璃上一滴都没有（雨只穿过了画面）').toBeGreaterThan(0);
  // ③ rain（61）：滑痕更多；中雨不该有水股/窗台积水
  const rain = await load(61);
  expect(rain.weather).toBe('rain');
  const nRain = Number(rain.glassStreaks);
  expect(nRain, `毛毛雨 ${nDrizzle} 条 ≥ 中雨 ${nRain} 条 → 滑痕不随雨强变`).toBeGreaterThan(nDrizzle);
  expect(Number(rain.glassStreams), '中雨就沿窗流水？').toBe(0);
  expect(Number(rain.sillWater), '中雨就积了一窗台水？').toBe(0);
  // ④ 几何：滑痕 x 必须落在窗洞内（从源码 windowSpec 派生，不写死比例）
  const bounds = rain.glassBounds as [number, number];
  expect(bounds[0], '玻璃雨没有 x 范围（一条都没画）').toBeGreaterThanOrEqual(0);
  expect(bounds[0], `滑痕 x=${bounds[0]} 落在窗洞（左缘 ${win.x}）之外`).toBeGreaterThanOrEqual(win.x - 2);
  expect(bounds[1], `滑痕 x=${bounds[1]} 落在窗洞（右缘 ${win.x + win.w}）之外`).toBeLessThanOrEqual(
    win.x + win.w + 2
  );
  // ⑤ thunder（95）：暴雨——沿窗水股 + 窗台积水都登场，且积水真的画在画布上
  const storm = await load(95);
  expect(storm.weather).toBe('thunder');
  expect(Number(storm.glassStreams), '暴雨没有沿窗流的水股').toBeGreaterThan(0);
  expect(Number(storm.sillWater), '暴雨窗台没有积水').toBeGreaterThan(0);
  expect(Number(storm.sillWater)).toBeLessThanOrEqual(3);
  expect(Number(storm.glassStreaks)).toBeGreaterThanOrEqual(nRain);
  const stormSill = await sillProbe(win);
  expect(
    stormSill.water - stormSill.dry,
    `暴雨的窗台积水行蓝偏只比无水行高 ${(stormSill.water - stormSill.dry).toFixed(2)}（积水没画出来）`
  ).toBeGreaterThan(6);
});

test('风大窗户颤：thunder 一个颤动周期内出现非零位移，clear 恒 0（整数、1–2px）', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  /**
   * 页内 rAF 逐帧锁存 dbg.shake，采 `frames` 帧（默认 300 > 210 帧颤动周期）。
   * 不能在 node 侧 100ms 轮询：颤动窗只 12 帧（≈200ms），整套 e2e 满负荷跑时
   * node↔page 往返会被拖慢，整个窗口被跳过 → 假红（2026-09-25 实抓；
   * 与雷闪用例同一条教训：窗口短的量必须页内逐帧采）。
   */
  const sampleShakes = async (frames = 300) =>
    page.evaluate(
      (n) =>
        new Promise<number[]>((res) => {
          const out: number[] = [];
          const tick = () => {
            const d = (window as unknown as { __bgfxDebug?: { shake?: number } }).__bgfxDebug;
            out.push(Number(d?.shake ?? 0));
            if (out.length >= n) res(out);
            else requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }),
      frames
    );
  // ① 晴（默认 mock）：wind 0.12 < 0.5 → 窗纹丝不动
  await page.goto('/', { waitUntil: 'load' });
  await page.waitForTimeout(1200);
  expect((await debugState(page)).weather).toBe('clear');
  const calm = await sampleShakes();
  expect(Math.max(...calm.map(Math.abs)), `晴天窗户在晃（采样 ${calm.length} 帧）`).toBe(0);
  // ② thunder：wind 0.85 → 每 3.5s 一阵短颤，采样必然碰到
  await page.evaluate(() => {
    try {
      localStorage.removeItem('8bitme:weather');
    } catch {
      /* ignore */
    }
  });
  await page.unroute('**/api.open-meteo.com/**');
  await mockWeather(page, 95, 1);
  await page.goto('/', { waitUntil: 'load' });
  await page.waitForTimeout(1200);
  expect((await debugState(page)).weather).toBe('thunder');
  const windy = await sampleShakes();
  const hit = windy.filter((v) => v !== 0);
  expect(hit.length, `暴雨里采样 ${windy.length} 帧，窗一次都没颤`).toBeGreaterThan(0);
  for (const v of windy) {
    expect(Number.isInteger(v), `窗颤位移 ${v} 不是整数（像素语言不收半像素）`).toBe(true);
    expect(Math.abs(v), `窗颤位移 ${v} 超出 ±2`).toBeLessThanOrEqual(2);
  }
});

// ==================== T5：光交换与玻璃物性（真窗化第三步） ====================
// 判据与被守者同源：几何一律从 windowSpec 派生，色值/alpha 一律从 window-light
// 的纯函数取；每个「夜里才画」的层都配一个白昼对照（防「永远画着」假绿）。

test('月光透窗：夜里窗台台面落一段月亮带（几何/色值同源），白昼同一对取样点无差', async ({ page }) => {
  await openWorldAt(page, 23, 30);
  const size = await canvasSize(page);
  const win = windowSpec(size.w, size.h);
  const dbg = await debugState(page);
  // 月亮的洞内 x 映射 = bodyPos（源码同一套：0.12w + arcX·0.76w）→ 加洞偏移得屏幕 x
  const m = skyMoment(T5_NIGHT_MS, T5_ANCHORS);
  const moonScreenX = win.x + Math.round(win.w * 0.12 + m.moonX * win.w * 0.76);
  const spill = moonSpill(win, moonScreenX, Number(dbg.starlight));
  expect(spill, '夜里月亮在弧上，moonSpill 不该为 null').not.toBeNull();
  const inX = Math.round((spill!.x0 + spill!.x1) / 2);
  // 带外点必须仍在**窗体宽**内（窗台只占窗体宽）：优先带左 20px，放不下就取带右 20px
  const outX = spill!.x0 - 20 >= win.x - win.frame + 2 ? spill!.x0 - 20 : spill!.x1 + 20;
  const y = win.y + win.h + 2; // 窗台台面行（台面 = win.y+win.h .. +4）
  const nightIn = await pixelAt(page, inX, y);
  const nightOut = await pixelAt(page, outX, y);
  for (let k = 0; k < 3; k++) {
    const d = Math.abs(nightIn[k]! - nightOut[k]!);
    expect(d, `月光带内/外第 ${k} 通道差 ${d} ≤ 8 → 亮带没画`).toBeGreaterThan(8);
  }
  // 白昼对照：同一对取样点必须无差（月亮带不是常驻）
  const day = await page.context().newPage();
  await openWorldAt(day, 12, 0, 0, 1);
  expect((await debugState(day)).moonSpill, '白天 moonSpill 该是 null').toBeNull();
  const dayIn = await pixelAt(day, inX, y);
  const dayOut = await pixelAt(day, outX, y);
  for (let k = 0; k < 3; k++) {
    const d = Math.abs(dayIn[k]! - dayOut[k]!);
    expect(d, `白昼窗台同一对点仍有 ${d} 差 → 亮带常驻了`).toBeLessThanOrEqual(1);
  }
  await day.close();
});

test('室内反光斑：夜里玻璃上有幽灵暖光斑（像素差分），白昼同一区域无差', async ({ page }) => {
  await openWorldAt(page, 23, 30);
  const size = await canvasSize(page);
  const win = windowSpec(size.w, size.h);
  const dbg = await debugState(page);
  const refl = dbg.reflection as { x: number; y: number; w: number; h: number; alpha: number } | null;
  expect(refl, '夜里玻璃上该有室内反光斑').not.toBeNull();
  // 锚位在玻璃下三分位（2026-10-06 评审：与夜暖晕同构「屋里的暖从底下上来」，
  // 不再悬在天空正中）——旧 0.42h 锚位在此必红
  expect(
    refl!.y,
    `反光斑 y=${refl!.y} 不在玻璃下三分位（应 ≥ ${win.y + Math.round(win.h * 0.55)}）`
  ).toBeGreaterThanOrEqual(win.y + Math.round(win.h * 0.55));
  // 主判据落像素：斑内 vs 同尺寸紧邻偏移区（位置由纯函数出，dbg 只提供几何）。
  // 2026-10-05 起反光斑 = 三层软边（外圈向外扩 6px）——对照区偏移 +10 才真正出晕外。
  const a = await rectMeanLum(page, refl!.x, refl!.y, refl!.w, refl!.h);
  const b = await rectMeanLum(page, refl!.x + refl!.w + 10, refl!.y, refl!.w, refl!.h);
  expect(a - b, `反光斑内/外亮度差 ${(a - b).toFixed(2)} ≤ 6 → 反光斑没画`).toBeGreaterThan(6);
  // 白昼对照：斑不存在；同一锚点区域（从 windowSpec 派生，覆盖斑的漂移范围 + 全部软边圈）内外无差
  const day = await page.context().newPage();
  await openWorldAt(day, 12, 0, 0, 1);
  expect((await debugState(day)).reflection, '白天不该有反光斑').toBeNull();
  const ax = win.x + Math.round(win.w * 0.5) - 24;
  const ay = win.y + Math.round(win.h * 0.64) - 20;
  const da = await rectMeanLum(day, ax, ay, 48, 44);
  const db2 = await rectMeanLum(day, ax + 53, ay, 48, 44);
  expect(
    Math.abs(da - db2),
    `白昼同一区域仍有 ${Math.abs(da - db2).toFixed(2)} 差 → 反光斑常驻了`
  ).toBeLessThanOrEqual(1);
  await day.close();
});

test('寒夜结露：玻璃上/左内缘 1px 亮霜线（夜里亮、白昼无），下缘无霜', async ({ page }) => {
  await openWorldAt(page, 23, 30);
  const size = await canvasSize(page);
  const win = windowSpec(size.w, size.h);
  const depth = win.revealSteps.reduce((a, b) => a + b, 0);
  const gx0 = win.x + depth + 1; // 玻璃可见区左上（depth 处是 lip）
  const gx1 = win.x + win.w - depth - 2;
  const topY = win.y + depth + 1;
  const colY1 = win.y + Math.round(win.h * 0.52) - 6; // 纵向扫到旧棂位之上（避开下方水面反光干扰）
  // 左缘竖线：霜列 (gx0) vs 紧邻无霜列 (gx0+1)——同属内阴影第一档（α0.3），只差霜
  const nL = await colMeanLum(page, gx0, topY, colY1);
  const nLc = await colMeanLum(page, gx0 + 1, topY, colY1);
  expect(nL - nLc, `左缘霜线内外亮度差 ${(nL - nLc).toFixed(2)} ≤ 20 → 霜线没画`).toBeGreaterThan(20);
  // 上缘横线：霜行 (topY) vs 紧邻下一行 (topY+1)——两行同属内阴影第一档
  const nT = await rowMeanLum(page, topY, gx0, gx1);
  const nTc = await rowMeanLum(page, topY + 1, gx0, gx1);
  expect(nT - nTc, `上缘霜线内外亮度差 ${(nT - nTc).toFixed(2)} ≤ 20 → 霜线没画`).toBeGreaterThan(20);
  // 下缘无霜（有窗台）：底行不得比紧邻上行亮出一根霜线。2026-10-06 夜暖晕提暖后
  // 底行被暖带整层均匀提亮（两行同受，差值≈0），旧「底行远暗于上缘霜行」判据
  // 分不清「暖带」和「霜」；霜若真画到下缘，只会亮底行这一行。
  const bottom = await rowMeanLum(page, win.y + win.h - 1, gx0, gx1);
  const aboveBottom = await rowMeanLum(page, win.y + win.h - 3, gx0, gx1);
  expect(
    bottom,
    `底行 ${bottom.toFixed(2)} 比紧邻上行 ${aboveBottom.toFixed(2)} 亮 ≥5 → 下缘也画了霜`
  ).toBeLessThanOrEqual(aboveBottom + 5);
  // 白昼对照
  const day = await page.context().newPage();
  await openWorldAt(day, 12, 0, 0, 1);
  expect((await debugState(day)).frost, '白天不该结露').toBeNull();
  const dL = await colMeanLum(day, gx0, topY, colY1);
  const dLc = await colMeanLum(day, gx0 + 1, topY, colY1);
  expect(Math.abs(dL - dLc), `白昼左缘仍有 ${Math.abs(dL - dLc).toFixed(2)} 差 → 霜线常驻了`).toBeLessThanOrEqual(2);
  const dT = await rowMeanLum(day, topY, gx0, gx1);
  const dTc = await rowMeanLum(day, topY + 1, gx0, gx1);
  // 白昼上缘两行只差天空拜耳抖动（实测 ~5），远小于霜的 55 —— 阈值 20 仍能拦住常驻
  expect(Math.abs(dT - dTc), `白昼上缘仍有 ${Math.abs(dT - dTc).toFixed(2)} 差 → 霜线常驻了`).toBeLessThan(20);
  await day.close();
});

test('玻璃冷罩：洞内纯色带行 = lerpHex(源码带色, tint 色, 0.04)，alpha 契约 0.04', async ({ page }) => {
  await openWorldAt(page, 12, 0, 0, 1);
  const size = await canvasSize(page);
  const win = windowSpec(size.w, size.h);
  const dbg = await debugState(page);
  const sky = sampleSky(Number(dbg.alt));
  const sc = genScenery(win.w, win.h);
  // band 2 中心行 = 纯带色（无抖动混色）；x 取洞左 20%（避开洞深/内阴影/梃/高光带）
  const band = 2;
  const bb = bandBounds(band, sc.horizonY);
  const row = Math.round((bb.top + bb.bottom) / 2);
  const x0 = win.x + Math.round(win.w * 0.2);
  const med = await medianRowRgb(page, win.y + row, x0, x0 + 60);
  const tint = glassTint(sky.bands[0]);
  expect(tint.alpha, '冷罩 alpha 契约').toBe(0.04);
  const bandRgb = hexToRgb(sky.bands[band]!);
  const tintRgb = hexToRgb(tint.color);
  const expected = [0, 1, 2].map(
    (k) => bandRgb[k]! * (1 - tint.alpha) + tintRgb[k]! * tint.alpha
  );
  // ① 模型对得上：逐通道差 ≤ 3
  for (let k = 0; k < 3; k++) {
    expect(
      Math.abs(med[k]! - expected[k]!),
      `实测 ${med[k]} vs 源码预期 ${expected[k].toFixed(2)}（通道 ${k}）`
    ).toBeLessThanOrEqual(3);
  }
  // ② **真的罩了**：实测像素必须离「罩过」更近、离「没罩」更远。
  //    只断言 |med − expected| ≤ 3 会被容差吃掉——冷罩单通道只偏 ~2.5，
  //    不画罩时 raw band 也落在容差内（实测反例：把 tint 的 alpha 置 0 仍全绿）。
  const dTinted = [0, 1, 2].reduce((s, k) => s + Math.abs(med[k]! - expected[k]!), 0);
  const dRaw = [0, 1, 2].reduce((s, k) => s + Math.abs(med[k]! - bandRgb[k]!), 0);
  expect(dRaw, `实测离未罩带色 ${dRaw.toFixed(1)} 不比离罩色 ${dTinted.toFixed(1)} 远 → 冷罩没画`).toBeGreaterThan(
    dTinted
  );
  expect(dRaw, `冷罩总偏移 ${dRaw.toFixed(1)} ≤ 1.5 → 等于没罩`).toBeGreaterThan(1.5);
});

test('暴雨起雾：雨强 1 时洞内叠白雾（比同刻晴天更亮），中雨不起雾', async ({ page }) => {
  await openWorldAt(page, 23, 30);
  const size = await canvasSize(page);
  const win = windowSpec(size.w, size.h);
  const depth = win.revealSteps.reduce((a, b) => a + b, 0);
  const sc = genScenery(win.w, win.h);
  // 取天空最上一条带（最暗）：雾（亮带提亮）在这里提得最多，判据最稳
  const bb = bandBounds(0, sc.horizonY);
  const row = win.y + Math.round((bb.top + bb.bottom) / 2);
  const x0 = win.x + depth + 4;
  const x1 = win.x + win.w - depth - 4;
  const clearMean = await rowMeanLum(page, row, x0, x1);
  // 暴雨（thunder：rain=1）
  await page.evaluate(() => {
    try {
      localStorage.removeItem('8bitme:weather');
    } catch {
      /* ignore */
    }
  });
  await page.unroute('**/api.open-meteo.com/**');
  await mockWeather(page, 95, 0, '2026-09-21');
  await page.goto('/', { waitUntil: 'load' });
  await page.waitForTimeout(1400);
  const storm = await debugState(page);
  expect(storm.weather).toBe('thunder');
  expect(Number(storm.mistAlpha), '暴雨雾罩 alpha 必须等于 mistGlass(1)').toBe(mistGlass(1));
  const mistMean = await rowMeanLum(page, row, x0, x1);
  // 判据方向：**比晴天亮**（雾是亮带提亮）。若没画雾，rain 的 dim 只会让画面更暗，
  // 所以「变亮」这条不会被 dim 蹭绿（「变暗」判据才会——那是 dim 干的，与雾无关）。
  expect(
    mistMean - clearMean,
    `暴雨洞内 ${mistMean.toFixed(2)} 不比晴天 ${clearMean.toFixed(2)} 亮 → 雾没画`
  ).toBeGreaterThan(6);
  // 中雨（rain=0.7 < 0.85）不起雾
  await page.evaluate(() => {
    try {
      localStorage.removeItem('8bitme:weather');
    } catch {
      /* ignore */
    }
  });
  await page.unroute('**/api.open-meteo.com/**');
  await mockWeather(page, 61, 0, '2026-09-21');
  await page.goto('/', { waitUntil: 'load' });
  await page.waitForTimeout(1400);
  expect(Number((await debugState(page)).mistAlpha), '中雨不该起雾').toBe(0);
});

test('墙随整扇窗退役：首屏顶部无墙、无墙顶灯带（ADR-0027）', async ({ page }) => {
  // 旧口径（T5）：墙顶室内灯浅阶必须从实测 nav 底之下起画——当时窗是墙上的
  // 凹洞，四边都有墙。ADR-0027 反转成「窗的外缘 = 视口四边、墙厚 0」后，
  // 灯带厚度 = wall.top × 0.4 恒为 0，整条随墙退役（不是被 nav 盖住）。
  // 本用例改守**新结构**：左框列在 nav 上下两侧都是同一种框面色——
  // 色值从源码 sunlitFrame(palette, 实测 daylight).face 派生（接光后框色随昼夜；
  // 不画框时该列会是墙色 wallFace → 必红）。
  // 时钟钉在正午：接光后深夜框面与墙同为暗色（对照量差会掉到阈值边缘），
  // 正午框面晒成暖亮木、墙仍是暗墙——「框 ≠ 墙」的对照最锐利。
  await openWorldAt(page, 12, 0, 0, 1);
  const size = await canvasSize(page);
  const win = windowSpec(size.w, size.h);
  expect(win.wall.top, '整扇窗：上墙厚必须为 0').toBe(0);
  const palette = { bg: DARK.colors.bg, accent: DARK.colors.accent, light: DARK.colors.text };
  const dbg = await debugState(page);
  const face = hexToRgb(sunlitFrame(palette, Number(dbg.daylight)).face);
  const wall = hexToRgb(wallFace(palette));
  const navBottom = await page.evaluate(() =>
    Math.round(document.querySelector('header.nav')?.getBoundingClientRect().bottom ?? 0)
  );
  const x = Math.round(win.frame / 2); // 左框带中点（框 0..frame）
  const ys = [3, Math.max(0, navBottom - 5), navBottom + 5, navBottom + 20];
  const got = await Promise.all(ys.map((y) => pixelAt(page, x, y)));
  const cd = (p: readonly number[], q: readonly number[]) =>
    p.reduce((s, v, i) => s + Math.abs(v - q[i]!), 0);
  for (let i = 0; i < ys.length; i++) {
    expect(
      cd(got[i]!, face),
      `y=${ys[i]} 处不是框面色（实测 ${got[i]}，期望 ${face}）→ 框没画到视口边`
    ).toBeLessThanOrEqual(4);
    expect(
      cd(got[i]!, wall),
      `y=${ys[i]} 处是墙面色 → 墙没退役 / 框没画`
    ).toBeGreaterThan(24);
  }
  // nav 上下同色：没有「nav 之下才亮」的灯带台阶
  expect(got[1], 'nav 上下出现灯带台阶 → 墙顶灯带没随墙退役').toEqual(got[2]);
});

// ==================== 去铁窗（2026-10-02 作者批，二轮 ADR-0028） ====================
// 铁窗感实测根因：棂面全天死灰 [123,127,143]（正午压在亮天空上 = 铁栅、深夜比
// 夜空亮一量级 = 泛灰光铁条）+ 夜里整屏无暖源。一轮 = 框棂接光 + 窗台小灯；
// 二轮拆棂（作者「治标不治本」）+ 夜暖晕；窗台小灯随后拆除（作者「跟没有一样，
// 很多余还抢镜头」）。判据与被守者同源：期望色从 sunlitFrame / glassWarm
// (palette/windowSpec, dbg 实测 daylight) 派生，采样点避开月光滑带与高光带。

test('框接光 + 夜暖晕（ADR-0028）：深夜框内棱 1px 暖金线、玻璃底部暖晕升起；白昼棱线与暖晕都不在', async ({
  page,
}) => {
  const palette = { bg: DARK.colors.bg, accent: DARK.colors.accent, light: DARK.colors.text };
  const cd = (p: readonly number[], q: readonly number[]) =>
    p.reduce((s, v, i) => s + Math.abs(v - q[i]!), 0);
  const rb = (p: readonly number[]) => p[0]! - p[2]!;
  const warmCol = hexToRgb(lerpHex(DARK.colors.accent, '#ffffff', 0.25));

  // 深夜：框内棱（x0−1 列）= 暖金受光线；玻璃底部暖晕带比其上方对照更暖（R 抬升）
  await openWorldAt(page, 23, 30);
  const size = await canvasSize(page);
  const win = windowSpec(size.w, size.h);
  const dbg = await debugState(page);
  const rim = await pixelAt(page, win.x - 1, win.y + Math.round(win.h * 0.3));
  expect(cd(rim, warmCol), `框内棱 ${rim} ≠ 暖金线 ${warmCol} → 夜棱线没画`).toBeLessThanOrEqual(20);
  const bands = glassWarm({ x: win.x, y: win.y, w: win.w, h: win.h }, Number(dbg.daylight))!;
  const yBottom = bands[0]!.y + Math.round(bands[0]!.h / 2);
  const yCtl = bands[2]!.y - 30; // 晕顶上方的干净玻璃（同列对照）
  const xGlow = win.x + Math.round(win.w * 0.18); // 左 1/4：避开右侧灯/植物
  const glow = await pixelAt(page, xGlow, yBottom);
  const ctl = await pixelAt(page, xGlow, yCtl);
  expect(
    glow[0]! - ctl[0]!,
    `夜暖晕 R 抬升 ${glow[0]! - ctl[0]!} → 玻璃底部暖晕没画`
  ).toBeGreaterThanOrEqual(8);

  // 白昼：内棱回到背光档（非暖金），glassWarm 关门
  await openWorldAt(page, 12, 0, 0, 1);
  const dbgD = await debugState(page);
  expect(glassWarm({ x: win.x, y: win.y, w: win.w, h: win.h }, Number(dbgD.daylight))).toBeNull();
  const dayRim = await pixelAt(page, win.x - 1, win.y + Math.round(win.h * 0.3));
  expect(
    cd(dayRim, warmCol),
    `白昼框内棱 ${dayRim} 仍是暖金线 → 夜棱线没随昼长关掉`
  ).toBeGreaterThan(24);
});


// ==================== T6：窗台陈设（左端一盆小像素植物） ====================
// 判据与被守者同源：几何从 windowSpec + 组件 drawSillPlant 的常量派生，色值从
// window-light.frameProfile / themes.DARK / sampleSky 派生；对照带取**同背景**的
// 左侧纯色框面（而不是「右侧 +24px」——那里已是 reveal/景，固有差就会假绿）。

test('窗台小植物：左端一盆盆栽真的画在框面上（盆/叶同源色），且盆底坐在台面顶边', async ({ browser }) => {
  // 时钟钉死 + 晴天（openWorldAt 惯例）：植物色从**框面实色**（sunlitFrame 接光
  // face）派生，框面色随时段变——不钉钟镜像就跟着真实时刻漂（同微摆用例的教训）。
  // 两个相位各用独立 page（同页 addInitScript 会累积时钟脚本，见屏辉用例注）。
  const page = await browser.newPage();
  await openWorldAt(page, 12, 0, 0, 1);
  // 点亮仪式（boot 96 帧）没走完前 alt 还在缓动，框面色随之漂——镜像必须等稳态
  await page.waitForFunction(
    () => ((window as unknown as { __bgfxDebug?: Record<string, unknown> }).__bgfxDebug ?? {}).bootP === 1,
    undefined,
    { timeout: 10000 }
  );
  const size = await canvasSize(page);
  const win = windowSpec(size.w, size.h);
  const dbg = await debugState(page);
  expect(dbg.weather, '正午晴天：dim=1，派生色不被天气压暗').toBe('clear');
  // 与 drawSillPlant 同一套派生：frameFace = sunlitFrame(palette, daylight).face
  const palette = { bg: DARK.colors.bg, accent: DARK.colors.accent, light: DARK.colors.text };
  const daylight = daylightFor(Number(dbg.alt));
  const frameFace = sunlitFrame(palette, daylight).face;
  const pot = lerpHex(frameFace, '#000000', 0.25);
  const leafDark = lerpHex(frameFace, '#ffffff', 0.22);
  const leafLit = lerpHex(frameFace, '#ffffff', 0.42);
  // 组件 drawSillPlant 的几何常量：px0 = win.x - frame + 11；底 = win.y + win.h；高 13 / 宽 6
  const px0 = win.x - win.frame + 11;
  const plantTop = win.y + win.h - 13;
  const r = await page.evaluate(
    ([px0, plantTop, colors]) => {
      const c = document.getElementById('bgfx-canvas') as HTMLCanvasElement;
      const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      const toRgb = (h: string) => [
        parseInt(h.slice(1, 3), 16),
        parseInt(h.slice(3, 5), 16),
        parseInt(h.slice(5, 7), 16),
      ];
      const cols = (colors as readonly string[]).map(toRgb);
      const countIn = (x: number, y: number, w: number, h: number, rgb: number[]) => {
        let n = 0;
        for (let yy = Math.round(y); yy < Math.round(y + h); yy++)
          for (let xx = Math.round(x); xx < Math.round(x + w); xx++) {
            const i = (yy * c.width + xx) * 4;
            if (
              Math.abs(d[i]! - rgb[0]!) <= 3 &&
              Math.abs(d[i + 1]! - rgb[1]!) <= 3 &&
              Math.abs(d[i + 2]! - rgb[2]!) <= 3
            )
              n++;
          }
        return n;
      };
      const bbox = (dx: number, dy: number, w: number, h: number) =>
        cols.map((rgb) => countIn(px0 + dx, plantTop + dy, w, h, rgb));
      return {
        plant: bbox(0, 0, 6, 13), // [pot, leafDark, leafLit]
        control: bbox(-8, 0, 6, 13), // 同排同尺寸、向左 8px：仍是同一块纯色框面
        baseRow: bbox(0, 12, 6, 1), // 最下一行（win.y + win.h - 1）：盆底
        belowRow: bbox(0, 13, 6, 1), // 台面首行：不该再有植物色
      };
    },
    [px0, plantTop, [pot, leafDark, leafLit]] as const
  );
  // ① 盆（24px）+ 叶（深 9px / 亮 16px）真的画在框面上
  expect(r.plant[0]!, `盆色 ${pot} 只找到 ${r.plant[0]} 像素`).toBeGreaterThanOrEqual(20);
  expect(r.plant[1]!, `深叶色 ${leafDark} 只找到 ${r.plant[1]} 像素`).toBeGreaterThanOrEqual(7);
  expect(r.plant[2]!, `亮叶色 ${leafLit} 只找到 ${r.plant[2]} 像素`).toBeGreaterThanOrEqual(12);
  // ② 对照带（同背景、向左 8px）三种植物色一个都不许有——否则判据抓的是背景自己
  for (const [k, n] of r.control.entries())
    expect(n, `对照带出现 ${n} 个植物色像素（色 ${k}）→ 判据假绿`).toBe(0);
  // ③ 盆底稳稳落在台面顶边，且不越到台面之下
  expect(r.baseRow[0]!, '盆底没落在 win.y + win.h - 1 行').toBeGreaterThanOrEqual(4);
  for (const [k, n] of r.belowRow.entries())
    expect(n, `台面首行仍有植物色像素（色 ${k}）→ 盆浮空 / 穿到台面下`).toBe(0);

  // ④ 夜里相位：植物必须在深夜框面上**浮出来**（2026-10-03 修复项——旧派生
  //    从 prof.face/ridgeNear 独立取色，去铁窗轮框面改接光后夜里整株与框面同化、
  //    只剩暗色左叶可辨）。可见性 = 亮叶与框面的通道差足够大 + 亮叶像素真的在画。
  const nightPage = await browser.newPage();
  await openWorldAt(nightPage, 23, 30, 0, 0);
  await nightPage.waitForFunction(
    () => ((window as unknown as { __bgfxDebug?: Record<string, unknown> }).__bgfxDebug ?? {}).bootP === 1,
    undefined,
    { timeout: 10000 }
  );
  const nightSize = await canvasSize(nightPage);
  const nightWin = windowSpec(nightSize.w, nightSize.h);
  const nightDbg = await debugState(nightPage);
  const nightFace = sunlitFrame(palette, daylightFor(Number(nightDbg.alt))).face;
  const nLeafLit = lerpHex(nightFace, '#ffffff', 0.42);
  const nPot = lerpHex(nightFace, '#000000', 0.25);
  const npx0 = nightWin.x - nightWin.frame + 11;
  const nTop = nightWin.y + nightWin.h - 13;
  const nr = await nightPage.evaluate(
    ([px0, plantTop, colors]) => {
      const c = document.getElementById('bgfx-canvas') as HTMLCanvasElement;
      const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      const toRgb = (h: string) => [
        parseInt(h.slice(1, 3), 16),
        parseInt(h.slice(3, 5), 16),
        parseInt(h.slice(5, 7), 16),
      ];
      const cols = (colors as readonly string[]).map(toRgb);
      const countIn = (x: number, y: number, w: number, h: number, rgb: number[]) => {
        let n = 0;
        for (let yy = Math.round(y); yy < Math.round(y + h); yy++)
          for (let xx = Math.round(x); xx < Math.round(x + w); xx++) {
            const i = (yy * c.width + xx) * 4;
            if (
              Math.abs(d[i]! - rgb[0]!) <= 3 &&
              Math.abs(d[i + 1]! - rgb[1]!) <= 3 &&
              Math.abs(d[i + 2]! - rgb[2]!) <= 3
            )
              n++;
          }
        return n;
      };
      return [0, 1, 2].map((k) => countIn(px0, plantTop, 6, 13, cols[k]!));
    },
    [npx0, nTop, [nPot, lerpHex(nightFace, '#ffffff', 0.22), nLeafLit]] as const
  );
  const maxChan = (a: string, b: string) => {
    const p = [a, b].map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));
    return Math.max(...[0, 1, 2].map((k) => Math.abs(p[0]![k]! - p[1]![k]!)));
  };
  expect(
    maxChan(nLeafLit, nightFace),
    `夜里亮叶与框面通道差仅 ${maxChan(nLeafLit, nightFace)} → 植物与框面同化（修复失效）`
  ).toBeGreaterThanOrEqual(40);
  expect(nr[2]!, `夜里亮叶像素只找到 ${nr[2]} 个 → 植物没画`).toBeGreaterThanOrEqual(12);
  expect(nr[0]!, `夜里盆色像素只找到 ${nr[0]} 个`).toBeGreaterThanOrEqual(20);
  await nightPage.close();
});

test('窗台小植物微摆：风大时顶叶出现两个整数位置，reduced-motion 下恒定', async ({ page }) => {
  test.setTimeout(90000); // 两轮页内 rAF 逐帧采样（getImageData 回读 ~85ms/帧，headless 下偏慢）

  // ① 风大：drizzle（wind 0.4 ∈ [0.2, 0.5)）——有微摆、**无窗颤**（shake 需 wind≥0.5），
  //    这样顶叶位移只可能来自 sway，不会被整框抖动污染（判据才与 sway 同源）。
  //    **时钟钉正午**（openWorldAt 惯例）：叶尖可见度随时段变——夜里叶色与框面同化
  //    （2026-10-03 实测：整株只剩暗色左叶可辨，帧间零动点），白天 drizzle 下
  //    叶 vs 框面差 ~18（原标定值）。判据本身是帧间差分（见 sampleSwayColumns），
  //    对框面色调免疫，但前提「叶尖可见」由钉正午保证。
  await openWorldAt(page, 12, 0, 55, 1);
  expect((await debugState(page)).weather).toBe('drizzle');
  const size = await canvasSize(page);
  const win = windowSpec(size.w, size.h);
  const movers = await sampleSwayColumns(page, win.x - win.frame + 11, win.y + win.h - 13, {
    distinct: 2,
  });
  expect(movers.length, `叶尖带零动点 → 植物没画或叶尖不可见（风=${(await debugState(page)).wind}）`).toBeGreaterThanOrEqual(1);
  const distinct = movers;
  expect(
    distinct.length,
    `风大时顶叶只出现在 ${distinct.join(',')} 一个位置 → 没微摆`
  ).toBeGreaterThanOrEqual(2);
  for (const x of distinct)
    expect(x, `顶叶 x=${x} 不是整数（像素语言不收半像素）`).toBe(Math.round(x));

  // ② reduced-motion：同一窗口位置必须恒定（帧间差分必须零动点——
  //    「恒定」只能用带足够的读数证，早退会假绿）。
  //    同页 emulateMedia + reload（不用新标签：后台页 rAF 会被节流，逐帧采样超时）。
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/', { waitUntil: 'load' });
  await page.waitForTimeout(1400);
  const slowSize = await canvasSize(page);
  const slowWin = windowSpec(slowSize.w, slowSize.h);
  const slowMovers = await sampleSwayColumns(page, slowWin.x - slowWin.frame + 11, slowWin.y + slowWin.h - 13, {
    reads: 100,
    distinct: 99, // 不许早退：要证明「恒定」
  });
  expect(slowMovers, `reduced-motion 下顶叶动了：${slowMovers.join(',')}`).toEqual([]);
});

// ==================== T8：窗边工位静物（桌 / CRT 壳 / 台灯 / 茶 / 书） ====================
// 判据与被守者同源：几何全部从 `deskSpec` 派生（不写死像素），色值从
// window-light.wallFace / frameProfile、themes.DARK、sampleSky 派生，
// 且**逐字照抄 BgFx.drawDeskRoom 的派生式**（改公式两边一起红）。
// 每个「有」的取样点都配一个同背景对照：不画时对照点与取样点同色 → 判据必须红。

test('工位静物（T8）：桌面板/CRT 屏/台灯亮缝真的画在画布上（色值同源 + 同背景对照）', async ({ page }) => {
  await openWorldAt(page, 12, 0, 0, 1); // 正午晴天：dim=1，派生色不被天气压暗
  await scrollHeroToTop(page); // ADR-0027：工位住第二章，deskAlpha 门只在这一屏开
  const size = await canvasSize(page);
  const d = deskSpec(size.w, size.h)!;
  const dbg = await debugState(page);
  expect(dbg.weather, '正午晴天').toBe('clear');
  const palette = { bg: DARK.colors.bg, accent: DARK.colors.accent, light: DARK.colors.text };
  const sky = sampleSky(Number(dbg.alt));
  const prof = frameProfile(palette, sky.bands[4]!);
  const wall = wallFace(palette);
  // —— 与 drawDeskRoom 逐字同源的派生式 ——
  const topCol = lerpHex(lerpHex(wall, '#ffffff', 0.55), palette.accent, 0.04);
  const apronCol = lerpHex(prof.face, '#ffffff', 0.24);
  const bodyCol = lerpHex(prof.face, '#ffffff', 0.06);
  const screenCol = lerpHex(prof.face, '#000000', 0.62);
  const lampGlowCol = lerpHex(palette.accent, '#ffffff', 0.25);
  const bookTopCol = lerpHex(prof.face, '#ffffff', 0.22);
  const mugCol = lerpHex(prof.face, '#ffffff', 0.32);
  const floorCol = lerpHex(wall, '#000000', 0.32); // 与 drawDeskRoom 同源
  const s = d.crt.screen;
  // 取样点全从 deskSpec 派生。
  // 对照点从「桌沿上方的墙」改成「桌外地板」（ADR-0027）：工位自成一景后
  // worldAlpha=0、墙不在这一屏画，桌沿上方是**未绘制的透明像素**（实测 0,0,0），
  // 旧对照失效。桌外同一场景里的地板才是「不画桌时该露出的背景」。
  const pts = {
    deskSurface: [d.desk.x0 + 6, d.desk.top + 5],
    deskAccent: [d.desk.x0 + 6, d.desk.top],
    // 围板现在是 4 段受光阶梯（2026-10-29）：顶部段 = 源码 apronCol，底部段逐级暗 7%
    apron: [d.desk.x0 + 6, d.desk.top + d.desk.surface + 6],
    apronBottom: [d.desk.x0 + 6, d.desk.front - 4],
    crtBody: [d.crt.x + 4, d.crt.y + 40],
    screen: [s.x + (s.w >> 1), s.y + (s.h >> 1)],
    lampGlow: [d.lamp.x, d.lamp.arm - 1],
    bookTop: [d.books.x + (d.books.w >> 1), d.books.y + 4],
    mug: [d.mug.x + 5, d.mug.y + 1],
    floorControl: [Math.max(2, d.desk.x0 - 12), d.floorY + 10], // 桌外地板
  } as const;
  const r = await page.evaluate(
    ([pts]) => {
      const c = document.getElementById('bgfx-canvas') as HTMLCanvasElement;
      const g = c.getContext('2d')!;
      const out: Record<string, number[]> = {};
      for (const [k, [x, y]] of Object.entries(pts as Record<string, readonly number[]>)) {
        const dd = g.getImageData(Math.round(x!), Math.round(y!), 1, 1).data;
        out[k] = [dd[0]!, dd[1]!, dd[2]!];
      }
      return out;
    },
    [pts] as const
  );
  const toRgb = (h: string): number[] => [
    parseInt(h.slice(1, 3), 16),
    parseInt(h.slice(3, 5), 16),
    parseInt(h.slice(5, 7), 16),
  ];
  const expectNear = (key: string, hex: string, tol: number) => {
    const want = toRgb(hex);
    for (let k = 0; k < 3; k++) {
      expect(
        Math.abs(r[key]![k]! - want[k]!),
        `${key} 通道 ${k}：实测 ${r[key]![k]} vs 源码预期 ${want[k]}（${hex}）`
      ).toBeLessThanOrEqual(tol);
    }
  };
  expectNear('deskSurface', topCol, 4);
  expectNear('deskAccent', palette.accent, 2);
  expectNear('apron', apronCol, 4);
  // 围板 4 段阶梯：底部段必须比顶部暗（旧版一整块平色 → 这条会红）
  expect(
    r.apronBottom![0]! + r.apronBottom![1]! + r.apronBottom![2]!,
    `围板底部 ${r.apronBottom!.join(',')} 不比顶部 ${r.apron!.join(',')} 暗 → 受光阶梯没画`
  ).toBeLessThan(r.apron![0]! + r.apron![1]! + r.apron![2]! - 20);
  expectNear('crtBody', bodyCol, 4);
  expectNear('screen', screenCol, 4);
  expectNear('lampGlow', lampGlowCol, 4);
  expectNear('bookTop', bookTopCol, 4);
  expectNear('mug', mugCol, 4);
  expectNear('floorControl', floorCol, 4);
  // ③「浮出来」阶梯（2026-10-03 P1③）：桌身器物不得比框面(face)暗超过一档——
  //    旧围板 face−0.30 / CRT 机身 face−0.15 被第二屏 scrim 向背景收敛后读作
  //    剪影（截图实锤「桌子融进墙」）。下限从 face / faceLit **独立派生**（刻意
  //    不镜像源码公式），防止改公式时把守卫一起改没。
  const sumLum = (c: number[]) => c[0]! + c[1]! + c[2]!;
  const faceLum = sumLum(toRgb(prof.face));
  const faceLitLum = sumLum(toRgb(prof.faceLit));
  expect(
    sumLum(r.apron!),
    `围板亮度 ${sumLum(r.apron!)} < 框面 ${faceLum} − 34 → 围板融进背景`
  ).toBeGreaterThanOrEqual(faceLum - 34);
  expect(
    sumLum(r.crtBody!),
    `CRT 机身亮度 ${sumLum(r.crtBody!)} < 框面 ${faceLum} − 34 → 剪影化`
  ).toBeGreaterThanOrEqual(faceLum - 34);
  expect(
    sumLum(r.mug!),
    `杯体亮度 ${sumLum(r.mug!)} < faceLit ${faceLitLum} + 25 → 杯不可辨`
  ).toBeGreaterThanOrEqual(faceLitLum + 25);
  expect(
    sumLum(r.bookTop!),
    `书堆顶本亮度 ${sumLum(r.bookTop!)} < 框面 ${faceLum} + 50 → 书堆不可辨`
  ).toBeGreaterThanOrEqual(faceLum + 50);
  // ① 判据能分辨：桌面色与同场景的地板色必须拉开（不画桌时桌面点也是地板/透明 → 上面那条会红）
  const dist = (a: number[], b: number[]) =>
    Math.abs(a[0]! - b[0]!) + Math.abs(a[1]! - b[1]!) + Math.abs(a[2]! - b[2]!);
  expect(
    dist(r.deskSurface!, r.floorControl!),
    `桌面色与地板色只差 ${dist(r.deskSurface!, r.floorControl!)} → 判据分不开（假绿风险）`
  ).toBeGreaterThan(20);
  // ② CRT 屏是近黑：比机身暗一大截
  expect(
    Math.max(...r.screen!),
    `屏最亮通道 ${Math.max(...r.screen!)} ≥ 60 → 屏不是熄灭的近黑`
  ).toBeLessThan(60);
  expect(
    Math.max(...r.crtBody!) - Math.max(...r.screen!),
    '屏不比机身暗 → 屏没画'
  ).toBeGreaterThan(30);
});

test('墙面置物板（2026-10-01）：板/盆栽/收音机真的画在画布上（色值同源 + 对照带）', async ({ page }) => {
  await openWorldAt(page, 12, 0, 0, 1); // 正午晴天：wind=0，盆栽静止，派生色不被天气压暗
  await scrollHeroToTop(page);
  const size = await canvasSize(page);
  const d = deskSpec(size.w, size.h)!;
  const dbg = await debugState(page);
  const palette = { bg: DARK.colors.bg, accent: DARK.colors.accent, light: DARK.colors.text };
  const sky = sampleSky(Number(dbg.alt));
  const prof = frameProfile(palette, sky.bands[4]!);
  const wall = wallFace(palette);
  // —— 与 drawDeskRoom ⑨ 段逐字同源的派生式 ——
  const boardCol = lerpHex(wall, '#ffffff', 0.27);
  const boardLit = lerpHex(boardCol, '#ffffff', 0.4);
  const potCol = lerpHex(wall, '#ffffff', 0.38);
  const leafBody = lerpHex(sky.ridgeNear, '#ffffff', 0.82);
  const radioPanel = lerpHex(wall, '#ffffff', 0.5);
  const S = d.shelf;
  const pts = {
    board: [S.x + (S.w >> 1), S.y + S.board - 2], // 板主面（避开受光棱/暗线）
    boardLit: [S.x + (S.w >> 1), S.y], // 顶缘受光棱
    pot: [S.plant.x + 3, S.y - 2], // 陶盆身
    leaf: [S.plant.x + Math.round(S.plant.w / 2) - 1, S.y - S.plant.h + 6], // 中叶身（摆幅 2 行之下）
    radioPanel: [S.radio.x + 4, S.y - S.radio.h + 3], // 收音机受光面板
    control: [S.x + (S.w >> 1), S.y - 40], // 对照带：板上方空墙（物件最高 22px）——未绘制
  } as const;
  const r = await page.evaluate(
    ([pts]) => {
      const c = document.getElementById('bgfx-canvas') as HTMLCanvasElement;
      const g = c.getContext('2d')!;
      const out: Record<string, number[]> = {};
      for (const [k, [x, y]] of Object.entries(pts as Record<string, readonly number[]>)) {
        const dd = g.getImageData(Math.round(x!), Math.round(y!), 1, 1).data;
        out[k] = [dd[0]!, dd[1]!, dd[2]!];
      }
      return out;
    },
    [pts] as const
  );
  const toRgb = (h: string): number[] => [
    parseInt(h.slice(1, 3), 16),
    parseInt(h.slice(3, 5), 16),
    parseInt(h.slice(5, 7), 16),
  ];
  const expectNear = (key: string, hex: string, tol: number) => {
    const want = toRgb(hex);
    for (let k = 0; k < 3; k++) {
      expect(
        Math.abs(r[key]![k]! - want[k]!),
        `${key} 通道 ${k}：实测 ${r[key]![k]} vs 源码预期 ${want[k]}（${hex}）`
      ).toBeLessThanOrEqual(tol);
    }
  };
  expectNear('board', boardCol, 4);
  expectNear('boardLit', boardLit, 4);
  expectNear('pot', potCol, 4);
  expectNear('leaf', leafBody, 5);
  expectNear('radioPanel', radioPanel, 5);
  // 对照带：空墙不是板色（未绘制 → 透明黑 0,0,0）——板色出现在对照点 = 判据假绿
  const dist = (a: number[], b: number[]) =>
    Math.abs(a[0]! - b[0]!) + Math.abs(a[1]! - b[1]!) + Math.abs(a[2]! - b[2]!);
  expect(
    dist(r.control!, toRgb(boardCol)),
    `对照点与板色只差 ${dist(r.control!, toRgb(boardCol))} → 判据分不开（假绿风险）`
  ).toBeGreaterThan(20);
});

test('工位静物（T8）：桌面顶缘恰好落在 desk.top 行、CRT 屏是一整块近黑矩形（位置 + 面积，不只存在）', async ({
  page,
}) => {
  await openWorldAt(page, 12, 0, 0, 1);
  await scrollHeroToTop(page); // ADR-0027：工位住第二章
  const size = await canvasSize(page);
  const d = deskSpec(size.w, size.h)!;
  const dbg = await debugState(page);
  const palette = { bg: DARK.colors.bg, accent: DARK.colors.accent, light: DARK.colors.text };
  const sky = sampleSky(Number(dbg.alt));
  const prof = frameProfile(palette, sky.bands[4]!);
  const screenCol = lerpHex(prof.face, '#000000', 0.62);
  const accent = palette.accent;
  const s = d.crt.screen;
  const r = await page.evaluate(
    ([d, accent, screenCol, s]) => {
      const c = document.getElementById('bgfx-canvas') as HTMLCanvasElement;
      const g = c.getContext('2d')!;
      const img = g.getImageData(0, 0, c.width, c.height).data;
      const toRgb = (h: string) => [
        parseInt(h.slice(1, 3), 16),
        parseInt(h.slice(3, 5), 16),
        parseInt(h.slice(5, 7), 16),
      ];
      const near = (x: number, y: number, rgb: number[], tol: number) => {
        const i = (Math.round(y) * c.width + Math.round(x)) * 4;
        return (
          Math.abs(img[i]! - rgb[0]!) <= tol &&
          Math.abs(img[i + 1]! - rgb[1]!) <= tol &&
          Math.abs(img[i + 2]! - rgb[2]!) <= tol
        );
      };
      const countRow = (y: number, x0: number, x1: number, rgb: number[], tol: number) => {
        let n = 0;
        for (let x = Math.round(x0); x < Math.round(x1); x++) if (near(x, y, rgb, tol)) n++;
        return n;
      };
      const countBox = (x: number, y: number, w: number, h: number, rgb: number[], tol: number) => {
        let n = 0;
        for (let yy = Math.round(y); yy < Math.round(y + h); yy++)
          for (let xx = Math.round(x); xx < Math.round(x + w); xx++)
            if (near(xx, yy, rgb, tol)) n++;
        return n;
      };
      const acc = toRgb(accent);
      const scr = toRgb(screenCol);
      return {
        deskW: d.desk.x1 - d.desk.x0,
        accentRow: countRow(d.desk.top, d.desk.x0, d.desk.x1, acc, 2),
        accentRowUp: countRow(d.desk.top - 3, d.desk.x0, d.desk.x1, acc, 2),
        screenArea: s.w * s.h,
        screenHit: countBox(s.x, s.y, s.w, s.h, scr, 4),
        // 对照：全画布范围内屏色的总数 —— 若等于屏内计数，说明屏色是屏独有的
        // （扫「墙上同尺寸区域」不行：那块区域会撞到 CRT 自己）
        screenTotal: countBox(0, 0, c.width, c.height, scr, 4),
      };
    },
    [d, accent, screenCol, s] as const
  );
  // ① 顶缘 2px accent 恰好铺满 desk.top 行（≥98% 桌宽）
  expect(
    r.accentRow,
    `desk.top 行只有 ${r.accentRow}/${r.deskW} 是 accent → 桌面顶缘没画在对齐线上`
  ).toBeGreaterThanOrEqual(Math.floor(r.deskW * 0.98));
  // ② 再往上一行不许有 accent（线不在别处）
  expect(r.accentRowUp, `桌沿上方 3px 仍有 ${r.accentRowUp} 个 accent 像素 → 顶缘位置错了`).toBe(0);
  // ③ 屏是一整块近黑矩形（≥95% 面积）
  expect(
    r.screenHit,
    `CRT 屏只有 ${r.screenHit}/${r.screenArea} 是近黑 → 屏没画满`
  ).toBeGreaterThanOrEqual(Math.floor(r.screenArea * 0.95));
  // ④ 对照：全画布屏色总数 == 屏内计数（屏色是屏独有的，判据不会假绿）
  expect(
    r.screenTotal,
    `全画布有 ${r.screenTotal} 个屏色像素，屏内只有 ${r.screenHit} 个 → 屏色不独有（判据假绿）`
  ).toBe(r.screenHit);
});

test('窄屏（480×800）：工位整组退场（桌面/地板一个像素都不画，hero 保持居中栈）', async ({ page }) => {
  await openWorldAt(page, 12, 0, 0, 1);
  await page.setViewportSize({ width: 480, height: 800 });
  await page.waitForTimeout(700);
  // 必须先把这一章顶对齐（deskAlpha 门打开）再断言「不画」——
  // 否则「窄屏不画」与「屏外不画」混在一起，判据假绿。
  await scrollHeroToTop(page);
  const size = await canvasSize(page);
  expect(deskSpec(size.w, size.h), '窄屏不该有工位几何').toBeNull();
  const palette = { bg: DARK.colors.bg, accent: DARK.colors.accent, light: DARK.colors.text };
  const floorCol = lerpHex(wallFace(palette), '#000000', 0.32);
  const n = await countColor(page, floorCol, size.h, 0, size.w);
  expect(n, `窄屏出现 ${n} 个地板色像素 → 桌子没退场`).toBe(0);
  // DESK 分界与 window-room 同值（窄屏判定不许两处各写一个数）
  expect(DESK.NARROW_MAX).toBe(900);
});

// ==================== T9：暖光系统（灯池 / 屏辉 / 热气） ====================
// 判据与被守者同源：几何全从 `deskSpec` 派生，取样点自带「同背景对照」
// （右段 = 灯池内，左段 = 灯池外的同一面），不画灯池时两段同色 → 判据必红。
// 「暖」不是「更亮」：额外要求 R−B 差值变大（单纯提亮蓝灰背景也会更亮）。

/** 多点取 RGB（坐标为视口/画布整数） */
async function samplePixels(
  page: Page,
  pts: Record<string, readonly [number, number]>
): Promise<Record<string, [number, number, number]>> {
  return page.evaluate((p) => {
    const c = document.getElementById('bgfx-canvas') as HTMLCanvasElement;
    const g = c.getContext('2d')!;
    const out: Record<string, number[]> = {};
    for (const [k, [x, y]] of Object.entries(p as Record<string, readonly number[]>)) {
      const dd = g.getImageData(Math.round(x!), Math.round(y!), 1, 1).data;
      out[k] = [dd[0]!, dd[1]!, dd[2]!];
    }
    return out as Record<string, [number, number, number]>;
  }, pts);
}

/** R−B（暖度代理量：暖光把偏蓝的室内面色往 R 拉） */
const warmOf = (p: readonly number[]) => p[0]! - p[2]!;

test('暖光系统（T9）：台灯灯池把桌面/围板/地板右段照暖照亮（灯外同背景对照）', async ({ page }) => {
  await openWorldAt(page, 12, 0, 0, 1); // 正午晴天：dim=1，派生色不被天气压暗
  await scrollHeroToTop(page); // ADR-0027：暖光住第二章
  const size = await canvasSize(page);
  const d = deskSpec(size.w, size.h);
  expect(d, '1440×900 应有工位几何').not.toBeNull();
  const D = d!.desk;
  const L = d!.lamp;
  // 右段 = 灯正下方（灯池中心）；左段 = **CRT 右缘外的桌面**（灯池外、屏光外，
  // 同面同材质）。2026-10-29 起桌面还多了「屏幕冷光」一段（方案 B），
  // 旧的左端取样点（x0+20）已被屏光抬亮，会让左右差从 >10 掉到 5。
  const rx = L.x;
  const lx = d!.crt.x + d!.crt.w + 20;
  const r = await samplePixels(page, {
    deskR: [rx, D.top + 5],
    deskL: [lx, D.top + 5],
    apronR: [rx, D.top + D.surface + 4],
    apronL: [lx, D.top + D.surface + 4],
    floorR: [rx, d!.floorY + 3],
    floorL: [lx, d!.floorY + 3],
  });
  const check = (name: string, a: string, b: string, minLum: number, minWarm: number) => {
    const dl = lumOf(r[a]!) - lumOf(r[b]!);
    const dw = warmOf(r[a]!) - warmOf(r[b]!);
    expect(dl, `${name}：右段只比左段亮 ${dl.toFixed(1)} → 灯池没照到`).toBeGreaterThan(minLum);
    expect(dw, `${name}：右段 R−B 只比左段高 ${dw} → 不是「暖」`).toBeGreaterThan(minWarm);
  };
  check('桌面', 'deskR', 'deskL', 10, 5);
  check('围板', 'apronR', 'apronL', 4, 2);
  check('地板光斑', 'floorR', 'floorL', 6, 2);
  // 反假绿：若灯池没画，左右同面同材质 → 两条断言都会红（对照点就是灯外的那一半）
  const dbg = await debugState(page);
  expect(dbg.lampPool, '灯池读数缺失').toBeTruthy();
});

test('暖光系统（T9）：CRT 屏外 2px 辉光环（比机身亮），白昼/深夜同样在场', async ({ browser }) => {
  // 室内灯不随时段（屋子是恒暗房间）——同一判据跑正午与深夜，两次都必须成立。
  // openWorldAt 用 page.addInitScript 钉时钟，同页重载会累积时钟脚本 → 每个时刻独立 page。
  const out: Array<{ label: string; dLum: number }> = [];
  for (const [hh, mm, label] of [
    [12, 0, '正午'],
    [23, 30, '深夜'],
  ] as const) {
    const page = await browser.newPage();
    await openWorldAt(page, hh, mm, 0, hh > 6 && hh < 19 ? 1 : 0);
    await scrollHeroToTop(page); // ADR-0027：屏辉住第二章
    const size = await canvasSize(page);
    const d = deskSpec(size.w, size.h);
    expect(d, '1440×900 应有工位几何').not.toBeNull();
    const sc = d!.crt.screen;
    const y = sc.y + (sc.h >> 1);
    // 辉光环 = bezel 外缘向外 2px（sc.x-3 / sc.x-2）；对照 = 机身更外侧 sc.x-6
    const r = await samplePixels(page, { glow: [sc.x - 2, y], body: [sc.x - 6, y] });
    const dl = lumOf(r.glow!) - lumOf(r.body!);
    expect(dl, `${label}：屏外辉光环只比机身亮 ${dl.toFixed(1)} → 辉光没画`).toBeGreaterThan(4);
    // 辉光不是「bezel 唇」（唇是内凹背光档，比机身暗）：两者必须不同
    const lip = await samplePixels(page, { lip: [sc.x - 1, y] });
    expect(
      lumOf(r.glow!) - lumOf(lip.lip!),
      `${label}：辉光与 bezel 唇同亮度（分不开）`
    ).toBeGreaterThan(4);
    out.push({ label, dLum: dl });
    await page.close();
  }
  expect(out.length, '两个时刻都要采到').toBe(2);
});

test('暖光系统（T9）：茶杯热气真的在飘（像素位置在变），reduced-motion 位置冻结但在场', async ({
  page,
}) => {
  test.setTimeout(90000); // 两轮页内 rAF 逐帧采样（各 ~240 帧，headless 下 rAF 偏慢）
  await openWorldAt(page, 23, 30, 0, 0);
  await scrollHeroToTop(page); // ADR-0027：热气住第二章
  const size = await canvasSize(page);
  const d = deskSpec(size.w, size.h);
  expect(d, '1440×900 应有工位几何').not.toBeNull();
  const S = d!.steam;
  const L = d!.lamp;
  // 窗口几何从源码派生：上升高度 = drawWarmLight 里的同一个公式
  const rise = Math.max(28, Math.round((L.base - L.head) * 0.6));
  const box = { x0: S.x0 - 3, y0: S.y - rise - 2, x1: S.x1 + 4, y1: S.y + 2 };
  /**
   * 页内 rAF 逐帧锁存：最亮像素 y + 中位亮度 + **非透明像素坐标集**。
   * 坐标集是 reduced-motion 判据（2026-09-26 ADR-0027 重派生）：工位搬到第二章后
   * worldAlpha=0，热气浮在**透明 canvas** 上——静止雾点的 RGB 经
   * premultiply/unpremultiply 舍入后会跳 1 档（实测前两帧 R/G 173↔181），
   * 「最亮 y 唯一」与「全窗口签名恒定」都会因此假红。
   * 「冻结」的语义是**位置不变**（不是每个字节不变）：逐帧非透明像素坐标集相等，
   * 才能既抓住「还在飘」（位置在变）又不被舍入噪声误伤。
   */
  const sample = (frames: number) =>
    page.evaluate(
      ({ box, frames }) =>
        new Promise<Array<{ y: number; max: number; med: number; spots: string }>>((res) => {
          const c = document.getElementById('bgfx-canvas') as HTMLCanvasElement;
          const g = c.getContext('2d')!;
          const w = box.x1 - box.x0;
          const h = box.y1 - box.y0;
          const out: Array<{ y: number; max: number; med: number; spots: string }> = [];
          const tick = () => {
            const im = g.getImageData(box.x0, box.y0, w, h).data;
            let best = -1;
            let by = -1;
            const lums: number[] = [];
            const spots: number[] = [];
            for (let yy = 0; yy < h; yy++)
              for (let xx = 0; xx < w; xx++) {
                const i = (yy * w + xx) * 4;
                const l = 0.2126 * im[i]! + 0.7152 * im[i + 1]! + 0.0722 * im[i + 2]!;
                lums.push(l);
                if (im[i + 3]! > 0) spots.push(yy * w + xx);
                if (l > best) {
                  best = l;
                  by = box.y0 + yy;
                }
              }
            lums.sort((a, b) => a - b);
            out.push({ y: by, max: best, med: lums[lums.length >> 1]!, spots: spots.join(',') });
            if (out.length >= frames) res(out);
            else requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }),
      { box, frames }
    );
  // ① 正常：4s 窗口里最亮像素 y 出现 ≥2 个不同整数位（真的在上升）
  const moving = await sample(240);
  const ys = new Set(moving.map((o) => o.y));
  expect(ys.size, `热气最亮 y 只有 ${ys.size} 个值（${[...ys].slice(0, 6).join(',')}）→ 没在飘`).toBeGreaterThanOrEqual(2);
  // ①b 热气像素的**位置**真的在变（不只是最亮像素在跳）
  expect(
    new Set(moving.map((o) => o.spots)).size,
    '热气非透明像素坐标集全程不变 → 画面上没有在动'
  ).toBeGreaterThan(1);
  // ② reduced-motion：同页 emulateMedia + reload（后台标签页 rAF 会被节流）
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(2000);
  await scrollHeroToTop(page); // reload 回到文档顶：重新把工位那一章顶对齐
  const frozen = await sample(240);
  const frozenSpots = new Set(frozen.map((o) => o.spots));
  expect(
    frozenSpots.size,
    `reduced-motion 下热气像素位置逐帧还在变（${frozenSpots.size} 种坐标集）`
  ).toBe(1);
  // ③ 非全透明假绿：最亮像素必须显著亮于窗口中位（中位 = 透明/未绘制底）
  const maxLum = Math.max(...frozen.map((o) => o.max));
  const medLum = frozen[0]!.med;
  expect(
    maxLum - medLum,
    `reduced-motion 下窗口最亮 ${maxLum.toFixed(1)} vs 中位 ${medLum.toFixed(1)} → 粒子不在场（全透明也恒定）`
  ).toBeGreaterThan(8);
});

