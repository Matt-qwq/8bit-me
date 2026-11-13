import { expect, test } from '@playwright/test';

import { LAB_DIAGRAMS } from '../../src/lib/lab';

/**
 * 实验场（/lab）—— 交互式图册的 e2e 防线
 *
 * 单测（tests/unit/lab.spec.ts）已守住「产物存在 / 主题不漂移 / 零外链」这些静态契约。
 * 这里只守浏览器里才成立的事：
 *   1. 路由真的渲染（产物是 public/ 下的静态 HTML，走 iframe —— 路径与 base 只有浏览器知道）
 *   2. iframe 真的加载了 /lab/<id>.html，且**内部**主题与站点同源（单档恒暗，ADR-0021）
 *      —— 这条是核心：跨文档不继承 CSS 变量，联动一旦断掉，图会停在旧配色，
 *         变成第 14 套观感，而页面看上去毫无异常（开发流程文档 的「假绿」同类）
 *   3. 无控制台报错、无外部请求
 */

const DIAGRAM_ID = 'warehouse-layers';
const VIEWER = `/lab/${DIAGRAM_ID}/`;

/** 卡片定位符：按 href 取，不按序号取 —— 图册加图后 `page.locator('.lab-card')`
 *  会命中多张卡片（strict mode 直接报错），而「第一张卡」也不该是测试的隐含契约。 */
const CARD = (id: string) => `.lab-card[href$="lab/${id}/"]`;

/** 等到 iframe 真正就绪（而不是只等到 <iframe> 元素挂上） */
async function readyFrame(page: import('@playwright/test').Page) {
  await page.waitForFunction(
    () => {
      const f = document.querySelector<HTMLIFrameElement>('.lab-frame');
      const d = f?.contentDocument;
      return !!d?.querySelector('svg') && !!d.documentElement.dataset.gb;
    },
    undefined,
    { timeout: 15_000 }
  );
}

test.describe('/lab 路由', () => {
  test('图册索引与单页都渲染且标题正确', async ({ page }) => {
    await page.goto('/lab/');
    await expect(page.locator('h1')).toContainText('LAB');
    // 数量从数据层取，不写死：图册的契约是「每张 LAB_DIAGRAMS 都有一张卡」，
    // 写死数字会在加图时红（2026-09-17 加第 2 张图时正是这条先红）。
    await expect(page.locator('.lab-card')).toHaveCount(LAB_DIAGRAMS.length);

    await page.goto(VIEWER);
    await expect(page.locator('h1')).toContainText('分层数仓');
    await expect(page.locator('.lab-stage')).toBeVisible();
  });

  test('索引卡片点进去真的到达目标图（断言落地内容，不是断言 hash）', async ({ page }) => {
    await page.goto('/lab/');
    await page.locator(CARD(DIAGRAM_ID)).click();
    await page.waitForURL(`**${VIEWER}`);
    // 不是断言 URL —— 断言目的地真的长出了东西
    await expect(page.locator('.lab-frame')).toBeVisible();
    await readyFrame(page);
    await expect(page.locator('h1')).toContainText('分层数仓');
  });

  test('导航栏「实验场」在非首页也能跳到图册（不再是无目标锚点）', async ({ page }) => {
    await page.goto('/blog/');
    await page.locator('.nav a', { hasText: '实验场' }).click();
    // 不断言 URL 形态（尾斜杠可有可无），直接断言落地内容真的进了视口
    await expect(page.locator(CARD(DIAGRAM_ID))).toBeInViewport({ timeout: 15_000 });
  });

  test('第二张图（rpa-migration）也真加载、标题对得上、走线稳态是 2px 实线', async ({ page }) => {
    /**
     * 为什么加图必须补这条（开发流程文档 触发表「/lab 图册：新增图」）：
     * 单测能证明产物存在、皮肤不漂移、图内几何达标，但证明不了「浏览器里这张图真的开出来了」——
     * 路径、base、iframe 加载、主题同步这些只有浏览器知道。
     * 这条只做冒烟：入口通、标题对、入场通电扫完**定格**为干净实线
     * （结构线不许常态变虚线，line-hierarchy.md §一）。逐条细节仍由第一张图的用例覆盖，
     * 因为机制是同一套（皮肤对全部 LAB_DIAGRAMS 生效），不重复花 e2e 预算。
     */
    const id = 'rpa-migration';
    await page.goto(`/lab/${id}/`);
    await expect(page.locator('h1')).toContainText('跨实例迁建');
    await readyFrame(page);

    const info = await page.evaluate(() => {
      const f = document.querySelector<HTMLIFrameElement>('.lab-frame')!;
      const d = f.contentDocument!;
      return {
        src: f.getAttribute('src') ?? '',
        mainSvg: d.querySelectorAll('.diagram-container > svg').length,
        nodes: d.querySelectorAll('[data-animate="node"]').length,
        edges: d.querySelectorAll('svg[data-animation="trace"] [data-animate="edge"]').length,
      };
    });
    expect(info.src).toContain(`/lab/${id}.html`);
    expect(info.src).toContain('gb-chrome=min');
    expect(info.mainSvg).toBe(1);
    // 5 阶段 × 2 行 = 10 个节点 / 4 条走线（与 scripts/atlas/specs/rpa-migration.dataflow.json 对得上）
    expect(info.nodes).toBe(10);
    expect(info.edges).toBe(4);

    // 入场通电最多 2.4s + 错峰 480ms；poll 到每条走线都是 none|2px|1（扫完的定格态）
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const d = document.querySelector<HTMLIFrameElement>('.lab-frame')!.contentDocument!;
            const w = d.defaultView!;
            return [...d.querySelectorAll('svg[data-animation="trace"] [data-animate="edge"]')].map(
              (el) => {
                const cs = w.getComputedStyle(el);
                return `${cs.strokeDasharray}|${cs.strokeWidth}|${cs.opacity}`;
              }
            );
          }),
        { timeout: 10_000, message: '新图入场通电没在 10s 内定格为 2px 实线' }
      )
      .toEqual(['none|2px|1', 'none|2px|1', 'none|2px|1', 'none|2px|1']);
  });

  test('iframe 真的加载了产物（而非空白壳）', async ({ page }) => {
    await page.goto(VIEWER);
    await readyFrame(page);
    const info = await page.evaluate(() => {
      const f = document.querySelector<HTMLIFrameElement>('.lab-frame')!;
      const d = f.contentDocument!;
      return {
        src: f.getAttribute('src') ?? '',
        mainSvg: d.querySelectorAll('.diagram-container > svg').length,
        gb: d.documentElement.dataset.gb,
      };
    });
    expect(info.src).toContain(`/lab/${DIAGRAM_ID}.html`);
    expect(info.src).toContain('gb-chrome=min');
    // 主图必须有且只有一张（overview-map 等辅助 svg 不算）
    expect(info.mainSvg).toBe(1);
  });
});

