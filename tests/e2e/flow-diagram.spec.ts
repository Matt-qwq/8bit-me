import { expect, test } from '@playwright/test';

/**
 * 文章字符图（```flow）的**浏览器层**可读度量
 *
 * 为什么源码层的度量（`tests/unit/flow-diagram.spec.ts`）还不够：
 *   那边读的是 `[slug].astro` 里的声明，看不见**层叠**。同一个文件里就有
 *   `.prose :global(pre code) { font-size: .875rem; line-height: 20px }`，
 *   一旦选择器特异性翻转，源码层照样全绿，而页面上图已经变形。
 *
 * 这里量的是**渲染结果**，三层口径：
 *   ① 计算样式（层叠后的真值）
 *   ② DOM 行盒几何（相邻行间距、全角格前进量 —— 对格的物理前提）
 *   ③ canvas 像素扫描出的**真实墨迹间隙**（2026-09-11 作者回报「字都粘一起了」，
 *      当时行高 1em = 12px，而 Zpix 汉字墨高 11px → 行间只剩 1px）
 *
 * 量墨迹的两个坑（都踩过，写在这里防复发）：
 *   · canvas 的 `actualBoundingBox*` 在 Chrome 里**整数取整**：`迁` 量出 left=1/right=12，
 *     把真实的 2px 字间空隙吃掉了 → 只能扫像素。
 *   · canvas 默认**亚像素定位**，逐字 fillText 会把间隙抹平（实测横向量出 0px）→
 *     必须按整数前进量逐字显式定位，才与 DOM 渲染一致（DOM 侧用截图验证过：11px 墨 + 2px 隙）。
 *   · 阈值取 50% 不透明（128）：低阈值会被抗锯齿的晕边连成一片（与 DOM 侧同现象）。
 *
 * 墨隙下限：行间 ≥ 8px、字间 ≥ 1px（当前实测 9px / 2px）——行间下限取「不紧」而非「不粘」：
 * 5px（16px 行高）曾被作者复判为「行间距近乎贴一起」。
 */
const ROUTE = '/blog/2026-08-29-rpa-migration-methodology/';
const FLOW = '.prose pre:has(> code.language-flow)';

async function measure(page: import('@playwright/test').Page) {
  return page.evaluate((sel) => {
    const pre = document.querySelector(sel) as HTMLElement | null;
    if (!pre) return { found: false } as Record<string, unknown>;
    const cs = getComputedStyle(pre);
    const code = pre.querySelector('code')!;
    const ccs = getComputedStyle(code);
    const textNode = code.firstChild as Text;
    const raw = code.textContent ?? '';
    const lines = raw.split('\n');

    // ② DOM 行盒：相邻非空行的 top 之差（空行会成倍，故只要求是行高的整数倍）
    const tops: number[] = [];
    let offset = 0;
    for (const line of lines) {
      if (line.trim() !== '') {
        const r = document.createRange();
        r.setStart(textNode, offset);
        r.setEnd(textNode, offset + line.length);
        tops.push(r.getBoundingClientRect().top);
      }
      offset += line.length + 1; // '\n'
    }
    const advances = tops.slice(1).map((t, i) => Number((t - tops[i]!).toFixed(2)));

    // 全角格前进量：首个含汉字的行里，相邻两字的左边界之差
    const lineWithCjk = lines.find((l) => /[\u4e00-\u9fff]/.test(l)) ?? '';
    const idx = [...lineWithCjk].findIndex((ch) => /[\u4e00-\u9fff]/.test(ch));
    let cell = Number.NaN;
    if (idx >= 0 && idx + 1 < lineWithCjk.length) {
      const base = lines.slice(0, lines.indexOf(lineWithCjk)).reduce((n, l) => n + l.length + 1, 0);
      const rectAt = (i: number) => {
        const r = document.createRange();
        r.setStart(textNode, base + i);
        r.setEnd(textNode, base + i + 1);
        return r.getBoundingClientRect().left;
      };
      cell = Number((rectAt(idx + 1) - rectAt(idx)).toFixed(2));
    }

    // ③ 真实墨迹：canvas 像素扫描（整数定位 + 50% 阈值）
    const font = `${ccs.fontSize} ${ccs.fontFamily}`;
    const size = Number.parseFloat(ccs.fontSize);
    const lineHeight = Number.parseFloat(ccs.lineHeight);
    const probe = document.createElement('canvas').getContext('2d')!;
    probe.font = font;
    const advance = probe.measureText('迁').width; // 13px @12px
    const gapOf = (values: number[]): number => {
      for (let i = 1; i < values.length; i += 1) if (values[i]! - values[i - 1]! > 1) return values[i]! - values[i - 1]! - 1;
      return -1;
    };
    const THR = 128;

    const vc = document.createElement('canvas');
    vc.width = 40;
    vc.height = Math.ceil(lineHeight * 2 + 20);
    const vx = vc.getContext('2d')!;
    vx.font = font;
    vx.fillStyle = '#fff';
    const ascent = vx.measureText('迁').fontBoundingBoxAscent;
    const baseline = Math.round((lineHeight - size) / 2 + ascent);
    vx.fillText('迁', 4, baseline);
    vx.fillText('迁', 4, baseline + lineHeight);
    const vd = vx.getImageData(0, 0, vc.width, vc.height).data;
    const inkRows = [...Array(vc.height).keys()].filter((y) =>
      [...Array(vc.width).keys()].some((x) => vd[(y * vc.width + x) * 4 + 3]! > THR),
    );

    const hc = document.createElement('canvas');
    hc.width = 60;
    hc.height = Math.ceil(size * 2 + 8);
    const hx = hc.getContext('2d')!;
    hx.font = font;
    hx.fillStyle = '#fff';
    hx.fillText('迁', 2, size);
    hx.fillText('迁', 2 + advance, size); // 整数定位，模拟 DOM 的落格
    const hd = hx.getImageData(0, 0, hc.width, hc.height).data;
    const inkCols = [...Array(hc.width).keys()].filter((x) =>
      [...Array(hc.height).keys()].some((y) => hd[(y * hc.width + x) * 4 + 3]! > THR),
    );

    return {
      found: true,
      fontSize: ccs.fontSize,
      lineHeight: ccs.lineHeight,
      letterSpacing: ccs.letterSpacing,
      fontFamily: ccs.fontFamily,
      color: ccs.color,
      bg: cs.backgroundColor,
      inlineStyle: pre.getAttribute('style'),
      advances,
      cell,
      verticalGap: gapOf(inkRows),
      horizontalGap: gapOf(inkCols),
      fontLoaded: document.fonts.check(`${ccs.fontSize} Zpix`),
    };
  }, FLOW);
}

