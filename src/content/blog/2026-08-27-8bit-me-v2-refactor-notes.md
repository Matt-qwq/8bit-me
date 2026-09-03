---
title: '8bit-me v2 重构手记：架构、主题与 canvas 动画'
date: 2026-08-27
description: '一条线拆成三块切面：源码私有站点公开的托管决策（ADR-0001）、13 套主题收敛进单一数据源、以及零依赖 bg-fx canvas 的辉光引擎。合并成一篇完整重构叙事。'
tags: ['8bit-me', 'Netlify', 'design tokens', 'canvas', 'Web Audio']
cover: '🛠️'
draft: false
---

# 8bit-me v2 重构手记

2026-08 的 v2 重构一次动了三层：**架构与托管**（源码私有、站点公开、
迁到 Netlify）、**主题系统**（13 套颜色收敛进单一数据源）、**视觉引擎**
（零依赖 bg-fx canvas 动画）。三条线本是同一次重构的三块切面，这里合并
成一篇完整叙事——决策怎么定的、等价性怎么验证的、坑是怎么踩的。

## 第一章：架构与托管（ADR-0001）

### 问题：仓库该不该公开？

站点的内容是公开作品集（要发简历给 HR 看），但**源码**是另一个问题：
AI 维护的代码 + 完整方案，放在 public 仓库等于把内部设计全部暴露。
GitHub Pages 免费档强制仓库 public——「站点公开」和「源码公开」被绑死了。

解法：**仓库 private + 站点 public 分离**。访问者只看到渲染产物，
源码只对站主可见。GitHub Pages 免费档不满足，只好换托管。

### 托管选型：被墙支配的选项

选托管时查了个事实：从国内直连测试——

| 平台 | 国内直连 |
|---|---|
| `github.io` | 可达 |
| `netlify.app` | 可达 |
| `*.workers.dev` / `*.pages.dev`（Cloudflare） | 被墙 |
| `*.vercel.app` | 被墙 |

先选了 Cloudflare Pages（免费、私有仓构建），上线后发现 Workers 部署 +
`pages.dev` 域名在国内直连不通——自己的站自己都打不开。换成 **Netlify**：
免费档、GitHub App 连接私有仓、`.netlify.app` 国内可达。一个隐藏坑：
Netlify 2026-07-28 后新建团队**默认新项目 private**（site protection），
新站一律 401 登录页，需手动把 Project visibility 改为 Public。

### 框架为什么维持 Astro 7

「喜欢新技术」和「AI 维护成本低」在这里并不冲突：Astro 7 本身就是
registry 最新主版本，且是唯一满足五条约束的选项（静态站、markdown
内容管线、零迁移成本、v2 canvas 扩展、免费托管）。

### 部署契约（踩过的坑汇总）

1. `astro.config.mjs` 默认 base 曾是 `/8bit-me/`（GitHub Pages 子路径）——
   迁移后必须注入 `ASTRO_BASE=/`，否则产物落到子路径、canonical 错位。
2. 环境变量 `ASTRO_SITE` 决定 canonical/og:url；不注入就静默指向旧域名。
3. Netlify 上 `netlify.toml` 的构建设置**优先于** UI 配置（官方文档明示），
   于是 typecheck 门禁以 `command = "npm run typecheck && npm run build"`
   的形式写进了仓库，随 code review 一起恢复了。
4. 每次 `push main` 自动触发生产构建——内容就是代码，写 markdown 即上线。

这套「决策文档化 + 评审」流程对 AI 维护的项目尤其重要：任何 agent 读
`CONTEXT.md` + `docs/adr/` 就能还原每一条为什么。

## 第二章：单一数据源的主题系统

本站在 v1 时有一套典型的"双源"主题系统：主题颜色既写在
`src/lib/themes.ts`（面板 + 色板条用），又手写在 `global.css` 的
13 个 `:root[data-theme="…"]` 块里。加一个主题 = 改两处，
`tsc` 只能保证 key 合法，保证不了 CSS 同步。

重构目标：**加主题只改一个文件**。

### 生成色块，而不是手写

主题块的生产形态变成：`BaseLayout.astro` 在构建期由 `THEMES` 数组
直接生成 CSS，内联到 `<head>`：

```ts
const themeCss = THEMES.map(
  (t) =>
    `:root[data-theme="${t.key}"]{--gb-0:${t.colors[0]};--gb-1:${t.colors[1]};--gb-2:${t.colors[2]};--gb-3:${t.colors[3]};}`
).join('\n');
```

