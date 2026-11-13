import { expect, test } from '@playwright/test';

/**
 * 像素对格（pixel grid）—— Zpix 字距修正的浏览器级契约
 *
 * 2026-09-08 实测：Zpix 的 CJK 前进量是 **13/12 em**（12px→13.00、16px→17.33、24px→26.00），
 * 所以只有 12/24/36/48px 落在整数像素上。16px 正文下每字 17.33px，浏览器逐字取整后
 * 出现「17/18px 交替」的字距抖动（canvas 墨迹间距实测 {17,18}）——像素字最忌这个。
 * 修法：`:root` 的 `--ls-*` 把每个字号档的有效前进量修正到整数（16px → -0.333px）。
 *
 * 本文件逐字测**渲染位置**（Range 的 left 坐标），不是测 CSS 声明：
 *   · 每个汉字左边界必须落整数像素（±0.02 容差）
 *   · 相邻汉字间距必须**恒定**（不能 17/18 交替）
 * 这样任何「改字号/改字距后忘记同步」都会在浏览器里立刻变红。
 */

/** 逐字左边界（用 Range 取每个字符的几何位置） */
async function charLefts(page: import('@playwright/test').Page, text: string) {
  return page.evaluate((t) => {
    const host = document.createElement('span');
    host.textContent = t;
    // 只继承 body 的 font-size / letter-spacing（不设任何自身样式）
    host.style.cssText = 'position:absolute;left:0;top:0;white-space:nowrap;';
    document.body.appendChild(host);
    const node = host.firstChild!;
    const xs: number[] = [];
    for (let i = 0; i < t.length; i++) {
      const r = document.createRange();
      r.setStart(node, i);
      r.setEnd(node, i + 1);
      xs.push(r.getBoundingClientRect().left);
    }
    const body = getComputedStyle(document.body);
    host.remove();
    return {
      xs,
      fontSize: body.fontSize,
      letterSpacing: body.letterSpacing,
      family: body.fontFamily,
    };
  }, text);
}

const CJK = '自动化与数据工程的实践记录';

function assertGrid(xs: number[]) {
  // ① 每个字的左边界落整数像素
  const fractional = xs
    .map((x, i) => ({ i, x, frac: Math.abs(x - Math.round(x)) }))
    .filter((r) => r.frac > 0.02);
  expect(
    fractional,
    `字符左边界未落在整数像素：${fractional.map((f) => `#${f.i}=${f.x}`).join(', ')}`
  ).toEqual([]);

  // ② 相邻字间距恒定（不能 17/18 交替）。容差 0.05px：浏览器子像素定位会有极微漂移，
  //    但真实的“对格失败”是 1px 级别的交替，这个容差能区分两者。
  const gaps = xs.slice(1).map((x, i) => x - xs[i]!);
  const spread = Math.max(...gaps) - Math.min(...gaps);
  expect(
    spread,
    `字间距不恒定：${gaps.map((g) => g.toFixed(3)).join(', ')}`
  ).toBeLessThanOrEqual(0.05);
}

