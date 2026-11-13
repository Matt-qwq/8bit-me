import { expect, test, type Page } from '@playwright/test';
import { mockWeather } from './helpers/mock-weather';
import { scrollHeroToTop } from './helpers/hero';

// 天气请求（Open-Meteo）一律 mock：离线可跑 + 零 resource error
test.beforeEach(async ({ page }) => {
  await mockWeather(page);
});

/**
 * 首屏打字机（hero typewriter）—— 浏览器级契约（ADR-0017）
 *
 * 范围（2026-09-11 作者反馈「intro 不打字很突兀」后定稿）：**h1 + tagline + intro 三行**。
 * `kicker` / CTA / 站况读数不打（读数是要紧数据，延迟它违反「绝不延迟内容」）。
 *
 * 分工：`tests/unit/typewriter.spec.ts` 守时间线与裁切几何的纯逻辑 + 范围源码契约；
 * 本文件守**真的在浏览器里发生了**、且**没有把首屏弄坏**：
 *
 *   ① 逐字揭示：采样序列里必须出现过**真中间态**（照 reveal.spec.ts 的逐帧采样手法，
 *      不赌时序——用 `addInitScript` 在页面任何脚本之前装采样器，比 goto 后 evaluate 稳）；
 *   ② **没有一个字被切一半**：每个字素必须「整字可见」或「整字不可见」。
 *      这条是本文件的**核心不变量**，且不依赖实现细节（把裁切多边形当几何区域，用
 *      点包含判定）——它同时抓住「没等字体就量边界」（回退字体前进量不同 → 边界落在字里）
 *      与「多行实现错」（两行同时擦除 / 阶梯位置错）；
 *   ③ 已显示的字素必须是**前缀**（不能跳过、不能倒序）；
 *   ④ 三行**依次**打，后一行不在前一行打完前起打；
 *   ⑤ 光标贴在**正在打的那一行**上（y / 高 vs 该行字格）；
 *   ⑥ 终态无残留：三行 clip-path 归 none、光标收起、文字与静态版逐字相同；
 *   ⑦ **布局零位移**：`clip-path` 不进布局，打字**全程**几何必须等于「无 JS 静态基线」
 *      （两个互相制约的指标：整体 bbox + 逐字边界与间距恒定）；
 *   ⑧ 节奏预算：整串必须在 3s 内落定（三行 57 字素的设计值 ≈ 2.4s）；
 *   ⑨ reduced-motion 下照打；⑩ 无 JS 时文字完整可见；⑪ 字体未就绪就不打字。
 *
 * 两个必须写下来的坑（都真踩过）：
 *   · **几何口径**：首页旧 fullpage 翻页脚本曾加载时 `scrollTo` 把 hero 顶贴视口顶（scrollY 0 → 60）；
 *     该骨架 2026-09 已退役、初始滚动不复存在，但**绝对 y 仍受滚动/入场动画位移影响**，
 *     故几何一律取「相对 `#hero .hero-inner` 的坐标」（`nav-links.spec.ts` 守停靠位）。
 *   · **光标坐标错位**（187 条 e2e 全绿却真存在）：第一版只断言了光标的 x 在内容盒内，
 *     没断言 y，于是「光标整体低了一行（68px）」无人发现，是 agent 自己截图看图才揪出来。
 *     **「断言存在」不等于「断言对」** —— 故有断言 ⑤。
 */

/** 点是否在多边形内（射线法，通用；不假设裁切形状） */
const INSIDE_FN = `
  function inside(pts, x, y) {
    let c = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i], b = pts[j];
      if ((a[1] > y) !== (b[1] > y) && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
    }
    return c;
  }
`;

/**
 * 采样器：在页面脚本之前装好，逐帧记录三行的裁切状态、光标、首屏内容盒几何与滚动位置。
 * 字素表在**字体就绪后**才量（字体未就绪时量出来的前进量是回退字体的，会自证错误）。
 */
