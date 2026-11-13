import { expect, test } from '@playwright/test';
import { MODES } from '../../src/lib/themes';
import { scrollHeroToTop } from './helpers/hero';

/**
 * 密度基线（density baseline）—— 2026-09-10 新增，roadmap P0-4
 *
 * 起因：215 单测 + 71 e2e 里**没有一条测「空」**——作者肉眼觉得首屏空、
 * 作品区空、移动端列表挤，但系统里永远不变红（缺陷在系统里不可见）。
 *
 * 本组只做**防倒退**：把实测基线写成下限断言。它不设「提升目标」——
 * 提升目标属于设计决策（P1-1 宽度阶梯 / P1-2 首屏实体化），
 * 那些由各自的验收判据管；这里只保证「已经达到的密度不会被无意中改回去」。
 *
 * 基线来源：2026-09-10 实测（1440×900 / 390×844，dev 与 dist 同源）。
 * 度量口径：容器宽占比 = 容器宽 / 视口宽；面板面积占比 = 面板面积 / 视口面积。
 */

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };

/** 1440×900 下的几何基线（下限）—— 2026-09-10 宽度阶梯（P1-1）与首屏实体化（P1-2）后的实测值 */
const DESKTOP_BASELINE = {
  /** 首页内容列宽度占视口比（实测 896/1440 = 62.2%，旧值 46.7%） */
  contentWidthRatio: 0.62,
  /** 首屏内容盒面积占视口比（实测 19.3%）。
   *  2026-09-10 U1 换正文字体后从 21.3% 略降到 19.3%：系统黑体在同样 16/28px 下
   *  字面比 Zpix 窄，hero 段落少一行 → 面板矮一截。
   *  这是「可读性优先于面积指标」的正常取舍，故基线随实测定为 19%。
   *
   *  T10 工位重排（2026-09-25）：hero 不再是「一个居中面板」——文字铭牌贴墙、
   *  头像进 CRT 屏、按钮变桌上卡带。旧口径（只量 `.hero-inner` 盒）会把场景的
   *  其余两件当成不存在，于是**口径改成三件内容的并集 bbox**（与 P3-4「把面积
   *  分子从框换成框里的东西」同一思路）。1440×900 实测并集 = 480×415 → 15.4%，
   *  基线取 0.15。旧值（.hero-inner 盒）当时为 24.5%（基线 0.19）。
   *
   *  ADR-0027（2026-09-26）：hero 下移成第二章、窗搬去首屏。本用例改为**滚到
   *  #hero 顶对齐**再量（屏外时 fixed 工位层与 in-flow 铭牌混在不同坐标系，
   *  并集 bbox 会量到跨屏的假值）。顶对齐后 1440×900 实测并集 = 855×417 →
   *  27.5%（左右分栏铺满全宽），仍 ≥ 0.15，基线不下调。 */
  heroAreaRatio: 0.15,
  /** about 面板面积占比（实测 9.75%） */
  aboutPanelAreaRatio: 0.09,
  /** skills 面板面积占比（实测 30.2%，旧值 22.29%） */
  skillsPanelAreaRatio: 0.28,
  /** blog 列表卡片正文列宽（实测 588px，旧值 364px） */
  blogCardBodyWidth: 550,
  /** blog 列表卡片宽度（实测 768px，旧值 544px） */
  blogCardWidth: 720,
};

/** 390×844 下的几何基线（下限）—— P1-4 移动端列表几何后的实测值 */
const MOBILE_BASELINE = {
  /** 首屏内容占视口高比（实测 50.2%） */
  heroFillRatio: 0.45,
  /** blog 卡片正文列宽（e2e 口径实测 204px，旧值 147.6px；dev 的 isMobile 模拟
   *  无滚动条，会多出 12px，以 e2e 口径为准） */
  blogCardBodyWidth: 200,
  /** blog 单卡高上限（实测 318px，旧值 342px / 430px）。
   *  U4 后：摘要限 6 行（`-webkit-line-clamp`）——摘要字数中位 106、最长 183，
   *  而移动端正文列 204px（≈14.5 字/行），不限行时最长要 12.6 行，卡高 342px
   *  且整卡是一面「文字墙」。限 6 行后 342 → 318px，达成 U4 的 ≤330 目标。 */
  blogCardMaxHeight: 330,
  /** 移动端摘要限行数（与 blog/index.astro 的 -webkit-line-clamp 一致） */
  descLineClamp: 6,
  /** 容器宽 / 视口宽（实测 390/390 = 100%） */
  containerWidthRatio: 0.95,
};

