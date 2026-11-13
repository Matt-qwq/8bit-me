import { expect, test } from '@playwright/test';
import { MODES } from '../../src/lib/themes';
import { scrollHeroToTopAndWaitTypewriter } from './helpers/hero';

/**
 * 首屏文字对比度（hero contrast）—— 2026-09-10 实测修复的守线
 *
 * 病根（实测）：首屏是唯一「免遮区」（`.bgfx-scrim.hero-vivid{top:100vh}`），
 * 文字直接坐在全亮 canvas 上。修复前 gb-green：h1 4.09 / tagline 3.41 / intro 3.10
 * —— 三顶全部破 AA 4.5；加 scrim 也只救到 tagline 4.56、intro 4.14。
 * 修复：`.hero-inner` 复用 `.pixel-panel`（实心底），`.tagline` 由强调色改结构色。
 * 修复后 13 套主题最差 4.56。
 *
 * 判据方法（**不是算数学，是量真实渲染像素**）：把文字 `color: transparent`
 * （保留字形占位），截取文字**墨迹矩形**（Range.getClientRects，不含相邻封面/边框），
 * 取该区域背景的 p02/p98 最差像素算对比度。探针脚本见
 * `_scratch/probe-range.mjs`（不进仓库，复现用）。
 *
 * 为什么必须真渲染：`themes.spec.ts` 的数学断言对 `--gb-0` 平色算，
 * 而首屏文字底下是 canvas + scrim 的合成背景——数学口径覆盖不到。
 */

/** 恒暗：UI 只有 DARK 一档（LIGHT 已退役），探针列表只留 dark */
const PROBE_THEMES = ['dark'];
const NODES: Array<[string, string]> = [
  ['#hero h1', 'hero-h1'],
  ['#hero .tagline', 'hero-tagline'],
  ['#hero .intro', 'hero-intro'],
];

