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