test.describe('密度基线：1440×900（防倒退）', () => {
  test('首页内容列宽 / 首屏面积 / about / skills 面板面积不低于基线', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto('/', { waitUntil: 'load' });
    await scrollHeroToTop(page); // ADR-0027：hero 是第二章，顶对齐后再量
    await page.waitForTimeout(400);

    const m = await page.evaluate(() => {
      const rect = (sel: string) => {
        const e = document.querySelector(sel);
        if (!e) return null;
        const r = e.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      };
      const heroInner = rect('#hero .hero-inner');
      // T10 工位重排：首屏内容 = 文字铭牌 + 屏里头像 + 桌上卡带（三件并集 bbox）。
      // 只量 .hero-inner 盒会漏掉场景的两件（头像 / 卡带），不再是真实的内容面积。
      let minL = Infinity, minT = Infinity, maxR = -Infinity, maxB = -Infinity;
      for (const sel of ['#hero .hero-inner', '#hero .crt-avatar', '#hero .cart']) {
        for (const e of document.querySelectorAll(sel)) {
          const b = e.getBoundingClientRect();
          if (b.width < 1 || b.height < 1) continue;
          minL = Math.min(minL, b.left);
          minT = Math.min(minT, b.top);
          maxR = Math.max(maxR, b.right);
          maxB = Math.max(maxB, b.bottom);
        }
      }
      const heroBbox =
        Number.isFinite(minL) && maxR > minL
          ? { x: minL, y: minT, w: maxR - minL, h: maxB - minT }
          : null;
      const aboutPanel = rect('#about .pixel-panel');
      const skillsPanel = rect('#skills .pixel-panel');
      return {
        vw: window.innerWidth,
        vh: window.innerHeight,
        container: rect('#hero .container'),
        heroInner,
        heroBbox,
        aboutPanel,
        skillsPanel,
      };
    });

    expect(m.container, '#hero .container 应存在').not.toBeNull();
    const contentWidthRatio = m.container!.w / m.vw;
    expect(contentWidthRatio, `内容列宽占比 ${(contentWidthRatio * 100).toFixed(1)}%`).toBeGreaterThanOrEqual(
      DESKTOP_BASELINE.contentWidthRatio
    );

    expect(m.heroInner, '#hero .hero-inner 应存在').not.toBeNull();
    expect(m.heroBbox, '首屏内容 bbox 量不到（三件内容都不在？）').not.toBeNull();
    const heroArea = (m.heroBbox!.w * m.heroBbox!.h) / (m.vw * m.vh);
    expect(heroArea, `首屏内容面积占比 ${(heroArea * 100).toFixed(1)}%`).toBeGreaterThanOrEqual(
      DESKTOP_BASELINE.heroAreaRatio
    );

    expect(m.aboutPanel, '#about .pixel-panel 应存在').not.toBeNull();
    const aboutArea = (m.aboutPanel!.w * m.aboutPanel!.h) / (m.vw * m.vh);
    expect(aboutArea, `about 面板面积占比 ${(aboutArea * 100).toFixed(1)}%`).toBeGreaterThanOrEqual(
      DESKTOP_BASELINE.aboutPanelAreaRatio
    );

    expect(m.skillsPanel, '#skills .pixel-panel 应存在').not.toBeNull();
    const skillsArea = (m.skillsPanel!.w * m.skillsPanel!.h) / (m.vw * m.vh);
    expect(skillsArea, `skills 面板面积占比 ${(skillsArea * 100).toFixed(1)}%`).toBeGreaterThanOrEqual(
      DESKTOP_BASELINE.skillsPanelAreaRatio
    );
  });

  test('blog 列表卡片宽与正文列宽不低于基线', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto('/blog/', { waitUntil: 'load' });
    await page.waitForTimeout(1800);

    const m = await page.evaluate(() => {
      const card = document.querySelector('.tl-item .card');
      const body = document.querySelector('.tl-item .body');
      const r = (e: Element | null) => (e ? e.getBoundingClientRect() : null);
      const c = r(card);
      const b = r(body);
      return { cardW: c?.width ?? 0, bodyW: b?.width ?? 0, count: document.querySelectorAll('.tl-item').length };
    });

    expect(m.count, '列表应有文章').toBeGreaterThan(0);
    expect(m.cardW, `卡片宽 ${m.cardW}px`).toBeGreaterThanOrEqual(DESKTOP_BASELINE.blogCardWidth);
    expect(m.bodyW, `正文列宽 ${m.bodyW}px`).toBeGreaterThanOrEqual(DESKTOP_BASELINE.blogCardBodyWidth);
  });
});

