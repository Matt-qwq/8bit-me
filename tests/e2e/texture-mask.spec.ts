import { expect, test } from '@playwright/test';

/**
 * 装饰层遮罩测试（texture mask）—— 铁律第一条的浏览器级守线（ADR-0015）
 *
 * 判据（docs/specs/line-hierarchy.md §四）：**装饰层不得成为结构线可辨性的来源**。
 *
 * 为什么要**真采样像素**：结构线的 `border-color` 等计算样式天然不依赖
 * `body::before`（墙面色带，ADR-0021 后的唯一常驻装饰层），拿 computed style 对比
 * 会**永远通过**——那是假绿。装饰层能影响的只有一件事：
 * **结构线与其邻域背景的像素对比度**。
 *
 * 为什么不是「变化 = 0」：装饰层本身就是一层 scrim，它**会**轻微改变合成亮度
 * （实测遮罩后结构线对比度反而略升）。真正的不变量是两条：
 *   ① 遮罩后结构线仍独立可辨（WCAG 对比度 ≥ 3:1）——装饰层不是它可辨的原因；
 *   ② 遮罩不能让对比度**跌**下去——若跌了，说明装饰层在承担结构功能。
 *
 * 背景：铁律原写「氛围是否来自背景？必须否」是绝对禁令，它判死本站自己的 6% 网格
 * 与 14% 扫描线（实测 1.11–1.19 / 1.29–1.51）——自相矛盾。09-10 改为预算制：
 * 允许存在，但**不得抢结构线**。本测试就是这条的机器判据。
 */

/** 隐藏全部常驻装饰层（含 BgFx canvas——它是背景里对比度最高的元素，
 *  2026-09-10 账本对齐时补入；此前「遮罩后结构线 ≥3:1」是在 canvas 还在时通过的）。 */
async function hideTexture(page: import('@playwright/test').Page) {
  await page.addStyleTag({
    content: `
      body::before { display: none !important; }
      .bgfx-canvas { display: none !important; }
    `,
  });
  await page.waitForTimeout(150);
}

/**
 * 采样 .pixel-panel 的顶缘受光带（2px accent）与其正上方背景带，
 * 返回两带的平均 RGB —— 由测试侧算 WCAG 对比度。
 * 采样目标用 #about（首页首个不在 canvas 免遮区里的面板——hero 面板顶在
 * 亮天空前，dark 档的金色受光带对亮天空本来就读作「装饰」，不是结构线）。
 */
async function sampleBorderBands(page: import('@playwright/test').Page, sel = '.pixel-panel') {
  const panel = page.locator(sel).first();
  await panel.scrollIntoViewIfNeeded();
  await page.waitForTimeout(150);
  const box = await panel.boundingBox();
  if (!box) throw new Error(`${sel} 不存在，无法采样`);

  const viewport = page.viewportSize() ?? { width: 1280, height: 720 };
  // 上方 6px 背景 + 下方 2px 受光带，避开圆角；同时夹到视口内
  const clip = {
    x: Math.min(Math.max(0, box.x + 12), viewport.width - 4),
    y: Math.min(Math.max(0, box.y - 6), viewport.height - 8),
    width: Math.max(4, Math.min(60, box.width - 24, viewport.width - box.x - 12)),
    height: 8,
  };
  const buf = await page.screenshot({ clip });

  return page.evaluate(
    async ({ data }) => {
      const img = new Image();
      img.src = 'data:image/png;base64,' + data;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const px = ctx.getImageData(0, 0, c.width, c.height).data;
      const avg = (from: number, to: number) => {
        let r = 0;
        let g = 0;
        let b = 0;
        let n = 0;
        for (let y = from; y < to; y++) {
          for (let x = 0; x < c.width; x++) {
            const i = (y * c.width + x) * 4;
            r += px[i]!;
            g += px[i + 1]!;
            b += px[i + 2]!;
            n++;
          }
        }
        return [r / n, g / n, b / n];
      };
      // clip 高 8px：上 6px 是面板外背景，下 2px 是顶缘受光带
      return {
        bg: avg(0, c.height - 2),
        border: avg(c.height - 2, c.height),
      };
    },
    { data: buf.toString('base64') }
  );
}

/** WCAG 相对亮度（输入 0–255 平均 RGB） */
function relLum([r, g, b]: number[]): number {
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!);
}

function contrast([a, b]: [number[], number[]]): number {
  const l1 = relLum(a);
  const l2 = relLum(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/** 结构线描边必须达到的可辨阈值（WCAG 非文本对比 3:1） */
const MIN_STRUCTURE_CONTRAST = 3.0;

test.describe('装饰层遮罩：结构线的可辨性不依赖装饰层', () => {
  for (const route of ['/', '/blog']) {
    test(`${route}：遮罩后结构线仍 ≥3:1，且对比度不跌`, async ({ page }) => {
      await page.goto(route);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(400);

      const sel = route === '/' ? '#about .pixel-panel' : '.pixel-panel';
      const beforeBands = await sampleBorderBands(page, sel);
      const before = contrast([beforeBands.border, beforeBands.bg]);

      await hideTexture(page);
      const afterBands = await sampleBorderBands(page, sel);
      const after = contrast([afterBands.border, afterBands.bg]);

      // ① 装饰层不是结构线可辨的原因：摘掉它仍 ≥3:1
      expect(
        after,
        `${route} 摘掉装饰层后结构线不可辨（对比度 ${after.toFixed(2)}:1 < ${MIN_STRUCTURE_CONTRAST}）`
      ).toBeGreaterThanOrEqual(MIN_STRUCTURE_CONTRAST);
      // ② 装饰层不得「帮」结构线变清楚：摘掉后对比度不能跌（它是 scrim，只会略微压平）
      expect(
        after,
        `${route} 装饰层在承担结构功能：遮罩前 ${before.toFixed(2)}:1 → 遮罩后 ${after.toFixed(2)}:1`
      ).toBeGreaterThanOrEqual(before - 0.05);
    });
  }

  test('装饰层确实被隐藏（防止选择器失效导致假绿）', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const beforeState = await page.evaluate(() => {
      const b = getComputedStyle(document.body, '::before');
      const cv = document.querySelector('.bgfx-canvas');
      return {
        wall: b.display,
        wallBg: b.backgroundImage.slice(0, 30),
        canvas: cv ? getComputedStyle(cv).display : 'missing',
      };
    });
    expect(beforeState.wall, 'body::before 应存在且可见').not.toBe('none');
    expect(beforeState.wallBg, 'body::before 应有色带背景（否则测的是空气）').toContain('gradient');
    expect(beforeState.canvas, '.bgfx-canvas 应存在且可见').not.toBe('none');

    await hideTexture(page);
    const afterState = await page.evaluate(() => {
      const b = getComputedStyle(document.body, '::before');
      const cv = document.querySelector('.bgfx-canvas');
      return {
        wall: b.display,
        canvas: cv ? getComputedStyle(cv).display : 'missing',
      };
    });
    expect(afterState.wall, '遮罩后 body::before 应为 none').toBe('none');
    expect(afterState.canvas, '遮罩后 .bgfx-canvas 应为 none').toBe('none');
  });
});
