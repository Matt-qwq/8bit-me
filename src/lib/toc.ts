import GithubSlugger from 'github-slugger';

/**
 * 文章目录（2026-10-30 D3）：从 markdown 正文抽出 h2，生成与正文**同 id** 的锚点。
 *
 * 为什么用 github-slugger：Astro 的 markdown 流水线给标题加 id 用的就是它
 * （node_modules 里作为 astro 的依赖存在）。自己写 slugify 会在中文标点、
 * 重复标题（-1 后缀）这些地方漂移，锚点静默失效——那正是「引用指向不存在的
 * 东西」这类跨文件契约，e2e 有守卫（refine spec 的 TOC 用例）。
 *
 * 口径：
 * - 只收 h2（h3 太多，目录会变成第二篇正文）；
 * - 跳过代码围栏内的 `## `（示例代码不是标题）；
 * - 少于 minCount 条返回空数组（两三条的短文加目录是噪声）；
 * - slugger 要吃**全部层级**的标题（Astro 也是按全文顺序编号的），否则重名后缀会对不上。
 */
export interface TocItem {
  /** 与正文 h2 的 id 完全一致 */
  id: string;
  /** 标题原文（去掉行内标记） */
  text: string;
}

const INLINE_MARKS = /[*_`]/g;

export function buildToc(markdown: string, minCount = 3): TocItem[] {
  const slugger = new GithubSlugger();
  const items: TocItem[] = [];
  let inFence = false;
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    const level = m[1]!.length;
    const text = m[2]!.replace(INLINE_MARKS, '').trim();
    if (!text) continue;
    const id = slugger.slug(text);
    if (level === 2) items.push({ id, text });
  }
  return items.length >= minCount ? items : [];
}