test.describe('密度基线：390×844（防倒退）', () => {
  test.use({ viewport: MOBILE });

  test('首屏内容占比 / 容器宽比 / 列表正文列宽不低于基线', async ({ page }) => {
    await page.goto('/', { waitUntil: 'load' });
    await page.waitForTimeout(2000);

    const home = await page.evaluate(() => {
      const inner = document.querySelector('#hero .hero-inner')?.getBoundingClientRect();
      const container = document.querySelector('#hero .container')?.getBoundingClientRect();
      return {
        vw: window.innerWidth,
        vh: window.innerHeight,
        heroH: inner?.height ?? 0,
        containerW: container?.width ?? 0,
        overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });

    const fill = home.heroH / home.vh;
    expect(fill, `首屏内容占视口高 ${(fill * 100).toFixed(1)}%`).toBeGreaterThanOrEqual(
      MOBILE_BASELINE.heroFillRatio
    );
    const cw = home.containerW / home.vw;
    expect(cw, `容器宽占比 ${(cw * 100).toFixed(1)}%`).toBeGreaterThanOrEqual(MOBILE_BASELINE.containerWidthRatio);
    expect(home.overflowX, '移动端不得横向溢出').toBeLessThanOrEqual(0);

    await page.goto('/blog/', { waitUntil: 'load' });
    await page.waitForTimeout(1500);
    const blog = await page.evaluate(() => {
      const body = document.querySelector('.tl-item .body')?.getBoundingClientRect();
      const card = document.querySelector('.tl-item .card')?.getBoundingClientRect();
      const desc = document.querySelector('.tl-item .card .desc');
      const dcs = desc ? getComputedStyle(desc) : null;
      return {
        bodyW: body?.width ?? 0,
        cardH: card?.height ?? 0,
        // 标准属性 `line-clamp` 尚未进 TS 的 CSSStyleDeclaration 类型
        clamp:
          dcs?.getPropertyValue('-webkit-line-clamp') ||
          dcs?.getPropertyValue('line-clamp') ||
          '',
        descClipped: desc ? desc.scrollHeight > desc.clientHeight + 1 : false,
      };
    });
    expect(blog.bodyW, `列表正文列宽 ${blog.bodyW.toFixed(1)}px`).toBeGreaterThanOrEqual(
      MOBILE_BASELINE.blogCardBodyWidth
    );
    expect(blog.cardH, `列表单卡高 ${blog.cardH.toFixed(1)}px`).toBeLessThanOrEqual(
      MOBILE_BASELINE.blogCardMaxHeight
    );
    // U4：限行规则必须在（否则长摘要把卡高推回 342）
    expect(blog.clamp, `摘要限行数应取 ${MOBILE_BASELINE.descLineClamp}`).toBe(
      String(MOBILE_BASELINE.descLineClamp)
    );
    expect(blog.descClipped, '移动端长摘要应真的被限行（没限说明规则未生效）').toBe(true);
  });

  /**
   * U4 的反面：限行是给窄屏用的，**不能伤到桌面**。
   * 桌面正文列 588px（≈42 字/行）下最长摘要只 4.4 行，永远碰不到 6 行上限——
   * 本用例把这个「两端各得其所」的性质钉住：桌面摘要不得被视觉截断。
   */
  test('桌面：摘要不被截断（6 行上限在宽列下不触发）', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto('/blog/', { waitUntil: 'load' });
    await page.waitForTimeout(1500);
    const clipped = await page.evaluate(() =>
      [...document.querySelectorAll('.tl-item .card .desc')]
        .filter((d) => d.scrollHeight > d.clientHeight + 1)
        .map((d) => (d.textContent ?? '').slice(0, 20))
    );
    expect(
      clipped,
      `桌面摘要被限行（应永不触发）：${clipped.join(' / ')}`
    ).toEqual([]);
  });
});

