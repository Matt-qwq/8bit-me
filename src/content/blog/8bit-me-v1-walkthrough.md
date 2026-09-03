---
title: '8bit-me v1 项目解说'
date: 2025-08-25
description: '一篇 project walkthrough：GB 绿四色调色板、pixel font、CRT overlay、chip-tune SFX 与 avatar sprite 四项 retro-experiment 是怎么在静态站点里落地的。'
tags: ['8bit-me', 'project walkthrough', 'design tokens']
cover: '🕹️'
draft: false
---

# 8bit-me v1 项目解说

这篇是 project walkthrough（项目解说）：把本站 v1 的架构与几个
retro-experiment（8-bit 实验）设计决定讲清楚。

## 站点结构

v1 只有两条路由族（route）：

- `/` —— 首页，single-page scrolling（单页滚动），五个 section
  （hero / about / projects / skills / contact）作为独立组件；
- `/blog` 与 `/blog/[slug]` —— 博客列表与文章单篇，由 content collections 驱动。

`output: 'static'`，构建产物是纯静态文件，直接丢给 GitHub Pages 托管；
不需要任何 server 端逻辑，静态部署天然没有密钥落地的空间。

## 四项 retro-experiment（v1 范围）

1. **pixel font**：自托管 Press Start 2P（OFL 协议），只覆盖 Latin，中文正文回退到
   系统字体栈，保证可读性——纯像素字体本身不含中文字形。
2. **CRT overlay**：全站扫描线 + 轻微闪烁的 overlay 层，`pointer-events: none`
   不挡点击；尊重 `prefers-reduced-motion`，并提供显式开关。
3. **chip-tune SFX**：Web Audio API 程序化合成，点击 / 悬停 / 导航三种短音效，
   零音频文件；静音开关默认开，选择存 localStorage。
4. **avatar sprite**：代码生成的占位像素头像——像素数据是字符串网格，程序绘制成
   内联 SVG，以后换真实素材只动一个组件。

## 设计 tokens：GB 绿四色

全站颜色收敛为 Game Boy 四色调色板（GB palette），以 CSS 变量暴露：

```css
:root {
  --gb-0: #0f380f;
  --gb-1: #306230;
  --gb-2: #8bac0f;
  --gb-3: #9bbc0f;
}
```

派生色统一用 `color-mix()` 从四色计算，不额外引入色相，视觉上保持单一主调。

## 部署

`astro.config` 配置 `site` / `base` 指向 GitHub Pages 子路径，所有内链走
`import.meta.env.BASE_URL` 拼出的 base-aware URL，最终产物可以直接发布到
仓库 Pages 的默认 URL，暂不绑定自定义域名。

## 收获

静态站点 + 程序化音效 + 单色调色板，是把「复古感」控制在低成本范围的好组合；
v2 的 canvas animation 与 gamified interaction 已经在路上。