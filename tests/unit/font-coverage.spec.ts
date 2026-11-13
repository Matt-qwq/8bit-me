import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import * as fontkit from 'fontkit';
import { describe, expect, it } from 'vitest';

/**
 * Zpix 字形覆盖契约（防「静默回退系统字体」）
 *
 * 2026-09-08 审计：全站**真正渲染出来**的字符里有 3 个 Zpix 没有字形——
 * `▚`（SideDock CRT 图标）、`◨`（SideDock THEME 图标）、`✓`（某篇文章正文）。
 * 缺字时浏览器不报错、不警告，只是**悄悄换一种字体画那一个字**，
 * 于是同一行里出现两种字形（像素字 + 系统黑体），截图不细看根本发现不了。
 *
 * 本测试用 fontkit 读全量 Zpix，检查两类必渲染文本：
 *   1. `src/content/blog/*.md` 正文（frontmatter 的 title/description/tags 也渲染，
 *      但 `cover:` 的 emoji 已不再作为文本渲染，故先剥掉该行）
 *   2. 组件里的字形图标（`<span class="icon">X</span>`）
 * 真加载由 tests/e2e/font.spec.ts 守；这里守「字形存不存在」。
 */

const ROOT = process.cwd();
const opened = fontkit.openSync(join(ROOT, 'public/fonts/zpix.ttf'));
// openSync 的返回类型是 Font | FontCollection（.ttc/.otc 才是集合）。
// zpix.ttf 是单个 TrueType，收窄一次；若真返回集合说明字体文件换错了，直接失败。
if (!('glyphForCodePoint' in opened)) {
  throw new Error('public/fonts/zpix.ttf 应为单个字体文件，而不是字体集合');
}
const font = opened;

const hasGlyph = (ch: string): boolean => {
  const g = font.glyphForCodePoint(ch.codePointAt(0)!);
  return !!(g && g.id !== 0);
};

/** 返回文本里 Zpix 缺字形的字符（去重，忽略空白） */
function missingGlyphs(text: string): string[] {
  const out = new Set<string>();
  for (const ch of text) {
    if (/\s/.test(ch)) continue;
    if (!hasGlyph(ch)) out.add(ch);
  }
  return [...out];
}

const fmt = (chars: string[]): string =>
  chars
    .map((c) => `${c} U+${c.codePointAt(0)!.toString(16).toUpperCase()}`)
    .join('  ');

describe('Zpix 字形覆盖', () => {
  it('所有博客正文用字都在 Zpix 里（缺字会静默回退系统字体）', () => {
    const dir = join(ROOT, 'src/content/blog');
    const bad: string[] = [];
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.md')) continue;
      const md = readFileSync(join(dir, name), 'utf8')
        // cover 的 emoji 只作封面 seed，不再作为文本渲染
        .replace(/^cover:.*$/m, '');
      const missing = missingGlyphs(md);
      if (missing.length) bad.push(`${name}: ${fmt(missing)}`);
    }
    expect(bad, `正文缺字形：\n${bad.join('\n')}`).toEqual([]);
  });

  it('组件字形图标都在 Zpix 里（SideDock 等）', () => {
    const files = [
      'src/components/SideDock.astro',
      'src/components/Nav.astro',
      'src/components/Footer.astro',
      'src/components/Konami.astro',
      'src/components/CoverBlock.astro',
      'src/components/CrtTerminal.astro',
      'src/pages/404.astro',
      'src/pages/blog/[slug].astro',
      'src/pages/blog/index.astro',
    ];
    const bad: string[] = [];
    for (const rel of files) {
      const src = readFileSync(join(ROOT, rel), 'utf8');
      // 只看 class="icon" 的元素内容（字形图标；普通文案由其它测试/人工守）
      const icons = [...src.matchAll(/class="icon"[^>]*>([^<]+)</g)].map(
        (m) => m[1]!
      );
      const missing = missingGlyphs(icons.join(''));
      if (missing.length) bad.push(`${rel}: ${fmt(missing)}`);
    }
    expect(bad, `图标缺字形：\n${bad.join('\n')}`).toEqual([]);
  });

  /**
   * （原「文章插图图内文字都在 Zpix 里」用例已随插图管线退役，见 ADR-0019；
   *   ```flow 字符图的字形覆盖改由 tests/unit/flow-diagram.spec.ts 继续守——
   *   那条同样是 fontkit 逐字查，只是对象从 TS 里的图数据换成了 markdown 里的图块。）
   */
});