type M = {
  found: boolean;
  fontSize: string;
  lineHeight: string;
  letterSpacing: string;
  fontFamily: string;
  color: string;
  bg: string;
  inlineStyle: string | null;
  advances: number[];
  cell: number;
  verticalGap: number;
  horizontalGap: number;
  fontLoaded: boolean;
};

/** 打开文章并把图块量一遍（可先注入覆盖样式做反例） */
async function measureRoute(page: import('@playwright/test').Page, override?: string): Promise<M> {
  await page.goto(ROUTE, { waitUntil: 'load' });
  await page.waitForTimeout(800);
  if (override) await page.addStyleTag({ content: override });
  await page.waitForTimeout(150);
  return (await measure(page)) as unknown as M;
}

test.describe('文章字符图：真实行距/字距不得「粘」', () => {
  test('计算样式与源码契约一致（字号 12px / 行高 16px / Zpix / 无 inline 样式）', async ({ page }) => {
    const m = await measureRoute(page);
    expect(m.found, '页面上找不到 ```flow 图块').toBe(true);
    expect(m.fontSize, '图块字号应显式 12px（Zpix 原生网格）').toBe('12px');
    expect(m.lineHeight, '图块行高应显式 20px（连续阅读块的 1.67 倍行距）').toBe('20px');
    expect(m.letterSpacing, '图块字距应为 0（全角格不能被拉开）').toBe('normal');
    expect(m.fontFamily, '图块第一顺位应是 Zpix').toMatch(/^"?Zpix/);
    expect(m.inlineStyle, 'Shiki 的 inline 样式不得落到图块上').toBeNull();
    expect(m.fontLoaded, 'Zpix 未就绪').toBe(true);
  });

  test('渲染出的行距是声明行高的整数倍（层叠不得被别的规则抢走）', async ({ page }) => {
    const m = await measureRoute(page);
    const lh = Number.parseFloat(m.lineHeight);
    expect(m.advances.length, '量不到相邻行').toBeGreaterThan(2);
    const bad = m.advances.filter((a) => a <= 0 || a % lh !== 0);
    expect(bad, `实测相邻行间距出现非 ${lh}px 整数倍：${bad.join('/')}`).toEqual([]);
  });

  test('全角格前进量是整数 13px（对格的物理前提）', async ({ page }) => {
    const m = await measureRoute(page);
    expect(Number.isFinite(m.cell), '量不到相邻两字的间距').toBe(true);
    expect(m.cell, `全角格 ${m.cell}px ≠ 13px（非整数格会让逐字左右抖）`).toBe(13);
  });

  test('真实墨迹间隙：行间 ≥ 8px、字间 ≥ 1px（canvas 像素扫描）', async ({ page }) => {
    const m = await measureRoute(page);
    expect(m.verticalGap, `行间只空 ${m.verticalGap}px → 行距过紧（「字粘在一起」/「近乎贴一起」）`).toBeGreaterThanOrEqual(8);
    expect(m.horizontalGap, `字间只空 ${m.horizontalGap}px → 字与字贴住`).toBeGreaterThanOrEqual(1);
  });

  /**
   * 反例自检（常驻）：把行高压回 1em，上面那条度量必须报红。
   * 没有这一条，读者无法判断上面是真的在量还是恒绿 —— 2026-09-10 那次
   * 「箭头不被切掉」的守卫就是因为属性取错而恒绿了一整天。
   */
  test('反例自检：行高压回 1em 时，墨迹度量必须判为「紧」', async ({ page }) => {
    const m = await measureRoute(page, `.prose pre:has(> code.language-flow) code{line-height:12px!important}`);
    expect(m.lineHeight, '覆盖样式没生效，这条自检无效').toBe('12px');
    expect(m.verticalGap, `行高 12px 时行间墨迹应只剩 1px 左右，实测 ${m.verticalGap}px`).toBeLessThan(8);
  });

  test('图块颜色恒定（单档）：同页两次采样一致，防随机漂移', async ({ page }) => {
    await page.goto(ROUTE, { waitUntil: 'load' });
    await page.waitForTimeout(600);
    const seen: string[] = [];
    for (let i = 0; i < 2; i++) {
      await page.waitForTimeout(150);
      const m = (await measure(page)) as unknown as M;
      seen.push(`第${i + 1}次: ${m.color} / ${m.bg}`);
    }
    expect(new Set(seen.map((s) => s.split(': ')[1])).size, `图块配色应恒定：\n${seen.join('\n')}`).toBe(1);
  });
});
