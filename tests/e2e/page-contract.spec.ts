import { expect, test } from '@playwright/test';
import { MODES } from '../../src/lib/themes';

/**
 * 每页契约（page contract）—— roadmap P1-6
 *
 * 起因：现有 spec 全是「不许」（≤1.55:1 / ≤2 层 / ≥4.5:1 / 零溢出），
 * 没有一条「必须有」。所以「一眼看出一套系统」这件事在文档里没有对应条目——
 * 每页可以各不相同而测试全绿。
 *
 * 本组把「同一套语法」落成 6 条可断言契约，4 条路由 × 逐条：
 *   ① 导航底线 1px --c-line（顶部区域分隔）
 *   ② ≥1 个 .pixel-panel（内容有容器语言）
 *   ③ 面板顶缘 2px 受光带（地平线受光，ADR-0021）
 *   ④ 唯一 h1（语义锚点）
 *   ⑤ 首屏内 ≥1 个可交互元素（不是纯静态墙）
 *   ⑥ 受光带色 = 本档 --c-accent（不引入第五色）
 */

const ROUTES = [
  '/',
  '/blog/',
  '/blog/2026-09-04-immutable-data-warehouse/',
  // P2-3 第二种视图：新页面必须遵守同一套视觉语法（面板 / 唯一 h1 / 零报错）
  '/blog/tags/',
  '/blog/tags/python/',
  '/404/',
];

test.describe('每页契约：同一套视觉语法', () => {
  for (const route of ROUTES) {
    test(`${route} 满足 6 条契约`, async ({ page }) => {
      await page.goto(route, { waitUntil: 'load' });
      await page.waitForTimeout(1800);

      const m = await page.evaluate(() => {
        const cs = (el: Element | null) => (el ? getComputedStyle(el) : null);
        const nav = document.querySelector('header.nav');
        const panels = [...document.querySelectorAll('.pixel-panel')];
        const h1s = [...document.querySelectorAll('h1')];
        const interactive = [
          ...document.querySelectorAll('a[href], button, [tabindex]:not([tabindex="-1"])'),
        ];
        const vh = window.innerHeight;
        const inFirstScreen = interactive.filter((e) => {
          const r = e.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && r.top < vh && r.bottom > 0;
        });
        const firstPanel = panels[0];
        return {
          navBorderWidth: nav ? cs(nav)!.borderBottomWidth : 'missing',
          navBorderColor: nav ? cs(nav)!.borderBottomColor : 'missing',
          panelCount: panels.length,
          panelTopWidth: firstPanel ? cs(firstPanel)!.borderTopWidth : 'missing',
          h1Count: h1s.length,
          h1Text: h1s[0]?.textContent?.trim().slice(0, 40) ?? '',
          interactiveInFirstScreen: inFirstScreen.length,
          firstPanelBorderColor: firstPanel ? cs(firstPanel)!.borderTopColor : 'missing',
          accent: getComputedStyle(document.documentElement).getPropertyValue('--c-accent').trim(),
          line: getComputedStyle(document.documentElement).getPropertyValue('--c-line').trim(),
        };
      });

      // ① 导航底线 1px + --c-line
      expect(m.navBorderWidth, '导航底线应为 1px').toBe('1px');
      const lineRgb = (() => {
        const h = m.line.replace('#', '');
        return `rgb(${[0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(', ')})`;
      })();
      const accentRgb = (() => {
        const h = m.accent.replace('#', '');
        return `rgb(${[0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(', ')})`;
      })();
      expect(m.navBorderColor, '导航底线色 = --c-line').toBe(lineRgb);

      // ② ≥1 个面板
      expect(m.panelCount, '每页至少一个 .pixel-panel').toBeGreaterThanOrEqual(1);

      // ③ 面板顶缘受光带 2px（地平线受光，ADR-0021）
      expect(m.panelTopWidth, '面板顶缘应为 2px 受光带').toBe('2px');

      // ④ 唯一 h1（语义锚点）——404 页历史上用 h2 当页标题，是真实的语义缺口，
      //    故本契约对 404 也要求 h1（已在 404.astro 修正）
      expect(m.h1Count, `h1 应恰好 1 个（实际 ${m.h1Count}：${m.h1Text}）`).toBe(1);

      // ⑤ 首屏内 ≥1 个可交互元素
      expect(m.interactiveInFirstScreen, '首屏应有可交互元素').toBeGreaterThanOrEqual(1);

      // ⑥ 面板顶缘受光带 = --c-accent（不引第五色）
      expect(m.firstPanelBorderColor, '面板顶缘 = --c-accent').toBe(accentRgb);
    });
  }
});

test.describe('每页契约：恒暗档成立', () => {
  // MODES 现为单元素数组（LIGHT 已退役），遍历自动只跑 dark
  for (const theme of MODES) {
    test(`${theme.key}：面板顶缘受光带与导航底线 = 本档 token`, async ({ page }) => {
      await page.goto('/', { waitUntil: 'load' });
      await page.waitForTimeout(1200);

      const m = await page.evaluate(() => ({
        panel: getComputedStyle(document.querySelector('.pixel-panel')!).borderTopColor,
        nav: getComputedStyle(document.querySelector('header.nav')!).borderBottomColor,
      }));
      const rgb = (hex: string) => {
        const h = hex.replace('#', '');
        return `rgb(${[0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(', ')})`;
      };
      expect(m.panel).toBe(rgb(theme.colors.accent));
      expect(m.nav).toBe(rgb(theme.colors.line));
    });
  }
});