test.describe('/lab 主题同步（跨文档）', () => {
  test('**没有存过模式**时，iframe 与站点同色（单档恒暗路径）', async ({ page }) => {
    /**
     * ADR-0021 版：UI 恒暗、无模式开关，BaseLayout 直接把暗色五槽注进 :root，
     * lab/[id].astro 静态传 gb=DEFAULT_MODE。首访（全新上下文 = 无 localStorage）时
     * 站内 --c-bg 与 iframe --bg 必须同色 —— 跨文档不继承 CSS 变量，
     * 同步一旦断掉，图会停在另一套配色（无记录 ≠ 两套观感）。
     */
    await page.goto(VIEWER);
    await readyFrame(page);
    const both = await page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      const d = document.querySelector<HTMLIFrameElement>('.lab-frame')!.contentDocument!;
      return {
        siteBg: cs.getPropertyValue('--c-bg').trim().toLowerCase(),
        iframeGb: d.documentElement.dataset.gb,
        iframeBg: d.defaultView!
          .getComputedStyle(d.documentElement)
          .getPropertyValue('--bg')
          .trim()
          .toLowerCase(),
      };
    });
    expect(both.iframeGb, '单档恒暗：iframe 只该走 dark 分支').toBe('dark');
    expect(both.iframeBg, `站内 ${both.siteBg} vs 图内 ${both.iframeBg}（gb=${both.iframeGb}）`).toBe(
      both.siteBg
    );
  });

  test('工具栏的视觉风格（preset）抢不走站内配色', async ({ page }) => {
    /**
     * 背景（2026-09-10 审计实测）：archify 的预设色块写作
     * `[data-preset="…"][data-theme="…"]`（特异性 0,2,0），皮肤原来的主题块
     * `html[data-gb="…"]` 是（0,1,1）—— 点一下预设，--bg 就从 #0f380f 变成
     * #030711 / #06131f / #181611，图册当场变成第 14/15/16 套观感。
     * 修法是把主题块提到 `html:root[data-gb="…"]`（0,2,1）；这条用例从**真实交互**验证。
     */
    await page.goto(VIEWER);
    await readyFrame(page);
    const bg = () =>
      page.evaluate(() => {
        const d = document.querySelector<HTMLIFrameElement>('.lab-frame')!.contentDocument!;
        return d.defaultView!.getComputedStyle(d.documentElement).getPropertyValue('--bg').trim();
      });
    const before = await bg();
    for (const preset of ['signal-flow', 'blueprint', 'editorial']) {
      await page.evaluate((p) => {
        const d = document.querySelector<HTMLIFrameElement>('.lab-frame')!.contentDocument!;
        d.querySelector<HTMLElement>(`.preset-option[data-preset-value="${p}"]`)!.click();
      }, preset);
      await expect.poll(bg, { timeout: 3000 }).toBe(before);
    }
  });

  test('视觉风格菜单被藏掉，且 S 快捷键换不动预设', async ({ page }) => {
    /**
     * 背景（2026-09-11 实测）：archify 的「视觉风格」菜单按定义就是「把图换成另一套视觉身份」。
     * 硬伤在 signal-flow：它给 .diagram-container 挂一条**写死的**渐变
     *   `linear-gradient(rgba(8,20,38,.82), rgba(3,8,18,.94))`（浅色主题则是近白）——
     *   不是 --gb-* 派生的颜色。gb-green 的 #0f380f 底被压成 (9,26,34)→(4,11,18) 的藏青，
     *   实测 61.3% 像素改变、平均通道差 11.6，量级与「换一套主题」相同。
     *
     * 为什么上一轮的特异性守线抓不到它（tests/unit/lab.spec.ts 的「压得住预设色块」）：
     * 那条只比 --bg/--lane-stroke/--text 谁赢；皮肤确实赢了这些 token，
     * 但 background-image 皮肤**从未写过**，于是既没被覆写、也没人看。
     * 教训与「关掉 .c-mask」同类：token 白名单不等于「非 token 样式已看守」。
     *
     * 所以这里断言的不是「哪个 token 赢了」，而是「那条渐变根本不存在」。
     */
    await page.goto(VIEWER);
    await readyFrame(page);

    const state = () =>
      page.evaluate(() => {
        const d = document.querySelector<HTMLIFrameElement>('.lab-frame')!.contentDocument!;
        const w = d.defaultView!;
        const btn = d.querySelector<HTMLElement>('#btn-preset');
        const wrap = d.querySelector<HTMLElement>('.preset-wrap');
        const c = d.querySelector<HTMLElement>('.diagram-container');
        return {
          preset: d.documentElement.dataset.preset ?? null,
          wrapDisplay: wrap ? w.getComputedStyle(wrap).display : '(缺失)',
          btnVisible: btn ? btn.getBoundingClientRect().width > 0 : false,
          containerBgImage: c ? w.getComputedStyle(c).backgroundImage : '(缺失)',
        };
      });

    const s0 = await state();
    expect(s0.wrapDisplay, '.preset-wrap 必须被 display:none 藏掉').toBe('none');
    expect(s0.btnVisible, '#btn-preset 不该占位（藏按钮 ≠ 关开关，还要吞 S）').toBe(false);
    expect(s0.preset, '站内 iframe 不该停在 archify 的某个预设上').toBe('classic');

    // 焦点给进 iframe（否则 keydown 落不到它的文档上，会假绿）
    await page.frameLocator('.lab-frame').locator('.diagram-container').click({
      position: { x: 8, y: 8 },
      force: true,
    });
    for (let i = 0; i < 4; i += 1) {
      await page.keyboard.press('s');
      await page.waitForTimeout(120);
      const s = await state();
      expect(s.preset, `按第 ${i + 1} 次 S 后预设被轮换了（S 没被吞掉）`).toBe('classic');
      expect(s.containerBgImage, 'signal-flow 的写死渐变渗进来了').toBe('none');
    }

    /**
     * 上面守的是「入口」（按钮藏了、快捷键吞了），但那只说明「没人会按到」。
     * 真正要守的是**能力本身**：只要 data-preset 变成 signal-flow，那条写死的藏青渐变就会生效 ——
     * 而 data-preset 不是只有菜单能改（archify 升级、URL 参数、别的脚本、devtools 都行）。
     * 所以这里直接强制把它改成 signal-flow，断言容器背景仍然是 none。
     * 这条才是「皮肤对非 token 样式也有话语权」的证明；上一轮的特异性守线守不到这里。
     */
    const forced = await page.evaluate(() => {
      const d = document.querySelector<HTMLIFrameElement>('.lab-frame')!.contentDocument!;
      const w = d.defaultView!;
      const c = d.querySelector<HTMLElement>('.diagram-container')!;
      const out: Record<string, string> = {};
      for (const p of ['signal-flow', 'blueprint', 'editorial', 'classic']) {
        d.documentElement.setAttribute('data-preset', p);
        out[p] = w.getComputedStyle(c).backgroundImage;
      }
      return out;
    });
    for (const [p, bgImage] of Object.entries(forced)) {
      expect(bgImage, `强制 data-preset="${p}" 后容器背景被改写了`).toBe('none');
    }
  });

  test('主题快捷键 T 被吞掉（隐藏按钮 ≠ 关掉开关）', async ({ page }) => {
    /**
     * 背景（2026-09-10 审计实测）：`#btn-theme` 被 display:none 之后，
     * archify 的 T 快捷键（doc 级 keydown）仍然生效：data-theme 翻成 light，
     * ADR-0021 后初值随钟点/太阳变（auto），故断言「不变」而不是写死 'dark'。
     */
    await page.goto(VIEWER);
    await readyFrame(page);
    const r = await page.evaluate(() => {
      const d = document.querySelector<HTMLIFrameElement>('.lab-frame')!.contentDocument!;
      const win = d.defaultView as Window & { __w?: string[] };
      win.__w = [];
      const orig = win.localStorage.setItem.bind(win.localStorage);
      win.localStorage.setItem = (k: string, v: string) => {
        win.__w!.push(`${k}=${v}`);
        return orig(k, v);
      };
      const before = d.documentElement.dataset.theme;
      d.dispatchEvent(new KeyboardEvent('keydown', { key: 't', bubbles: true }));
      d.body.dispatchEvent(new KeyboardEvent('keydown', { key: 't', bubbles: true }));
      return { before, theme: d.documentElement.dataset.theme, writes: win.__w };
    });
    expect(r.theme, 'T 不该翻转 data-theme').toBe(r.before);
    expect(r.writes, 'T 不该往同源 localStorage 写 archify-*').toEqual([]);
  });

  test('恒 dark：旧 light 存档被无视（不被 archify 的 prefers-color-scheme 覆写）', async ({
    page,
  }) => {
    /**
     * 旧契约（两档）已退役：写 8bitme:mode='light' 没人读——UI 恒暗是**特性**，
     * 不是兼容性缺口。同时守 archify 自己的 prefers-color-scheme 回退不能反超：
     * 皮肤的主题块（html:root[data-gb]）必须压住它的媒体查询分支。
     */
    await page.goto('/');
    await page.evaluate(() => localStorage.setItem('8bitme:mode', 'light'));
    await page.goto(VIEWER);
    await readyFrame(page);
    const got = await page.evaluate(() => {
      const d = document.querySelector<HTMLIFrameElement>('.lab-frame')!.contentDocument!;
      return {
        gb: d.documentElement.dataset.gb,
        mode: d.documentElement.dataset.theme,
        bg: d.defaultView!.getComputedStyle(d.documentElement)
          .getPropertyValue('--bg')
          .trim(),
      };
    });
    expect(got.gb, '旧 light 存档不该换来 light 分支').toBe('dark');
    expect(got.mode, 'iframe 只该走 dark 分支').toBe('dark');
    expect(got.bg.toLowerCase(), '恒暗底色').toBe('#0b102c');
  });


});

