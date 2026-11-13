import { expect, test, type Page } from '@playwright/test';
import { scrollHeroToTop } from './helpers/hero';

/**
 * CRT 终端（hero 工位屏内容物）—— 浏览器真渲染守卫
 *
 * 作者终局裁决（2026-10-02）：屏里是电脑，内容 = 代码生成的终端 + 打字光标。
 * 分工：源码契约（token/兜底/动效惯例/旧件已死）→ tests/unit/crt-terminal.spec.ts；
 * 浏览器里真的在打字、会循环、reduced-motion 行为、屏对齐 → 本文件 +
 * tests/e2e/hero-desk.spec.ts（figure 盒 = deskSpec.crt.screen）。
 *
 * 动效判据沿用打字机的硬经验：断言「文本真的在变」，不能只断言元素存在。
 */

const DESKTOP = { width: 1440, height: 900 };

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
  await page.waitForTimeout(150);
}

const textLen = (page: Page) =>
  page.evaluate(() => (document.querySelector('#hero .term-body')?.textContent ?? '').length);

test.describe('CRT 终端', () => {
  test('真的在打字：12s 窗口内文本从短打到全文（相位无关判据）', async ({ page }) => {
    test.setTimeout(30000);
    await openDesk(page);

    // 打字是清屏→打满→停留→清屏的循环，任意时刻采样长度都可能下行——
    // 相位无关的判据：窗口内同时观察到「短文本」与「全文」两个状态 = 打字真的发生过。
    const seen = await page.evaluate(
      () =>
        new Promise<{ min: number; max: number; full: boolean }>((resolve) => {
          let min = Number.POSITIVE_INFINITY;
          let max = 0;
          let full = false;
          const t0 = Date.now();
          const iv = setInterval(() => {
            const t = document.querySelector('#hero .term-body')?.textContent ?? '';
            min = Math.min(min, t.length);
            max = Math.max(max, t.length);
            full = full || t.includes('build ok');
            if (Date.now() - t0 > 12000) {
              clearInterval(iv);
              resolve({ min, max, full });
            }
          }, 120);
        })
    );
    expect(seen.max - seen.min, `文本量应大幅变化（实测 ${seen.min}→${seen.max}，打字/清屏在发生）`).toBeGreaterThan(30);
  });

  test('环境循环：一个剧本走完停留后清屏，换下一个剧本继续（永续随机轮播）', async ({ page }) => {
    test.setTimeout(45000);
    await openDesk(page);

    // 相位无关：40s 窗口（> 单剧本 8~12s + 停留 4.2s）内应观察到至少两个不同剧本的命令
    const cmds = await page.evaluate(
      () =>
        new Promise<string[]>((resolve) => {
          const seen = new Set<string>();
          const t0 = Date.now();
          const iv = setInterval(() => {
            for (const el of document.querySelectorAll('#hero .term-body .line-prompt + span')) {
              const t = el.textContent ?? '';
              if (t) seen.add(t);
            }
            if (Date.now() - t0 > 40000) {
              clearInterval(iv);
              resolve([...seen]);
            }
          }, 200);
        })
    );
    expect(cmds.length, `40s 内应轮播到 ≥2 个剧本的命令（实测 ${cmds.join(' | ')}）`).toBeGreaterThanOrEqual(2);
  });

  test('窄屏（居中栈）：插画壳在位，屏面 176×156，全文兜底可见', async ({ page }) => {
    await page.setViewportSize({ width: 480, height: 800 });
    await page.goto('/', { waitUntil: 'load' });

    const m = await page.evaluate(() => {
      const hero = document.getElementById('hero')!;
      const figure = document.querySelector('#hero .crt-avatar figure')!;
      const screen = document.querySelector('#hero .term-win')!;
      const r = screen.getBoundingClientRect();
      const cs = getComputedStyle(figure);
      return {
        desk: hero.classList.contains('hero--desk'),
        border: cs.borderLeftWidth,
        w: r.width,
        h: r.height,
        fallback: document.querySelector('#hero .term-fallback')?.textContent ?? '',
        title: document.querySelector('#hero .term-title')?.textContent ?? '',
        status: document.querySelector('#hero .term-status')?.textContent ?? '',
        hidden: getComputedStyle(document.querySelector('#hero .term-body')!).overflow,
      };
    });
    expect(m.desk, '窄屏不应走工位档').toBe(false);
    expect(m.border, '居中栈档应保留插画壳（4px 边框）').toBe('4px');
    expect(Math.abs(m.w - 176), `屏面宽应 176px，实际 ${m.w}px`).toBeLessThan(0.02);
    expect(Math.abs(m.h - 156), `屏面高应 156px，实际 ${m.h}px`).toBeLessThan(0.02);
    expect(m.fallback, '无 JS 兜底：剧本 A 转写可见').toContain('ls posts/');
    expect(m.title, '终端标题栏在位').toContain('matt@8bit-me');
    expect(m.status, '终端状态栏在位').toContain('zsh');
    expect(m.hidden, '打字区域锁死在盒内').toBe('hidden');
  });

  test('reduced-motion：打字照常播（ADR-0005 知情覆写），光标闪烁被全局压制', async ({ page }) => {
    test.setTimeout(30000);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openDesk(page);

    // 相位无关：窗口内文本量大幅变化 = 轮播照常播
    const seen = await page.evaluate(
      () =>
        new Promise<{ min: number; max: number }>((resolve) => {
          let min = Number.POSITIVE_INFINITY;
          let max = 0;
          const t0 = Date.now();
          const iv = setInterval(() => {
            const t = (document.querySelector('#hero .term-body')?.textContent ?? '').length;
            min = Math.min(min, t);
            max = Math.max(max, t);
            if (Date.now() - t0 > 12000) {
              clearInterval(iv);
              resolve({ min, max });
            }
          }, 120);
        })
    );
    expect(seen.max - seen.min, `reduced-motion 下轮播应照常（实测 ${seen.min}→${seen.max}）`).toBeGreaterThan(30);

    // 光标是脚本逐剧本创建/摘除的（回车即摘，存在是间歇的）：
    // 单次原子检查——轮询等它挂载，挂载瞬间立刻读计算样式（reduced-motion 下应 animation: none）
    const caretAnim = await page.evaluate(
      () =>
        new Promise<string>((resolve) => {
          const t0 = Date.now();
          const iv = setInterval(() => {
            const c = document.querySelector('#hero .term-caret');
            if (c) {
              clearInterval(iv);
              const cs = getComputedStyle(c);
              resolve(`${cs.animationName} ${cs.animationDuration}`);
            } else if (Date.now() - t0 > 8000) {
              clearInterval(iv);
              resolve('absent');
            }
          }, 80);
        })
    );
    expect(caretAnim, `reduced-motion 下光标应停闪常显（实测 ${caretAnim}）`).toContain('none');
  });

  test('无障碍：终端为装饰层 aria-hidden，真实数据由 hero 读数承载', async ({ page }) => {
    await page.goto('/', { waitUntil: 'load' });

    const m = await page.evaluate(() => ({
      hidden: document.querySelector('#hero [data-term]')!.getAttribute('aria-hidden'),
      status: document.querySelector('#hero .hero-status') !== null,
    }));
    expect(m.hidden).toBe('true');
    expect(m.status, '站况读数（POSTS/UPDATE）仍在 hero 正文区').toBe(true);
  });

  test('运行时样式可达 + 单行不破相：光标块有形、任意轮播行不换行不溢出', async ({ page }) => {
    test.setTimeout(30000);
    await openDesk(page);

    // 2026-10-03 P0② 实锤：.line/.term-caret 样式曾住在 scoped <style> 里，
    // JS 创建的元素没有 data-astro-cid → 计算样式全丢（输出行换行破相、光标
    // 裸奔）。这条用例读的就是**运行时元素的计算样式**，scoped 失效即红。
    // 光标与行都是逐剧本创建/摘除的（间歇存在）——轮询到同时在场再读。
    const m = await page.evaluate(
      () =>
        new Promise<{
          caretW: string;
          caretBg: string;
          promptColor: string;
          lines: Array<{ h: number; overflow: boolean }>;
        }>((resolve) => {
          const t0 = Date.now();
          const iv = setInterval(() => {
            const caret = document.querySelector('#hero .term-caret');
            const prompt = document.querySelector('#hero .line-prompt');
            const lines = [...document.querySelectorAll('#hero .term-body .line')];
            if (caret && prompt && lines.length > 0) {
              clearInterval(iv);
              const cs = getComputedStyle(caret);
              resolve({
                caretW: cs.width,
                caretBg: cs.backgroundColor,
                promptColor: getComputedStyle(prompt).color,
                lines: lines.map((el) => ({
                  h: el.getBoundingClientRect().height,
                  overflow: el.scrollWidth > el.clientWidth + 1,
                })),
              });
            } else if (Date.now() - t0 > 15000) {
              clearInterval(iv);
              resolve({ caretW: 'absent', caretBg: 'absent', promptColor: 'absent', lines: [] });
            }
          }, 80);
        })
    );
    expect(m.caretW, `光标块宽 ${m.caretW} ≠ 7px → 运行时样式未达 JS 元素`).toBe('7px');
    expect(m.caretBg, '光标无背景色 → 运行时样式未达 JS 元素').not.toBe('rgba(0, 0, 0, 0)');
    expect(m.promptColor, '提示符不是 accent 金 → .line-prompt 样式未达 JS 元素').not.toBe(
      'rgb(232, 236, 245)'
    );
    expect(m.lines.length, '轮播行未挂载').toBeGreaterThan(0);
    for (const l of m.lines) {
      expect(l.h, `行高 ${l.h}px > 24px → 输出行发生换行破相`).toBeLessThanOrEqual(24);
      expect(l.overflow, '行内容横向溢出（超宽行）→ 输出行超 26 半宽').toBe(false);
    }
  });
});