`global.css` 里只保留 `:root`（默认色 + 语义别名）。经典 CSS 变量分层：
语义别名（`--color-text` 等）定义一次，主题块只覆盖 `--gb-0..3`，
`var()` 在**实际消费元素**上解析，所以深度嵌套的组件无需改动。

### 等价性怎么验证

评审时专门核过 var() 链路的等价性：
`:root[data-theme=…]` 的 specificity（0,2,0）覆盖 `:root`（0,1,0）的
`--gb-*`；别名声明在 `:root`，custom property 在声明元素处完成代入再继承。
13 套色值逐一与旧手写块比对，大小写无关、值一致 ✓。

### 主题下的 CRT overlay

CRT 扫描线原本硬编码 GB 绿（`rgba(15,56,15,…)`），任何主题下都是绿线。
现在消费 `--gb-3`（对比色槽）而不是 `--gb-0`（背景槽）——后者在浅色
主题下会等于背景色、扫描线不可见（这是 code review 抓出来的回归）：

```css
:root {
  --crt-scan: color-mix(in srgb, var(--gb-3) 35%, transparent);
  --crt-vignette: color-mix(in srgb, var(--gb-3) 45%, transparent);
}
```

无 `color-mix` 的旧浏览器走 `@supports not` 回退到固定近似值。

### 教训

双源数据的"以防万一"同步注释是最大的谎言——有同步约束，就该消除
第二个源，而不是靠注释保证。加主题从"改两处 + 祈祷颜色一致"变成
"数组加一项"，正是 AI 维护场景最想要的形态。

## 第三章：零依赖 canvas 动画（bg-fx）

hero 首屏的背景动画（bg-fx）是 v2 的主实验：六种模式（星尘/扫描/雨/
波形/网格/关闭）共用一套引擎。全程零依赖，只有 `astro` 一个包。

### 质感从哪来

平涂小像素是"简陋感"的来源。电子感三件套：

1. **辉光（additive）**：深色主题下把光晕层用 `globalCompositeOperation =
   'lighter'` 叠加（多次绘制自然提亮），核心层回 source-over；浅色主题
   退回普通叠加防洗白（背景亮度算一次，主题切换时重算）。
2. **分层**：星尘分前景（accent）/背景（light）；流星带渐隐尾迹；
   WAVE 模式三层（辉光 → 波形 → 镜像倒影）。
3. **脉冲**：全局呼吸（`0.75 + 0.25·sin(t)`）让亮度活起来。

### 音画联动：事件解耦

`src/lib/sfx.ts` 的 `playClick / playHover / playNav` 在合成音效的同时向
`window` 派发 `CustomEvent('8bit:fx')`，bg-fx 监听后生成对应光效
（click→扩散波纹 / nav→全屏扫光 / hover→星火）。**声音与画面零耦合**，
将来加新的音效或新的光效都不用改对方。

### 性能预算（静态站的底线）

- `devicePixelRatio` 封顶 1.5
- 粒子数按 canvas 面积裁剪（`clamp(area/9000, 70, 170)`）
- hero 滚出视口（IntersectionObserver）和标签页隐藏时停帧
- 样式串预生成，避免逐帧拼 `rgba()` 字符串
- 坐标全部整数化（`fillRect`），天然防锯齿

### 踩过的两个坑

**坑一：启动死锁。** 启动门 `wantsRun()` 里包含了 `running` 标志，
而 `running` 只能由 `sync()` 开启——动画永远无法启动（用户看到的是
完全静止）。修复：门禁只看外部条件（视口可见 + 页面可见），
不自引用自身状态。

**坑二：reduced-motion 冻结。** 尊重 `prefers-reduced-motion` 的初版
实现是"渲染一帧静态画面"。对**装饰性背景**这是过度执行——用户要的就是
活力。改为：降频半速（每 2 帧推进一步）而不是冻结，保留克制感同时
不牺牲体验。

## 小结

零依赖不是"抠门"，是让 AI 维护和性能预算都变简单的架构选择：
canvas 2D 能做出 neon 质感，就永远不需要引入渲染库。三块切面各自
独立、又共享同一条底线：**可维护性优先，决策全部留档**——这正是
一个让 AI 接手时少踩坑的站点该有的样子。