async function installSampler(page: Page): Promise<void> {
  await page.addInitScript(`(() => {
    ${INSIDE_FN}
    const SELS = ['#hero h1', '#hero .tagline', '#hero .intro'];
    const store = { samples: [], glyphs: null, fonts: null };
    window.__tw = store;

    const parseClip = (el) => {
      if (!el) return null;
      const cp = getComputedStyle(el).clipPath;
      if (cp === 'none') return { none: true, pts: null };
      const m = /polygon\\(([^)]+)\\)/.exec(cp);
      if (!m) return { none: false, pts: [] };
      const pts = m[1].split(',').map((s) => s.trim().split(/\\s+/).map((v) => parseFloat(v)));
      return { none: false, pts };
    };

    // 字素表（相对各自元素 border box）：只在**最终布局**就绪后量一次。
    // T10 重派生（2026-09-25）：工位重排后 hero 的布局分两段——内联脚本先上
    // hero--boot（藏住居中栈），模块脚本再从 deskSpec 写坐标、切到 hero--desk。
    // 字体预加载可能在这两段之间就就绪；此时量到的字素表还是**居中栈**的
    // （h1 有 16px 内衬、intro 单行），而打字机量的是工位布局（h1 无内衬、intro
    // 两行）——两套坐标不一致会把「边界落在字里」误报成真缺陷。
    // 故字素表必须等 hero--boot 摘掉（坐标已上）后再量。
    const layoutReady = () => {
      const hero = document.getElementById('hero');
      return !!hero && !hero.classList.contains('hero--boot');
    };
    const buildGlyphs = () => {
      const out = [];
      for (const sel of SELS) {
        const el = document.querySelector(sel);
        if (!el) { out.push([]); continue; }
        const b = el.getBoundingClientRect();
        const range = document.createRange();
        const list = [];
        const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walk.nextNode())) {
          const t = node.textContent || '';
          for (let i = 0; i < t.length; i++) {
            range.setStart(node, i);
            range.setEnd(node, i + 1);
            const r = range.getBoundingClientRect();
            list.push({ l: r.left - b.left, r: r.right - b.left, t: r.top - b.top, b: r.bottom - b.top });
          }
        }
        out.push(list);
      }
      return out;
    };

    const tick = () => {
      if (!store.fonts && document.fonts.status === 'loaded' && layoutReady()) {
        store.fonts = true;
        store.glyphs = buildGlyphs();
      }
      const rowsOf = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const range = document.createRange();
        range.selectNodeContents(el);
        return [...range.getClientRects()]
          .filter((r) => r.width > 1)
          .map((r) => ({ y: r.top, h: r.height }));
      };
      const caret = document.querySelector('#hero .tw-caret');
      const cr = caret && !caret.hidden ? caret.getBoundingClientRect() : null;
      const inner = document.querySelector('#hero .hero-inner');
      const ib = inner && inner.getBoundingClientRect();

      // 每行的可见字素数 + 是否被切一半
      const vis = SELS.map((sel, li) => {
        const clip = parseClip(document.querySelector(sel));
        const glyphs = store.glyphs ? store.glyphs[li] : null;
        if (!clip) return null;
        if (clip.none) return { n: glyphs ? glyphs.length : -1, cut: 0, done: true };
        if (!glyphs) return { n: -1, cut: 0, done: false };
        let n = 0, cut = 0, maxVis = -1, minHid = -1;
        for (let gi = 0; gi < glyphs.length; gi++) {
          const g = glyphs[gi];
          const midY = (g.t + g.b) / 2;
          const a = inside(clip.pts, g.l + 0.5, midY);
          const b = inside(clip.pts, g.r - 0.5, midY);
          if (a && b) {
            n++;
            maxVis = gi;
          } else {
            if (a !== b) cut++;
            if (minHid < 0) minHid = gi;
          }
        }
        return { n, cut, done: false, maxVis, minHid };
      });

      store.samples.push({
        t: performance.now(),
        tw: document.documentElement.dataset.tw || null,
        vis,
        clip: SELS.map((s) => { const c = parseClip(document.querySelector(s)); return c ? c.none : null; }),
        caret: cr ? { x: cr.x, y: cr.top, h: cr.height } : null,
        rows: { h1: rowsOf('#hero h1'), tag: rowsOf('#hero .tagline'), intro: rowsOf('#hero .intro') },
        raw: SELS.map((s) => { const el = document.querySelector(s); return el ? getComputedStyle(el).clipPath : null; }),
        inner: ib ? [ib.x, ib.y, ib.width, ib.height] : [],
        scrollY: window.scrollY,
      });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  })()`);
}

