import { expect, test, type Page } from '@playwright/test';

/**
 * 像素字体 Zpix 的加载与应用 —— 本站「像素语言」的地基。
 *
 * 背景（2026-09-08 作者发现）：`@font-face` 的 `src` 曾写成
 * `src: url(var(--font-zpix-subset)) format('woff2')` —— **`var()` 不能出现在
 * `url()` 里**，该声明按 CSS 规范是解析错误，被浏览器直接丢弃；构建期的
 * CSS 压缩器进一步把整条 `src` 从产物里删掉。结果：@font-face 只剩
 * `font-family: Zpix` 却没有字体源，浏览器**不注册任何 FontFace**
 * （`document.fonts` 为空），Zpix 永远加载不了，全站静默退回系统黑体。
 *
 * 这类「字形悄悄换了」的回归，截图看不出、类型检查看不出、字号单测也看不出。
 * 四条断言分层兜住它：
 *   ① 网络层：zpix.subset.woff2 请求 200（URL 拼对了）
 *   ② 字体 API 层：FontFaceSet 里存在 family=Zpix 且 status=loaded 的 face
 *      （**不能用 `document.fonts.check()`**：未知字体族它也返回 true，是假绿）
 *   ③ 渲染层：同一段文字在「Zpix, sans-serif」与「sans-serif」下宽度不同
 *      （Zpix 没加载时两者都落 sans-serif，宽度相等）
 *   ④ 体积层：**首页不得请求 /fonts/zpix.ttf**，且子集响应 < 100_000 B
 *      （2026-09-10 补：子集产物曾是一份假 woff2（裸 sfnt / glyf 表长 0），
 *       浏览器 NetworkError 后静默兜底到 7,179,288 B 的全量 TTF —— 文件在、
 *       请求 200、字体也真的 loaded，前三条全绿，只有体积泄露了 7 MB）
 *   ⑤ 字形层：Zpix 标识层的每个字逐字形 canvas 比对**真的由 Zpix 画出来**
 *      （2026-09-10 评审 M4：`src` 列表不是逐字回退 —— 子集缺字时不会去下
 *       zpix.ttf，而是落到 font-family 栈的下一个字体（系统黑体），
 *       于是标识层里静静地冒出一个非像素字。体积/loaded/宽度三条都拦不住它。）
 *
 * **2026-09-10 契约更新（作者决策 U1 换正文字体）**：
 *   - 正文改系统黑体（`--font-body`），故 `body` 的字体栈首项不再是 Zpix；
 *   - Zpix 仍是**标识语言**：标题 / 导航 / 按钮 / 标签 / 丝印 —— 必须加载且真的被应用。
 *   本文件断言相应改为「标题节点走 Zpix」（原为「body 走 Zpix」）。
 */

const FONT_URL = /\/fonts\/zpix\.subset\.woff2$/;