test.describe('单档端到端守线（ADR-0021，恒暗）', () => {
  /**
   * 旧 13 套主题的逐套端到端随主题系统退役；现在守单档（恒暗）：
   * 五槽 = themes.ts 定义、面板顶缘受光带 = accent、导航底线 = line。
   * MODES 现为单元素数组（LIGHT 已退役），遍历自动只跑 dark。
   */
  for (const mode of MODES) {
    test(`${mode.key}：五槽与结构线色 = themes.ts 定义`, async ({ page }) => {
      await page.goto('/', { waitUntil: 'load' });
      await page.waitForTimeout(1200);

      const actual = await page.evaluate(() => {
        const cs = getComputedStyle(document.documentElement);
        const panel = document.querySelector('.pixel-panel');
        const nav = document.querySelector('header.nav');
        return {
          bg: cs.getPropertyValue('--c-bg').trim(),
          panel: cs.getPropertyValue('--c-panel').trim(),
          line: cs.getPropertyValue('--c-line').trim(),
          accent: cs.getPropertyValue('--c-accent').trim(),
          text: cs.getPropertyValue('--c-text').trim(),
          panelTop: panel ? getComputedStyle(panel).borderTopColor : 'missing',
          navBorder: nav ? getComputedStyle(nav).borderBottomColor : 'missing',
        };
      });

      const rgb = (hex: string) => {
        const h = hex.replace('#', '');
        return `rgb(${[0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(', ')})`;
      };
      const slots: Record<string, string> = {
        bg: mode.colors.bg,
        panel: mode.colors.panel,
        line: mode.colors.line,
        accent: mode.colors.accent,
        text: mode.colors.text,
      };
      for (const [key, want] of Object.entries(slots)) {
        expect((actual as Record<string, string>)[key].toLowerCase(), `${key} 应等于 themes.ts`).toBe(
          want.toLowerCase()
        );
      }
      // 结构线：面板顶缘 = 受光带（accent）；导航底线 = line
      expect(actual.panelTop, '面板顶缘 = accent 受光带').toBe(rgb(mode.colors.accent));
      expect(actual.navBorder, '导航底线 = line').toBe(rgb(mode.colors.line));
    });
  }

  test('恒暗档：遮罩后结构线对比度不跌', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1500);
    const rows: Array<{ theme: string; before: number; after: number }> = [];

    for (const theme of MODES) {
      await page.waitForTimeout(250);

      const measure = async () =>
        page.evaluate(() => {
          const panel = document.querySelector('.pixel-panel')!;
          const cs = getComputedStyle(panel);
          const border = cs.borderTopColor;
          // 结构线 vs 页面底（--gb-0）：用同一元素的计算色 + 根底色算数学对比度
          const rootBg = getComputedStyle(document.documentElement).getPropertyValue('--c-bg').trim();
          const parse = (c: string) => {
            if (c.startsWith('rgb')) return c.match(/\d+/g)!.slice(0, 3).map(Number);
            const h = c.replace('#', '');
            return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
          };
          const lum = (rgb: number[]) => {
            const f = (v: number) => {
              const s = v / 255;
              return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
            };
            return 0.2126 * f(rgb[0]!) + 0.7152 * f(rgb[1]!) + 0.0722 * f(rgb[2]!);
          };
          const a = lum(parse(border));
          const b = lum(parse(rootBg));
          return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        });

      const before = await measure();
      await page.addStyleTag({
        content: 'body::before,.bgfx-canvas{display:none !important;}',
      });
      const after = await measure();
      rows.push({ theme: theme.key, before: +before.toFixed(2), after: +after.toFixed(2) });
    }

    const bad = rows.filter((r) => r.after < 3 || r.after < r.before - 0.05);
    expect(
      bad,
      `结构线依赖装饰层或不可辨：\n${bad.map((r) => `${r.theme} ${r.before} → ${r.after}`).join('\n')}`
    ).toEqual([]);
  });
});