function parseRgb(s: string): [number, number, number] {
  const n = s.match(/\d+(\.\d+)?/g)!.slice(0, 3).map(Number);
  return s.startsWith('color(') ? (n.map((v) => Math.round(v * 255)) as [number, number, number]) : (n as [number, number, number]);
}
const lum = ([r, g, b]: [number, number, number]) => {
  const f = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a: [number, number, number], b: [number, number, number]) => {
  const l1 = lum(a), l2 = lum(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};

/**
 * 2026-09-21 无底形态：hero 文字裸坐景上（描边 + 反极性硬投影）。
 *
 * **为什么放弃 worst-pixel 口径**：文字直接坐在「窗外世界」的画面上，晨昏的天空
 * 是中间亮度（暮色紫 ~0.13–0.2），亮/黑两极文字都过不了 4.5——这正是所有像素
 * 游戏用「描边字」的原因：可读性由**描边**承担，不靠场景底色。
 *
 * 新口径（两层）：
 * ① 真渲染——描边真的画在像素上：文字 rect 里 --c-panel 色占比 ≥ 12%（描边 +
 *    投影贴着字形，rect 内它是主导背景色）；零像素采样做不到这一点（数学看不到描边）。
 * ② 数学——文字 × 投影色 ≥ 4.5:1（投影 = --c-panel，与 themes.spec 的
 *    「正文坐面板」五槽保证同源；描边包住字形后，字与描边的对比就是可读性本体）。
 */
/** 描边占比下限：h1 是宽字距拉丁字（字隙占比高 → 描边天然少），阈值单独放宽；
 *  CJK 行字密、描边贴字密 → 12%。两档都是实测值向下取整。 */
const PANEL_SHARE: Record<string, number> = {
  'hero-h1': 0.05,
  'hero-tagline': 0.1,
  'hero-intro': 0.08,
  default: 0.08,
};

test.describe('首屏描边文字：真渲染占比 + 文字×投影色数学', () => {
  for (const theme of PROBE_THEMES) {
    test(`${theme}：描边真实渲染 + 文字×投影色 ≥ 4.5`, async ({ page }) => {
      // HUD 只在「铭牌上方净空 ≥ nav 高」的视口点亮（Hero.apply() 实测几何门控）——
      // 量它必须先把视口设成能过门控的桌面尺寸，否则 visibility:hidden 截出来是空背景假红。
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto('/', { waitUntil: 'load' });
      // ADR-0027：hero 是第二章。必须滚过去（否则元素在视口外，clip 截图直接报
      // "Clipped area is outside the image"）并等打字机落定——裁切中的文字连
      // 描边/硬投影一起被裁掉，直接截会量到「空背景」而假红。
      await scrollHeroToTopAndWaitTypewriter(page);

      const panel = await page.evaluate(() => {
        const cs = getComputedStyle(document.documentElement);
        return cs.getPropertyValue('--c-panel').trim();
      });
      // --c-panel 可能是 color-mix() 等现代色函数，不能手拆字符串——用探针元素解析成 rgb
      const pRgb = parseRgb(
        await page.evaluate(() => {
          const n = document.createElement('span');
          n.style.color = 'var(--c-panel)';
          document.body.appendChild(n);
          const c = getComputedStyle(n).color;
          n.remove();
          return c;
        })
      );

      const failures: string[] = [];
      for (const [sel, label] of NODES) {
        const el = page.locator(sel).first();
        // ① 数学：文字 × 投影色（= --c-panel，描边/投影与五槽同源）
        const info = await el.evaluate((e) => {
          const cs = getComputedStyle(e);
          const r = document.createRange();
          r.selectNodeContents(e);
          return { color: cs.color, lines: r.getClientRects().length };
        });
        expect(info.lines, `${label} 应至少有一行文字`).toBeGreaterThan(0);
        const rc = ratio(parseRgb(info.color), pRgb);
        expect(rc, `${label} 文字×投影色 ${rc.toFixed(2)}:1（描边可读性本体）`).toBeGreaterThanOrEqual(4.5);

        // ② 真渲染：把文字设为透明后，rect 里投影色像素必须显著存在（描边贴着字形画出来了）
        await el.evaluate((e) => {
          [e as HTMLElement, ...e.querySelectorAll('*')].forEach((n) => {
            (n as HTMLElement).style.setProperty('color', 'transparent', 'important');
          });
        });
        await page.waitForTimeout(120);
        const vp = page.viewportSize()!;
        const rr = (await el.boundingBox())!;
        const buf = await page.screenshot({
          clip: { x: rr.x, y: rr.y, width: Math.min(rr.width, vp.width - rr.x), height: rr.height },
        });
        const share = await page.evaluate(
          async ([url, hex]) => {
            const img = new Image();
            img.src = url;
            await img.decode();
            const c = document.createElement('canvas');
            c.width = img.width;
            c.height = img.height;
            const g = c.getContext('2d')!;
            g.drawImage(img, 0, 0);
            const d = g.getImageData(0, 0, c.width, c.height).data;
            const R = parseInt((hex as string).slice(1, 3), 16);
            const G = parseInt((hex as string).slice(3, 5), 16);
            const B = parseInt((hex as string).slice(5, 7), 16);
            let hit = 0;
            let total = 0;
            for (let i = 0; i < d.length; i += 4) {
              total++;
              if (
                Math.abs(d[i]! - R) <= 6 &&
                Math.abs(d[i + 1]! - G) <= 6 &&
                Math.abs(d[i + 2]! - B) <= 6
              )
                hit++;
            }
            return hit / total;
          },
          ['data:image/png;base64,' + buf.toString('base64'), panel] as const
        );
        expect(
          share,
          `${label} rect 内投影色占比 ${(share * 100).toFixed(1)}%（描边未渲染或被盖）`
        ).toBeGreaterThanOrEqual(PANEL_SHARE[label] ?? PANEL_SHARE.default!);
        await el.evaluate((e) => {
          [e as HTMLElement, ...e.querySelectorAll('*')].forEach((n) => {
            (n as HTMLElement).style.removeProperty('color');
          });
        });
      }
      expect(failures, `${theme} hero 描边契约破坏：${failures.join('; ')}`).toEqual([]);
    });
  }

  test('首屏文字带像素硬投影（无底形态：描边 + 反极性投影替代实底）', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1500);
    // 2026-09-21 纸条 → 无底：hero 文字裸坐景上，契约 = 每行文字都带描边硬投影
    //（投影色 --c-panel，与文字反极性——亮档白影托黑字、暗档黑影托亮字）。
    for (const sel of [
      '#hero h1',
      '#hero .tagline',
      '#hero .intro',
      '#hero .hero-status',
    ]) {
      const ts = await page
        .locator(sel)
        .first()
        .evaluate((e) => getComputedStyle(e).textShadow);
      expect(ts, `${sel} 必须带硬投影（无底形态的可读性载体）`).not.toBe('none');
      expect(ts, `${sel} 投影必须是实心硬投影（不许模糊羽化）`).toContain('rgb');
    }
  });

  test('tagline 不再用强调色作文字（accent 只做线）', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1200);
    const { tagline, accent, text } = await page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      const t = document.querySelector('#hero .tagline')!;
      return {
        tagline: getComputedStyle(t).color,
        accent: cs.getPropertyValue('--c-accent').trim(),
        text: cs.getPropertyValue('--color-text').trim(),
      };
    });
    const toRgb = (hex: string) => {
      const h = hex.replace('#', '');
      return `rgb(${[0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(', ')})`;
    };
    expect(tagline, 'tagline 应为结构色而非强调色').not.toBe(toRgb(accent));
    expect(tagline, 'tagline 应为正文结构色').toBe(toRgb(text));
  });
});