/** FontFaceSet 里所有字族及其状态（family 去掉引号） */
async function fontFaces(page: Page): Promise<{ family: string; status: string }[]> {
  await page.evaluate(() => document.fonts.ready);
  return page.evaluate(() =>
    [...document.fonts].map((f) => ({
      family: f.family.replace(/^['"]|['"]$/g, ''),
      status: f.status,
    }))
  );
}

test.describe('像素字体 Zpix', () => {
  test('首页：字体文件 200、FontFace 注册且 loaded、body 栈首项是 Zpix', async ({
    page,
  }) => {
    const responses: { url: string; status: number }[] = [];
    page.on('response', (r) => {
      if (FONT_URL.test(r.url())) responses.push({ url: r.url(), status: r.status() });
    });

    await page.goto('/', { waitUntil: 'load' });

    // ① 网络层：至少一次 woff2 请求，且必须 200（404 时浏览器仍走 fallback，静默）
    expect(responses.length, '应发起 zpix.subset.woff2 请求').toBeGreaterThan(0);
    expect(
      responses.every((r) => r.status === 200),
      `字体请求非 200：${JSON.stringify(responses)}`
    ).toBe(true);

    // ② 字体 API 层：src 无效时浏览器根本不注册 FontFace（document.fonts 为空）
    const faces = await fontFaces(page);
    expect(
      faces.some((f) => f.family === 'Zpix' && f.status === 'loaded'),
      `FontFaceSet 里没有已加载的 Zpix：${JSON.stringify(faces)}`
    ).toBe(true);

    // ③ 级联层：**标题**（标识语言）字体栈第一项必须是 Zpix。
    //    body 已改系统黑体（U1），故改测标题节点——像素身份在标识层，不在正文。
    const family = await page.evaluate(
      () => getComputedStyle(document.querySelector('h1, h2')!).fontFamily
    );
    expect(
      family.split(',')[0]!.trim().replace(/^['"]|['"]$/g, ''),
      `标题字体栈首项：${family}`
    ).toBe('Zpix');
  });

  test('Zpix 真的被用于排版（不是只声明了字体栈）', async ({ page }) => {
    await page.goto('/', { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);

    // 同一段中文 + 英文 + 数字，两种字体栈测宽度：
    // Zpix 若没加载，两个 span 都会落到同一个 sans-serif → 宽度相等（断言失败）。
    const widths = await page.evaluate(() => {
      const host = document.createElement('div');
      host.style.cssText =
        'position:absolute;left:-9999px;top:0;white-space:nowrap;font-size:32px;';
      const mk = (family: string) => {
        const el = document.createElement('span');
        el.style.fontFamily = family;
        el.textContent = '8bit-me 像素字体 Zpix 0123';
        host.appendChild(el);
        return el;
      };
      const withZpix = mk("'Zpix', sans-serif");
      const fallback = mk('sans-serif');
      document.body.appendChild(host);
      const w = {
        zpix: withZpix.getBoundingClientRect().width,
        fallback: fallback.getBoundingClientRect().width,
      };
      host.remove();
      return w;
    });

    expect(widths.zpix, '两种字体栈宽度相同 → Zpix 没生效').not.toBe(
      widths.fallback
    );
  });

  test('文章页同样走 Zpix（全站挂载，不是首页专属）', async ({ page }) => {
    await page.goto('/blog', { waitUntil: 'load' });
    const href = await page
      .locator('.tl-item .card h3 a')
      .first()
      .getAttribute('href');
    await page.goto(href!, { waitUntil: 'load' });

    const faces = await fontFaces(page);
    expect(
      faces.some((f) => f.family === 'Zpix' && f.status === 'loaded'),
      `文章页 FontFaceSet 里没有已加载的 Zpix：${JSON.stringify(faces)}`
    ).toBe(true);
    // 标题（标识层）走 Zpix；正文走系统黑体（U1）
    const h1 = await page.evaluate(
      () => getComputedStyle(document.querySelector('h1')!).fontFamily
    );
    expect(h1.split(',')[0]!.trim().replace(/^['"]|['"]$/g, '')).toBe('Zpix');
    const body = await page.evaluate(
      () => getComputedStyle(document.body).fontFamily
    );
    expect(
      body.split(',')[0]!.trim().replace(/^['"]|['"]$/g, ''),
      '正文应为系统黑体（不再是 Zpix）'
    ).not.toBe('Zpix');
  });

  test('Zpix 标识层每个字都真的由 Zpix 画（缺字 = 静默换字体）', async ({ page }) => {
    // 2026-09-10 评审 M4 实测推翻了「src 第二项 zpix.ttf 兜新博文漏字」这条旧说法：
    // `src` 只是同一个 face 的多个来源，不是逐字回退。子集缺字时浏览器
    // 既不下 ttf、也不报错，而是用 `font-family` 栈的**下一个字体**（系统黑体）画 ——
    // 标识层里冒出一个非像素字，肉眼几乎看不出，体积/loaded/宽度三条断言也都绿。
    //
    // 判据（两层，因为「缺字时落到栈里下一个字体」这件事在 Chrome 里不完全干净）：
    //   ① 实际字体栈 vs 同一个栈去掉 Zpix：**逐像素相同 = Zpix 一个字没画**
    //      （这个字根本不在 Zpix 里）；
    //   ② 实际字体栈 vs 全量 Zpix 参考 face（`/fonts/zpix.ttf` 注册成 ZpixFull）：
    //      全量 Zpix 画出了真字形（≠ 回退渲染）而实际栈没画出 = **子集缺字**。
    //      实测：只靠 ① 抓不到缺字（Chrome 在「第一项存在但缺字形」时挑的兜底字体
    //      与「栈里去掉 Zpix」时挑的不完全一样），② 才是真正能红的那层。
    // 两条都不依赖具体字体名，所以跨平台不会假红。
    // 三条路由一起查：`&larr;` / `&rarr;` 那三处实体就在 /blog 与 /blog/tags 上（评审 M3）。
    const ROUTES = ['/', '/blog', '/blog/tags'];

    const probe = async () => {
      // 全量 Zpix 作参照 face（只在浏览器里比对渲染结果，不改变页面字体）
      const ttf = await (await fetch('/fonts/zpix.ttf')).arrayBuffer();
      const reference = new FontFace('ZpixFullReference', ttf);
      await reference.load();
      document.fonts.add(reference);

      const strip = (s: string) => s.trim().replace(/^['"]|['"]$/g, '');
      // Zpix 层 = 计算样式的首项就是 Zpix 的叶子元素（标题 / 导航 / 按钮 / 标签 / 丝印）
      const layer = [...document.querySelectorAll('body *')].filter((el) => {
        if (el.children.length) return false;
        if (!el.textContent || !el.textContent.trim()) return false;
        const first = strip(getComputedStyle(el).fontFamily.split(',')[0] ?? '');
        return first === 'Zpix';
      });

      const chars = new Map<string, { stack: string; sample: string }>();
      for (const el of layer) {
        const text = (el.textContent ?? '').trim();
        const stack = getComputedStyle(el).fontFamily;
        for (const ch of text) {
          if (/\s/.test(ch)) continue;
          if (!chars.has(ch)) chars.set(ch, { stack, sample: text.slice(0, 24) });
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 64;
      const ctx = canvas.getContext('2d')!;
      const ink = (stack: string, ch: string) => {
        ctx.clearRect(0, 0, 64, 64);
        ctx.font = `32px ${stack}`;
        ctx.fillStyle = '#000';
        ctx.textBaseline = 'top';
        ctx.fillText(ch, 4, 4);
        return ctx.getImageData(0, 0, 64, 64).data;
      };
      const identical = (a: Uint8ClampedArray, b: Uint8ClampedArray) => {
        for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
        return true;
      };
      const inkPixels = (a: Uint8ClampedArray) => {
        let n = 0;
        for (let i = 3; i < a.length; i += 4) if (a[i] !== 0) n++;
        return n;
      };

      const notDrawn: { ch: string; cp: string; sample: string }[] = [];
      const subsetMissing: { ch: string; cp: string; sample: string }[] = [];
      let checked = 0;
      let skippedBlank = 0;
      for (const [ch, { stack, sample }] of chars) {
        const cp = 'U+' + (ch.codePointAt(0) ?? 0).toString(16).toUpperCase();
        const actual = ink(stack, ch);
        if (inkPixels(actual) === 0) {
          skippedBlank++; // 空白类字符（空格 / 全角空格）本来就没墨
          continue;
        }
        checked++;
        const rest = stack.split(',').slice(1).join(',').trim() || 'sans-serif';
        const fallback = ink(rest, ch);
        if (identical(actual, fallback)) {
          notDrawn.push({ ch, cp, sample });
        }
        const full = ink('ZpixFullReference', ch);
        if (!identical(full, fallback) && !identical(actual, full)) {
          subsetMissing.push({ ch, cp, sample });
        }
      }
      return { layerCount: layer.length, checked, skippedBlank, notDrawn, subsetMissing };
    };

    const report: {
      route: string;
      layerCount: number;
      checked: number;
      notDrawn: { ch: string; cp: string; sample: string }[];
      subsetMissing: { ch: string; cp: string; sample: string }[];
    }[] = [];
    for (const route of ROUTES) {
      await page.goto(route, { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.load("32px 'Zpix'"));
      await page.evaluate(() => document.fonts.ready);
      report.push({ route, ...(await page.evaluate(probe)) });
    }

    // 防空跑：标识层元素与非空白字符都得有量
    const checked = report.reduce((a, r) => a + r.checked, 0);
    expect(report.length, '三条路由都要跑到').toBe(3);
    expect(
      Math.min(...report.map((r) => r.layerCount)),
      `有路由没找到 Zpix 层叶子元素：${JSON.stringify(report.map((r) => [r.route, r.layerCount]))}`
    ).toBeGreaterThan(10);
    expect(checked, `三条路由合计只比对了 ${checked} 个非空白字符`).toBeGreaterThan(50);

    const notDrawn = report.flatMap((r) => r.notDrawn.map((d) => ({ route: r.route, ...d })));
    expect(
      notDrawn,
      '这些字在 Zpix 层里渲染出来与回退字体逐像素相同 → Zpix 一个字也没画（全量字体都没这个字形）：' +
        JSON.stringify(notDrawn.slice(0, 20))
    ).toEqual([]);

    const subsetMissing = report.flatMap((r) =>
      r.subsetMissing.map((d) => ({ route: r.route, ...d }))
    );
    expect(
      subsetMissing,
      '这些字全量 Zpix 有字形、子集却没画 → 子集缺字，标识层里冒出了系统黑体字。' +
        '重跑 node scripts/subset-font.mjs 并提交产物：' +
        JSON.stringify(subsetMissing.slice(0, 20))
    ).toEqual([]);
  });

  test('首页只加载子集 woff2，不回退 7MB 全量 TTF', async ({ page }) => {
    // 2026-09-10 的静默回归：子集产物其实是 fontkit 写的假 woff2（裸 sfnt，
    // 首 4 字节 `true`、glyf 表长 0）→ 浏览器 NetworkError → @font-face 悄悄
    // 兜底到 7,179,288 B 的 zpix.ttf。文件在、请求 200、字体也确实加载了、
    // 既有 43 条测试全绿——**唯独代价是每页多下 7 MB**。
    // 这条断言盯的就是这个代价：先断掉 TTF 兜底，再要求 Zpix 仍然 loaded。
    const requested: string[] = [];
    const responses: { url: string; status: number; bytes: number }[] = [];
    page.on('request', (r) => requested.push(r.url()));
    page.on('response', async (r) => {
      if (!/\/fonts\//.test(r.url())) return;
      let bytes = -1;
      try {
        bytes = (await r.body()).length;
      } catch {
        bytes = -1; // 被 route.abort 的请求没有 body
      }
      responses.push({ url: r.url(), status: r.status(), bytes });
    });
    // 断掉全量 TTF：若子集产物不可用，浏览器就无字体可退，Zpix 必为 error
    await page.route('**/fonts/zpix.ttf', (route) => route.abort());

    await page.goto('/', { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);

    expect(
      requested.filter((u) => /\/fonts\/zpix\.ttf$/.test(u)),
      '首页请求了 7MB 全量 TTF → 子集产物不可用，静默回退又发生了'
    ).toEqual([]);

    const subset = responses.find((r) => /\/fonts\/zpix\.subset\.woff2$/.test(r.url));
    expect(subset, '没有发起 zpix.subset.woff2 请求').toBeTruthy();
    expect(subset!.status, `子集请求状态：${subset!.status}`).toBe(200);
    expect(subset!.bytes, `子集产物 ${subset!.bytes} B 过大`).toBeLessThan(100_000);
    expect(subset!.bytes, '响应体没读到（-1）').toBeGreaterThan(0);

    // TTF 已被 abort：此刻 Zpix 仍然 loaded，只可能来自那份子集 woff2
    const faces = await fontFaces(page);
    expect(
      faces.some((f) => f.family === 'Zpix' && f.status === 'loaded'),
      `TTF 兜底已被断，Zpix 仍须由 woff2 加载：${JSON.stringify(faces)}`
    ).toBe(true);
  });
});
