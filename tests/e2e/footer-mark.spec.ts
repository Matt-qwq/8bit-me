import { expect, test } from '@playwright/test';

/**
 * footer 空心像素字标（homepage-optimization-v1 · B2）。
 *
 * 实现 = Zpix 48px + 填充透明 + 1px `-webkit-text-stroke`（描边走 --c-line token）。
 * 判据与被守的东西同源：**声明色 vs 实际画出来** —— computed stroke-color 必须
 * 等于 :root 上解析后的 --c-line（token 跟随，零字面量），填充必须真透明
 * （透明 = 空心；实心即实现跑偏），字号档位 48px（typography 白名单内）。
 */

test('字标：空心填充 + 1px --c-line 描边 + Zpix 48px + aria-hidden', async ({ page }) => {
  await page.goto('/');
  const mark = page.locator('footer .foot-mark');
  await expect(mark).toHaveText('8BIT-ME');
  await expect(mark).toBeVisible();
  await expect(mark).toHaveAttribute('aria-hidden', 'true');

  const s = await mark.evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      color: cs.color,
      strokeColor: cs.getPropertyValue('-webkit-text-stroke-color').trim(),
      strokeWidth: cs.getPropertyValue('-webkit-text-stroke-width').trim(),
      fontFamily: cs.fontFamily,
      fontSize: cs.fontSize,
    };
  });
const line = await page.evaluate(() =>
  getComputedStyle(document.documentElement).getPropertyValue('--c-line').trim()
);
// computed style 返回 rgb() 形式，token 源是 #hex —— 归一后比对（同 scrollbar.spec 手法）
const hexToRgb = (hex: string): string => {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
};

expect(s.color, '填充必须透明（空心）').toBe('rgba(0, 0, 0, 0)');
expect(s.strokeWidth).toBe('1px');
expect(s.strokeColor, '描边色 = 解析后的 --c-line（token 跟随，不许字面量）').toBe(
  hexToRgb(line)
);
  expect(s.fontFamily).toContain('Zpix');
  expect(s.fontSize).toBe('48px');
});

test('页脚三行都落在整数像素上（半像素会让 Zpix 的 1px 笔画整段发灰）', async ({ page }) => {
  // 2026-11-13 作者指出页脚「有点问题」后的实测：三行行盒顶分别是 x.594——
  // 来源是 0.6rem=9.6px / 0.4rem=6.4px 两个非整数外边距，外加 Zpix 48px 的
  // 字体盒是 56.064px（line-height 压不住）。半像素偏移下 1px 笔画会摊成 2px 灰边，
  // 而 horizontal 那套（pixel-grid.spec）只测字距，测不到竖直方向。
  await page.goto('/');
  await page.addStyleTag({ content: 'footer { --x: 0 }' });
  const ys = await page.evaluate(() => {
    window.scrollTo(0, 0);
    const f = document.querySelector('footer.footer')!;
    return ['foot-mark', 'foot-line', 'foot-credit'].map((c) => {
      const b = f.querySelector('.' + c)!.getBoundingClientRect();
      return { cls: c, top: +(b.top + window.scrollY).toFixed(3) };
    });
  });
  const bad = ys.filter((r) => Math.abs(r.top - Math.round(r.top)) > 0.02);
  expect(bad, '页脚行盒顶不在整数像素：' + bad.map((b) => b.cls + '=' + b.top).join(', ')).toEqual(
    []
  );
});

test('署名行与 © 行同用 Zpix（丝印标签不混系统黑体）', async ({ page }) => {
  await page.goto('/');
  const [line, credit] = await page.evaluate(() => {
    const f = document.querySelector('footer.footer')!;
    return ['.foot-line', '.foot-credit'].map(
      (s) => getComputedStyle(f.querySelector(s)!).fontFamily
    );
  });
  expect(line).toContain('Zpix');
  expect(credit, '署名行走回系统黑体（390px 下一行像素字一行黑体，一眼看出不属于这个站）').toContain(
    'Zpix'
  );
});