/**
 * 大屏密度（1920）—— roadmap U5
 *
 * U5 问「--w-wide 56rem 是否还能更宽」。做了 56/64/68rem × 8 个断点的原型实测：
 * 增宽**不会减少视觉上的空**，只是把空白从容器外搬进面板内（hero 文本左对齐，
 * 面板越宽右侧死区越大）；而 ≤1440 增宽会立刻变挤（1440 下 71%、1280 下 80%）。
 * 故判定 **维持 56rem**（prose 本就独立限宽 672px，增宽对阅读行宽毫无影响）。
 *
 * 但 U5 暴露了一个真缺口：**密度基线只测 1440 与 390**——大屏是无人看守的区间。
 * 本组补上 1920，并把「内容列不得窄于 token 值 / 行宽独立 / 零溢出」钉住。
 */
test.describe('密度基线：1920（大屏，U5 补测）', () => {
  test.use({ viewport: { width: 1920, height: 1080 } });

  test('内容列 = --w-wide、行宽 = --w-prose、零横向溢出', async ({ page }) => {
    await page.goto('/', { waitUntil: 'load' });
    await page.waitForTimeout(2200);
    // 作品区已是 6 卡网格（2026-09 分页器/子屏随 fullpage 骨架退役）
    await page.evaluate(() =>
      document.querySelector('#projects')?.scrollIntoView({ block: 'start', behavior: 'instant' })
    );
    await page.waitForTimeout(800);

    const m = await page.evaluate(() => {
      const px = (v: string) => Number.parseFloat(v);
      const root = getComputedStyle(document.documentElement);
      const cont = document.querySelector('.container'); // 首个 = hero 容器
      // 阅读行宽（2026-10-30 W2·S1）：首页不再有 container--prose 包裹
      // （about/contact 的脊柱对齐到 wide 容器），限宽改由段落自身承担。
      const prose = document.querySelector('#about .pixel-panel p');
      const grid = document.querySelector('#projects .proj-grid');
      const cards = grid ? [...grid.querySelectorAll('li')] : [];
      const tops = cards
        .map((c) => Math.round(c.getBoundingClientRect().top))
        .filter((t) => t > 0);
      return {
        wide: px(root.getPropertyValue('--w-wide')) * 16,
        prose: px(root.getPropertyValue('--w-prose')) * 16,
        contW: cont?.getBoundingClientRect().width ?? 0,
        proseW: prose?.getBoundingClientRect().width ?? 0,
        projCols: tops.length ? tops.filter((t) => t === tops[0]).length : 0,
        overflowX:
          document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });

    // 内容列必须撑满 token（不得因大屏而被压窄，也不得溢出 token）
    expect(
      Math.abs(m.contW - m.wide),
      `1920 内容列 ${m.contW.toFixed(1)}px，应等于 --w-wide ${m.wide}px`
    ).toBeLessThanOrEqual(1);
    // 文字列独立限宽：增宽陈列列不得放宽阅读行宽
    expect(
      Math.abs(m.proseW - m.prose),
      `阅读行宽 ${m.proseW.toFixed(1)}px，应等于 --w-prose ${m.prose}px`
    ).toBeLessThanOrEqual(1);
    expect(m.projCols, `作品卡同排应 ≥3 列（实测 ${m.projCols}）`).toBeGreaterThanOrEqual(3);
    expect(m.overflowX, '1920 不得横向溢出').toBeLessThanOrEqual(0);
  });
});

/**
 * 2026-09-25 退役：「窄屏：侧栏接插件不压内容（V7）」整组。
 * 右侧 SET 仓（`.side-dock` + `#side-dock-trigger`）现在**只在 DEV 构建存在**（作者：
 * 「右侧那个按钮是留给自己开发调试的，整个都不要上线」）——生产 DOM 里没有这个固定件，
 * 「它与 hero 内容重叠多少」自然不成立。生产不含它的守卫见 tests/e2e/toggles.spec.ts
 * 与 tests/e2e/debug.spec.ts（SSR + DOM 双查），本组不再保留空壳。
 */

/**
 * 内容密度：把「面积」的分子从「框」换成「框里的东西」—— 2026-09-10 P3-4。
 *
 * 起因（双方向独立取证 + 父会话复算，P3 roadmap §1）：
 * 上面的 density 基线把「面板 border-box 面积」当作密度的代理。实测它是**反向**的——
 *   · 首屏面板加宽到 1100px：死区从 170px 涨到 374px，指标反而从 19.3% 涨到 23.7%（更绿）
 *   · 把面板收窄去贴合内容：死区降到 48px，指标掉到 16.6%（转红）
 * 也就是说这条规则**奖励空框、惩罚修构图**，而 P3-3 修首屏构图（CTA 独立成列）正是
 * 会收窄框的那类改动。故本组补上「内容 bbox」与「右死区」两个口径。
 *
 * 口径：内容 bbox = 面板内**文字节点或交互/图形元素**的并集外接矩形（排除 `.pp-pad`
 * 装饰角点——它贴着面板内边，会把死区永远掩盖成 28px）。纯几何、零像素采样，确定可复现。
 * 阈值全部取 2026-09-10 实测值向下取整（只防倒退，不设提升目标）。
 *
 * 实测（1440×900，P3-3 后）：hero 内容 15.57% / fill 0.759 / 死区 32px；
 * about 5.61% / 0.575 / 32；skills 23.66% / 0.784 / 32；contact 4.03% / 0.559 / 32。
 */
test.describe('内容密度：框里的东西（P3-4 口径修正）', () => {
  test('首屏/关于/技能/联系：内容 bbox 占比 + 填充率 + 右死区 ≤40px', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto('/', { waitUntil: 'load' });
    await page.waitForTimeout(2200);

    const m = await page.evaluate(() => {
      const out: Record<string, { contentPct: number; fill: number; deadRight: number }> = {};
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      for (const id of ['about', 'skills', 'contact']) {
        // hero 已退出面板口径（2026-09-23 纸条化）：hero 不再有 .pixel-panel，
        // 「右死区 ≤40px」的对称构图约束被纸条构图**有意打破**——右半屏让给窗外景，
        // hero 的密度改由 hero-contrast（行行实底）与 typewriter 几何守线承接。
        const panel = document.querySelector(`#${id} .pixel-panel`);
        if (!panel) continue;
        const pr = panel.getBoundingClientRect();
        let minL = Infinity, minT = Infinity, maxR = -Infinity, maxB = -Infinity;
        panel.querySelectorAll('*').forEach((e) => {
          if (e.classList.contains('pp-pad')) return; // 装饰角点不算墨
          const hasText = [...e.childNodes].some(
            (n) => n.nodeType === 3 && (n.textContent ?? '').trim()
          );
          if (!hasText && !e.matches('a, button, svg, img')) return;
          const r = e.getBoundingClientRect();
          if (r.width < 1 || r.height < 1) return;
          minL = Math.min(minL, r.left);
          minT = Math.min(minT, r.top);
          maxR = Math.max(maxR, r.right);
          maxB = Math.max(maxB, r.bottom);
        });
        const contentArea = (maxR - minL) * (maxB - minT);
        const panelArea = pr.width * pr.height;
        out[id] = {
          contentPct: +((contentArea / (vw * vh)) * 100).toFixed(2),
          fill: +(contentArea / panelArea).toFixed(3),
          deadRight: Math.round(pr.right - maxR),
        };
      }
      return out;
    });

    // ① 内容 bbox 占视口面积（下限 = 实测向下取整）
    const CONTENT_FLOOR: Record<string, number> = { about: 5.4, skills: 23, contact: 3.5 }; // contact 3.9→3.5：面板描边 4px→1/2px 后内容盒略微变高（ADR-0021）
    // hero 不在面板口径内（纸条化，见上）
    for (const [id, floor] of Object.entries(CONTENT_FLOOR)) {
      expect(m[id], `#${id} 面板缺失`).toBeDefined();
      expect(m[id]!.contentPct, `#${id} 内容占比 ${m[id]!.contentPct}%（下限 ${floor}%）`)
        .toBeGreaterThanOrEqual(floor);
    }

    // ② 填充率（内容 bbox / 面板面积）——这条抓「把框做大」这条捷径：
    //    框一大、内容不动，fill 立刻掉下来。
    const FILL_FLOOR: Record<string, number> = { about: 0.55, skills: 0.75, contact: 0.53 }; // hero 已退出面板口径（纸条化）
    for (const [id, floor] of Object.entries(FILL_FLOOR)) {
      expect(m[id]!.fill, `#${id} 面板填充率 ${m[id]!.fill}（下限 ${floor}）`).toBeGreaterThanOrEqual(floor);
    }

    // ③ 右死区 ≤40px（= 边框 4 + padding 28 + 容差 8）——这条就是 P3-3 的守线：
    //    改前首屏 170px（其余面板 32px），是全网唯一「内容不贴边」的面板。
    for (const id of Object.keys(CONTENT_FLOOR)) {
      expect(m[id]!.deadRight, `#${id} 面板右死区 ${m[id]!.deadRight}px`).toBeLessThanOrEqual(40);
    }
  });
});