test.describe('/lab 像素媒介与可读性', () => {
  test('iframe 内文字由 Zpix 绘制，且带字号的文字都不低于 11 用户单位', async ({ page }) => {
    /**
     * 修正（2026-09-10 审计）：原来这条只量「第一个 svg text」（font-size 9 档 → 11.63px），
     * 而图里最小的是 7/8 档 —— **断言取错了元素，把「最小字」放过去了**。
     * 现在量全部带 font-size 的 text，判据用**用户单位**（皮肤施加的字号），
     * 屏幕尺寸另行记录：12 用户单位在 1202px 宽图上 = 11.63px。
     *
     * 为什么最小档不是站内的 12px：走线标签的挖空框是 archify 按原文大小算好的
     * （「只取可信行」框宽 61 单位），而 Zpix 的 CJK 前进量是 13/12 em —— 12px 下 5 字 = 65 单位，
     * 溢出框外，箭头线会从文字边上露出来。见 ADR-0016 §十二。
     */
    await page.goto(VIEWER);
    await readyFrame(page);
    const r = await page.evaluate(() => {
      const d = document.querySelector<HTMLIFrameElement>('.lab-frame')!.contentDocument!;
      const w = d.defaultView!;
      const svg = d.querySelector('svg')!;
      const scale = svg.getBoundingClientRect().width / svg.viewBox.baseVal.width;
      const texts = [...svg.querySelectorAll('text')].filter((t) => t.hasAttribute('font-size'));
      const sizes = texts.map((t) => parseFloat(w.getComputedStyle(t).fontSize));
      return {
        font: w.getComputedStyle(texts[0]!).fontFamily.split(',')[0],
        count: texts.length,
        minCss: Math.min(...sizes),
        minScreen: Math.min(...sizes) * scale,
      };
    });
    expect(r.count).toBeGreaterThan(10);
    expect(r.font).toBe('Zpix');
    expect(r.minCss, '图内最小字号（用户单位）').toBeGreaterThanOrEqual(11);
    // 屏幕下界：舞台 1202px（1440 视口）→ 11 单位 = 10.66px；
    // 舞台掉到 min-width 1150（视口 ≲1390px）→ 10.20px。这是全站最小的图内文字，
    // 且无法再抬：抬到站内 12px 档会撑破 archify 算好的挖空框（见上）。数值进了 ADR-0016 §十二 等作者拍板。
    expect(r.minScreen).toBeGreaterThanOrEqual(10.2);
  });

  test('泳道框真的是 8,8 虚线（`.c-lane rect` 是后代选择器，从来匹配不到）', async ({ page }) => {
    /**
     * 2026-09-10 审计实测：archify 把 class 挂在 `<rect class="c-lane">` 自己身上，
     * 皮肤写的 `html[data-gb] .c-lane rect` 一条也没命中 —— 泳道一直在用 archify 的 6,6。
     * 页面上看不出异常，只有量 computed style 才发现。
     */
    await page.goto(VIEWER);
    await readyFrame(page);
    const lane = await page.evaluate(() => {
      const d = document.querySelector<HTMLIFrameElement>('.lab-frame')!.contentDocument!;
      const cs = d.defaultView!.getComputedStyle(d.querySelector('.c-lane')!);
      return { dash: cs.strokeDasharray.replace(/\s/g, ''), fill: cs.fill, width: cs.strokeWidth };
    });
    expect(lane.dash).toBe('8px,8px');
    expect(lane.fill).toBe('none');
    expect(lane.width).toBe('2px');
  });

  test('走线的箭头端点不许落在挖空板里（否则箭头被切掉一截）', async ({ page }) => {
    /**
     * 背景（2026-09-10 作者看图发现「箭头被遮挡了」）：
     * 标签板（`.c-mask`）默认覆盖到标签基线下方 16 单位，而水平走线就在基线下方 10 单位处 ——
     * 于是板子把线中段和**箭头尾部**一起抹掉了：屏幕上只剩一条短棍 + 一个悬空三角。
     * 这不是皮肤改出来的（A/B 对比 HEAD 产物同样如此），是规格里标签贴在线上导致的。
     * 修法：规格给每条 flow 加 `labelDy`（把标签和它的板抬到线之上）——
     * 板子不再压线，箭头恢复完整。这条断言把「箭头端点不能落在任何板子里」钉住。
     */
    await page.goto(VIEWER);
    await readyFrame(page);
    const bad = await page.evaluate(() => {
      const d = document.querySelector<HTMLIFrameElement>('.lab-frame')!.contentDocument!;
      const svg = d.querySelector('.diagram-container > svg')!;
      const out: { edge: string; tip: string }[] = [];
      // 只看**标签板**（走线标签组里的 .c-mask）；节点自己的板不算遮挡
      svg.querySelectorAll('g[data-detail="context"]').forEach((g) => {
        const mask = g.querySelector(':scope > rect.c-mask');
        // 注意：edge 属性挂在 <g> 自己身上（不是后代）—— 第一版写成了 g.querySelector，
        // 永远拿到 null，于是断言恒绿（假绿）。这类"查询写错层级"的教训见 ADR-0016 §十二。
        const edgeKey = g.getAttribute('data-edge-key');
        if (!mask || edgeKey === null || edgeKey === undefined) return;
        const path = svg.querySelector(`path[data-edge-key="${edgeKey}"]`);
        const pts = (path?.getAttribute('data-composition-points') || '')
          .split(';')
          .map((v) => v.split(',').map(Number));
        const tip = pts[pts.length - 1];
        if (!tip || tip.length !== 2) return;
        const m = {
          x: Number(mask.getAttribute('x')),
          y: Number(mask.getAttribute('y')),
          w: Number(mask.getAttribute('width')),
          h: Number(mask.getAttribute('height')),
        };
        // 板子压住箭头所在的这条线（端点往回 12 单位）就算遮挡
        // 箭头本体占 [tip-10, tip]（marker 长 10 单位）：板子与这段相交 = 切掉一截
        const arrowSpansMask = m.x <= tip[0] && m.x + m.w >= tip[0] - 10;
        const maskCoversLine = tip[1] >= m.y - 1 && tip[1] <= m.y + m.h + 1;
        if (arrowSpansMask && maskCoversLine) {
          out.push({ edge: edgeKey, tip: tip.join(',') });
        }
      });
      return out;
    });
    expect(bad, '有走线的箭头被挖空板盖住了（标签该用 labelDy 抬离走线）').toEqual([]);
  });

  test('文字不超出自己的挖空框（给「再把字放大一档」留的刹车）', async ({ page }) => {
    /**
     * 为什么量「前进量 vs 框宽」：这两个数直接决定字号还能不能往上抬。
     * 实测（2026-09-10）：最紧的「只取可信行」= 60 / 61 单位（余 1）；
     * 走线分类行「TRY_CAST」= 52.9 / 51.2（**已超 1.7**，改前就超 1.1）。
     * 1.7 单位 ≈ 1.2 屏幕 px，且字形墨迹不到边（前进量含字侧空隙），故不修 ——
     * 但上界要守住：一旦有人把 7/8 档抬到 12px，这里会直接报出来。
     */
    await page.goto(VIEWER);
    await readyFrame(page);
    const rows = await page.evaluate(() => {
      const d = document.querySelector<HTMLIFrameElement>('.lab-frame')!.contentDocument!;
      const out: { text: string; over: number }[] = [];
      d.querySelectorAll('svg g').forEach((g) => {
        const mask = g.querySelector(':scope > rect.c-mask');
        if (!mask) return;
        const width = Number(mask.getAttribute('width'));
        g.querySelectorAll<SVGTextElement>(':scope > text').forEach((t) => {
          const adv = t.getComputedTextLength();
          if (adv > 0) out.push({ text: (t.textContent || '').slice(0, 12), over: adv - width });
        });
      });
      return out;
    });
    expect(rows.length).toBeGreaterThan(0);
    const worst = rows.reduce((a, b) => (b.over > a.over ? b : a));
    expect(worst.over, `「${worst.text}」超出挖空框 ${worst.over.toFixed(2)} 单位`).toBeLessThanOrEqual(2);
  });

  test('窄屏：内边距不白吃屏宽（旧「角点不切入内容」随 .pp-pad 退役）', async ({ browser }) => {
    /**
     * 背景（2026-09-11 实测）：390px 下 iframe 可用宽原本只有 216px，而**在开始横滚之前**
     * 图已经被四层内边距吃掉 128px（每侧 64px）。
     * 实测基线：改前 iframe 250 / 横滚 5.4 屏；改后 314 / 横滚 4.19 屏。
     * ADR-0021：.pp-pad 角点已退役，「角点不切入内容」的制约断言随之删除；
     * 面板 padding 已无角点带约束，但仍守住 iframe 宽度下限。
     */
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.goto(VIEWER);
    await readyFrame(page);

    const r = await page.evaluate(() => {
      const frame = document.querySelector<HTMLElement>('.lab-frame')!;
      const fr = frame.getBoundingClientRect();
      const c = frame as HTMLIFrameElement;
      const scroller = c.contentDocument!.querySelector('.diagram-container')!;
      return {
        frameW: Math.round(fr.width),
        scrollScreens: +(scroller.scrollWidth / scroller.clientWidth).toFixed(2),
      };
    });
    await ctx.close();

    expect(r.frameW, `390px 下 iframe 只有 ${r.frameW}px，内边距又在白吃屏宽了`).toBeGreaterThanOrEqual(300);
    // 记录横滚量：不许比修前（5.4 屏）更差
    expect(r.scrollScreens, '窄屏横滚屏数退步了').toBeLessThanOrEqual(5.4);
  });

  test('390px：侧栏停靠栏不得挡住 iframe 内的交互控件（余量只有 8px）', async ({ browser }) => {
    /**
     * 背景（2026-09-11 实测）：侧栏 SideDock 在 ≤960px 停靠右下角（V7），
     * 它的假定是「整屏 section 的内容垂直居中，底缘是唯一没有内容的一带」。
     * **这条假定对 /lab 不成立** —— 这里 iframe 顶到视口底，底缘全是内容。
     *
     * 实测下来没有真缺陷，但**成立的理由很险**：
     *   - archify 的缩放按钮在 .diagram-nav 里，它自带 overflow-x:auto（390px 下可滚 110px）
     *   - nav 右缘 = 321px（页面坐标），dock 左缘 = 329px —— **只差 8px**
     *   - 横滑 nav 到底后，三个缩放控件（Zoom out / Zoom in again / Zoom in）
     *     中心点 hit-test 全部无遮挡
     *
     * 也就是说：「窄屏下缩放能用」**不靠设计保证，靠 8px 巧合**。
     * 任何人改 dock 宽度、nav 定位或 .lab-wide 宽度都可能破掉它，
     * 而破掉之后的症状是「手机上放大不了」——静默、难查。故立此守线。
     *
     * 顺带记两条同一次实测的边界（不要误判为缺陷）：
     *   ① 双指捉合**本就不支持**（standalone 直接打开产物也同样无效）——
     *      与本站的两条 stopPropagation 无关，是 archify 没有这个手势。
     *   ② 缩放控件在窄屏需**横滑 nav** 才全部可见（与图需横滚同类），
     *      初始状态下「Zoom in again」恰好落在 dock 下方、
     *      「Zoom in」在视口外 —— 那是横滑前的位置，不是不可达。
     */
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.goto(VIEWER);
    await readyFrame(page);

    const probe = () =>
      page.evaluate(() => {
        const fEl = document.querySelector<HTMLIFrameElement>('.lab-frame')!;
        const fr = fEl.getBoundingClientRect();
        const doc = fEl.contentDocument!;
        const nav = doc.querySelector<HTMLElement>('.diagram-nav')!;
        const navRect = nav.getBoundingClientRect();
        const rows: { label: string; blocker: string | null }[] = [];
        for (const b of doc.querySelectorAll('button')) {
          const label = b.getAttribute('aria-label') || '';
          if (!/^Zoom/.test(label)) continue;
          const q = b.getBoundingClientRect();
          const sx = fr.left + q.x + q.width / 2;
          const sy = fr.top + q.y + q.height / 2;
          const top = document.elementFromPoint(sx, sy);
          const blocked = top !== fEl && !fEl.contains(top as Node);
          rows.push({
            label: label.slice(0, 22),
            blocker: blocked ? `${top?.tagName}.${(top?.className || '').toString().split(' ')[0]}` : null,
          });
        }
        return {
          navRight: Math.round(fr.left + navRect.right),
          frameRight: Math.round(fr.right),
          zoomButtons: rows.length,
          rows,
        };
      });

    // 2026-09-25：右侧 SET 仓只在 DEV 构建存在，生产没有那块「侧栏」可参照了——
    // 判据退到「nav 不许越出帧右缘」（越出即被裁/被挡），真正的拦截仍由下面的
    // elementFromPoint 逐控件检查承担（那才是「能不能点」的真判据）。
    const init = await probe();
    expect(
      init.navRight,
      `nav 右缘 ${init.navRight} 越出帧右缘 ${init.frameRight}`
    ).toBeLessThanOrEqual(init.frameRight);

    // 横滑 nav 到底（archify 自带的可滚行为），三个缩放控件必须全部可点
    await page.evaluate(() => {
      const doc = document.querySelector<HTMLIFrameElement>('.lab-frame')!.contentDocument!;
      doc.querySelector<HTMLElement>('.diagram-nav')!.scrollLeft = 9999;
    });
    await page.waitForTimeout(300);
    const after = await probe();
    await ctx.close();

    expect(after.zoomButtons, '缩放控件数量不对（archify 改版？）').toBeGreaterThanOrEqual(2);
    for (const r of after.rows) {
      expect(r.blocker, `横滑后「${r.label}」仍被 ${r.blocker} 挡住 —— 窄屏下放大不了`).toBeNull();
    }
  });

  test('窄屏 + 放大后：触摸拖拽只走原生横滚，不再与 pan 双重位移', async ({ browser }) => {
    /**
     * 2026-09-10 审计实测（CDP 真触摸事件，390px 视口 + 150% 缩放）：
     * 一次横滑之后 `scrollLeft 0 → 147` **且** `translateX -420.5 → -440.5` ——
     * archify 的 pan 处理与容器原生滚动同时生效，位移量翻倍。
     * （100% 时不会：它的 pan 在 scale<=1 直接 return。）
     * 站点立场是「宁可让读者滚一下」，所以窄屏触摸只保留滚动。
     */
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
    const page = await ctx.newPage();
    await page.goto(VIEWER);
    await readyFrame(page);
    await page.evaluate(() => {
      const d = document.querySelector<HTMLIFrameElement>('.lab-frame')!.contentDocument!;
      const nav = d.querySelector('.diagram-nav')!;
      nav.querySelector<HTMLElement>('[data-view="in"]')!.click();
      nav.querySelector<HTMLElement>('[data-view="in"]')!.click();
    });
    await page.waitForTimeout(250);

    const state = () =>
      page.evaluate(() => {
        const d = document.querySelector<HTMLIFrameElement>('.lab-frame')!.contentDocument!;
        return {
          scrollLeft: d.querySelector('.diagram-container')!.scrollLeft,
          transform: d.querySelector('.diagram-container > svg')!.getAttribute('style'),
        };
      });
    // 起点必须落在「空背景」上：archify 的 pan 在节点/面板上本来就 return，
    // 落在节点上会假绿（这条在红证里实测踩过 —— 第一版坐标正好压在节点框里，旧代码也「通过」）。
    const box = (await page.locator('.lab-frame').boundingBox())!;
    const empty = await page.evaluate(() => {
      const d = document.querySelector<HTMLIFrameElement>('.lab-frame')!.contentDocument!;
      const c = d.querySelector('.diagram-container')!;
      const cr = c.getBoundingClientRect();
      const blocked = (el: Element | null) =>
        !!el?.closest(
          '[data-node-id],button,a,input,.diagram-nav,.focus-chip,.overview-map,.route-probe,.semantic-lens,.diagram-guide,.node-finder'
        );
      for (let y = cr.top + 8; y < cr.bottom - 8; y += 3) {
        for (let x = cr.left + 8; x < cr.right - 8; x += 3) {
          if (!blocked(d.elementFromPoint(x, y))) return { x, y };
        }
      }
      return null;
    });
    expect(empty, '没找到可用于拖拽的空背景点').not.toBeNull();
    const cx = box.x + empty!.x;
    const cy = box.y + empty!.y;
    const before = await state();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy, id: 1 }] });
    for (let i = 1; i <= 6; i += 1) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: cx - i * 20, y: cy, id: 1 }],
      });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(300);
    const after = await state();
    expect(after.scrollLeft, '滚动该生效').toBeGreaterThan(before.scrollLeft);
    expect(after.transform, 'pan 不该同时位移').toBe(before.transform);
    await ctx.close();
  });

  test('图内线宽只有 2px 一档（像素语言的线宽白名单）', async ({ page }) => {
    await page.goto(VIEWER);
    await readyFrame(page);
    const widths = await page.evaluate(() => {
      const d = document.querySelector<HTMLIFrameElement>('.lab-frame')!.contentDocument!;
      const w = d.defaultView!;
      const out = new Set<string>();
      d.querySelectorAll('svg rect, svg path').forEach((el) => {
        const sw = w.getComputedStyle(el).strokeWidth;
        if (sw && sw !== '0px') out.add(sw);
      });
      return [...out];
    });
    expect(widths).toEqual(['2px']);
  });

  test('站内只留一套主题开关（archify 自带的 Light 按钮被隐藏）', async ({ page }) => {
    await page.goto(VIEWER);
    await readyFrame(page);
    const themeBtnVisible = await page.evaluate(() => {
      const d = document.querySelector<HTMLIFrameElement>('.lab-frame')!.contentDocument!;
      const b = d.getElementById('btn-theme');
      return b ? d.defaultView!.getComputedStyle(b).display !== 'none' : false;
    });
    expect(themeBtnVisible).toBe(false);
  });

  test('pan/zoom 工具保留（嵌入模式没把工具栏一起藏掉）', async ({ page }) => {
    await page.goto(VIEWER);
    await readyFrame(page);
    const ok = await page.evaluate(() => {
      const d = document.querySelector<HTMLIFrameElement>('.lab-frame')!.contentDocument!;
      const w = d.defaultView!;
      const tb = d.querySelector('.toolbar');
      const nav = d.querySelector('.diagram-nav');
      const vis = (el: Element | null) =>
        !!el && w.getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0;
      return { toolbar: vis(tb), nav: vis(nav) };
    });
    expect(ok.toolbar).toBe(true);
    expect(ok.nav).toBe(true);
  });

  test('挖空层 .c-mask 一个都不能被隐藏（关掉它 = 箭头线穿过标签文字）', async ({
    page,
  }) => {
    /**
     * 背景（2026-09-10 作者发现）：悬停节点时「幂等写入」被箭头线穿过、读不出来。
     * 根因是皮肤把 `.c-mask` 当装饰层一起 `display:none` 了，
     * 而它是 archify 的挖空层（`opaque mask rect to hide arrows underneath`）。
     *
     * 这里不断言「元素存在」——断言它**真的在画**：display 不是 none、
     * opacity 不是 0、fill 是不透底的（alpha=1）。三条任一破了，线就会透出来。
     */
    await page.goto(VIEWER);
    await readyFrame(page);
    const masks = await page.evaluate(() => {
      const d = document.querySelector<HTMLIFrameElement>('.lab-frame')!.contentDocument!;
      const w = d.defaultView!;
      return [...d.querySelectorAll('svg .c-mask')].map((m) => {
        const cs = w.getComputedStyle(m);
        return { display: cs.display, opacity: cs.opacity, fill: cs.fill, visibility: cs.visibility };
      });
    });
    expect(masks.length, '产物里应当有挖空层').toBeGreaterThan(0);
    const broken = masks.filter(
      (m) => m.display === 'none' || m.visibility === 'hidden' || Number(m.opacity) < 0.99
    );
    expect(broken, '挖空层被隐藏了 —— 箭头线会穿过标签文字').toEqual([]);
    // 不透底的填充：rgb() 而不是 rgba()
    expect(masks.every((m) => /^rgb\(/.test(m.fill))).toBe(true);
  });

  test('每条走线标签都被一块不漏底的挖空层盖住（真在像素上验证，不是看属性）', async ({
    page,
  }) => {
    await page.goto(VIEWER);
    await readyFrame(page);

    /** 同一区域拍两次：一次正常，一次把挖空层关掉。若两张图完全一样，
     *  说明挖空层根本没在干活（标签下面本来就没线，或者它被废了）。
     *  这比“断言元素存在”硬：它直接证明“线确实被遮住了”。 */
    const clipOf = async () =>
      page.evaluate(() => {
        const d = document.querySelector<HTMLIFrameElement>('.lab-frame')!.contentDocument!;
        const svg = d.querySelector('.diagram-container > svg')!;
        const t = [...svg.querySelectorAll('text')].find((x) =>
          (x.textContent || '').includes('幂等写入')
        )!;
        const r = t.getBoundingClientRect();
        const f = document.querySelector<HTMLIFrameElement>('.lab-frame')!.getBoundingClientRect();
        return { x: f.left + r.left, y: f.top + r.top, width: r.width, height: r.height };
      });

    const clip = await clipOf();
    const withMask = await page.screenshot({ clip });

    await page.evaluate(() => {
      const d = document.querySelector<HTMLIFrameElement>('.lab-frame')!.contentDocument!;
      const s = d.createElement('style');
      s.textContent = 'svg .c-mask{display:none!important}';
      d.head.appendChild(s);
    });
    const withoutMask = await page.screenshot({ clip });

    expect(
      Buffer.compare(withMask, withoutMask),
      '关掉挖空层后这一块像素没任何变化 —— 说明挖空层没在遮线，或者线根本没穿过标签'
    ).not.toBe(0);
  });

  test('页面无横向溢出（舞台加宽没有撑破布局）', async ({ page }) => {
    for (const vp of [
      { width: 1920, height: 1000 },
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(vp);
      await page.goto(VIEWER);
      await readyFrame(page);
      const over = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 1
      );
      expect(over, `${vp.width}px 下有横向溢出`).toBe(false);
    }
  });
});