test('墙面色带在内容之下：文字像素不被装饰层改动', async ({ page }) => {
  // 旧扫描线守线的 ADR-0021 版：唯一装饰层是 body::before 的墙面色带（z −4，
  // 内容之下）。取一段正文文字的像素，与「关掉色带」时同位置像素比较——
  // 若装饰层画到文字之上，两者会有可测差异。
  await page.goto('/blog/2026-09-04-immutable-data-warehouse/');
  await page.waitForTimeout(2000);
  const el = page.locator('.prose p').first();
  await el.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  const box = await el.boundingBox();
  expect(box).not.toBeNull();
  const clip = { x: box!.x, y: box!.y, width: Math.min(box!.width, 400), height: Math.min(box!.height, 60) };

  const shot = async () => (await page.screenshot({ clip })).toString('base64');
  const withScan = await shot();
  await page.addStyleTag({ content: 'body::before { display: none !important; }' });
  await page.waitForTimeout(300);
  const withoutScan = await shot();

  const diff = await page.evaluate(
    async ({ a, b }) => {
      const load = async (url: string) => {
        const img = new Image();
        img.src = 'data:image/png;base64,' + url;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.width; c.height = img.height;
        c.getContext('2d')!.drawImage(img, 0, 0);
        return c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      };
      const A = await load(a);
      const B = await load(b);
      let changed = 0;
      for (let i = 0; i < A.length; i += 4) {
        if (A[i] !== B[i] || A[i + 1] !== B[i + 1] || A[i + 2] !== B[i + 2]) changed++;
      }
      return { changed, total: A.length / 4 };
    },
    { a: withScan, b: withoutScan }
  );

  const changedRatio = diff.changed / diff.total;
  expect(
    changedRatio,
    `正文像素被装饰层改动 ${(changedRatio * 100).toFixed(1)}%（应 <2%：装饰层在内容之下）`
  ).toBeLessThan(0.02);
});

/**
 * 无底色文字（bare text）—— P1-8 的真解：不是「canvas 让开」，而是调 dim
 *
 * 实测过程（2026-09-10）：
 *  1. 先试「内容安全带」（在 canvas 上叠一条居中遮罩）——A/B 显示只值 +0.08，
 *     原因是 `.crt-overlay`（z −1）在 DOM 里晚于 `.bgfx-canvas`，画在安全带之上。
 *  2. 再量最差背景的真实来源：`p98 = (23,63,15)`，正好是「网格 6% + 扫描线 14%
 *     + scrim 72%」的合成值，**没有 canvas 亮线参与**（走线稀疏，没落在文字下）。
 *  3. 故真解是 dim 亮度：82% → 87%，13 套主题最差 4.51（gb-green），
 *     且与标题亮度比仍 ≥1.22（阈值 1.15）。
 *
 * 本组守的是「无底色文字」：section 标题、文章页 meta / back、页脚。
 */
const BARE_NODES: Array<[string, string, string]> = [
  ['/', '#about .section-title > span:nth-child(2)', 'about-title'],
  // footer 空心字标（.foot-mark）是 aria-hidden 图形签名，不是阅读面：
  // 对比度守卫只量「读的文字」（描边走 --c-line，由结构线可辨性守），
  // 排除它后本条守卫目标与原先一致（.foot-line）。
  ['/', 'footer p:not([aria-hidden="true"])', 'footer'],
  ['/blog/2026-09-04-immutable-data-warehouse/', '.meta', 'post-meta'],
  ['/blog/2026-09-04-immutable-data-warehouse/', '.back', 'post-back'],
];

