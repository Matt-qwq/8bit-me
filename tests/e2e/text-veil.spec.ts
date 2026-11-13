import { expect, test } from '@playwright/test';
import { PNG } from 'pngjs';
import { scrollHeroToTopAndWaitTypewriter } from './helpers/hero';

/**
 * 「文本真的按声明颜色画出来了吗」—— 2026-09-19 新增。
 *
 * 起因（实测事故）：文章页标题的 `color` 计算值是 `rgb(233, 237, 247)`（近白），
 * 但**屏幕上最亮的像素只有 (45, 51, 67)**——被 `.bgfx-scrim` 压到 14% 亮度。
 * 根因是 CSS 绘制顺序：`.bgfx-scrim` 写的是 `position:absolute; z-index:0`，
 * 而**定位元素 z-index:0 会画在静态定位的块级内容之上**（它的代码注释却写着
 * 「canvas 之上、内容之下」——实现与意图相反）。文章头部的 `.head` 是静态定位，
 * 于是整个标题被 72% + 50% 的两层遮罩盖住；而 `.prose.pixel-panel` 是 `position:relative`，
 * 同层但 DOM 在后 ⇒ 画在 scrim 之上 ⇒ 面板里的正文一直是亮的。
 *
 * 为什么必须有这一条：**computed style 说亮 ≠ 屏幕上亮**。已有的排版守线全是
 * computed-style / 几何断言（`typography.spec.ts`、`pixel-grid.spec.ts`），
 * 它们对「有个东西盖在上面」完全无感——这次就是这么漏过去的。
 *
 * ⚠️ 当前状态（2026-09-19）：两条 `fixme` 就是**还没修的那条真缺陷**。
 * 不是守卫写错了：把那两处改成 `z-index: -1` 后它们立刻转绿（已实测）。
 * 卡住的原因是「不压内容」会连锁掀掉两个主题的 AA：`gb-green` / `dawnbringer-ember`
 * 的 dim 文字实测只有 3.02–3.78:1（把 dim 色提到 96% 也只到 4.34:1），
 * 而它们原本是靠 scrim 压暗背景（连同 CRT 扫描线的亮线）才达标的。
 * ⇒ 这是全局观感 + 主题调色板级决策，已上报作者；裁决后解开 fixme 即可。
 *
 * 判据：元素自身截图里**最亮的像素**必须达到其声明色的亮度的一定比例。
 * 用「最亮像素」而不是均值：抗锯齿与扫描线会让大多数像素变暗，但只要字形笔画里
 * 有一个像素画到位，就说明没有遮罩层；反之若被半透明层压住，**最亮像素也上不去**。
 */

/** 相对亮度（0–1，sRGB 加权；只用于「声明 vs 实测」的比例，不做对比度判定） */
function lum(r: number, g: number, b: number): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function parseColor(css: string): [number, number, number] {
  // `color-mix()` 的结果 Chrome 会序列化成 color(srgb 0.80 0.82 0.86)（0–1 分量），
  // 而普通色是 rgb()/rgba()（0–255）。两种都要收（站内多处用 color-mix 派生文本色）。
  const srgb = css.match(/color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
  if (srgb) return [1, 2, 3].map((i) => parseFloat(srgb[i]) * 255) as [number, number, number];
  const m = css.match(/rgba?\(([^)]+)\)/);
  if (!m) throw new Error(`无法解析颜色：${css}`);
  const [r, g, b] = m[1].split(',').map((x) => parseFloat(x));
  return [r, g, b];
}

/** 极性自适应探针（ADR-0021 后有明暗两档，两者都要守）：
 *  亮文字（DARK 档）→ 取最亮像素（历史事故 = 被压暗）；
 *  暗文字（LIGHT 档）→ 取最暗像素（对称事故 = 被提亮/洗白）。
 *  旧版只取最亮，LIGHT 档下最亮像素永远是浅背景 —— 主断言恒绿（假绿）。 */
function probePng(buf: Buffer, polarity: 'bright' | 'dark'): { r: number; g: number; b: number } {
  const png = PNG.sync.read(buf);
  let best = { r: 0, g: 0, b: 0 };
  let bestL = polarity === 'bright' ? -1 : Infinity;
  for (let i = 0; i < png.data.length; i += 4) {
    const [r, g, b] = [png.data[i], png.data[i + 1], png.data[i + 2]];
    const l = lum(r, g, b);
    const better = polarity === 'bright' ? l > bestL : l < bestL;
    if (better) {
      bestL = l;
      best = { r, g, b };
    }
  }
  return best;
}

/**
 * 实测校准（2026-09-19，dsf=1，修好装饰栈之后）：
 *   文章标题 / meta / 正文 / 列表页 h1 / 首页 h1 / 关于页标题 → 实测最亮像素 == 声明色（100%）
 * 阈值取 **0.85**：留给 CRT 扫描线（1px 暗线）与抗锯齿的余量，
 * 而故障态是 **0.14**，差着一个数量级 ⇒ 判得开。
 */
