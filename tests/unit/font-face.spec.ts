import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * @font-face 源码契约（像素字体 Zpix 的地基）
 *
 * 2026-09-08 作者发现：Zpix 完全没加载，全站静默退回系统黑体。
 * 根因是 `src: url(var(--font-zpix-subset))` —— **var() 不能出现在 url() 里**，
 * 属于非法 CSS：浏览器整条丢弃、构建期压缩器把 src 从产物里删掉，
 * @font-face 只剩 font-family 没有源。
 *
 * 这条契约把「合法 CSS + base 感知 + 单一来源」钉死，不让它再回来：
 *   1. 全仓 CSS/组件里不得出现 `url(var(`（非法模式，出现即静默失效）
 *   2. @font-face 只有一个来源：BaseLayout 注入（global.css 不再声明）
 *   3. 注入的声明必须带 src、两个字体源、且 URL 走 import.meta.env.BASE_URL
 *
 * 真加载由 tests/e2e/font.spec.ts 守（FontFaceSet + 渲染宽度），本文件只守源码形状。
 */

const ROOT = process.cwd();
const read = (rel: string): string =>
  readFileSync(join(ROOT, rel), 'utf-8').replace(/\r\n/g, '\n');

const CSS = read('src/styles/global.css');
const LAYOUT = read('src/layouts/BaseLayout.astro');

/** 剥掉块注释再断言：本仓库的注释里会写反例（如「不要写 url(var(…)」），
 *  它们不该被当成真实代码命中。 */
const code = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '');

describe('@font-face 合法性（禁止 url(var(...))）', () => {
  it('global.css 与 BaseLayout 都不含 `url(var(`（非法 CSS，会被整条丢弃）', () => {
    for (const [name, src] of [
      ['src/styles/global.css', CSS],
      ['src/layouts/BaseLayout.astro', LAYOUT],
    ] as const) {
      expect(code(src), `${name} 出现 url(var(...))`).not.toContain('url(var(');
    }
  });

  it('@font-face 单一来源：global.css 不再声明，由 BaseLayout 注入', () => {
    expect(code(CSS), 'global.css 不应再声明 @font-face').not.toMatch(
      /@font-face\s*\{/
    );
    expect(code(LAYOUT), 'BaseLayout 应注入 @font-face').toMatch(
      /@font-face\s*\{/
    );
  });
});

describe('BaseLayout 注入的字体声明', () => {
  it('带 src、woff2 + ttf 两个源', () => {
    expect(LAYOUT).toMatch(/@font-face\{[^}]*src:url\(/);
    expect(LAYOUT).toContain('fonts/zpix.subset.woff2');
    expect(LAYOUT).toContain('fonts/zpix.ttf');
    expect(LAYOUT).toContain("format('woff2')");
    expect(LAYOUT).toContain("format('truetype')");
  });

  it('URL 走 BASE_URL（子路径部署可用，不写根路径字面量）', () => {
    // 两个字体 URL 都必须由 import.meta.env.BASE_URL 前缀拼接
    const urls = LAYOUT.match(/url\('\$\{import\.meta\.env\.BASE_URL\}[^']*'\)/g) ?? [];
    expect(urls.length, `BASE_URL 前缀的字体 URL 数：${urls.length}`).toBe(2);
  });

  it('字体文件仍在 public/fonts（与 URL 路径一致）', () => {
    const preload = LAYOUT.match(/rel="preload"[\s\S]*?fonts\/zpix\.subset\.woff2/);
    expect(preload, 'BaseLayout 应保留 woff2 预加载').not.toBeNull();
  });

  it('font-display: block 保留（防 FOUT 抖动）', () => {
    expect(LAYOUT).toContain('font-display:block');
  });
});
