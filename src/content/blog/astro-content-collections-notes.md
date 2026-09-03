---
title: 'Astro Content Collections 实践笔记'
date: 2025-08-18
description: '用 content collections + Zod schema 锁定 post frontmatter，把「写文章」变成纯 Markdown 编辑器，构建期自动校验数据形状。'
tags: ['Astro', 'TypeScript', 'engineering notes']
cover: '📝'
draft: false
---

# Astro Content Collections 实践笔记

这篇是 v1 首发方向里的 engineering notes（技术笔记）：记录本站博客 pipeline
是怎么用 Astro 的 **content collections** 搭起来的。

## 为什么选 content collections

个人博客最怕两件事：写作成本高，和内容数据结构悄悄漂移（schema drift）。

content collections 把文章文件夹变成「类型安全的数据源」：

- 文章是纯 Markdown 文件，放在 `src/content/blog/`，git 即内容仓库（Markdown content pipeline）；
- frontmatter 由 **Zod schema** 锁定，字段形状不对时构建期直接报错；
- 查询侧拿到的是带类型的 entry，`post.data.title` 这种访问有类型提示。

对比 headless CMS：少一个系统依赖，多一份确定性。v1 不需要写作后台，
CMS 明确放在 out of scope。

## schema 锁定六字段

本站 post schema 固定在六个字段：

```ts
schema: z.object({
  title: z.string(),
  date: z.coerce.date(),
  description: z.string(),
  tags: z.array(z.string()),
  cover: z.string().optional(),
  draft: z.boolean().default(false),
})
```

- `title` / `description` / `cover` 是普通字符串；
- `date` 用 `z.coerce.date()`，frontmatter 里写 ISO 字符串（如 `2025-08-18`）即可；
- `tags` 是字符串数组；
- `draft` 是布尔值，默认 `false`。

这个 schema 就是本项目的测试缝（test seam）：`astro sync` 生成类型定义，
`tsc --noEmit` 校验所有消费端代码，`astro build` 校验全部内容文件。

## draft 过滤

生产构建时，列表与单篇路由都显式过滤 `draft: true`：

```ts
const posts = (await getCollection('blog'))
  .filter((post) => !post.data.draft)
  .sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());
```

这样写了一半的文章（draft）永远不会意外上线，发布 = 把 `draft` 改回 `false`
并 push，符合「push 即发布」的写作流。

## 小结

content collections 把「写博客」这件事收敛成：写 Markdown → schema 校验 →
静态构建。省下来的心智留给内容本身。