const MIN_RENDERED_RATIO = 0.85;

const TARGETS: { route: string; sel: string; name: string }[] = [
  { route: '/blog/2026-08-29-rpa-migration-methodology/', sel: 'article h1', name: '文章标题（静态定位，曾被 scrim 压到 14%）' },
  { route: '/blog/2026-08-29-rpa-migration-methodology/', sel: 'article .meta', name: '文章 meta 行' },
  { route: '/blog/2026-08-29-rpa-migration-methodology/', sel: 'article .prose p', name: '文章正文（面板内，reference）' },
  { route: '/blog/2026-09-19-ai-bottleneck-shift-postmortem/', sel: 'article h1', name: '新文章标题' },
  { route: '/blog/', sel: 'h1', name: '列表页标题' },
  { route: '/', sel: 'h1', name: '首页 hero 标题' },
  { route: '/about/', sel: 'h1, h2', name: '关于页标题' },
];

test.describe('文本真的按声明颜色画出来了（防装饰层压暗）', () => {
  for (const { route, sel, name } of TARGETS) {
    test(`${name}：${route} 的 ${sel}`, async ({ page }) => {

      await page.goto(route, { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
      if (route === '/') {
        // ADR-0027：hero 是第二章，且打字机等这一章进视口才开打——必须滚过去
        // 等落定，否则 h1 还带着 clip-path，截到的是空背景（探针会量到 ~30%）。
        await scrollHeroToTopAndWaitTypewriter(page);
      } else {
        await page.waitForTimeout(1200); // 背景 canvas / 入场动画落定
      }

      const el = page.locator(sel).first();
      await el.scrollIntoViewIfNeeded();
      await page.waitForTimeout(250);
      const box = await el.boundingBox();
      expect(box, `${sel} 没有盒模型`).not.toBeNull();

      const declared = parseColor(await el.evaluate((e) => getComputedStyle(e).color));
      const shot = await page.screenshot({
        clip: { x: box!.x, y: box!.y, width: Math.min(box!.width, 620), height: Math.min(box!.height, 40) },
      });
      const polarity: 'bright' | 'dark' =
        lum(...declared) > 0.5 ? 'bright' : 'dark';
      const got = probePng(shot, polarity);
      const ratio =
        polarity === 'bright'
          ? lum(got.r, got.g, got.b) / lum(...declared)
          : lum(...declared) / lum(got.r, got.g, got.b);

      expect(
        ratio,
        `声明色 rgb(${declared.join(',')}) 但实测极值像素是 rgb(${got.r},${got.g},${got.b})` +
          `（${(ratio * 100).toFixed(1)}%）—— 有半透明层盖在文本上（历史事故：.bgfx-scrim 的 z-index）`
      ).toBeGreaterThanOrEqual(MIN_RENDERED_RATIO);
    });
  }

  /**
   * 常驻反例自检：守卫必须能抓住「有东西盖在上面」。
   * 注入一层 70% 不透明的同色遮罩（等价于历史故障的机制），断言判红。
   * 没有这条，上面 7 条断言可能全是恒绿的（先例：2026-09-10 那条属性取错而恒绿的守卫）。
   */
  test('反例自检：盖一层 70% 遮罩必须被判红', async ({ page }) => {
    await page.goto('/blog/2026-08-29-rpa-migration-methodology/', { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(800);

    await page.addStyleTag({
      content: `article h1 { position: relative; } article h1::after {
        content: ''; position: absolute; inset: 0; pointer-events: none;
        /* 反例 = 历史事故的机制本身：一层压暗幕帘（固定深色，两档模式下都会把
           文字压到比声明色暗 —— 这正是本守卫侦察的失败方向） */
        background: color-mix(in srgb, #05081a 70%, transparent);
      }`,
    });
    await page.waitForTimeout(200);

    const el = page.locator('article h1').first();
    const box = await el.boundingBox();
    const declared = parseColor(await el.evaluate((e) => getComputedStyle(e).color));
    const shot = await page.screenshot({
      clip: { x: box!.x, y: box!.y, width: Math.min(box!.width, 620), height: Math.min(box!.height, 40) },
    });
    const polarity: 'bright' | 'dark' =
      lum(...declared) > 0.5 ? 'bright' : 'dark';
    const got = probePng(shot, polarity);
    const ratio =
      polarity === 'bright'
        ? lum(got.r, got.g, got.b) / lum(...declared)
        : lum(...declared) / lum(got.r, got.g, got.b);

    // 压暗幕帘把极值像素推离声明色（亮字档 → 低于 0.85；暗字档 → 高于 1.15）
    const judgedRed = ratio < MIN_RENDERED_RATIO || ratio > 1 / MIN_RENDERED_RATIO;
    expect(judgedRed, `反例没被判红（${(ratio * 100).toFixed(1)}%）：这条守卫是恒绿的，等于没守`).toBe(true);
  });
});