/**
 * 文章图（```flow 字符图）：面积下限已退役（2026-09-11，ADR-0019）。
 *
 * 原「文章页插图：非文字元素面积（P3-7）」与「插图文案与面板角点」两组守的是
 * 构建期内联 SVG 的渲染面积与面板内边距/角点关系。图改成 markdown 里的字符图之后：
 *   · 字符图的面积由**文本行数**决定，不再是「非文字元素」，这条口径失去意义；
 *   · 角点关系仍在，但守的对象换成 `pre:has(> code.language-flow)`（普通 pre 面板，
 *     用 .pixel-panel 默认 24px 内边距），由 `tests/e2e/flow-diagram.spec.ts` 的
 *     计算样式与几何断言覆盖（含「行高/字号/全角格」三条）。
 * 故这里不再保留任何插图专用断言。
 */

/**
 * 窄屏滚动提示（2026-10-29）——密度基线的补丁：**空**也要有交代。
 *
 * 实测：390×844 下 hero 内容到 680px 结束，下面 163px 是空的；
 * 页面还有五屏内容，但首屏看不出「可以往下滚」。提示只在 ≤560px 出现
 * （桌面档内容本来就占满一屏，加了是噪声），且必须是装饰性的
 * （aria-hidden，不占 tab 序，不影响读屏）。
 */
