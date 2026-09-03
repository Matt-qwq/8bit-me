import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

/**
 * post schema —— 唯一的可编程测试缝（test seam）。
 * frontmatter 六字段由 Zod 锁定：title / date / description / tags / cover / draft。
 * 任何字段形状不符都会在 astro sync / build / typecheck 阶段暴露。
 */
const blog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
  schema: z.object({
    /** 标题 */
    title: z.string(),
    /** 发布日期（ISO 8601） */
    date: z.coerce.date(),
    /** 摘要 */
    description: z.string(),
    /** 标签（数组） */
    tags: z.array(z.string()),
    /** 封面（像素 sprite / emoji / 占位），非必需 */
    cover: z.string().optional(),
    /** 草稿：draft 文章不渲染到公开列表 */
    draft: z.boolean().default(false),
  }),
});

export const collections = { blog };