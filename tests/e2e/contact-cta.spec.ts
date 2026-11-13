import { expect, test } from '@playwright/test';

/**
 * contact 主 CTA 可点感（homepage-optimization-v1 · C1，2026-10-01 作者「先把简单的做了」）。
 *
 * 核实结论（2026-10-01 实测）：按钮文字是亮色、对卡片底对比度达标——「明度低读不可点」
 * 不成立；真弱点是 **idle 硬投影只有 45% 线色，几乎隐形**，而填充与卡片同色
 * （1:1 实测），按键失去「浮起」感。
 *
 * 修法（线语言内、不动描边结构）：idle / hover 的 2px 硬投影提到**满强线色 / 满强
 * 强调色**——空芯描边 + 满色硬投影 = 像素按键的「未点亮浮起」态（hover 才通电，
 * accent 不进常态）。填充保持与卡片同色是**状态语言的故意**（未点亮=描边空芯），
 * 本用例把这两个决定一起钉死。
 *
 * 判据口径：投影颜色连 **alpha 一起断**——45% 半强混合的 rgb 通道与满色相同，
 * 只查通道会假绿（改前红 = alpha 0.45 不达标）。
 */

const hexToRgb = (hex: string): number[] => {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
};

/** 投影里每个颜色字面量 → {r,g,b,a}（a 缺省 = 1） */
const shadowColors = (shadow: string): Array<{ rgb: number[]; a: number }> =>
  [...shadow.matchAll(/rgba?\(([^)]+)\)/g)].map((m) => {
    const parts = m[1]!.split(',').map((v) => parseFloat(v));
    return { rgb: parts.slice(0, 3), a: parts.length > 3 ? parts[3]! : 1 };
  });

const hasFullColor = (shadow: string, hex: string): boolean => {
  const rgb = hexToRgb(hex);
  return shadowColors(shadow).some(
    ({ rgb: c, a }) =>
      a >= 0.99 &&
      c.every((v, i) => Math.abs(v - rgb[i]!) <= 1)
  );
};

const varOf = (page: import('@playwright/test').Page, name: string) =>
  page.evaluate((n) =>
    getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name
  );

test('CTA idle：满强线色硬投影（浮起感）+ 填充与卡片同色（空芯状态语言）', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    document.getElementById('contact')?.scrollIntoView({ behavior: 'instant' });
  });
  const btn = page.locator('#contact .pixel-btn').first();
  const { shadow, bg, cardBg } = await btn.evaluate((el) => ({
    shadow: getComputedStyle(el).boxShadow,
    bg: getComputedStyle(el).backgroundColor,
    cardBg: getComputedStyle(el.closest('.pixel-panel')!).backgroundColor,
  }));

  const line = await varOf(page, '--c-line');
  expect(
    hasFullColor(shadow, line),
    `idle 投影应含满强线色 ${line}（实际投影：${shadow}）`
  ).toBe(true);

  // 状态语言：填充 = 卡片底（空芯），不许有人手痒给 idle 上底色差
  expect(bg, 'idle 填充应与卡片同色（空芯）').toBe(cardBg);
});

test('CTA hover：accent 通电（满强强调色投影 + 底缘 inset）', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    document.getElementById('contact')?.scrollIntoView({ behavior: 'instant' });
  });
  const btn = page.locator('#contact .pixel-btn').first();
  await btn.hover();
  const shadow = await btn.evaluate((el) => getComputedStyle(el).boxShadow);
  const accent = await varOf(page, '--c-accent');
  expect(
    hasFullColor(shadow, accent),
    `hover 投影应含满强强调色 ${accent}（实际投影：${shadow}）`
  ).toBe(true);
  expect(shadow, 'hover 保留底缘通电条').toContain('inset');
});

test('渠道图注（A2）：每个渲染的按钮都有同序对应的图注行，且值非空', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    document.getElementById('contact')?.scrollIntoView({ behavior: 'instant' });
  });

  // 按钮与图注同源自 social.label：按钮序 = 图注序（TIMEZONE 在图注之后）
  const btnLabels = (
    await page.locator('#contact .links .pixel-btn').allTextContents()
  ).map((s) => s.trim().toLowerCase());
  const metaKeys = (await page.locator('#contact .meta .meta-k').allTextContents()).map(
    (s) => s.trim().toLowerCase()
  );
  expect(metaKeys.length, '图注行数 = 按钮数 + TIMEZONE 行').toBe(btnLabels.length + 1);
  expect(
    metaKeys.slice(0, btnLabels.length),
    `图注键应与按钮一一对应（按钮：${btnLabels.join('/')}，图注：${metaKeys.join('/')}）`
  ).toEqual(btnLabels);
  expect(metaKeys[metaKeys.length - 1]).toBe('timezone');

  // 值非空（键存在但值缺失 = 图注失效）
  for (let i = 0; i < btnLabels.length; i++) {
    const v = await page.locator('#contact .meta .meta-v').nth(i).textContent();
    expect(v?.trim(), `图注 ${metaKeys[i]} 的值不应为空`).not.toBe('');
  }
});

test('渠道图标（B3）：每个按钮内联 15×15 点阵 SVG，accent 单色随主题', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    document.getElementById('contact')?.scrollIntoView({ behavior: 'instant' });
  });

  const buttons = page.locator('#contact .links .pixel-btn');
  const n = await buttons.count();
  for (let i = 0; i < n; i++) {
    const svg = buttons.nth(i).locator('svg');
    await expect(svg, `按钮 ${i} 应含内联图标`).toHaveCount(1);
    const info = await svg.evaluate((el) => {
      const rects = el.querySelectorAll('rect');
      const cs = getComputedStyle(rects[0]!);
      return {
        viewBox: el.getAttribute('viewBox'),
        rectCount: rects.length,
        fill: cs.fill,
        crisp: el.getAttribute('shape-rendering'),
      };
    });
    expect(info.viewBox).toBe('0 0 15 15');
    expect(info.rectCount, '行程合并后 rect 数应 >0 且远小于 225').toBeGreaterThan(0);
    expect(info.rectCount).toBeLessThan(80);
    expect(info.crisp).toBe('crispEdges');
    // fill 解析 = accent token（零字面量，随主题走）
    const accent = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--c-accent').trim()
    );
    const h = accent.replace('#', '');
    const rgb = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
    const got = info.fill.match(/\d+(\.\d+)?/g)!.map(Number);
    for (let c = 0; c < 3; c++) expect(Math.abs(got[c]! - rgb[c]!)).toBeLessThanOrEqual(1);
  }
});