type ClipState = { none: boolean; pts: number[][] | null } | null;
type Vis = { n: number; cut: number; done: boolean; maxVis?: number; minHid?: number } | null;
type RowRect = { y: number; h: number };
type Sample = {
  t: number;
  tw: string | null;
  vis: Vis[];
  clip: (boolean | null)[];
  /** 原始计算值（降级路径靠它判定「从未推进」） */
  raw: (string | null)[];
  caret: { x: number; y: number; h: number } | null;
  /** 每个元素的**全部**视觉行（intro 桌面 2 行 → 光标会走到第 2 行） */
  rows: { h1: RowRect[] | null; tag: RowRect[] | null; intro: RowRect[] | null };
  inner: number[];
  scrollY: number;
};

const samplesOf = (page: Page) =>
  page.evaluate(() => (window as unknown as { __tw: { samples: Sample[] } }).__tw.samples);

/** 每行的字素数（终态量，用于断言前缀长度） */
const glyphCounts = (page: Page) =>
  page.evaluate(() => {
    const out: number[] = [];
    for (const sel of ['#hero h1', '#hero .tagline', '#hero .intro']) {
      const el = document.querySelector(sel);
      out.push(el ? [...(el.textContent ?? '')].length : -1);
    }
    return out;
  });

/**
 * 几何探针（有 JS / 无 JS 两个上下文共用，保证口径一致）。
 * 坐标一律相对 `#hero .hero-inner`。布局：
 * [inner.x, inner.w, inner.h, h1 box(4), tagline box(4), intro box(4), h1 逐字(7), tagline 逐字(14), intro 逐字(36)]
 */
const geometryProbe = () => {
  const inner = document.querySelector('#hero .hero-inner')!.getBoundingClientRect();
  const box = (sel: string) => {
    const el = document.querySelector(sel);
    if (!el) return [NaN, NaN, NaN, NaN];
    const r = el.getBoundingClientRect();
    return [r.x - inner.x, r.y - inner.y, r.width, r.height];
  };
  const chars = (sel: string, max: number) => {
    const el = document.querySelector(sel);
    const node = el?.firstChild;
    if (!node) return [];
    const range = document.createRange();
    const out: number[] = [];
    const text = node.textContent ?? '';
    for (let i = 0; i < Math.min(text.length, max); i++) {
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      out.push(+(range.getBoundingClientRect().left - inner.x).toFixed(3));
    }
    return out;
  };
  return [
    inner.x,
    inner.width,
    inner.height,
    ...box('#hero h1'),
    ...box('#hero .tagline'),
    ...box('#hero .intro'),
    ...chars('#hero h1', 7),
    ...chars('#hero .tagline', 20),
    ...chars('#hero .intro', 40),
  ];
};

const waitDone = async (page: Page) => {
  await page.waitForFunction(() => document.documentElement.dataset.tw === 'done', undefined, {
    timeout: 8000,
  });
  // 再等两帧：`done` 是在 rAF 里置的，采样器的同一帧可能跑在它之前，
  // 不等就取样本会拿到「还差一个字」的中间态（实测的假红）。
  await page.waitForTimeout(120);
};

/**
 * ADR-0027：hero 是第二章，打字机用 IntersectionObserver(threshold 0.5)
 * 等这一章进视口才打——加载后停在首屏时三行永远保持裁切。
 * 所以「等打字落定」的用例都必须先滚到 #hero 顶对齐，再等 done。
 */
const openHero = async (page: Page) => {
  await scrollHeroToTop(page);
  await waitDone(page);
};

/** 每行「整字可见」的计数序列（只取字素表已就绪的帧） */
const series = (samples: Sample[], li: number) =>
  samples.map((s) => s.vis[li]).filter((v): v is { n: number; cut: number; done: boolean } => !!v && v.n >= 0);

