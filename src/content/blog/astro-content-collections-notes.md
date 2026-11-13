---
title: 'Astro Content Collections 实践笔记'
date: 2025-08-18
description: '用 content collections + Zod schema 锁住 frontmatter，把写文章变成纯 Markdown，构建期自动校验数据形状。附两年后回看仍然成立的三条经验，以及 schema 作为类型门禁怎么用。'
tags: ['Astro', 'TypeScript', 'engineering notes']
cover: '📝'
draft: false
---

这篇是 engineering notes（技术笔记）：记录本站博客 pipeline 怎么用 Astro 的 content collections 搭起来，以及用了一段时间后仍然成立的经验。

先给结论，再给过程。三条：schema 是类型门禁而不是文档；草稿过滤要放在唯一入口；内容层的契约可以脱离浏览器测试。

## 一、为什么用 content collections

个人博客最怕两件事：写作成本高，以及内容数据结构悄悄漂移（schema drift）。

第二件比第一件难发现。今天加一个 `cover` 字段，明天某篇写成 `coverImage`，构建不报错，页面只是少了张图。这种问题靠人记不住，只能靠机器拦。

content collections 把文章文件夹变成类型安全的数据源：

- 文章是纯 Markdown，放在 `src/content/blog/`，git 即内容仓库；
- frontmatter 由 Zod schema 锁定，形状不对时构建期直接报错；
- 查询侧拿到的是带类型的 entry，`post.data.title` 有类型提示。

对比 headless CMS，少一个系统依赖，多一份确定性。个人站不需要写作后台，所以 CMS 明确放在范围外。

## 二、schema 锁定六字段

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

几个细节值得说。

`date` 用 `z.coerce.date()`，frontmatter 里写 ISO 字符串（如 `2026-08-18`）即可，由 schema 完成转换。这样 Markdown 里不必写 YAML 时间对象，人与机器都好写。

`draft` 用 `z.boolean().default(false)`，默认发布。默认值的取向很重要：漏写字段时应倾向安全的那个方向。「默认不发布」会让写作者以为发了却没发，反向默认更符合直觉。

`cover` 是可选字符串。可选字段的代价是所有消费端都要处理 undefined，所以可选字段要少——本站六个字段里只有一个是可选的。

## 三、三条仍然成立的经验

### 经验一：schema 是类型门禁，不是文档

最容易把 schema 当成「给未来自己看的字段说明」。它真正的身份是**门禁**：`astro sync` 生成类型定义，`tsc --noEmit` 校验消费端代码，`astro build` 校验全部内容文件。

于是有了一条硬规则：**加字段必须同步改 schema**。顺序反过来的话 `tsc` 会立刻报错，而不是等到线上发现某篇少了字段。

门禁的价值在它拦住什么。它拦不住内容写得差，但能拦住「字段名写错」「字段类型写错」「忘记加必填字段」这三类，而这三类恰好是反复出现的。

### 经验二：草稿过滤只能有一处

生产构建时过滤 `draft: true`：

```ts
const posts = (await getCollection('blog'))
  .filter((post) => !post.data.draft)
  .sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());
```

关键在于「只有一处」。列表页过滤一次、单篇路由的 `getStaticPaths` 再过滤一次，看着稳妥，实际是两份真值。两份真值迟早分叉：某次只改了列表页，草稿文章就从 `/blog` 里消失，但 `/blog/[slug]` 依然生成——反而比两边都不过滤更隐蔽。

本站的做法是把过滤收进 `src/lib/posts.ts` 一个函数，两处都调它。这样「草稿不上线」是一条可测的契约，而不是两处各自记得。

### 经验三：内容契约可以脱离浏览器测

用了一段时间才意识到：很多「页面上对不对」的判断根本不需要浏览器。

比如「导航里的锚点都指向真实存在的 section id」，再比如「项目卡外链指向的是已发布文章，不是草稿」。这类判断是**跨文件引用契约**。

读源码加正则，在 vitest 里就能断言，跑一次一秒钟。

浏览器测试要几十秒起，而这类契约有上百处。放进单测层以后，改导航、改项目配置时会立刻知道有没有指向不存在的东西，不必先起浏览器再翻截图。

同一条思路还能往内容层延伸：文章正文里有没有重复的一级标题、目录里的链接是否都在同一篇内有效、摘要长度分布是否离谱。这些都可以在构建前算出来。

## 四、踩过的两个坑

**slug 的来源**。本站 slug 直接取 `post.id`，也就是文件名（去掉扩展名）。好处是文件名即 URL，改名即改链接，一眼能看出来。代价是**改名即换 URL**，旧链接会 404。没有历史包袱时这样最省事，一旦有外链就要加一层重定向映射。

**Markdown 处理器与插件**。Astro 的 Markdown 管线可以挂 remark / rehype 插件，但每加一个插件就多一个依赖。本站需要「正文里别重复写一级标题」这类约束时，第一反应是写个 remark 插件在构建期删掉。

后来改用内容层测试加作者纪律解决，省掉一个依赖。判断依据很简单：能靠测试加纪律解决的，不要靠新依赖解决。

## 五、小结

content collections 把「写博客」收敛成三步：写 Markdown、schema 校验、静态构建。省下来的心智留给内容本身。

回看这套东西真正起作用的地方，不在它提供了多少功能。它把三类容易悄悄变坏的东西变成了会报错的东西：字段形状、草稿可见性、跨文件引用。

个人站的维护者通常只有一个，人的记忆不构成机制。把记忆换成门禁，是这类小项目唯一划得来的投资。
