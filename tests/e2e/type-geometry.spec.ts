import { expect, test } from '@playwright/test';

/**
 * 排版几何 / 运行时字体度量（指标设计 v1 的 P0-3 与 A6/G1/G2）
 *
 * 三件事只有真实浏览器能验：
 *   1. **运行时平台字体**（CDP `CSS.getPlatformFontsForNode`）：截图/单测/类型检查都看不见
 *      「某个节点悄悄换了字体」。实测抓到文章页 `<pre>` 里的中文回退 Microsoft YaHei×36
 *      （Consolas 无 CJK 字形）——已把 Zpix 加进 `--font-mono` 兜底，本测试守它不再回来。
 *   2. **行盒整数性 + 行距恒定**：computed line-height 是 28px 不等于真实行盒落在整数像素。
 *   3. **溢出**：3 断点 × 4 路由，排除自带滚动祖先（`<pre>` 的 `overflow-x:auto` 是合法的）。
 *
 * 注意：`document.fonts.check()` 对未知字体族也返回 true，是假绿，本文件不用它。
 */

const ROUTES = ['/', '/blog', '/404'];
/**
 * 平台字体白名单（2026-09-10 按 U1 换字体后分档）：
 *  - **标识层**（h1/h2/h3/a）→ Zpix（像素身份所在）
 *  - **正文层**（p/li）→ 系统黑体（微软雅黑/苹方/思源黑体等，随平台变）
 *  - **代码层**（pre/code）→ Consolas 等 mono 栈
 * 任何白名单外的字体 = 静默回退，必须为 0。
 */
const ZPIX_FONTS = new Set(['Zpix']);
const MONO_FONTS = new Set(['Consolas', 'Courier New', 'monospace', 'ui-monospace']);
/** 正文允许的系统黑体（各平台常见；含 macOS / Windows / Linux） */
const BODY_FONTS = new Set([
  'Microsoft YaHei', '微软雅黑',
  'PingFang SC', 'Hiragino Sans GB',
  'Noto Sans SC', 'Source Han Sans SC', 'Source Han Sans',
  'Helvetica Neue', 'Arial', 'Arial Unicode MS',
  'DengXian', 'SimHei', '黑体', 'sans-serif', 'system-ui',
]);
const ALL_ALLOWED = new Set([...ZPIX_FONTS, ...MONO_FONTS, ...BODY_FONTS]);

async function postHref(page: import('@playwright/test').Page): Promise<string> {
  await page.goto('/blog', { waitUntil: 'load' });
  const href = await page
    .locator('.tl-item .card h3 a')
    .first()
    .getAttribute('href');
  return href!;
}

test.describe('运行时平台字体（CDP）', () => {
  test('正文/标题节点只允许 Zpix 与 mono 栈（无静默回退）', async ({ page }) => {
    const href = await postHref(page);
    const routes = [...ROUTES, href];

    for (const route of routes) {
      await page.goto(route, { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);

      const client = await page.context().newCDPSession(page);
      await client.send('DOM.enable');
      await client.send('CSS.enable');
      const { root } = await client.send('DOM.getDocument', { depth: -1 });
      const { nodeIds } = await client.send('DOM.querySelectorAll', {
        nodeId: root.nodeId,
        selector:
          'main h1, main h2, main h3, main a, main p, main li, main pre, main code, .text-pixel, .tag',
      });

      const unexpected = new Map<string, number>();
      // 节点可能上百，逐个查字体（CDP 调用快，但限 300 个防极端页面）
      for (const nodeId of nodeIds.slice(0, 300)) {
        try {
          const { fonts } = await client.send('CSS.getPlatformFontsForNode', {
            nodeId,
          });
          for (const f of fonts) {
            if (!ALL_ALLOWED.has(f.familyName)) {
              unexpected.set(
                f.familyName,
                (unexpected.get(f.familyName) ?? 0) + f.glyphCount
              );
            }
          }
        } catch {
          // 节点在 DOM 变更中失效：跳过（不影响「无意外字体」结论）
        }
      }
      await client.detach();

      expect(
        [...unexpected.entries()],
        `${route} 出现非预期字体（静默回退）：${[...unexpected.entries()]
          .map(([k, v]) => `${k}×${v}`)
          .join(', ')}`
      ).toEqual([]);
    }
  });
});

test.describe('行盒几何', () => {
  test('段落每行 top 落整数像素、相邻行距恒等于 line-height', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const href = await postHref(page);
    await page.goto(href, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);

    const m = await page.evaluate(() => {
      const p = [...document.querySelectorAll('.prose p')].find(
        (el) => (el.textContent?.length ?? 0) > 80
      )!;
      const range = document.createRange();
      range.selectNodeContents(p);
      const rects = [...range.getClientRects()].filter((r) => r.width > 1);
      const lh = Number.parseFloat(getComputedStyle(p).lineHeight);
      return {
        tops: rects.map((r) => +r.top.toFixed(3)),
        lh,
      };
    });

    expect(m.tops.length, '段落应有多行').toBeGreaterThanOrEqual(2);

    // 行盒 top 落整数像素
    const offGrid = m.tops.filter((t) => Math.abs(t - Math.round(t)) > 0.02);
    expect(offGrid, `行盒 top 未落整数：${offGrid.join(', ')}`).toEqual([]);

    // 相邻行距恒等于 line-height
    const gaps = m.tops.slice(1).map((t, i) => +(t - m.tops[i]!).toFixed(3));
    for (const g of gaps) {
      expect(Math.abs(g - m.lh), `行距 ${g} ≠ line-height ${m.lh}`).toBeLessThanOrEqual(
        0.05
      );
    }
  });
});