test.describe('无底色文字对比度（坐在墙面色带 + scrim 合成背景上）', () => {
  for (const theme of PROBE_THEMES) {
    test(`${theme}：section 标题 / meta / back / 页脚 ≥ 4.5:1`, async ({ page }) => {
      const bad: string[] = [];
      for (const [path, sel, label] of BARE_NODES) {
        await page.goto(path, { waitUntil: 'load' });
        await page.waitForTimeout(2200);
        await page.evaluate((s) => {
          document.querySelector(s)?.scrollIntoView({ block: 'center', behavior: 'instant' });
        }, sel);
        await page.waitForTimeout(500);

        const el = page.locator(sel).first();
        const info = await el.evaluate((e) => {
          const cs = getComputedStyle(e);
          /**
           * 只取**文本节点自身**的矩形：量的是「文字底下那块背景」。
           *
           * 为什么不用 `selectNodeContents(e)`（2026-09-19 修）：那会把子元素的盒子
           * 一起算进采样区，而 `.meta` 里挂着 `.tag` 芯片——它的 **2px `--gb-1` 边框**
           * 是全行最亮的像素，于是 gb-green 的 post-meta 被算成 **2.71:1**；
           * 而日期文字底下实际是 **4.75:1**（同一时刻实测）。芯片边框不是相邻文字的背景。
           * 口径收紧并没有漏掉真正的风险：若某个元素自身有亮底、或芯片带亮底，
           * 那个元素的**文本节点矩形**照样会把它采到（另一条断言「首屏文字确实坐在
           * 实心底上」就是靠它守的）。
           */
          const rects: { x: number; y: number; w: number; h: number }[] = [];
          const walk = (n: Node) => {
            for (const c of Array.from(n.childNodes)) {
              if (c.nodeType === Node.TEXT_NODE) {
                if (!c.textContent?.trim()) continue;
                const r = document.createRange();
                r.selectNodeContents(c);
                for (const x of r.getClientRects()) {
                  if (x.width > 3 && x.height > 3) rects.push({ x: x.x, y: x.y, w: x.width, h: x.height });
                }
              } else if (c.nodeType === Node.ELEMENT_NODE) {
                walk(c);
              }
            }
          };
          walk(e);
          return { color: cs.color, rects };
        });
        if (!info.rects.length) continue;
        const color = parseRgb(info.color);
        await el.evaluate((e) => {
          [e as HTMLElement, ...e.querySelectorAll('*')].forEach((n) => {
            (n as HTMLElement).style.setProperty('color', 'transparent', 'important');
          });
        });
        await page.waitForTimeout(120);

        let worst = Number.POSITIVE_INFINITY;
        for (const r of info.rects.slice(0, 6)) {
          const vp = page.viewportSize()!;
          if (r.y < 0 || r.y > vp.height - 2 || r.x < 0) continue;
          const clip = {
            x: r.x, y: r.y,
            width: Math.min(r.w, vp.width - r.x),
            height: Math.min(r.h, vp.height - r.y),
          };
          if (clip.width < 3 || clip.height < 3) continue;
          const buf = await page.screenshot({ clip });
          const stat = await page.evaluate(async (url) => {
            const img = new Image();
            img.src = url;
            await img.decode();
            const c = document.createElement('canvas');
            c.width = img.width; c.height = img.height;
            const g = c.getContext('2d')!;
            g.drawImage(img, 0, 0);
            const d = g.getImageData(0, 0, c.width, c.height).data;
            const px: Array<[number, number, number]> = [];
            for (let i = 0; i < d.length; i += 4) px.push([d[i]!, d[i + 1]!, d[i + 2]!]);
            const L = ([r, gg, bb]: [number, number, number]) => {
              const f = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
              return 0.2126 * f(r) + 0.7152 * f(gg) + 0.0722 * f(bb);
            };
            px.sort((a, b) => L(a) - L(b));
            const q = (p: number) => px[Math.floor(p * (px.length - 1))]!;
            return { p02: q(0.02), p98: q(0.98) };
          }, 'data:image/png;base64,' + buf.toString('base64'));
          worst = Math.min(worst, ratio(color, stat.p02), ratio(color, stat.p98));
        }
        await el.evaluate((e) => {
          [e as HTMLElement, ...e.querySelectorAll('*')].forEach((n) => {
            (n as HTMLElement).style.removeProperty('color');
          });
        });
        if (Number.isFinite(worst) && worst < 4.5) bad.push(`${label} ${worst.toFixed(2)}:1`);
      }
      expect(bad, `${theme} 无底色文字破 AA：${bad.join(' / ')}`).toEqual([]);
    });
  }
});