test.describe('像素对格：Zpix 字距修正', () => {
  /**
   * 2026-09-10（U1 换正文字体）：正文已改系统黑体，`body` 不再走 Zpix，
   * 故「body 的逐字对格」不再是本站契约——但**Zpix 元素的对格仍是**：
   * 标题 / 导航 / 按钮 / 标签继续用 `--ls-*` 修正，必须逐字落整数像素。
   * 本组改为注入一个走 `--font-pixel` + `--ls-*` 的样本元素来测（与真实标题同源）。
   */
  test('Zpix 元素（走 --font-pixel）逐字左边界整数、间距恒定', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/', { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);

    const r = await page.evaluate((text) => {
      const host = document.createElement('span');
      host.textContent = text;
      // 与站点标题同源：Zpix 字体族 + 32px 档 + 对应 --ls-32
      host.style.cssText =
        'position:absolute;left:0;top:0;white-space:nowrap;font-family:var(--font-pixel);font-size:32px;letter-spacing:var(--ls-32);';
      document.body.appendChild(host);
      const node = host.firstChild!;
      const xs: number[] = [];
      for (let i = 0; i < text.length; i++) {
        const range = document.createRange();
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        xs.push(range.getBoundingClientRect().left);
      }
      const cs = getComputedStyle(host);
      const out = { xs, fontSize: cs.fontSize, letterSpacing: cs.letterSpacing, family: cs.fontFamily };
      host.remove();
      return out;
    }, CJK);

    expect(r.fontSize).toBe('32px');
    expect(r.letterSpacing).toBe('-0.666667px');
    expect(r.family.split(',')[0]!.replace(/^['"]|['"]$/g, '')).toBe('Zpix');
    assertGrid(r.xs);
  });

  test('正文（系统黑体）字距为 normal，不再被 Zpix 修正污染', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/', { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    const r = await page.evaluate(() => {
      const cs = getComputedStyle(document.body);
      return { fontSize: cs.fontSize, letterSpacing: cs.letterSpacing, family: cs.fontFamily };
    });
    expect(r.fontSize).toBe('16px');
    expect(r.letterSpacing, '正文字距必须 normal（系统黑体 CJK 前进量 1.0 em）').toBe('normal');
    expect(
      r.family.split(',')[0]!.replace(/^['"]|['"]$/g, ''),
      '正文应为系统黑体'
    ).not.toBe('Zpix');
  });

  test('文章正文：汉字前进量恒定（系统黑体不再要求落整数像素）', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/blog', { waitUntil: 'load' });
    const href = await page
      .locator('.tl-item .card h3 a')
      .first()
      .getAttribute('href');
    await page.goto(href!, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);

    // 直接测正文里真实段落的逐字位置。
    // 2026-09-10（P2-4 新内容上线后暴露）：旧写法假设「段落第一个汉字就在 firstChild
    // 里、且从它开始的 10 个字符都是汉字」——正文首位是拉丁词（AI / agent / skills）
    // 或段落被行内元素切开时，offset 对错节点，于是量不到汉字而误报。
    // 改为 TreeWalker 跨文本节点收集，取最长的连续汉字 run。
    const xs = await page.evaluate(() => {
      const isCjk = (ch: string) => /[\u4e00-\u9fa5]/.test(ch);
      let best: number[] = [];
      for (const p of document.querySelectorAll('.prose p')) {
        if (!isCjk(p.textContent ?? '')) continue;
        const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
        let run: number[] = [];
        while (walker.nextNode()) {
          const node = walker.currentNode as Text;
          const t = node.textContent ?? '';
          for (let i = 0; i < t.length; i++) {
            const r = document.createRange();
            r.setStart(node, i);
            r.setEnd(node, i + 1);
            const left = r.getBoundingClientRect().left;
            // 换行会让 left 回跳：那不是真实的前进量，断开 run
            if (isCjk(t[i]!) && (run.length === 0 || left > run[run.length - 1]!)) {
              run.push(left);
            } else {
              run = isCjk(t[i]!) ? [left] : [];
            }
            if (run.length > best.length) best = [...run];
          }
        }
      }
      return best;
    });
    expect(xs.length, '应量到连续汉字').toBeGreaterThanOrEqual(6);
    // 2026-09-10：正文字体已换系统黑体，CJK 前进量 1.0 em —— 16px 下每字 16.0px，
    // 落整数；但仍用「间距恒定」判据（比整数对格更本质，且对未来字号变化稳健）。
    const gaps = xs.slice(1).map((x, i) => +(x - xs[i]!).toFixed(3));
    const spread = Math.max(...gaps) - Math.min(...gaps);
    expect(spread, `正文汉字间距不恒定：${gaps.join(', ')}`).toBeLessThanOrEqual(0.05);
  });

  /**
   * 真实段落（含中文标点）—— 本测试是 2026-09-09 指标设计子代理揪出的漏洞的防线。
   *
   * 实测事实：Zpix 的**汉字**前进量 13/12 em，**中文标点（，：；）** 却是 12/12 em。
   * `--ls-*` 只能把一个类别修到整数，所以 16px 真实段落里 79% 字符不在整数像素上、
   * 相位有 {0, 1/3, 2/3} 三种——而旧版本文件用**纯汉字串**测，全绿。
   * 本测试改用真实段落，并区分「可做到」与「做不到」：
   *   · 连续汉字 run 内的间距必须恒定（--ls 的价值就在这里）
   *   · 同类标点前进量必须恒定（不能被二次 tracking 污染）
   *   · 相位种类数 ≤ 3（16px 的物理上限；若改到 12/24/48px 则要求 1）
   */
  test('真实段落（含标点）：汉字 run 间距恒定、标点前进量恒定、相位 ≤ 3', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/blog', { waitUntil: 'load' });
    const href = await page
      .locator('.tl-item .card h3 a')
      .first()
      .getAttribute('href');
    await page.goto(href!, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);

    const m = await page.evaluate(() => {
      const isCjk = (ch: string) => /[\u4e00-\u9fa5]/.test(ch);
      const isPunct = (ch: string) => /[，。、；：？！]/.test(ch);
      // 取一段足够长的**纯文本**正文段落（含标点）：
      // 有 <code>/<strong>/<a> 的段落会带进别的字体/字重，它们的亚像素位移不归本指标管。
      const p = [...document.querySelectorAll('.prose p')]
        .filter((el) => {
          const t = el.textContent ?? '';
          const plain = [...el.childNodes].every((n) => n.nodeType === 3);
          return plain && t.length > 60 && isCjk(t) && isPunct(t);
        })
        .sort((a, b) => (b.textContent?.length ?? 0) - (a.textContent?.length ?? 0))[0];
      if (!p) throw new Error('找不到含标点的长段落');

      // 段落里可能有 <strong>/<code>/<a> 等内联节点 → 用 TreeWalker 逐文本节点取字，
      // 不能假设 firstChild 就是整段（否则 Range offset 越界）。
      const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
      const chars: { ch: string; left: number }[] = [];
      while (walker.nextNode()) {
        const node = walker.currentNode as Text;
        const t = node.textContent ?? '';
        for (let i = 0; i < t.length; i++) {
          const r = document.createRange();
          r.setStart(node, i);
          r.setEnd(node, i + 1);
          chars.push({ ch: t[i]!, left: r.getBoundingClientRect().left });
        }
      }

      // 连续汉字 run 的间距集合（跨行处断开：换行后 left 会回跳，不是真实间距）
      const runGaps: number[][] = [];
      let cur: number[] = [];
      for (let i = 0; i + 1 < chars.length; i++) {
        const gap = +(chars[i + 1]!.left - chars[i]!.left).toFixed(3);
        const wrapped = gap <= 0;
        if (isCjk(chars[i]!.ch) && isCjk(chars[i + 1]!.ch) && !wrapped) {
          cur.push(gap);
        } else if (cur.length) {
          runGaps.push(cur);
          cur = [];
        }
      }
      if (cur.length) runGaps.push(cur);

      // 同类标点的前进量（同样跳过跨行）
      const punctAdv = new Map<string, number[]>();
      for (let i = 0; i + 1 < chars.length; i++) {
        const gap = +(chars[i + 1]!.left - chars[i]!.left).toFixed(3);
        if (isPunct(chars[i]!.ch) && gap > 0) {
          const arr = punctAdv.get(chars[i]!.ch) ?? [];
          arr.push(gap);
          punctAdv.set(chars[i]!.ch, arr);
        }
      }

      // 相位（1/64px 量化后聚类）—— 只统计汉字：行内 code/strong 会带进别的字体与字重，
      // 它们的前进量不归本指标管（各自有自己的对格问题）。
      // 2026-09-10（U1 换正文字体后）：正文不再是 Zpix，拉丁字母是**比例宽度**，
      // 混排段落里汉字前面跟几个拉丁字符，落点相位就随之变化——绝对相位不再是
      // 正文字体的不变量（要它成立等于要求拉丁也等宽，即退回像素体）。
      // 正文本轮的不变量是「同 run 内汉字前进量恒定」（下面①②），相位只在
      // Zpix 元素上守（见本文件第一组用例）。
      const phases = new Set<number>();
      for (const c of chars) {
        if (!isCjk(c.ch)) continue;
        const frac = c.left - Math.floor(c.left);
        phases.add(Math.round(frac * 64) / 64);
      }
      return {
        fontSize: getComputedStyle(document.body).fontSize,
        runGaps,
        punctAdv: [...punctAdv.entries()],
        phases: [...phases].sort((a, b) => a - b),
        chars: chars.length,
      };
    });

    // ① 每个汉字 run（≥3 个间距）内间距必须恒定
    for (const gaps of m.runGaps.filter((g) => g.length >= 3)) {
      const spread = Math.max(...gaps) - Math.min(...gaps);
      expect(
        spread,
        `汉字 run 间距不恒定：${gaps.join(', ')}`
      ).toBeLessThanOrEqual(0.05);
    }

    // ② 同类标点前进量恒定
    for (const [ch, adv] of m.punctAdv) {
      const spread = Math.max(...adv) - Math.min(...adv);
      expect(spread, `标点「${ch}」前进量不恒定：${adv.join(', ')}`).toBeLessThanOrEqual(
        0.05
      );
    }

    // ③ 相位种类数：**只对 Zpix 正文生效**（12 的整数倍字号要求 1，其余档上限 3）。
    //    U1 后正文是系统黑体（比例拉丁），绝对相位不成立，故跳过。
    const bodyFont = await page.evaluate(
      () => getComputedStyle(document.body).fontFamily
    );
    const isPixelBody = /Zpix/i.test(bodyFont);
    const size = Number.parseFloat(m.fontSize);
    if (!isPixelBody) {
      expect(m.phases.length, '系统正文字体的相位不设上限（比例拉丁所致）').toBeLessThanOrEqual(64);
    } else if (size % 12 === 0) {
      expect(m.phases, `${m.fontSize} 应完全对格（单相位）`).toHaveLength(1);
    } else {
      expect(
        m.phases.length,
        `${m.fontSize} 相位种类数超上限：${m.phases.join(', ')}`
      ).toBeLessThanOrEqual(3);
    }
  });
});