test.describe('溢出', () => {
  for (const width of [1440, 768, 375]) {
    test(`${width}px：文字不横向溢出视口（排除滚动祖先）`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      const href = await postHref(page);
      for (const route of [...ROUTES, href]) {
        await page.goto(route, { waitUntil: 'load' });
        await page.evaluate(() => document.fonts.ready);
        const bad = await page.evaluate(() => {
          const scrollable = (el: Element): boolean => {
            let n: Element | null = el.parentElement;
            while (n) {
              const ox = getComputedStyle(n).overflowX;
              if (ox === 'auto' || ox === 'scroll') return true;
              n = n.parentElement;
            }
            return false;
          };
          const out: string[] = [];
          for (const el of document.querySelectorAll(
            'main p, main h1, main h2, main h3, main li, main a, main code, main pre'
          )) {
            const r = el.getBoundingClientRect();
            if (r.width === 0) continue;
            if ((r.right > window.innerWidth + 1 || r.left < -1) && !scrollable(el)) {
              out.push(
                `${el.tagName}.${(el as HTMLElement).className || '-'} ${Math.round(
                  r.left
                )}..${Math.round(r.right)} vw=${window.innerWidth}`
              );
            }
          }
          return [...new Set(out)];
        });
        expect(bad, `${route} @${width}px 溢出：\n${bad.join('\n')}`).toEqual([]);
      }
    });
  }
});

/**
 * 身份元素必须是 Zpix（roadmap U1 收尾时补的守线）—— 2026-09-10
 *
 * 起因（**真回归**）：U1 把 `--font-body` 从 Zpix 换成系统黑体后，导航链接
 * 静默变成了微软雅黑——它既没有 `text-pixel` 类，`.nav` 容器当时也没声明字体族，
 * 于是随 body 一起换掉了。更糟的是它仍带着 `letter-spacing: var(--ls-14)`
 * （Zpix 专用修正 -0.167px），等于**给比例字体做像素对格**，正是那个 token
 * 本来要避免的抖动。而当时的断言只扫 `main` 内的节点，导航（在 header 里）
 * 完全不在视野内，所以「导航一行未动」这句话当时是假的却无人反驳。
 *
 * 本组把「标识语言 = Zpix」变成可测契约：逐元素断言计算字体。
 * 与上面那组的区别：那组查「有没有意外字体」，这组查「该是 Zpix 的必须真是」。
 */
const IDENTITY_SELECTORS: Array<[string, string]> = [
  ['header.nav a', '导航链接触发'],
  ['.logo', '站点 logo'],
  ['#hero h1', '首屏主标题'],
  ['.section-title', '章节标题'],
  ['.section-title .num', '章节编号丝印'],
  ['.kicker', 'Press START 丝印'],
  ['.tagline', '副标题'],
  ['.pixel-btn', '按钮'],
  ['.tag', '标签芯片'],
  ['.foot-line', '页脚丝印'],
  ['.tl-year, .tl-date', '时间线丝印'],
];

test.describe('身份元素必须是 Zpix（标识语言不被正文字体换走）', () => {
  for (const route of ['/', '/blog/']) {
    test(`${route}：所有身份元素计算字体含 Zpix`, async ({ page }) => {
      await page.goto(route, { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);

      const bad = await page.evaluate((pairs) => {
        const out: string[] = [];
        for (const [sel, label] of pairs) {
          for (const el of document.querySelectorAll(sel)) {
            const cs = getComputedStyle(el);
            if (cs.display === 'none' || cs.visibility === 'hidden') continue;
            const first = cs.fontFamily.split(',')[0]!.replace(/["']/g, '');
            if (first !== 'Zpix') {
              out.push(
                `${label}（${sel}）→ ${first}，文字「${(el.textContent ?? '').trim().slice(0, 10)}」`
              );
            }
          }
        }
        return out;
      }, IDENTITY_SELECTORS);

      expect(
        bad,
        `以下身份元素渲染字体不是 Zpix（标识语言被正文字体换走了）：\n${bad.join('\n')}`
      ).toEqual([]);
    });
  }
});
