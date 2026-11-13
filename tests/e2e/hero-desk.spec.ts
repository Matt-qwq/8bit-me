import { expect, test, type Page } from '@playwright/test';
import { deskSpec } from '../../src/lib/desk-room';
import { scrollHeroToTop } from './helpers/hero';

/**
 * 窗边工位：DOM 与 canvas 几何对齐（T10）
 *
 * 背景：hero 从「居中文字栈」重排成「窗边工位」——文字贴墙、终端头像搬进
 * canvas 画的 CRT 屏、三个按钮变成立在桌上的 DOM 卡带。DOM 层的坐标**必须**
 * 与 canvas 用同一份 `deskSpec`（Hero 的接线脚本把模块结果写进
 * `#hero` 的 CSS 变量），否则头像会飘在屏外、卡带会落在桌外。
 *
 * ADR-0027：工位住第二章 #hero（首屏是整扇窗）——本文件所有几何用例都先
 * `scrollHeroToTop()`（见 helpers/hero.ts），否则量到的是「屏外未绘制」态。
 *
 * 坐标系：`deskSpec(w,h)` 的 w/h = **canvas 逻辑宽高**（= `.bgfx-canvas` 的
 * getBoundingClientRect，不含滚动条），与 BgFx 的 `getSize()` 同源。本文件
 * 的期望值一律从模块现算（不写死 1440 基准数），与被守的东西同源。
 *
 * 分工：世界/山湖/窗框的像素守线在 tests/e2e/world.spec.ts（T8/T9 领地）；
 * 本文件只守「DOM 工位坐对地方」。
 */

const DESKTOP = { width: 1440, height: 900 };
const NARROW = { width: 480, height: 800 };

/** 与 Hero 接线脚本同源：canvas 逻辑尺寸 */
async function canvasSize(page: Page) {
  return page.evaluate(() => {
    const wrap = document.querySelector('.bgfx-canvas') as HTMLElement;
    const r = wrap.getBoundingClientRect();
    return { w: Math.max(1, Math.round(r.width)), h: Math.max(1, Math.round(r.height)) };
  });
}

const boxOf = (b: { x: number; y: number; width: number; height: number }) =>
  [b.x, b.y, b.x + b.width, b.y + b.height] as const;

/**
 * 工位只住第二章（ADR-0027）：`#hero` 顶对齐到视口顶后，canvas 的 deskAlpha 门
 * 才打开、DOM 工位层才满亮（--scene-a=1）。所有工位几何用例都从这里出发。
 */
async function openDesk(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'load' });
  await scrollHeroToTop(page);
  await page.waitForFunction(
    () => {
      const hero = document.getElementById('hero');
      return !!hero && hero.classList.contains('hero--desk') && !hero.classList.contains('hero--boot');
    },
    undefined,
    { timeout: 5000 }
  );
  await page.waitForTimeout(150); // 等 --scene-a 与一帧绘制
}

