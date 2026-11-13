import { expect, test, type Page } from '@playwright/test';

/**
 * 像素排版可读性层（typography scale）—— 浏览器里的计算样式契约
 *
 * 与 tests/unit/typography-scale.spec.ts 分工：
 *   单测守源码不变量（字号档位 / 行高配对 / 3px 边框清零）；
 *   本文件守「真的级联成那样」——computed style 是级联的最终结果，
 *   能抓住「单测过了但选择器没命中 / 被更高优先级覆盖」这类静默失效。
 *
 * 数值来源：docs/research/pixel-typography-readability.md A2.3 / A2.4 / B3 / C2。
 * 断言的取值口径：行高必须是 4px 阶（28 / 24 / 20 / 16px），字号回到 12px 格
 * （12 / 14 / 16 / 18 / 20px），不是「看着差不多」。
 */

/** 从 /blog 按列表顺序找一篇同时含 h2、h3、pre、多项列表、行内 code 的已发布文章。
 *  不写死 slug：文章会增删改，写死会让测试随内容变动假红。 */
async function openRichPost(page: Page): Promise<string> {
  await page.goto('/blog', { waitUntil: 'load' });
  const hrefs = await page
    .locator('.tl-item .card h3 a')
    .evaluateAll((els) =>
      els
        .map((el) => el.getAttribute('href'))
        .filter((h): h is string => !!h && h.includes('/blog/'))
    );
  expect(hrefs.length, '/blog 应至少有一篇已发布文章').toBeGreaterThan(0);

  for (const href of hrefs) {
    await page.goto(href, { waitUntil: 'load' });
    const rich = await page.evaluate(
      () =>
        !!document.querySelector('.prose h2') &&
        !!document.querySelector('.prose h3') &&
        !!document.querySelector('.prose pre') &&
        !!document.querySelector('.prose li + li') &&
        !!document.querySelector('.prose p code, .prose li code')
    );
    if (rich) return href;
  }
  throw new Error('没有找到同时含 h2/h3/pre/多项列表/行内 code 的已发布文章');
}

test.describe('排版可读性：正文型阶', () => {
  test('正文/标题行高落在 4px 阶，代码块边框回到 4px', async ({ page }) => {
    await openRichPost(page);

    const got = await page.evaluate(() => {
      const style = (sel: string, prop: string): string | null => {
        const el = document.querySelector(sel);
        return el ? getComputedStyle(el).getPropertyValue(prop) : null;
      };
      return {
        pLine: style('.prose p', 'line-height'),
        h2Size: style('.prose h2', 'font-size'),
        h2Line: style('.prose h2', 'line-height'),
        h3Size: style('.prose h3', 'font-size'),
        h3Line: style('.prose h3', 'line-height'),
        preBorder: style('.prose pre', 'border-top-width'),
        inlineCodeSize: style('.prose p code, .prose li code', 'font-size'),
        liGap: style('.prose li + li', 'margin-top'),
      };
    });

    // 正文 16px → 28px（4px 阶；原 1.7 会算出 27.2px）
    expect(got.pLine).toBe('28px');
    // prose h2 18px/24px（作者 2026-09-08 反馈下调一档）
    expect(got.h2Size).toBe('18px');
    expect(got.h2Line).toBe('24px');
    // prose h3 16px/24px（与正文同档，靠 700 字重区分）
    expect(got.h3Size).toBe('16px');
    expect(got.h3Line).toBe('24px');
    // 代码块边框与全站细线语言一致
    expect(got.preBorder).toBe('1px');
    // 行内 code：0.875em × 16px = 14px
    expect(got.inlineCodeSize).toBe('14px');
    // 列表项间距 0.5em = 8px（真的生效，不是只写了规则）
    expect(Number.parseFloat(got.liGap ?? '0')).toBeGreaterThan(0);
  });

  test('375px 窄屏：正文 14px / 行高仍是 28px（4px 阶不随断点破格）', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/', { waitUntil: 'load' });

    const got = await page.evaluate(() => {
      const cs = getComputedStyle(document.body);
      return { size: cs.fontSize, line: cs.lineHeight };
    });

    expect(got.size).toBe('14px');
    expect(got.line).toBe('28px');
  });
});

test.describe('断行策略：末行不落孤字', () => {
  /** 按 top 归并 range 矩形 → 行盒；返回末行占正文列宽的比例。
   *  forceAuto 用来自证判据有效（把 pretty 关掉必须重新出现孤字）。 */
  const lastLineRatio = (page: Page, selector: string, forceAuto: boolean) =>
    page.evaluate(
      ({ sel, force }) => {
        const el = document.querySelector(sel) as HTMLElement | null;
        if (!el) return null;
        const prev = el.style.textWrap;
        if (force) el.style.textWrap = 'auto';
        const cs = getComputedStyle(el);
        const contentWidth =
          el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
        const range = document.createRange();
        range.selectNodeContents(el);
        const rects = [...range.getClientRects()].filter((r) => r.width > 1);
        // 一个行盒可能因行内 <a> 分裂成多个矩形 → 按 top 归并
        const lines = new Map<number, { left: number; right: number }>();
        for (const r of rects) {
          const key = Math.round(r.top);
          const cur = lines.get(key) ?? { left: Number.POSITIVE_INFINITY, right: Number.NEGATIVE_INFINITY };
          lines.set(key, {
            left: Math.min(cur.left, r.left),
            right: Math.max(cur.right, r.right),
          });
        }
        const tops = [...lines.keys()].sort((a, b) => a - b);
        const last = lines.get(tops[tops.length - 1]);
        const ratio = last ? (last.right - last.left) / contentWidth : 1;
        el.style.textWrap = prev;
        return { ratio, lineCount: tops.length, wrap: cs.textWrap };
      },
      { sel: selector, force: forceAuto }
    );

  test('skills 尾注：balance 生效且末行不再是孤字（含反例自检）', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/', { waitUntil: 'load' });
    await page.locator('#skills').scrollIntoViewIfNeeded();

    const balanced = await lastLineRatio(page, '#skills .note', false);
    expect(balanced, '#skills .note 应存在').not.toBeNull();
    // Chrome 实测：全局 p 的 pretty 对本段几乎无效（0.076 → 0.098），
    // 真正拉平的是 .note 自己的 balance —— 所以这里守 balance，不守 pretty。
    expect(balanced!.wrap, '尾注应级联到 text-wrap: balance').toBe('balance');
    expect(balanced!.lineCount, '尾注应至少折成两行（否则这条断言量不到断行）').toBeGreaterThan(1);

    const auto = await lastLineRatio(page, '#skills .note', true);

    // 反例：退回 auto 时末行只剩「GitHub。」（实测 0.076 行宽）——
    // 若这条不成立，说明判据量不到孤字，上面的绿是假绿。
    expect(auto!.ratio, '关掉 balance 应重新出现孤字（反例自检）').toBeLessThan(0.25);
    expect(balanced!.ratio, 'balance 生效后末行应至少占 1/2 行宽').toBeGreaterThan(0.5);
  });

  test('标题组级联到 text-wrap: balance', async ({ page }) => {
    await page.goto('/', { waitUntil: 'load' });
    const got = await page.evaluate(() => {
      const h2 = document.querySelector('#skills .section-title');
      const p = document.querySelector('#about p');
      return {
        h2: h2 ? getComputedStyle(h2).textWrap : null,
        p: p ? getComputedStyle(p).textWrap : null,
      };
    });
    expect(got.h2).toBe('balance');
    expect(got.p, '正文段落仍应级联到 pretty（长文不拉平）').toBe('pretty');
  });
});