test.describe('/lab 入场通电（trace 动效）', () => {
  /**
   * 背景（2026-09-17，动画线第二块）：`/lab/<id>` 的 4 条图内走线进入时**一次性上电** ——
   * 虚线沿走线扫过一遍（每条 2.4s，错峰 160ms），扫完**定格为原本的 2px 实线**，之后完全静止。
   *
   * 这里只守浏览器里才成立的事（静态契约在 tests/unit/lab.spec.ts）：
   *   ① 真的在动 + 动完真的回到干净实线（结构线不许常态变虚线 —— line-hierarchy.md §一）
   *   ② reduced-motion 下一步都不动（本站豁免若带 !important 会反杀这条）
   *   ③ 通电中途线宽仍恒为 2px（皮肤那条 stroke-width:2!important 真能压住动画）
   *   ④ 上游的「暂停动效」开关被藏掉（藏按钮 ≠ 关开关，那条旁路由 boot script 清）
   *
   * 「真的在动」一律用 pause + seek 再比 computed 值，**不用「等一会儿再采样」**
   * （写法取自 tests/e2e/flow-diagram.spec.ts：canvas 整数定位 + 50% 阈值扫墨迹）：
   * 动画的 0% 与 100% 两个相位都可能正好落在基态（dashoffset 0），随便取两个时刻
   * 会得到「看起来没动」的假红。
   */

  const EDGE = 'svg[data-animation="trace"] [data-animate="edge"]';
  const NODE = '[data-animate="node"]';

  /**
   * 定位走线动画：皮肤现在自带 keyframes 与 name（`gb-edge-flow`），装载即扫一次。
   *
   * **2026-10-29 换 archify 3.2 产物时改过这里**：旧版靠 `data-ambient-motion=running`
   * 门控、由 archify 的 motion governor 驱动，所以要「先把 governor 逼到 settled 再手动
   * 置 running」才能重放。3.2 把 archify-edge-flow 删了（边缘动画改成用户触发的
   * .intent-trace-flow / .route-journey-flow），governor 初始态也变成 `paused` ——
   * 于是「等 settled」这条路径永远等不到。本站在皮肤里自带动画后，重放不再需要 governor：
   * 直接拿 `getAnimations()` 上的那个 Animation，pause + 设 currentTime 就能定格任意相位。
   * 断言口径不变：真的在扫、扫完回到干净实线、reduced-motion 一步不动、中途线宽恒 2px。
   */
  const EDGE_ANIM = 'gb-edge-flow';

  test('入场通电真的在跑，且扫完定格为 2px 实线（核心）', async ({ page }) => {
    await page.goto(VIEWER);
    await readyFrame(page);

    const motion = await page.evaluate((sel) => {
      const d = document.querySelector<HTMLIFrameElement>('.lab-frame')!.contentDocument!;
      const cs = d.defaultView!.getComputedStyle(d.querySelector(sel)!);
      return {
        name: cs.animationName,
        duration: cs.animationDuration,
        timing: cs.animationTimingFunction,
        iterations: cs.animationIterationCount,
      };
    }, EDGE);
    expect(motion.name, '走线没挂上本站的 gb-edge-flow（皮肤自带 keyframes）').toBe(EDGE_ANIM);
    // 时长/阶跃来自皮肤（TRACE 单一数据源），不是上游 shorthand 里那个 linear
    expect(motion.duration).toBe('2.4s');
    expect(motion.timing, '阶跃曲线没生效（应是 steps(12,end) 的整齿）').toContain('steps(12');
    // 硬约束：只能一次性。周期循环会让结构线常态变虚线（line-hierarchy.md §一）
    expect(motion.iterations, '通电成了循环 —— 结构线会常态变虚线').toBe('1');

    /* ① 真的在动：暂停后 seek 到几个相位比 computed stroke-dashoffset。
       第 1 条走线 --step:0（延迟 0），所以 currentTime 就是动画进度，不涉及延迟相位。 */
    const probe = await page.evaluate((sel) => {
      const d = document.querySelector<HTMLIFrameElement>('.lab-frame')!.contentDocument!;
      const w = d.defaultView!;
      const el = d.querySelector<SVGPathElement>(sel)!;
      const anim = el.getAnimations()[0]!;
      anim.pause();
      const at = (t: number) => {
        anim.currentTime = t;
        return w.getComputedStyle(el).strokeDashoffset;
      };
      const seen = { start: at(100), mid: at(1200), late: at(2200) };
      anim.play(); /* 交还控制权，下游要等它真的跑完 */
      return seen;
    }, EDGE);
    expect(
      probe.mid,
      `seek 到 100ms 与 1200ms 的 dashoffset 相同（${probe.start}）—— 关键帧没在动`
    ).not.toBe(probe.start);
    expect(probe.late, `seek 到 2200ms 与 1200ms 相同（${probe.mid}）`).not.toBe(probe.mid);

    /* ② 稳态：跑完回到干净实线（不是停在半途的虚线段、不是发灰的半透明） */
    /* 期望色从**父页**的 --gb-2 / --gb-3 取（iframe 产物里并没有 --gb-* 这组 token，
       它只有皮肤派生的 --arrow / --arrow-emphasis）。用父页真身而不是 iframe 自己的
       --arrow，是为了让这条断言是「跨文档主题同步 + 皮肤映射」两件事的合验，
       否则皮肤把 --arrow 映射错颜色时这条会跟着一起错。 */
    const theme = await page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      const probe = document.createElement('span');
      document.body.appendChild(probe);
      const resolve = (token: string) => {
        probe.style.color = cs.getPropertyValue(token);
        return getComputedStyle(probe).color;
      };
      const out = { gb2: resolve('--c-accent'), gb3: resolve('--c-text') };
      probe.remove();
      return out;
    });

    const snapshot = () =>
      page.evaluate(
        ([edgeSel, nodeSel]) => {
          const d = document.querySelector<HTMLIFrameElement>('.lab-frame')!.contentDocument!;
          const w = d.defaultView!;
          return {
            edges: [...d.querySelectorAll(edgeSel)].map((el) => {
              const cs = w.getComputedStyle(el);
              return {
                key: el.getAttribute('data-edge-key'),
                emphasis: (el.getAttribute('class') || '').includes('a-emphasis'),
                dash: cs.strokeDasharray,
                width: cs.strokeWidth,
                opacity: cs.opacity,
                stroke: cs.stroke,
              };
            }),
            nodes: [...d.querySelectorAll(nodeSel)].map((el) => w.getComputedStyle(el).strokeWidth),
          };
        },
        [EDGE, NODE] as const
      );

    await expect
      .poll(
        async () => {
          const s = await snapshot();
          return s.edges.every(
            (e) => e.dash === 'none' && e.width === '2px' && e.opacity === '1'
          );
        },
        { timeout: 6000, message: '6s 内走线没回到稳态实线（动画定格在虚线段？）' }
      )
      .toBe(true);

    const s = await snapshot();
    expect(s.edges.length, '走线数量不对').toBe(4);
    for (const e of s.edges) {
      expect(e.dash, `走线 ${e.key} 稳态仍是虚线`).toBe('none');
      expect(e.width, `走线 ${e.key} 稳态线宽不是 2px`).toBe('2px');
      expect(e.opacity, `走线 ${e.key} 稳态半透明（动画残留）`).toBe('1');
      // 稳态颜色必须是主题自己的结构线色：走线默认档 --arrow = gb-2，
      // emphasis 档 --arrow-emphasis = gb-3（skin.mjs 的主题块）—— 两档都是主题派生的，
      // 不得出现「动画留下的中间色 / 发灰」。
      expect(
        e.stroke,
        `走线 ${e.key} 稳态颜色不是本档的 ${e.emphasis ? '--c-text' : '--c-accent'}（${e.emphasis ? theme.gb3 : theme.gb2}）`
      ).toBe(e.emphasis ? theme.gb3 : theme.gb2);
    }
    // 一条旁证：稳态时节点也没有任何动画残留（脉冲被归零，且没留下 drop-shadow 的糊化痕迹）
    expect(new Set(s.nodes)).toEqual(new Set(['2px']));
  });

  test('reduced-motion：即使手动 arm 通电，也一步都不许动', async ({ page }) => {
    /**
     * archify 自带 `@media (prefers-reduced-motion:reduce){ svg[data-animation="trace"] [data-animate]{animation:none!important} }`
     * （template.html:4703-4711）。本站的豁免规则**刻意不带 !important**，就是为了不压过它：
     * 两者都带 important 时比特异性，我们的更高，本站规则会赢 —— 那就变成
     * 「开了 reduced-motion 的读者照样看到走线在扫」，是反杀无障碍而非风格取舍。
     *
     * 光断言「没在动」不够（那可能是因为 trace 能力缺失、或动画本来就没 arm）：
     * 这里**手动把门控属性挂成 running**（等价于“用户没开 reduce 时的状态”），
     * 若豁免带了 important（尤其是带 animation-name 的简写），这一步就会漏。
     */
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(VIEWER);
    await readyFrame(page);

    const r = await page.evaluate((sel) => {
      const d = document.querySelector<HTMLIFrameElement>('.lab-frame')!.contentDocument!;
      const w = d.defaultView!;
      return {
        edges: [...d.querySelectorAll(sel)].map((el) => {
          const cs = w.getComputedStyle(el);
          return {
            name: cs.animationName,
            running: el.getAnimations().filter((a) => a.playState === 'running').length,
            dash: cs.strokeDasharray,
            width: cs.strokeWidth,
            opacity: cs.opacity,
          };
        }),
      };
    }, EDGE);

    // 正向对照：同一个产物在 no-preference 下 MUST 有动画，
    // 否则下面那串「animationName 是 none」可能只是「动画根本没挂上」的假绿。
    expect(r.edges.length).toBe(4);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.reload();
    await readyFrame(page);
    const armed = await page.evaluate(
      (sels) =>
        [...document.querySelector<HTMLIFrameElement>('.lab-frame')!.contentDocument!.querySelectorAll(sels)].map(
          (el) => el.getAnimations().length
        ),
      EDGE
    );
    expect(armed, 'no-preference 下走线没挂上动画 —— 那条 reduced 断言就成了假绿').toEqual([1, 1, 1, 1]);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(VIEWER);
    await readyFrame(page);
    for (const e of r.edges) {
      expect(e.name, 'reduced-motion 下走线仍挂着动画名 —— 豁免带 !important 反杀了无障碍').toBe(
        'none'
      );
      expect(e.running).toBe(0);
      expect(e.dash).toBe('none');
      expect(e.width).toBe('2px');
      expect(e.opacity).toBe('1');
    }
  });

  test('通电中途线宽恒为 2px（stroke-width:2!important 真的压得住动画）', async ({ page }) => {
    /**
     * 为什么要这一条：走线的关键帧只动 dasharray/dashoffset/opacity，**不动线宽**；
     * 真正会改线宽的是节点脉冲（`stroke-width:1.5 → 2.4`，template.html:4629-4635）。
     * 而节点脉冲被皮肤归零了（0s）—— 直接量它等于量「动画根本没跑」，是假绿。
     * 所以这里用 inline `!important` 把节点的时长按回 3.6s（内联 important 是唯一能压过
     * 皮肤 important 的层叠位次），让它**真的在关键帧上**，再看皮肤那条能不能压住宽度。
     * 若哪天有人删掉 `stroke-width:2!important`，这条会立刻红（2.4px）。
     */
    await page.goto(VIEWER);
    await readyFrame(page);

    const r = await page.evaluate(
      ([edgeSel, nodeSel]) => {
        const d = document.querySelector<HTMLIFrameElement>('.lab-frame')!.contentDocument!;
        const w = d.defaultView!;
        const edge = d.querySelector<SVGPathElement>(edgeSel)!;
        const node = d.querySelector<SVGElement>(nodeSel)!;

        // ① 走线：seek 到 18% 相位
        const ea = edge.getAnimations()[0]!;
        ea.pause();
        ea.currentTime = 0.18 * 2400;
        const edgeState = {
          width: w.getComputedStyle(edge).strokeWidth,
          dash: w.getComputedStyle(edge).strokeDasharray,
          opacity: w.getComputedStyle(edge).opacity,
        };

        // ② 节点：把被归零的脉冲临时按回来（inline important），再 seek 到 18%。
        // 2026-10-29：3.2 的节点脉冲只在 data-ambient-entry="running" 下才挂 name，
        // 不再「恒定挂着 animation + 0s 时长」，所以这里连 name 一起显式写回 ——
        // 本条的考点是「皮肤 stroke-width:2!important 压不压得住关键帧」，不是上游的门控。
        node.style.setProperty('animation-name', 'archify-node-pulse', 'important');
        node.style.setProperty('animation-duration', '3.6s', 'important');
        node.style.setProperty('animation-iteration-count', '1', 'important');
        const na = node.getAnimations()[0];
        const nodeName = w.getComputedStyle(node).animationName;
        if (na) {
          na.pause();
          na.currentTime = 0.18 * 3600;
        }
        return {
          edgeState,
          nodeName,
          nodeWidth: w.getComputedStyle(node).strokeWidth,
          nodeFilter: w.getComputedStyle(node).filter,
        };
      },
      [EDGE, NODE] as const
    );

    // 先确认「确实采到了动画中途」——否则宽度断言是空的
    expect(r.edgeState.dash, '走线没落在关键帧的虚线段上').not.toBe('none');
    expect(Number(r.edgeState.opacity), '走线没落在关键帧的不透明段上').toBeLessThan(1);
    expect(r.edgeState.width).toBe('2px');

    // 节点：18% 那一帧写着 stroke-width 2.4 + drop-shadow，皮肤两条 !important 必须都压住
    expect(r.nodeName, '节点脉冲没被按回来，宽度断言会是空的').toBe('archify-node-pulse');
    expect(r.nodeWidth, '节点脉冲把线宽顶到 2.4px 了 —— stroke-width:2!important 没生效').toBe(
      '2px'
    );
  });

  test('#btn-motion（暂停动效开关）在 iframe 内被藏掉且不占位', async ({ page }) => {
    /**
     * 入场是一次性的：跑完就没有可暂停的东西。留着这个开关只会给「结构线常态变虚线」开入口，
     * 它还会往同源 localStorage 写第二套偏好键 archify-motion（非本站 8bitme:* 约定）。
     * 注意断言的是「元素在、但被藏」，不是「元素不存在」—— 后者会在 archify 改版删掉它时假绿。
     */
    await page.goto(VIEWER);
    await readyFrame(page);
    const s = await page.evaluate(() => {
      const d = document.querySelector<HTMLIFrameElement>('.lab-frame')!.contentDocument!;
      const b = d.getElementById('btn-motion');
      return {
        exists: !!b,
        display: b ? d.defaultView!.getComputedStyle(b).display : '(缺失)',
        width: b ? b.getBoundingClientRect().width : -1,
        hiddenAttr: b ? b.hasAttribute('hidden') : null,
      };
    });
    expect(s.exists, '#btn-motion 不存在了 —— archify 改版？本条会变成假绿').toBe(true);
    expect(s.display).toBe('none');
    expect(s.width).toBe(0);
    // 上游 capability 分支会摘掉 hidden 属性，所以藏住它的**只能是**皮肤那条 CSS
    expect(s.hiddenAttr, 'hidden 属性还在，说明藏是上游干的 —— 皮肤那条没生效').toBe(false);
  });
});