test.describe('窗边工位：DOM 对齐 canvas 几何', () => {
  test.use({ viewport: DESKTOP });

  test('CRT 终端坐在屏里：figure 盒 = deskSpec.crt.screen，终端文本在位', async ({ page }) => {
    // ADR-0027：工位住第二章，先把 #hero 顶对齐再量（DOM 工位层是 fixed，
    // 顶对齐后它的视口坐标才与 canvas 的 deskSpec 坐标同帧可比）。
    await openDesk(page);

    const size = await canvasSize(page);
    const screen = deskSpec(size.w, size.h)!.crt.screen;

    const m = await page.evaluate(() => {
      const figure = document.querySelector('#hero .crt-avatar figure')!;
      const r = figure.getBoundingClientRect();
      return {
        desk: document.getElementById('hero')!.classList.contains('hero--desk'),
        box: [r.x, r.y, r.x + r.width, r.y + r.height],
        overflow: getComputedStyle(document.querySelector('#hero .term-body')!).overflow,
      };
    });

    expect(m.desk, '桌面应走工位档（hero--desk）').toBe(true);
    expect(m.overflow, '打字区域锁死在屏幕盒内（页面级布局零位移）').toBe('hidden');

    // figure 盒 = 屏矩形（逐边 ≤2px）——「终端恰好填 screen」
    const [sl, st, sr, sb] = [screen.x, screen.y, screen.x + screen.w, screen.y + screen.h];
    const edges: Array<[number, number, string]> = [
      [m.box[0]!, sl, '左'],
      [m.box[1]!, st, '上'],
      [m.box[2]!, sr, '右'],
      [m.box[3]!, sb, '下'],
    ];
    for (const [got, want, name] of edges) {
      expect(Math.abs(got - want), `终端 ${name}边 ${got.toFixed(1)} vs 屏 ${want}（差 >2px）`).toBeLessThanOrEqual(2);
    }
  });

  test('三盘卡带：x == deskSpec.cartXs（容差 2px），底边立在桌沿', async ({ page }) => {
    await openDesk(page);

    const size = await canvasSize(page);
    const d = deskSpec(size.w, size.h)!;
    const boxes = await page.evaluate(() =>
      [...document.querySelectorAll('#hero .cart')].map((e) => {
        const b = e.getBoundingClientRect();
        return { x: b.x, bottom: b.y + b.height, w: b.width, h: b.height };
      })
    );

    expect(boxes).toHaveLength(3);
    for (let i = 0; i < 3; i++) {
      expect(
        Math.abs(boxes[i]!.x - d.cartXs[i]!),
        `第 ${i + 1} 盘卡带 x=${boxes[i]!.x.toFixed(1)} vs cartXs=${d.cartXs[i]}`
      ).toBeLessThanOrEqual(2);
      expect(
        Math.abs(boxes[i]!.bottom - d.desk.top),
        `第 ${i + 1} 盘卡带底边 ${boxes[i]!.bottom.toFixed(1)} vs 桌沿 ${d.desk.top}（没有立在桌面上）`
      ).toBeLessThanOrEqual(2);
      // 卡带是竖排标签：高 > 宽
      expect(boxes[i]!.h, `第 ${i + 1} 盘不是竖排卡带`).toBeGreaterThan(boxes[i]!.w);
    }
    // 等间距（与 deskSpec 的 cartStep 同源）
    const gaps = [boxes[1]!.x - boxes[0]!.x, boxes[2]!.x - boxes[1]!.x];
    expect(Math.abs(gaps[0]! - gaps[1]!), `卡带间距不均：${gaps.join(', ')}`).toBeLessThanOrEqual(2);
  });

  test('滚动中途：工位整体跟 #hero 走（canvas 桌沿 / 卡带 / 头像同步平移，视差不劫持 fixed 层）', async ({ page }) => {
    // 作者 2026-10-01 截图实锤的散架：hero 顶滚过视口顶后，离场视差把 transform
    // 挂上 .hero-inner —— 祖先一挂 transform，fixed 工位层（.hero-scene/.hero-cta）
    // 的包含块就被劫持成铭牌盒，卡带从桌沿飞到右上角（x = plate.left + cartX）、
    // 头像塌进铭牌；canvas 房间却钉死在视口上，整章画面散架。修复后四件事同时成立：
    // ① 视差 transform 只挂铭牌内容元素（.hero-inner 恒为无 transform）；
    // ② DOM 工位（卡带/头像）= 顶对齐基线 + hero.top（跟章平移，x 不漂）；
    // ③ canvas 桌沿同步平移（desk.top + hero.top 行找得到桌面亮阶）；
    // ④ 视差本身活着（滚过顶后 .hero-text 有 inline translateY(−hero.top×0.3)）。
    await openDesk(page);

    const size = await canvasSize(page);
    const d = deskSpec(size.w, size.h)!;
    const base = await page.evaluate(() => {
      const cart = document.querySelector('#hero .cart')!.getBoundingClientRect();
      const avatar = document.querySelector('#hero .crt-avatar')!.getBoundingClientRect();
      return { cartX: cart.x, cartY: cart.y, avatarX: avatar.x, avatarY: avatar.y };
    });
    expect(
      Math.abs(base.cartX - d.cartXs[0]!),
      '顶对齐基线不成立（先确认 openDesk 状态）'
    ).toBeLessThanOrEqual(2);

    /** 滚到 hero.top = delta（instant，等视差 rAF 与 canvas 下一帧落定） */
    const scrollHeroTo = async (delta: number) => {
      await page.evaluate((dy) => {
        const hero = document.getElementById('hero')!;
        window.scrollTo({
          top: hero.getBoundingClientRect().top + window.scrollY - dy,
          behavior: 'instant' as ScrollBehavior,
        });
      }, delta);
      await page.waitForFunction(
        (dy) => Math.abs(document.getElementById('hero')!.getBoundingClientRect().top - dy) <= 1,
        delta,
        { timeout: 5000 }
      );
      await page.waitForTimeout(150);
    };

    // +150：从下往上进章（deskAlpha≈0.67，房间从屏底滑入）；
    // −180：滚过顶（离场视差激活区 = 原 bug 的触发区）。
    for (const delta of [150, -180]) {
      await scrollHeroTo(delta);
      const m = await page.evaluate(() => {
        const cart = document.querySelector('#hero .cart')!.getBoundingClientRect();
        const avatar = document.querySelector('#hero .crt-avatar')!.getBoundingClientRect();
        const inner = document.querySelector('#hero .hero-inner') as HTMLElement;
        const text = document.querySelector('#hero .hero-text') as HTMLElement;
        return {
          cartX: cart.x,
          cartY: cart.y,
          avatarX: avatar.x,
          avatarY: avatar.y,
          innerTf: getComputedStyle(inner).transform,
          textTf: text.style.transform,
        };
      });
      // ② DOM 工位跟章：x 不许漂（被劫持会 + plate.left），y = 基线 + hero.top
      expect(
        Math.abs(m.cartX - base.cartX),
        `Δ=${delta}：卡带 x 漂了 ${(m.cartX - base.cartX).toFixed(1)}px → fixed 层包含块被劫持`
      ).toBeLessThanOrEqual(2);
      expect(
        Math.abs(m.cartY - (base.cartY + delta)),
        `Δ=${delta}：卡带没跟章（视口 y 偏 ${(m.cartY - base.cartY - delta).toFixed(1)}px）`
      ).toBeLessThanOrEqual(2);
      expect(
        Math.abs(m.avatarX - base.avatarX),
        `Δ=${delta}：CRT 头像 x 漂了（fixed 层被劫持）`
      ).toBeLessThanOrEqual(2);
      expect(
        Math.abs(m.avatarY - (base.avatarY + delta)),
        `Δ=${delta}：CRT 头像没跟章`
      ).toBeLessThanOrEqual(2);
      // ① 反劫持不变量：铭牌盒必须无 transform（fixed 层的包含块 = 视口）
      expect(m.innerTf, `Δ=${delta}：.hero-inner 挂上了 transform —— 会劫持 fixed 工位层`).toBe('none');
      // ④ 视差活着，只是换了载体（A3/Q5：滚过顶后 y = −hero.top × 0.3）
      const got = m.textTf === '' ? 0 : parseFloat(m.textTf.replace('translateY(', ''));
      const want = delta < 0 ? Math.max(0, -delta * 0.3) : 0;
      expect(
        Math.abs(got - want),
        `Δ=${delta}：铭牌内容视差 ${m.textTf || '(无)'} ≠ 预期 translateY(${want}px)`
      ).toBeLessThanOrEqual(1);
      // ③ canvas 桌沿也在跟：desk.top + delta 行有桌面顶缘的 accent 亮阶。
      //    判据 = 第一个「暖色持续亮阶」：accent 是金色（R>B），而进章途中窗外
      //    世界钉在视口上的踢脚线/地板（冷色）与雨丝（冷色）都被色温排除；
      //    持续判据（随后 ≥6 行保持亮）排掉单行噪声。
      const edgeY = await page.evaluate(
        ([x, yLo, yHi]) => {
          const c = document.getElementById('bgfx-canvas') as HTMLCanvasElement;
          const g = c.getContext('2d')!;
          const n = Math.round(yHi! - yLo!);
          const col = g.getImageData(Math.round(x!), Math.round(yLo!), 1, n).data;
          const lum = (i: number) => col[i * 4]! + col[i * 4 + 1]! + col[i * 4 + 2]!;
          const warm = (i: number) => col[i * 4]! - col[i * 4 + 2]! >= 30;
          for (let i = 1; i < n - 7; i++) {
            if (lum(i) - lum(i - 1) < 60 || !warm(i)) continue;
            let sustained = true;
            for (let k = 1; k <= 6; k++) {
              if (lum(i + k) < lum(i - 1) + 30) {
                sustained = false;
                break;
              }
            }
            if (sustained) return yLo! + i;
          }
          return -1;
        },
        [d.desk.x0 + 6, d.desk.top + delta - 60, d.desk.top + delta + 40] as const
      );
      expect(
        edgeY,
        `Δ=${delta}：桌沿亮阶没找到（canvas 工位没画在 desk.top+${delta} 行）`
      ).toBeGreaterThan(0);
      expect(
        Math.abs(edgeY - (d.desk.top + delta)),
        `Δ=${delta}：canvas 桌沿在 ${edgeY}，应为 ${d.desk.top + delta}（canvas 没跟章）`
      ).toBeLessThanOrEqual(3);
    }
  });

  test('铭牌（左栏文字）：左缘 = 容器左缘、宽 = 桌面宽（ADR-0027 左右分栏）', async ({ page }) => {
    // 旧口径「文字右缘 ≤ win.x − frame（不进窗洞）」随 ADR-0027 失效：
    // 窗已搬到上一屏（整扇窗），文字与窗不同屏，没有「越进窗洞」这回事。
    // 新结构是**左右分栏**：文字铭牌在左栏、工位在右半屏，两块等宽（= 桌面宽）、
    // 隔空相对。判据从 deskSpec 现算（与被守的 --plate-* 接线同源）。
    await openDesk(page);

    const size = await canvasSize(page);
    const d = deskSpec(size.w, size.h)!;

    const m = await page.evaluate(() => {
      const cont = document.querySelector('#hero .container')!.getBoundingClientRect();
      const inner = document.querySelector('#hero .hero-inner')!.getBoundingClientRect();
      const intro = document.querySelector('#hero .intro')!;
      const range = document.createRange();
      range.selectNodeContents(intro);
      const rows = [...range.getClientRects()].filter((r) => r.width > 1).length;
      return {
        contLeft: cont.left,
        contRight: cont.right,
        innerLeft: inner.left,
        innerRight: inner.right,
        innerW: inner.width,
        rows,
      };
    });

    // ① 铭牌左缘 = 容器左缘（实测，跟断点/最大宽走，不写死 264）
    expect(
      Math.abs(m.innerLeft - m.contLeft),
      `铭牌左缘 ${m.innerLeft.toFixed(1)} ≠ 容器左缘 ${m.contLeft.toFixed(1)}`
    ).toBeLessThanOrEqual(2);
    // ② 铭牌宽 = 桌面宽（deskSpec 同源：两块等宽、隔空相对）
    const deskW = d.desk.x1 - d.desk.x0;
    expect(
      Math.abs(m.innerW - deskW),
      `铭牌宽 ${m.innerW.toFixed(1)} ≠ 桌面宽 ${deskW}`
    ).toBeLessThanOrEqual(2);
    // ③ 铭牌不越出内容列（右缘 ≤ 容器右缘 + 2）
    expect(m.innerRight, '铭牌越出内容列').toBeLessThanOrEqual(m.contRight + 2);
    // ④ 桌面 intro 应为 2 行（列宽 = 桌面宽 485，没有被改窄）
    expect(m.rows, `桌面 intro 应为 2 行（实际 ${m.rows} 行，列宽被改窄了？）`).toBe(2);
  });

    test('反例自检：把卡带 x 推离锚点 30px 时，探针必须判出 >2px 的差', async ({ page }) => {
    await openDesk(page);

    const size = await canvasSize(page);
    const d = deskSpec(size.w, size.h)!;
    const read = () =>
      page.evaluate(() => {
        const e = document.querySelectorAll('#hero .cart')[1] as HTMLElement;
        return e.getBoundingClientRect().x;
      });
    const before = await read();
    expect(Math.abs(before - d.cartXs[1]!), '基线本就偏了').toBeLessThanOrEqual(2);
    await page.evaluate(() => {
      const e = document.querySelectorAll('#hero .cart')[1] as HTMLElement;
      e.style.setProperty('--cart-x', `${Number.parseFloat(getComputedStyle(e).getPropertyValue('--cart-x')) + 30}px`);
    });
    const after = await read();
    expect(Math.abs(after - d.cartXs[1]!), '推离锚点 30px 后探针没判红 → 这组守卫是恒绿的').toBeGreaterThan(2);
  });

  test('墙面置物板：canvas 几何不压 DOM 铭牌、不越到工位侧（2026-10-01 空墙场景化）', async ({ page }) => {
    await openDesk(page);
    const size = await canvasSize(page);
    const d = deskSpec(size.w, size.h)!;
    const S = d.shelf;
    // hero 顶对齐后 canvas 逻辑坐标 == 视口坐标，DOM rect 可与 deskSpec 直接比较
    const plate = await page.evaluate(() => {
      const r = document.querySelector('#hero .hero-text')!.getBoundingClientRect();
      const nav = document.querySelector('header.nav')!.getBoundingClientRect();
      return { top: r.top, navBottom: nav.bottom };
    });
    // ① 不压铭牌：板底（含托架 4px）与铭牌顶留呼吸隙
    expect(
      S.y + S.board + 4,
      `板底 ${S.y + S.board} 应在铭牌顶 ${plate.top.toFixed(1)} 之上 ≥ 20px`
    ).toBeLessThanOrEqual(plate.top - 20);
    // ② 不顶进 nav
    expect(S.y, `板顶 ${S.y} 不得进入 nav（底 ${plate.navBottom.toFixed(1)}）`).toBeGreaterThanOrEqual(
      plate.navBottom
    );
    // ③ 不越到工位侧（镜像锚定契约的页面实测）
    expect(S.x + S.w).toBeLessThanOrEqual(d.desk.x0);
  });

  test('窄屏：工位退场，回到居中栈（无横向溢出）', async ({ page }) => {
    await page.setViewportSize(NARROW);
    await page.goto('/', { waitUntil: 'load' });
    await scrollHeroToTop(page); // 顶对齐后仍是居中栈（不是「屏外所以没进工位档」）
    await page.waitForTimeout(300);

    const m = await page.evaluate(() => {
      const hero = document.getElementById('hero')!;
      const boxes = [...document.querySelectorAll('#hero .cart')].map((e) => {
        const b = e.getBoundingClientRect();
        return { w: b.width, h: b.height, right: b.right };
      });
      return {
        desk: hero.classList.contains('hero--desk'),
        stack: hero.classList.contains('hero--stack'),
        boxes,
        overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });

    // canvas 也在这个宽度退场（deskSpec 返 null）——DOM 必须跟着退场
    expect(m.desk, '窄屏不该走工位档').toBe(false);
    expect(m.stack, '窄屏应标记 hero--stack').toBe(true);
    expect(m.boxes).toHaveLength(3);
    for (const b of m.boxes) {
      // 回退成横排像素按钮（不是竖排卡带）
      expect(b.w, '窄屏按钮应是横排（宽 > 高）').toBeGreaterThan(b.h);
      expect(b.right, '窄屏按钮不得横向溢出').toBeLessThanOrEqual(NARROW.width + 1);
    }
    expect(m.overflowX, '窄屏不得横向溢出').toBeLessThanOrEqual(0);
  });
});

/**
 * 2026-10-29（impeccable bolder 轮）：工位过 scrim 之后**真的读得出来**。
 *
 * 起因（实测）：`.bgfx-scrim` 平铺 72%（内容列再叠 50% 横向压暗 ⇒ 有效 86%），
 * 桌面/围板被压到 **1.09:1**——canvas 里画得再准，屏幕上整间屋子也是一堵空墙
 * （作者截图实锤「桌子融进墙」）。canvas 像素断言（world.spec T8）看不见这一层：
 * 它读的是 canvas 自身，不是屏幕上画出来的东西。
 *
 * 判据：视口截图里「围板 vs 墙」的对比度 ≥ 2.0:1（暗色场景的结构下限；
 * 文字另有 4.5 门禁，这里量的是**场景**）。反例自检：把 scrim 打回平铺 72%，
 * 同一条判据必须红——否则说明它量不到遮罩。
 */
test.describe('工位可读性：过 scrim 后仍有结构', () => {
  test.use({ viewport: DESKTOP });

  const lum = (r: number, g: number, b: number) => {
    const f = (v: number) => {
      v /= 255;
      return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };

  /** 截图取两点（同一 x 列：桌沿上方 = 墙，围板中部 = 桌面下的立面），算对比度 */
  async function deskContrast(page: Page, x: number, wallY: number, apronY: number) {
    const buf = await page.screenshot();
    const { PNG } = await import('pngjs');
    const png = PNG.sync.read(buf);
    const px = (px2: number, py: number) => {
      const i = (py * png.width + px2) * 4;
      return [png.data[i]!, png.data[i + 1]!, png.data[i + 2]!] as const;
    };
    const wall = px(x, wallY);
    const apron = px(x, apronY);
    const lw = lum(...wall);
    const la = lum(...apron);
    return { ratio: (la + 0.05) / (lw + 0.05), wall, apron };
  }

  test('围板 vs 墙 ≥ 2.0:1（反例：打回平铺 72% 必须红）', async ({ page }) => {
    await openDesk(page);
    // 跨章会触发抖动溶解仪式（SectionFx，900ms）——仪式期间全屏覆盖层在画，
    // 截图会量到遮罩色（首跑实测：两个取样点都是 73,68,72 的仪式格）。
    await page.waitForTimeout(1300);
    const size = await canvasSize(page);
    const d = deskSpec(size.w, size.h)!;
    const x = Math.round(d.desk.x0 + 12);
    const wallY = Math.round(d.desk.top - 60);
    const apronY = Math.round(d.desk.front - 8);

    const now = await deskContrast(page, x, wallY, apronY);
    expect(
      now.ratio,
      `围板 ${now.apron.join(',')} vs 墙 ${now.wall.join(',')} 只有 ${now.ratio.toFixed(2)}:1 —— 桌子又融进墙了`
    ).toBeGreaterThanOrEqual(2);

    // 反例自检：把 scrim 打回旧行为（平铺 72%，无梯度）
    await page.evaluate(() => {
      const s = document.querySelector('.bgfx-scrim') as HTMLElement;
      s.style.backgroundImage = 'none';
      s.style.backgroundColor = 'color-mix(in srgb, var(--c-bg) 72%, transparent)';
    });
    await page.waitForTimeout(200);
    const old = await deskContrast(page, x, wallY, apronY);
    expect(
      old.ratio,
      `平铺 72% 下仍有 ${old.ratio.toFixed(2)}:1 —— 这条判据量不到遮罩，是假绿`
    ).toBeLessThan(1.6);
  });
  test('置物板三件小物：过 scrim 后仍比板亮（层级 = 物件 > 家具）', async ({ page }) => {
    await openDesk(page);
    await page.waitForTimeout(1300); // 同上：等章节转场仪式画完
    const size = await canvasSize(page);
    const S = deskSpec(size.w, size.h)!.shelf;

    const buf = await page.screenshot();
    const { PNG } = await import('pngjs');
    const png = PNG.sync.read(buf);
    const px = (px2: number, py: number) => {
      const i = (py * png.width + px2) * 4;
      return [png.data[i]!, png.data[i + 1]!, png.data[i + 2]!] as const;
    };
    const L = (c: readonly number[]) => lum(c[0]!, c[1]!, c[2]!);
    const wall = px(Math.max(2, S.x - 60), S.y - 30);
    const board = px(S.x + (S.w >> 1), S.y + S.board - 2);
    const pot = px(S.plant.x + 3, S.y - 4);
    const books = px(S.books.x + 6, S.y - 8);
    const radio = px(S.radio.x + 4, S.y - S.radio.h + 3);

    const c = (a: readonly number[], b: readonly number[]) =>
      (L(a) + 0.05) / (L(b) + 0.05);
    for (const [name, p] of [
      ['陶盆', pot],
      ['书堆', books],
      ['收音机面板', radio],
    ] as const) {
      expect(
        c(p, wall),
        `${name} 相对空墙只有 ${c(p, wall).toFixed(2)}:1 —— 暗墙上读不出来`
      ).toBeGreaterThanOrEqual(1.9);
      expect(
        c(p, board),
        `${name} 比搁板（${c(board, wall).toFixed(2)}:1）还暗 —— 读作板上挖的洞，不是摆在板上的东西`
      ).toBeGreaterThan(1);
    }
  });
  test('方案 B：屏幕冷光落桌面 + CRT 受光方向 + 墙脚暗带', async ({ page }) => {
    await openDesk(page);
    await page.waitForTimeout(1300);
    const size = await canvasSize(page);
    const d = deskSpec(size.w, size.h)!;
    const D = d.desk;

    const buf = await page.screenshot();
    const { PNG } = await import('pngjs');
    const png = PNG.sync.read(buf);
    const px = (x: number, y: number) => {
      const i = (Math.round(y) * png.width + Math.round(x)) * 4;
      return [png.data[i]!, png.data[i + 1]!, png.data[i + 2]!] as const;
    };
    const L = (c: readonly number[]) => lum(c[0]!, c[1]!, c[2]!);

    // ① 屏幕冷光：屏下桌面 vs CRT 右缘外的同面同材质
    const underScreen = px(d.crt.screen.x + 40, D.top + 5);
    const offScreen = px(d.crt.x + d.crt.w + 20, D.top + 5);
    expect(
      L(underScreen) / L(offScreen),
      `屏下桌面 ${underScreen.join(',')} vs 屏外 ${offScreen.join(',')} —— 屏没照亮桌面`
    ).toBeGreaterThanOrEqual(1.05);

    // ② 受光方向：光在右，左棱必须明显暗于右棱（旧版三边同亮 = 描边不是光）
    const leftRim = px(d.crt.x, d.crt.y + 40);
    const rightRim = px(d.crt.x + d.crt.w - 1, d.crt.y + 40);
    const sum = (c: readonly number[]) => c[0]! + c[1]! + c[2]!;
    expect(
      sum(rightRim) - sum(leftRim),
      `左棱 ${leftRim.join(',')} 右棱 ${rightRim.join(',')} —— 受光方向不成立（三边同亮？）`
    ).toBeGreaterThanOrEqual(60);

    // ③ 墙脚暗带：桌沿正上方要比 40px 以上的墙暗（桌子「站在墙前」的深度线索）
    const wallNear = px(1027, D.top - 3);
    const wallFar = px(1027, D.top - 40);
    expect(
      L(wallNear) / L(wallFar),
      `墙脚 ${wallNear.join(',')} vs 远墙 ${wallFar.join(',')} —— 桌子又贴在墙上了`
    ).toBeLessThanOrEqual(0.93);
  });

  test('台灯发光逻辑：罩口到桌面之间亮、罩顶以上必须暗（光只往下走）', async ({ page }) => {
    await openDesk(page);
    await page.waitForTimeout(1300);
    const size = await canvasSize(page);
    const d = deskSpec(size.w, size.h)!;
    const L = d.lamp;
    const D = d.desk;

    const buf = await page.screenshot();
    const { PNG } = await import('pngjs');
    const png = PNG.sync.read(buf);
    const region = (cx: number, cy: number, half: number) => {
      let r = 0, g = 0, b = 0, n = 0;
      for (let y = cy - half; y <= cy + half; y++)
        for (let x = cx - half; x <= cx + half; x++) {
          const i = (y * png.width + x) * 4;
          r += png.data[i]!;
          g += png.data[i + 1]!;
          b += png.data[i + 2]!;
          n++;
        }
      return [r / n, g / n, b / n] as [number, number, number];
    };
    const Lr = (c: readonly number[]) => lum(c[0]!, c[1]!, c[2]!);
    const ratio = (a: readonly number[], b: readonly number[]) => (Lr(a) + 0.05) / (Lr(b) + 0.05);
    const warm = (c: readonly number[]) => c[0]! - c[2]!;

    // 罩口（L.arm）到桌沿（D.top）之间那段墙：被灯照到的「低处暖光」
    const below = region(L.x, Math.round((L.arm + D.top) / 2), 6);
    // 罩顶以上 40px：真实台灯的灯罩挡住向上的光 → 这里必须基本是原墙色
    const above = region(L.x, L.head - 40, 6);
    const far = region(L.x - 320, Math.round((L.arm + D.top) / 2), 6);

    expect(
      ratio(below, far),
      `罩口下方只有 ${ratio(below, far).toFixed(2)}:1 —— 光没落在桌面上方，台灯像没通电`
    ).toBeGreaterThanOrEqual(1.3);

    expect(
      warm(below) - warm(far),
      `罩口下方 R−B ${warm(below)} vs 远墙 ${warm(far)} —— 只是变亮没变暖`
    ).toBeGreaterThanOrEqual(8);

    // ★ 物理判据：灯罩挡住向上的光。罩顶以上若也亮 → 光从罩顶射出（旧实现就是这个错）
    expect(
      ratio(above, far),
      `罩顶以上也有 ${ratio(above, far).toFixed(2)}:1 —— 光从灯罩顶上射出来了，不像台灯`
    ).toBeLessThan(1.12);
  });

  test('S4 置物板左缘对齐内容列（与 h1 同一条竖线，不再孤悬在墙中）', async ({ page }) => {
    await openDesk(page);
    await page.waitForTimeout(1300); // 等章节转场仪式画完
    const size = await canvasSize(page);
    const d = deskSpec(size.w, size.h)!;
    const h1Left = await page.evaluate(() => {
      const h1 = document.querySelector('#hero h1') as HTMLElement | null;
      const c = document.querySelector('#hero .container') as HTMLElement | null;
      const el = h1 ?? c;
      if (!el) return -1;
      const r = el.getBoundingClientRect();
      return Math.round(r.left);
    });
    // 反例：把 deskSpec.shelf 改回「板右缘 = 桌左缘 − 44」→ 左缘落到 ~396，差 120px
    expect(
      Math.abs(d.shelf.x - h1Left),
      `置物板左缘 ${d.shelf.x} vs 内容列左缘 ${h1Left} —— 板没有和文字列对齐`
    ).toBeLessThanOrEqual(2);
    // 右缘仍不得越到工位侧
    expect(d.shelf.x + d.shelf.w).toBeLessThanOrEqual(d.desk.x0);
  });
});
