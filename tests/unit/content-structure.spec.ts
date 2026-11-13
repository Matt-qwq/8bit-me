import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 文章正文结构契约（content structure contract）—— 2026-09-10 新增
 *
 * 起因：`page-contract.spec.ts` 抓出文章页有**两个 h1**——页面模板渲染
 * frontmatter `title` 为 h1，而 markdown 正文又用「# 标题」开头（18/18 篇都是，
 * 且与 title 完全一致）。语义锚点不唯一。
 *
 * 修法：删除正文里的顶层 H1（页面模板独占 H1）。本测试守这条约定，
 * 防止未来新文章再写 `# 标题`。
 *
 * 注意：**代码块内的 `# 注释` 不算**（如 fetch-path-selection 里的伪代码）。
 */

const DIR = join(process.cwd(), 'src/content/blog');

function bodyLines(raw: string): string[] {
  const nl = raw.includes('\r\n') ? '\r\n' : '\n';
  const lines = raw.split(nl);
  if (lines[0]?.trim() !== '---') return lines;
  const close = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  return close === -1 ? lines : lines.slice(close + 1);
}

/** 正文里的顶层 H1（排除代码块），返回行号（从 1 起，含 frontmatter 偏移） */
function topLevelH1(raw: string): number[] {
  const lines = bodyLines(raw);
  const hits: number[] = [];
  let inCode = false;
  lines.forEach((l, i) => {
    if (l.trim().startsWith('```')) inCode = !inCode;
    else if (!inCode && l.startsWith('# ')) hits.push(i + 1);
  });
  return hits;
}

describe('文章正文结构：不写顶层 H1（页面模板独占 h1）', () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith('.md'));

  it('内容目录非空（防路径写错导致测试空跑）', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  for (const file of files) {
    it(`${file} 正文无顶层 H1`, () => {
      const raw = readFileSync(join(DIR, file), 'utf-8');
      const hits = topLevelH1(raw);
      expect(
        hits,
        `正文第 ${hits.join(', ')} 行是顶层 H1——标题请交给 frontmatter title（页面模板渲染）`
      ).toEqual([]);
    });
  }

  it('代码块内的 # 注释不算违规（回归保护）', () => {
    const fake = [
      '---',
      'title: x',
      '---',
      '',
      '## 标题',
      '',
      '```python',
      '# 伪代码：在页面里直接取页面自己的接口',
      'print(1)',
      '```',
    ].join('\n');
    expect(topLevelH1(fake)).toEqual([]);
  });

  it('正文顶层 # 会被抓到（改前红）', () => {
    const fake = ['---', 'title: x', '---', '', '# 重复的标题', '', '正文'].join('\n');
    // 返回值是「正文切片内的 1-based 行号」：frontmatter 之后第 2 行（第 1 行是空行）
    expect(topLevelH1(fake)).toEqual([2]);
  });
});

/**
 * 内容量契约（roadmap P2-4）—— 2026-09-10
 *
 * P2-4 的判据是两条：`getPublishedPosts().length >= 18`，且已发布篇目
 * **每篇正文 ≥ 1200 汉字**（不足者补写，草稿要么写完发布、要么删）。
 *
 * 为什么用 `node:fs` 而不是 e2e：这是内容层契约，读文件加正则就能判，
 * 不需要浏览器（快 100 倍）。为什么排除代码块：代码不是汉字正文，
 * 拿代码块凑字数没有意义。
 *
 * **不守「draft 数 = 0」**：那是 P2-4 的一次性里程碑，草稿是本站的正常功能，
 * 把「永不允许草稿」写成永久契约是错的。这里只守「已发布篇数不倒退」
 * 与「已发布的不许是薄稿」。
 */
describe('内容量契约（P2-4）', () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith('.md'));

  /** 正文汉字数（去 frontmatter、去代码块与行内代码） */
  function bodyHanzi(raw: string): number {
    const body = raw.split('---').slice(2).join('---');
    const noCode = body
      .replace(/```[\s\S]*?```/g, '')
      .replace(/`[^`]*`/g, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
    return (noCode.match(/[\u4e00-\u9fa5]/g) ?? []).length;
  }

  const published = files
    .map((f) => ({ f, raw: readFileSync(join(DIR, f), 'utf-8') }))
    .filter((x) => !/^draft:\s*true\s*$/m.test(x.raw.split('---')[1] ?? ''));

  it('已发布篇数 ≥ 18（P2-4 的下限，防内容量倒退）', () => {
    expect(
      published.length,
      `已发布 ${published.length} 篇：${published.map((p) => p.f).join(', ')}`
    ).toBeGreaterThanOrEqual(18);
  });

  it('每篇已发布正文 ≥ 1200 汉字（不许薄稿）', () => {
    const thin = published
      .map((p) => ({ f: p.f, n: bodyHanzi(p.raw) }))
      .filter((x) => x.n < 1200)
      .map((x) => `${x.f}（${x.n} 字）`);
    expect(thin, `以下已发布文章不足 1200 汉字：\n${thin.join('\n')}`).toEqual([]);
  });

  it('守卫本身有效：汉字计数排除代码块与行内代码', () => {
    const raw = ['---', 'title: x', '---', '', '汉字'.repeat(600), '', '```', '汉字'.repeat(900), '```'].join('\n');
    expect(bodyHanzi(raw)).toBe(1200);
  });
});

/**
 * 旧插图管线的退役契约（ADR-0019）—— 2026-09-11
 *
 * 原「插图契约（P3-7）」组守的是构建期内联 SVG（`diagram-art.ts` + `ArticleFigure.astro`）
 * 的四条跨文件契约。2026-09-11 作者定调「图改成 markdown 直接渲染的逻辑图 / 流程图」
 * 后，旧管线已整体删除（连同 `figure` frontmatter 字段），故原四条契约作废，
 * 换成下面两条「退役不得回流」的契约：
 *   ① 没有任何文章再声明 `figure:`（schema 已删，写了会被 Zod 拒绝——但那要跑 build 才知道）
 *   ② `src/**` 里不再引用已删文件（`diagram-art` / `ArticleFigure` / `.afig-`）——
 *      引用不存在的模块会编译失败，而注释里残留引用会误导后来者（曾发生）。
 * ```flow 字符图本身的契约在 `tests/unit/flow-diagram.spec.ts`（含可读度量）。
 */
describe('插图管线已退役（ADR-0019：改由 ```flow 字符图承载）', () => {
  const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf-8');

  it('没有任何文章再声明 figure 字段（schema 已删）', () => {
    const bad = readdirSync(DIR)
      .filter((f) => f.endsWith('.md'))
      .filter((f) => /^figure:/m.test(read(join('src/content/blog', f))));
    expect(bad, `这些文章还留着 figure 字段（schema 已删，会被 Zod 拒绝）：${bad.join(' / ')}`).toEqual([]);
  });

  it('源码里不再引用已删除的旧插图管线', () => {
    const src = join(process.cwd(), 'src');
    const hits: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const full = join(d, e.name);
        if (e.isDirectory()) walk(full);
        else if (/\.(ts|astro|css)$/.test(e.name) && /diagram-art|ArticleFigure|afig-/.test(readFileSync(full, 'utf-8'))) hits.push(full);
      }
    };
    walk(src);
    expect(hits, `残留引用（旧图管线已删，引用了会编译不过 / 静默失效）：${hits.join(' / ')}`).toEqual([]);
  });
});