test.describe('首屏打字机：逐字揭示', () => {
  test('三行都出现真中间态、都逐字推进、且依次起打', async ({ page }) => {
    await installSampler(page);
    await page.goto('/', { waitUntil: 'load' });
    await openHero(page);

    const counts = await glyphCounts(page);
    const samples = (await samplesOf(page)) as Sample[];
    expect(samples.length, '采样器一帧都没记到').toBeGreaterThan(10);
    for (const [i, c] of counts.entries()) {
      expect(c, `第 ${i + 1} 行没量到字素`).toBeGreaterThan(1);
    }

    for (const li of [0, 1, 2]) {
      const s = series(samples, li);
      const full = counts[li]!;
      // ① 真中间态
      const mid = s.filter((v) => v.n > 0 && v.n < full);
      expect(mid.length, `第 ${li + 1} 行没出现中间态（要么没打，要么一帧到位）`).toBeGreaterThan(2);
      // ② 逐帧单调推进
      const ns = s.map((v) => v.n);
      for (let i = 1; i < ns.length; i++) {
        expect(ns[i]!, `第 ${li + 1} 行的已显示字数回退了：${ns[i - 1]} → ${ns[i]}`).toBeGreaterThanOrEqual(ns[i - 1]!);
      }
      // ③ 至少三个不同进度（「一次跳一半」不算逐字）
      expect(new Set(ns).size, `第 ${li + 1} 行只有 ${new Set(ns).size} 个进度档`).toBeGreaterThanOrEqual(3);
    }

    // ④ 依次起打：后一行起打时，前一行必须已全部显示
    for (const [prev, cur] of [
      [0, 1],
      [1, 2],
    ] as const) {
      const idx = samples.findIndex((s) => (s.vis[cur]?.n ?? -1) > 0);
      expect(idx, `第 ${cur + 1} 行从没开始打`).toBeGreaterThan(-1);
      expect(
        samples[idx]!.vis[prev]!.n,
        `第 ${cur + 1} 行起打时第 ${prev + 1} 行还没打完（两行同时在打）`
      ).toBe(counts[prev]!);
    }

    // ⑤ 终态：三行完全揭幕、光标收起
    for (const sel of ['#hero h1', '#hero .tagline', '#hero .intro']) {
      await expect(page.locator(sel)).toHaveCSS('clip-path', 'none');
    }
    expect(await page.$eval('#hero .tw-caret', (e) => (e as HTMLElement).hidden), '打完光标必须收起').toBe(true);
    expect(await page.locator('#hero .tw-caret').isVisible()).toBe(false);
  });

  test('没有一个字被切一半（核心不变量：整字可见或整字不可见）', async ({ page }) => {
    // 这条同时守两件事：① 多行阶梯裁切位置正确；② 边界是用**真字体**量的
    // （回退字体的前进量与 Zpix 每字差约 1px → 边界落在字里 → cut > 0）。
    await installSampler(page);
    await page.goto('/', { waitUntil: 'load' });
    await openHero(page);

    const samples = (await samplesOf(page)) as Sample[];
    const ready = samples.filter((s) => s.vis.every((v) => !v || v.n >= 0));
    expect(ready.length, '采样里没有一帧量到字素表（防空跑）').toBeGreaterThan(5);

    const bad: string[] = [];
    for (const s of ready) {
      s.vis.forEach((v, li) => {
        if (v && v.cut > 0) bad.push(`第 ${li + 1} 行有 ${v.cut} 个字被切一半`);
      });
    }
    expect([...new Set(bad)].slice(0, 6), '裁切边落在字里（多行实现错 / 没等 Zpix 就量边界）').toEqual([]);
  });

  test('已显示的字素必须是前缀（不跳字、不倒序、不在行内留洞）', async ({ page }) => {
    await installSampler(page);
    await page.goto('/', { waitUntil: 'load' });
    await openHero(page);

    const samples = (await samplesOf(page)) as Sample[];
    const ready = samples.filter((s) => s.vis.every((v) => !v || v.n >= 0));
    expect(ready.length, '采样里没有一帧量到字素表（防空跑）').toBeGreaterThan(5);
    const counts = await glyphCounts(page);

    const gapsFound: string[] = [];
    for (const s of ready) {
      s.vis.forEach((v, li) => {
        if (!v || v.n < 0) return;
        expect(v.n, `第 ${li + 1} 行可见字数越界`).toBeLessThanOrEqual(counts[li]!);
        // 前缀性：可见的最大下标 + 1 必须等于第一个隐藏的下标（中间不能有洞）。
        // 这是多行阶梯裁切最容易错的地方（比如第 2 行先露了开头）。
        if (v.maxVis !== undefined && v.maxVis >= 0 && v.minHid !== undefined && v.minHid >= 0) {
          if (v.maxVis + 1 !== v.minHid) {
            gapsFound.push(`第 ${li + 1} 行：可见到 #${v.maxVis}，但 #${v.minHid} 已隐藏（中间有洞）`);
          }
        }
      });
    }
    expect([...new Set(gapsFound)].slice(0, 6), '揭示不是前缀（行内出现空洞）').toEqual([]);

    const last = ready[ready.length - 1]!;
    last.vis.forEach((v, li) => expect(v!.n, `第 ${li + 1} 行终态字数不对`).toBe(counts[li]!));
  });

  test('光标贴在正在打的那一行上（x 在内容盒内、y/高与该行字格一致）', async ({ page }) => {
    await installSampler(page);
    await page.goto('/', { waitUntil: 'load' });
    await openHero(page);

    const samples = (await samplesOf(page)) as Sample[];
    const withCaret = samples.filter((s) => s.caret !== null && s.vis.every((v) => !v || v.n >= 0));
    expect(withCaret.length, '打字期间没出现光标').toBeGreaterThan(3);

    const innerRight = withCaret[0]!.inner[0]! + withCaret[0]!.inner[2]!;
    const badX: string[] = [];
    const badRow: string[] = [];
    const ROWS = ['h1', 'tag', 'intro'] as const;
    for (const s of withCaret) {
      if (s.caret!.x < s.inner[0]! - 8 || s.caret!.x > innerRight + 8) {
        badX.push(`光标 x=${s.caret!.x.toFixed(1)} 越出内容盒`);
      }
      // 正在打的那一行 = 第一个还没打完的元素
      const li = s.vis.findIndex((v) => v && !v.done);
      if (li < 0) continue;
      const rows = s.rows[ROWS[li]!];
      expect(rows, `量不到第 ${li + 1} 行的视觉行`).not.toBeNull();
      // 光标必须落在该元素的**某一行**上（intro 会跨到第 2 行），y 与高都要对得上
      const hit = rows!.some(
        (r) => Math.abs(s.caret!.y - r.y) <= 2 && Math.abs(s.caret!.h - r.h) <= 2
      );
      if (!hit) {
        badRow.push(
          `第 ${li + 1} 行：光标 y=${s.caret!.y.toFixed(1)} h=${s.caret!.h.toFixed(1)}，该元素行=${JSON.stringify(
            rows!.map((r) => [Math.round(r.y), Math.round(r.h)])
          )}`
        );
      }
    }
    expect([...new Set(badX)].slice(0, 4), '光标跑出首屏内容盒').toEqual([]);
    expect([...new Set(badRow)].slice(0, 4), '光标没贴在正在打的那一行上（多半是坐标系混用）').toEqual([]);
  });

  test('打字机不许滚动页面（intro 打字期间 scrollY 恒定）', async ({ page }) => {
    await installSampler(page);
    await page.goto('/', { waitUntil: 'load' });
    await openHero(page);
    const samples = (await samplesOf(page)) as Sample[];
    // 取「intro 已经开始打」的帧：此刻页面上没有任何脚本滚动（翻页骨架 2026-09 已退役），
    // 之后任何 scrollY 变化都只能归给打字机。滚到 #hero 的那一次滚动发生在打字开始前，
    // 不在筛选出的打字帧里（判据仍是「打字期间 scrollY 恒定」）。
    const typing = samples.filter((s) => (s.vis[2]?.n ?? -1) > 0);
    expect(typing.length, '采样没落在 intro 打字期间（防空跑）').toBeGreaterThan(2);
    expect(
      [...new Set(typing.map((s) => s.scrollY))],
      'intro 打字期间页面被滚动了'
    ).toHaveLength(1);
  });

  test('节奏预算：从开打到落定 ≤3s（三行 57 字素设计值 ≈ 2.4s）', async ({ page }) => {
    // ADR-0027：打字机等这一章进视口才开打，所以预算从「真的开打」起算
    // （页面加载 + 滚动到第二章的时间不计入——那已经不是「首屏迟迟读不到」的问题）。
    await page.goto('/', { waitUntil: 'load' });
    await scrollHeroToTop(page);
    // 开打信号 = 光标被显示（ensureCaret 在第一个打字帧调用）
    await page.waitForFunction(
      () => {
        const c = document.querySelector<HTMLElement>('#hero .tw-caret');
        return !!c && !c.hidden;
      },
      undefined,
      { timeout: 8000 }
    );
    const t0 = Date.now();
    await waitDone(page);
    const elapsed = Date.now() - t0;
    expect(elapsed, `打字用了 ${elapsed}ms，超过 3s 会让这一章迟迟读不到 intro`).toBeLessThan(3000);
  });

  test('字体没就绪就不打字（宁可静态，也不按回退字体的前进量裁字）', async ({ page }) => {
    // 把子集 woff2 推迟 800ms（> FONT_WAIT_MS 400ms）：此时按回退字体（系统黑体）
    // 量边界会把裁切边落在字里（CJK 前进量 16px vs Zpix 17px）——
    // 正确行为是**整个降级为静态显示**，而不是用错的边界硬打。
    await page.route('**/fonts/zpix.subset.woff2', async (route) => {
      await new Promise((r) => setTimeout(r, 800));
      await route.continue();
    });
    await installSampler(page);
    await page.goto('/', { waitUntil: 'load' });
    await openHero(page);

    const samples = (await samplesOf(page)) as Sample[];
    // 降级路径 = **从未推进过**：占位裁切值只有一个（`inset(0 100% 0 0)`），
    // 打字一旦真的开始就会产生几十个不同的裁切值。
    // （不能断言「一次都没裁」：内联预挂载**故意**先裁掉防 FOUC，那是设计行为。）
    const nonNone = new Set(
      samples.flatMap((s) => s.raw).filter((v): v is string => !!v && v !== 'none')
    );
    expect(
      [...nonNone],
      `字体未就绪时仍在逐步揭示（产生了 ${nonNone.size} 个不同裁切值，应按回退字体前进量裁错了）`
    ).toHaveLength(1);
    for (const sel of ['#hero h1', '#hero .tagline', '#hero .intro']) {
      await expect(page.locator(sel)).toHaveCSS('clip-path', 'none');
    }
  });

  test('reduced-motion 下照打（与首页翻页 PPT / CRT 转场同一条豁免约定）', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await installSampler(page);
    await page.goto('/', { waitUntil: 'load' });
    await openHero(page);

    const counts = await glyphCounts(page);
    const samples = (await samplesOf(page)) as Sample[];
    const s = series(samples, 2); // intro
    const mid = s.filter((v) => v.n > 0 && v.n < counts[2]!);
    expect(mid.length, 'reduced-motion 下打字被压制了').toBeGreaterThan(2);
  });

  test('打字全程零 console.error / pageerror', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
    });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    await installSampler(page);
    await page.goto('/', { waitUntil: 'load' });
    await openHero(page);
    await page.waitForTimeout(1600); // 覆盖内联 3s 兜底计时器的前半段
    expect(errors, '打字机全程必须零报错').toEqual([]);
  });

  test('停在首屏不打字：3.5s 后三行仍保持裁切（进这一章才开打）', async ({ page }) => {
    // ADR-0027：hero 是第二章，加载时它在屏外。旧行为是「加载即打」——
    // 访客滚到第二章时字已经打完，看不到打字机；新行为是等这一章进视口。
    // 本用例停在首屏（scrollY=0）等过内联 3s 兜底计时器，验证它没把裁切提前清掉。
    await page.goto('/', { waitUntil: 'load' });
    await page.waitForFunction(() => document.documentElement.dataset.tw === 'on');
    await page.waitForTimeout(3500);
    const m = await page.evaluate(() => ({
      tw: document.documentElement.dataset.tw,
      clips: ['#hero h1', '#hero .tagline', '#hero .intro'].map(
        (s) => getComputedStyle(document.querySelector(s)!).clipPath
      ),
      caretHidden: (document.querySelector('#hero .tw-caret') as HTMLElement).hidden,
      heroTop: Math.round(document.getElementById('hero')!.getBoundingClientRect().top),
    }));
    expect(m.heroTop, '本条必须在 hero 屏外测（已进视口就不是「停在首屏」了）').toBeGreaterThan(0);
    expect(m.tw, '屏外不该落定（done = 已经打完了）').not.toBe('done');
    for (const [i, c] of m.clips.entries()) {
      expect(c, `屏外第 ${i + 1} 行应保持裁切（实际 ${c}）`).not.toBe('none');
    }
    expect(m.caretHidden, '屏外光标不该出现').toBe(true);

    // 反证：滚到这一章后同一页面真的会打（排除「永远不打」也恒绿）
    await scrollHeroToTop(page);
    await waitDone(page);
    for (const sel of ['#hero h1', '#hero .tagline', '#hero .intro']) {
      await expect(page.locator(sel)).toHaveCSS('clip-path', 'none');
    }
  });
});

