import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MODES, meetsContrast } from '../../src/lib/themes';

/**
 * 像素滚动条契约（ADR-0012）
 *
 * 分工：
 *   单测守「颜色数学 + 源码不变量」——不开浏览器就能拦住的静默失效；
 *   e2e（tests/e2e/scrollbar.spec.ts）守「浏览器里真的级联成那样」——
 *   headless Chrome 不绘制滚动条，但 getComputedStyle 能取到伪元素级联值。
 *
 * 注意：这里**不**做「所有 px 都是 4 的倍数」这类断言——本特性天然含 2px
 * 描边/边框，仓库既有件（.tag / .skill-bar / calc(var(--step)*0.5)）也是 2px，
 * 那条规则既错又无意义（首跑即红）。
 */

const ROOT = process.cwd();
// 仓库工作区是 CRLF（Windows 检出），统一成 LF 再跑正则，免得行尾差异造成假红
const CSS = readFileSync(join(ROOT, 'src/styles/global.css'), 'utf-8').replace(
  /\r\n/g,
  '\n'
);

/** 截取像素滚动条段落（到下一个已知顶级段落「电路化试点」为止） */
function scrollbarSection(): string {
  const start = CSS.indexOf('/* --- 像素滚动条');
  expect(start, 'global.css 应有像素滚动条段落').toBeGreaterThan(-1);
  const next = CSS.indexOf('\n/* 电路化试点', start);
  return CSS.slice(start, next === -1 ? undefined : next);
}

describe('滚动条配色契约（两档模式实算，不开浏览器）', () => {
  it('游标（--c-accent）vs 轨道底（--c-bg）≥ 3:1（WCAG 1.4.11 非文本对比）', () => {
    for (const m of MODES) {
      expect(
        meetsContrast(m.colors.accent, m.colors.bg, 3),
        `${m.key} 游标 vs 轨道`
      ).toBe(true);
    }
  });

  it('未点亮（--c-bg 空芯）→ 通电（--c-accent 实心）的变化量 ≥ 3:1（hover/active 可辨）', () => {
    for (const m of MODES) {
      expect(
        meetsContrast(m.colors.accent, m.colors.bg, 3),
        `${m.key} 通电前后`
      ).toBe(true);
    }
  });

  it('不引第五色：滚动条段落内零字面量颜色（必须走 --gb-* 变量）', () => {
    const section = scrollbarSection();
    const literals = section.match(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/g) ?? [];
    expect(literals, `发现字面量颜色：${literals.join(', ')}`).toEqual([]);
  });
});

describe('滚动条源码不变量', () => {
  const section = scrollbarSection();

  it('尺寸走 token，且窄屏降级存在', () => {
    expect(section).toContain('--sb-size');
    expect(CSS).toMatch(/--sb-size:\s*16px/);
    expect(section).toMatch(/@media \(max-width: 560px\)/);
  });

  it('Gecko 回退的门必须是 `not selector(::-webkit-scrollbar)`（测冲突条件本身）', () => {
    // 用 -moz-appearance 之类代理条件：Chromium 若补上该别名 → 门误开 →
    // scrollbar-color 压掉像素化，且 Nav/theme-panel 的隐藏滚动条会复活。
    expect(section).toContain('@supports not selector(::-webkit-scrollbar)');
    expect(section).not.toMatch(/@supports[^{]*-moz-appearance/);
    // scrollbar-color 声明只能出现在该门内（先剥掉注释——段头注释里也提到过这个词）
    const decls = section.replace(/\/\*[\s\S]*?\*\//g, '');
    const outside = decls.replace(
      /@supports not selector\(::-webkit-scrollbar\)\s*\{[\s\S]*?\n\}/,
      ''
    );
    expect(outside).not.toContain('scrollbar-color');
  });

  it('端部箭头显式关闭（不依赖浏览器默认行为）', () => {
    expect(section).toMatch(/::-webkit-scrollbar-button\s*\{[^}]*display:\s*none/);
  });

  it('滚动条不引外部资产（子集字体脚本不扫 CSS，但保持零 url() 更稳）', () => {
    expect(section).not.toContain('url(');
  });

  it('滚动条占位：html 有 scrollbar-gutter；section 容器不再内滚（骨架退役口径）', () => {
    expect(CSS).toMatch(/html\s*\{[^}]*scrollbar-gutter:\s*stable/);
    // 2026-09 拆 fullpage 翻页骨架：section > .container 的内滚 hack（max-height/
    // overflow-y:auto + 自带滚动条）已随方案退役，全页只剩文档一条滚动条 →
    // 「容器滚动条横跳」不复存在；旧规则复活即红（强度不减，断言从存在性转为反例）。
    expect(CSS).not.toMatch(/main#main > section > \.container\s*\{[^}]*overflow-y:\s*auto/);
    expect(CSS).not.toMatch(/main#main > section > \.container\s*\{[^}]*scrollbar-gutter/);
  });
});

describe('既有隐藏滚动条不回归（Nav）', () => {
  it('Nav 导航条内滚动条的隐藏规则仍在', () => {
    const nav = readFileSync(join(ROOT, 'src/components/Nav.astro'), 'utf-8');
    expect(nav).toContain('scrollbar-width: none');
    expect(nav).toMatch(/::-webkit-scrollbar\s*\{\s*display:\s*none/);
  });
});
