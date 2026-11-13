import { expect, test, type Page } from '@playwright/test';

/**
 * 点阵图标复用面（homepage-optimization-v1 · B3，2026-10-02 作者指示）：
 * contact 三卡之外的 skills 九行行首 + footer 两处行内。
 *
 * 判据与 contact-cta 的图标条目同族：viewBox / 尺寸、crispEdges、rect>0 且 ≪225、
 * fill 解析 = accent token（零字面量随主题走）。skills 另守「行不换行」——
 * 9rem 列宽就是为行首图标留的，文字挤到换行 = 列宽白改（几何守卫量差值）。
 */

const hexToRgb = (hex: string): number[] => {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
};

/** fill 解析值必须 = accent token（同 contact-cta 的零字面量判据） */
const assertAccentFill = async (page: Page, fill: string, where: string) => {
  const accent = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--c-accent').trim()
  );
  const want = hexToRgb(accent);
  const got = fill.match(/\d+(\.\d+)?/g)!.map(Number);
  for (let c = 0; c < 3; c++) {
    expect(Math.abs(got[c]! - want[c]!), `${where} 通道 ${c} ≠ accent`).toBeLessThanOrEqual(1);
  }
};

test.describe('点阵图标复用（skills 行首 / footer）', () => {
  test('skills：九行行首各一枚图标（16px、crispEdges、fill=accent、行不换行）', async ({
    page,
  }) => {
    await page.goto('/', { waitUntil: 'load' });
    await page.evaluate(() =>
      document.querySelector('#skills')!.scrollIntoView({ block: 'center' })
    );
    await page.waitForTimeout(450); // reveal 浮入落定（变换不影响盒测量，但等稳）

    const rows = await page.evaluate(() =>
      [...document.querySelectorAll('#skills .skills .row')].map((li) => {
        const svg = li.querySelector('.label svg')!;
        const rects = svg.querySelectorAll('rect');
        return {
          w: svg.getBoundingClientRect().width,
          h: svg.getBoundingClientRect().height,
          viewBox: svg.getAttribute('viewBox'),
          crisp: svg.getAttribute('shape-rendering'),
          rectCount: rects.length,
          fill: getComputedStyle(rects[0]!).fill,
          rowH: li.getBoundingClientRect().height,
          label: (li.querySelector('.label')!.textContent ?? '').trim(),
        };
      })
    );
    expect(rows, 'siteConfig.skills 九行，行行都该有行首图标').toHaveLength(9);
    for (const r of rows) {
      expect(r.viewBox, `${r.label}：viewBox 不是 15 格`).toBe('0 0 15 15');
      expect(r.w, `${r.label}：图标宽 ${r.w} ≠ 16`).toBeCloseTo(16, 1);
      expect(r.h, `${r.label}：图标高 ${r.h} ≠ 16`).toBeCloseTo(16, 1);
      expect(r.crisp, `${r.label}：缺 crispEdges`).toBe('crispEdges');
      expect(r.rectCount, `${r.label}：rect 数异常`).toBeGreaterThan(0);
      expect(r.rectCount, `${r.label}：rect 数逼近逐格（行程合并失效）`).toBeLessThan(80);
      expect(
        r.rowH,
        `${r.label}：行高 ${r.rowH}px → 文字换行，9rem 列宽失守`
      ).toBeLessThanOrEqual(24);
      await assertAccentFill(page, r.fill, `${r.label} 图标 fill`);
    }
    // 文本还在图标旁（图标是行首缀，不是替代）
    expect(rows[0]!.label).toContain('Python');
  });

  test('footer：字标行火箭 + 署名行字模 A（15px、crispEdges、fill=accent、两枚不同图）', async ({
    page,
  }) => {
    await page.goto('/', { waitUntil: 'load' });
    await page.evaluate(() =>
      document.querySelector('footer.footer')!.scrollIntoView({ block: 'end' })
    );
    await page.waitForTimeout(450);

    const m = await page.evaluate(() => {
      const grab = (sel: string) => {
        const svg = document.querySelector(`${sel} svg.foot-icon`)!;
        const rects = svg.querySelectorAll('rect');
        return {
          w: svg.getBoundingClientRect().width,
          h: svg.getBoundingClientRect().height,
          crisp: svg.getAttribute('shape-rendering'),
          rectCount: rects.length,
          fill: getComputedStyle(rects[0]!).fill,
        };
      };
      return { line: grab('.foot-line'), credit: grab('.foot-credit') };
    });
    for (const [where, it] of [
      ['字标行火箭', m.line],
      ['署名行字模 A', m.credit],
    ] as const) {
      expect(it.w, `${where}：宽 ${it.w} ≠ 15`).toBeCloseTo(15, 1);
      expect(it.h, `${where}：高 ${it.h} ≠ 15`).toBeCloseTo(15, 1);
      expect(it.crisp, `${where}：缺 crispEdges`).toBe('crispEdges');
      expect(it.rectCount, `${where}：rect 数异常`).toBeGreaterThan(0);
      await assertAccentFill(page, it.fill, where);
    }
    // 两处是两枚不同的图（火箭 ≠ 字模 A）——行程数不同即自然成立，明确断一次
    expect(m.line.rectCount).not.toBe(m.credit.rectCount);
  });
});