test.describe('首屏打字机：不破坏静态版', () => {
  test('布局零位移：打字全程几何 == 落定态（含逐字边界）', async ({ page }) => {
    const viewport = { width: 1440, height: 900 };
    // hero-rise 入场动画（0.32s）会给 .hero-text 一个 translateY(8px)，
    // 要等它落定，否则量到的是入场中间态、不是打字机的问题。
    const settle = 700;

    await page.setViewportSize(viewport);
    await installSampler(page);
    await page.goto('/', { waitUntil: 'load' });
    // ADR-0027：打字机只在这一章进视口才打——不滚过去采样会全程量到「未开打」的静止几何
    await scrollHeroToTop(page);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(settle);

    // 打字期间反复取样：clip-path 不进布局 → 每一帧都必须与**落定态**逐值相同。
    // T10 重派生（2026-09-25）：旧版拿「无 JS 静态页」当基线——工位重排后
    // hero 坐标是 JS 从 deskSpec 算出来的（无 JS 走的是居中栈回退，见下面
    // 「无 JS 降级」用例），两个布局本就不同，旧基线口径失效。改拿**同一页面
    // 的落定态**当基线：同样是「无裁切、无入场位移」的稳定几何，仍能抓住
    // 「裁切/入场改变了布局」这类回归。
    const snaps: number[][] = [];
    for (let i = 0; i < 90; i++) {
      snaps.push((await page.evaluate(geometryProbe)) as number[]);
      if (await page.evaluate(() => document.documentElement.dataset.tw === 'done')) break;
    }
    snaps.push((await page.evaluate(geometryProbe)) as number[]);
    // 防空跑：这段采样必须真的落在打字过程中
    const samples = (await samplesOf(page)) as Sample[];
    expect(
      samples.filter((s) => s.tw === 'on').length,
      '采样时打字已经结束了，这条用例没验到打字期间'
    ).toBeGreaterThan(0);

    const baseline = snaps[snaps.length - 1]!;
    expect(baseline.length, '基线探针没量到东西').toBeGreaterThan(8);

    const diffsOf = (snap: number[]) => snap.map((v, i) => Math.abs(v - baseline[i]!));
    const worst = Math.max(...snaps.map((s) => Math.max(...diffsOf(s))));
    const badSnap = snaps.find((s) => Math.max(...diffsOf(s)) === worst)!;
    const badIdx = diffsOf(badSnap).reduce((best, d, i, all) => (d > all[best]! ? i : best), 0);
    if (worst > 0.5) {
      // 失败时把环境一并打出来：这条用例在并行压力下偶发红（单跑必绿），
      // 光看差值（409 vs 412）猜不出根因——需要知道两边当时的字体/视口/滚动状态。
      const env = await page.evaluate(() => ({
        clientW: document.documentElement.clientWidth,
        wrapW: Math.round(document.querySelector('.bgfx-canvas')!.getBoundingClientRect().width),
        zpix: document.fonts.check('32px Zpix'),
        fonts: [...document.fonts].map((f) => `${f.family}/${f.status}`).join(','),
        scrollY: window.scrollY,
        dpr: window.devicePixelRatio,
        tw: document.documentElement.dataset.tw,
      }));
      const h1W = await page.evaluate(
        () => Math.round(document.querySelector('#hero h1')!.getBoundingClientRect().width * 100) / 100
      );
      throw new Error(
        `打字期间几何与静态基线不符：idx ${badIdx} 基线 ${baseline[badIdx]} vs 实测 ${badSnap[badIdx]}` +
          `
  实测 h1 宽 = ${h1W}；env = ${JSON.stringify(env)}`
      );
    }
    expect(worst).toBeLessThanOrEqual(0.5);

    // 逐字间距恒定：拿 tagline（纯汉字，13 字）验 —— Zpix 的 CJK 前进量恒定（14px 档 = 15.0px），
    // 与 pixel-grid.spec.ts 同一判据。h1 是拉丁串（比例宽度）、intro 含拉丁与标点，
    // 它们的逐字位置由上面与基线的**逐值比对**覆盖。
    // 探针布局：0-2 inner，3-6 h1 box，7-10 tagline box，11-14 intro box，
    //          然后依次是 h1 / tagline / intro 的逐字左边界（长度随文案变，不硬编码）。
    const tagLen = await page.evaluate(
      () => (document.querySelector('#hero .tagline')?.firstChild?.textContent ?? '').length
    );
    expect(tagLen, 'tagline 应是非空单行').toBeGreaterThan(8);
    const gaps = (arr: number[]) => arr.slice(1).map((v, i) => +(v - arr[i]!).toFixed(3));
    const tagChars = snaps[snaps.length - 1]!.slice(22, 22 + tagLen);
    const spread = Math.max(...gaps(tagChars)) - Math.min(...gaps(tagChars));
    expect(spread, `tagline 逐字间距不恒定：${gaps(tagChars).join(', ')}`).toBeLessThanOrEqual(0.05);
  });

  test('无 JS 降级：三行完整可见，不被预挂载藏住', async ({ browser }) => {
    const ctx = await browser.newContext({
      javaScriptEnabled: false,
      viewport: { width: 1440, height: 900 },
    });
    const page = await ctx.newPage();
    await page.goto('/', { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);

    for (const sel of ['#hero h1', '#hero .tagline', '#hero .intro']) {
      const el = page.locator(sel);
      await expect(el, `${sel} 在无 JS 时必须可见`).toBeVisible();
      const text = (await el.textContent())?.trim() ?? '';
      expect(text.length, `${sel} 文案为空`).toBeGreaterThan(0);
      const clip = await el.evaluate((e) => getComputedStyle(e).clipPath);
      expect(clip, `${sel} 无 JS 时不该被裁切`).toBe('none');
    }
    // T10：工位坐标由 JS 从 deskSpec 算出来，无 JS 时没有 canvas 画的工位可坐——
    // 必须回到居中栈（hero--desk 不得凭空出现），且 CRT 终端保留插画壳（边框在 figure 上），
    // 终端全文（无 JS 兜底）完整可见。
    const fallback = await page.evaluate(() => {
      const hero = document.getElementById('hero')!;
      const figure = document.querySelector('#hero .crt-avatar figure')!;
      const code = document.querySelector('#hero .term-fallback')!;
      return {
        desk: hero.classList.contains('hero--desk'),
        border: getComputedStyle(figure).borderLeftWidth,
        text: code.textContent ?? '',
      };
    });
    expect(fallback.desk, '无 JS 时不应出现工位档（没有 canvas 工位可坐）').toBe(false);
    expect(fallback.border, '无 JS 居中栈里终端应保留插画壳').toBe('4px');
    expect(fallback.text, '无 JS 时终端转写可见（服务端渲染兜底）').toContain('ls posts/');
    await ctx.close();
  });
});
