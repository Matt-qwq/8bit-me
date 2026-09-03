# 8bit-me

复古像素美学贯穿全站的博客 + 8-bit 实验场：canvas 背景动画、芯片音效、13 套像素主题、CRT 光束转场。线上站点：<https://8bit-me.netlify.app/>

[![CI](https://github.com/Matt-qwq/8bit-me/actions/workflows/ci.yml/badge.svg)](https://github.com/Matt-qwq/8bit-me/actions/workflows/ci.yml)

📖 [English / README](README.md)

## 特性

- **首页单页滚动五 section**（hero / about / projects / skills / contact），像素级分块 reveal，reduced-motion 下恒可见
- **BgFx canvas 背景**——「机箱核心」PCB 结构层（芯片座、曼哈顿走线、信号包、开机仪式），随 section 重组五种机器态子图，2D 相机滚动+鼠标视差；服从固定 72% scrim 可读性契约
- **CRT 光束扫屏转场**——单一签名幕帘，WAAPI `steps()` 整数齿阶跃（出场 0.34s / 入场 0.28s）
- **chip-tune 芯片音效**——Web Audio 程序化合成，零音频文件，六类角色音（nav / click / toggle / select / game / hover）
- **13 套像素主题**——单一数据源（`src/lib/themes.ts`），Game Boy 四色系，FOUC 防护预挂载
- **自定义光标**、**Konami 彩蛋**、**404 打地鼠小游戏**
- **可访问性契约**——`prefers-reduced-motion` 降级氛围特效（BgFx 降频不冻结、光标退化为静态准星）；可读性 scrim 72% 不可让
- **零后端静态站**——Astro `output: 'static'`，Markdown 内容管线，无 CMS、无构建期密钥

## 技术栈

Astro 7 · TypeScript canvas（零动画依赖库）· Vitest（单元）· Playwright + 系统 Chrome（e2e 冒烟）· 自托管 Zpix 像素字体（构建期子集化）

## 快速上手

```bash
# node >= 22（见 .nvmrc）
npm i
npm run dev        # http://localhost:4321
npm run build      # 产物 dist/
npm run preview    # 本地预览产物（e2e 同源 4322 端口）
```

## 定制指南

- **博客文章**：在 `src/content/blog/` 新增 `.md`（frontmatter：`title / date / description / tags / cover? / draft`，`draft: true` 不发路由）。schema 见 `src/content.config.ts`。
- **首页文案 / 导航**：`src/lib/config.ts`；主题色板：`src/lib/themes.ts`。
- **五个 section**：`src/components/sections/*.astro`。
- **背景动画**：纯函数在 `src/lib/bgfx-motion.ts`（机器几何 / 相机 / 辉光数学，单测锁死），绘制在 `src/components/BgFx.astro`，运行时 `src/lib/fx-runtime.ts`。
- **音效**：元素标 `data-sfx-role` / `data-sfx-hover`，角色映射在 `src/lib/sfx.ts`。

## 部署

`npm run build` 产出纯静态 `dist/`——可推任意静态托管（Netlify / GitHub Pages / Cloudflare Pages / 对象存储）。仓库自带 `netlify.toml` 示例；环境变量 `ASTRO_SITE` / `ASTRO_BASE`（可选——未设时自动跳过 canonical/OG，独立随处可跑）。

## 测试

- `npm run test:unit` —— Vitest 单测（纯逻辑层：palette / bgfx-motion / fx-moment / trans-math / themes / config / posts…）
- `npm run test:e2e` —— build 后 Playwright 冒烟：四路由渲染、控制台零报错、转场 DOM 链路、交互断言。e2e 依赖系统 Chrome，留在本地人工验收。
- **CI 质量门**（`.github/workflows/ci.yml`）：每次 push/PR 跑 `typecheck` + `test:unit` + `build`。

## 目录结构

```
src/
  components/        # BgFx / CursorFx / PageTrans / Nav / Footer …（含 sections/）
  content/           # blog 文章（Markdown 内容管线）
  layouts/           # BaseLayout：13 主题注入 + 挂载顺序固定
  lib/               # 纯逻辑层（vitest 目标）：palette / bgfx-motion / fx-moment /
                     #   trans-math / themes / config / posts / prefs / sfx
  pages/             # index（五 section）/ blog / blog/[slug] / 404
  styles/            # global.css（Zpix 像素排版阶梯 + :root 变量）
docs/adr/            # 架构决策记录（0001 已被 0009 取代）
tests/               # unit（vitest）+ e2e（playwright）
```

## 更新节奏

本仓库为项目的公开镜像，内容为可公开的子集，定期整仓同步；详见 `docs/adr/0009-open-source-public-repo.md`。

## 执照

- 代码与文档：**MIT**（见 `LICENSE`）。
- **Zpix 像素字体**为 SolidZORO 的第三方字体（个人/教育免费，商用需向作者付费授权），**不在 MIT 范围内**——见 `Zpix-NOTICE.md`。