# 8bit-me · 8-bit 实验场（像素博客）

> **8-bit retro-experiment playground** — a pixel-art blog built with Astro, canvas effects, chip-tune SFX and a CRT page transition. 中文为主的项目；本站实时访问：<https://8bit-me.netlify.app/>

8bit-me 是一个以复古游戏机美学贯穿全站的静态博客：内容上长期更新技术方法论文章，视觉/交互上是 8-bit 实验场——canvas 背景动画（机箱内部·机器叙事）、CRT 光束扫屏转场、程序化合成芯片音效、13 套像素主题、Konami 彩蛋与 404 打地鼠。

> 📌 **公开快照说明**：本仓库是项目的**公开快照镜像**（精选白名单内容，含全部可公开源码与文档），更新节奏由作者控制。日常开发在私有工作仓进行；站点部署链路（Netlify）与本仓无关。仓库理念与逆转过程见 `docs/adr/0009-open-source-public-repo.md`。

## 特性（Features）

- **单页滚动五 section**：hero / about / projects / skills / contact，IntersectionObserver 分块 reveal（像素级 steps 过渡，reduced-motion 下恒可见）
- **BgFx canvas 背景**（v5「机箱核心」）：PCB 结构层 + 低频事件层（信号包/尘埃/待机灯）+ 会话开机仪式 + 随 section 重组的 5 种机器态子图 + 2D 相机推拉视差；默认静、单强调色，72% scrim 可读性契约
- **CRT 光束扫屏转场**（v3 单一签名）：恒定暗场幕布 + 双芯光束（白热亮芯 + 磷光晕），WAAPI `steps()` 整数齿阶跃，出 0.34s / 入 0.28s
- **chip-tune SFX**（v3 角色分音）：Web Audio 程序化合成，六类音效角色（nav/click/toggle/select/game/hover），零音频文件
- **13 套像素主题**：Game Boy 四色（--gb-0..3）体系，单一数据源 `src/lib/themes.ts`，FOUC 防护预挂载
- **自定义光标装置** CursorFx + **Konami 彩蛋** + **404 打地鼠小游戏**
- **可访问性契约**：整页 `prefers-reduced-motion` 降级（BgFx 降频不冻结 / CursorFx 静态准星），CRT 转场按作者意图豁免；scrim 可读性 72% 不可让
- **零后端静态站**：Astro `output: 'static'`，Markdown 内容管线，无 headless CMS、无构建期密钥

## 技术栈（Stack）

Astro 7（静态输出）· 原生 TypeScript canvas（零动画依赖库）· Vitest（单元）· Playwright + 系统 Chrome（e2e 冒烟）· 自托管 Zpix 像素字体（子集化产出）

## 快速上手（Quick start）

```bash
# node >= 22（.nvmrc）
npm i
npm run dev        # http://localhost:4321
npm run build      # 产物 dist/
npm run preview    # 本地预览产物（e2e 同源 4322 端口）
```

## 定制指南（Customize）

- **博客文章**：在 `src/content/blog/` 新增 `.md`（frontmatter：`title / date / description / tags / cover? / draft`），`draft: true` 不发路由。schema 见 `src/content.config.ts`。
- **首页文案**：`src/lib/config.ts`（nav / projects / site copy），主题色板 `src/lib/themes.ts`。
- **五个 section**：`src/components/sections/*.astro`。
- **背景动画**：纯函数在 `src/lib/bgfx-motion.ts`（机器几何/相机/辉光数学，单测锁死），绘制在 `src/components/BgFx.astro`，运行时 `src/lib/fx-runtime.ts`。
- **音效角色**：元素标 `data-sfx-role` / `data-sfx-hover`，映射在 `src/lib/sfx.ts`。

## 部署（Deploy anywhere）

`npm run build` 产出纯静态 `dist/`——可推任意静态托管（Netlify / GitHub Pages / Cloudflare Pages / 对象存储）。仓库自带 `netlify.toml` 示例；环境变量仅 `ASTRO_SITE` / `ASTRO_BASE`（未设时自动跳过 canonical/og:url，不会指错域名）。

## 测试（Testing）

- `npm run test:unit` —— Vitest 单测（纯逻辑层：palette / bgfx-motion / fx-moment / trans-math / themes / config / posts…）
- `npm run test:e2e` —— build 后 Playwright 冒烟（四路由渲染 + 控制台零报错 + 转场 DOM 链路 + 行为断言），e2e 依赖系统 Chrome，留在本地人工验收
- CI 质量门：本仓 GitHub Actions 每次 push/PR 跑 `typecheck` + `test:unit` + `build`（见 `.github/workflows/ci.yml`）

[![CI](https://github.com/Matt-qwq/8bit-me/actions/workflows/ci.yml/badge.svg)](https://github.com/Matt-qwq/8bit-me/actions/workflows/ci.yml)

## 目录结构（Layout）

```
src/
  components/        # BgFx / CursorFx / PageTrans / Nav / Footer …（含 sections/）
  content/           # blog 文章（Markdown 内容管线）
  layouts/           # BaseLayout：13 主题注入 + 挂载顺序固定
  lib/               # 纯逻辑层（vitest 目标）：palette / bgfx-motion / fx-moment /
                     #   trans-math / themes / config / posts / prefs / sfx
  pages/             # index(五 section) / blog / blog/[slug] / 404
  styles/            # global.css（Zpix 像素排版阶梯 + :root 变量）
docs/adr/            # 架构决策记录（0001 已被 0009 取代）
tests/               # unit（vitest）+ e2e（playwright）
```

## 执照（License）

- 代码与文档：**MIT**（见 `LICENSE`）。
- **Zpix 像素字体**为第三方付费字体（SolidZORO）：个人/教育产品免费，商业产品需向作者付费授权，**不在 MIT 范围内**——见 `Zpix-NOTICE.md`。本站以个人产品身份使用。