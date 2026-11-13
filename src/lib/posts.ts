import { getCollection, type CollectionEntry } from 'astro:content';

export type Post = CollectionEntry<'blog'>;

/**
 * 已发布文章（draft 过滤 + date 倒序）
 * draft: true 的文章不渲染到列表与 [slug] 路由（User Story 16）。
 */
export async function getPublishedPosts(): Promise<Post[]> {
  const posts = await getCollection('blog');
  return posts
    .filter((post) => !post.data.draft)
    .sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());
}

/** 展示用日期格式：YYYY-MM-DD
 * frontmatter 的 date 经 z.coerce.date() 按 UTC 解析（如 "2025-08-18" → UTC 零点），
 * 因此按 UTC 部分渲染，避免 UTC- 时区读者看到前一天。 */
export function formatDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(
    date.getUTCDate()
  )}`;
}
/**
 * 标签索引（roadmap P2-3 第二种内容视图的数据层）
 *
 * 设计取舍：**只收录达到门槛的标签**。
 * P2-3 的前提是「≥30 篇再做」，理由是内容少时按标签浏览会全是单篇标签——
 * 实测 18 篇时 41 个标签里 30 个只有 1 篇，直接铺出来就是一面死链墙。
 * 门槛直接守住那个理由：视图永远不会变薄，内容长起来后自动变丰富，
 * 不必等到某个篇数才敢开。
 *
 * 排序：先按篇数降序，同数按标签名（用 localeCompare 保证中英混排稳定）；
 * 门槛内的标签按此顺序渲染 → 输出确定性（同输入同顺序，可单测）。
 */
export interface TagCount {
  tag: string;
  count: number;
}

/** 标签 → 篇数（默认只看 ≥min 篇的；返回顺序即渲染顺序） */
export function getTagCounts(posts: Post[], min = 2): TagCount[] {
  const counts = new Map<string, number>();
  for (const post of posts) {
    for (const tag of post.data.tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .filter(([, n]) => n >= min)
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/** 标签页路由项：slug 与展示名成对给出，**索引页与详情页共用同一份**（防止两侧漂移） */
export interface TagRoute extends TagCount {
  slug: string;
}

/** 标签名 → URL slug（小写、空格转连字符、去掉标点；保留中日韩与拉丁字母数字） */
export function tagSlug(tag: string): string {
  return tag
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}-]/gu, '')
    .replace(/^-+|-+$/g, '');
}

/**
 * 标签路由表（索引页与详情页的唯一数据源）。
 * slug 冲突时按「先到先得 + -2 / -3」后缀消歧——顺序由 getTagCounts 保证确定，
 * 所以同一份内容永远得到同一组 URL（可单测）。
 */
export function getTagRoutes(posts: Post[], min = 2): TagRoute[] {
  const used = new Set<string>();
  return getTagCounts(posts, min).map(({ tag, count }) => {
    const base = tagSlug(tag) || 'tag';
    let slug = base;
    let n = 2;
    while (used.has(slug)) slug = `${base}-${n++}`;
    used.add(slug);
    return { tag, count, slug };
  });
}