test.describe('窄屏滚动提示', () => {
  test('390 宽：提示可见、贴在 hero 底部、且在视口内', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto('/', { waitUntil: 'load' });
    await scrollHeroToTop(page);
    await page.waitForTimeout(400);

    const m = await page.evaluate(() => {
      const el = document.querySelector('.hero-scroll') as HTMLElement | null;
      const hero = document.getElementById('hero')!;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const hr = hero.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        display: cs.display,
        text: (el.textContent || '').trim(),
        hidden: el.getAttribute('aria-hidden'),
        rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
        heroBottom: Math.round(hr.bottom),
        vh: innerHeight,
        anim: cs.animationName,
      };
    });

    expect(m, '窄屏应渲染 .hero-scroll').not.toBeNull();
    expect(m!.display).not.toBe('none');
    expect(m!.text).toContain('SCROLL');
    expect(m!.hidden, '提示是装饰：不进读屏').toBe('true');
    expect(m!.rect[3], '提示要有实际尺寸（不是 display 了但高 0）').toBeGreaterThan(8);
    // 贴在 hero 底部：底边在 hero 之内，且整块在视口里（不能被裁）
    expect(m!.rect[1] + m!.rect[3]).toBeLessThanOrEqual(m!.heroBottom);
    expect(m!.rect[1]).toBeGreaterThan(m!.vh * 0.75);
    expect(m!.rect[1] + m!.rect[3]).toBeLessThanOrEqual(m!.vh);
    expect(m!.anim, '两档跳动（像素语言），不是缓动').toContain('hero-scroll-bob');
  });

  test('桌面 1440：提示不显示（内容占满一屏，加了是噪声）', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto('/', { waitUntil: 'load' });
    const display = await page.evaluate(
      () => getComputedStyle(document.querySelector('.hero-scroll')!).display
    );
    expect(display).toBe('none');
  });

  test('reduced-motion：提示静止（保留位置，不跳）', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/', { waitUntil: 'load' });
    const m = await page.evaluate(() => {
      const el = document.querySelector('.hero-scroll') as HTMLElement;
      const cs = getComputedStyle(el);
      return { anim: cs.animationName, display: cs.display };
    });
    expect(m.display).not.toBe('none');
    expect(m.anim, 'reduced-motion 下不许自带动').toBe('none');
  });
});