test.describe('/lab 无副作用', () => {
  test('访问图册不产生控制台报错；页面壳除天气外零站外请求、iframe 产物零站外请求', async ({
    page,
  }) => {
    const errors: string[] = [];
    const shellForeign: string[] = [];
    const frameForeign: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('request', (r) => {
      const u = r.url();
      // 预览服 webServer 起在 127.0.0.1（另有 404 资源日志不算站外）
      const self = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//;
      if (!/^https?:/.test(u) || self.test(u)) return;
      if (r.frame() === page.mainFrame()) {
        // 页面壳（BaseLayout → BgFx）：允许「窗外」世界的天气请求
        // （ADR-0020：主站唯一运行时外部请求，作者批准的例外）。
        if (/^https:\/\/api\.open-meteo\.com\//.test(u)) return;
        shellForeign.push(u);
      } else {
        // iframe 内的图册产物：**零外链是 ADR-0016 铁律**，一个都不许有
        frameForeign.push(u);
      }
    });

    // 天气 mock：避免离线时真实请求失败产生 resource error 污染零报错断言
    await page.route('**/api.open-meteo.com/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          current: { weather_code: 0, is_day: 1 },
          daily: { sunrise: ['2026-09-21T06:12'], sunset: ['2026-09-21T18:28'] },
        }),
      })
    );

    await page.goto('/lab/');
    await page.goto(VIEWER);
    await readyFrame(page);

    expect(errors).toEqual([]);
    expect(shellForeign, '页面壳除天气外零站外请求').toEqual([]);
    expect(frameForeign, '图册产物 iframe 零站外请求（ADR-0016 铁律）').toEqual([]);
  });
});
