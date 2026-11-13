# 文章图改用 markdown 字符图，退役 SVG 插图管线

2026-09-11 作者定稿。承接 ADR-0018（文字优先）之后的第一次**内容层改造**：作者原话「旧的文章插图改成 markdown 渲染的逻辑图流程图，不要现在的图」。当日实施完成，6 篇带图文章全部改写，旧管线整体删除。

## 决策

文章里的逻辑图 / 流程图 = **markdown 源里直接写的 ```flow 围栏**，由 `<pre>` 渲染成字符图；构建期内联 SVG 那条路（`diagram-art.ts` 手写数据 + `ArticleFigure.astro` + frontmatter 的 `figure` 字段）**整体退役**。

理由三条：
- **图跟着论述走**：旧图被模板钉死在正文最前（`{post.data.figure && <ArticleFigure/>}`），所有文章都是「图 = 开篇导图」；现在图写在 markdown 里，出现在它真正解释的那段旁边。
- **零 JS / 零依赖 / 可断言**：字符图就是文本，不需要渲染层、不需要组件、不需要 schema 白名单；守线可以直接在源码层量。
- **降复杂度**：一次删除两个源文件、一个 schema 字段、两套测试文件与若干条跨文件契约（见下方退役清单）。

## 为什么能在 Zpix 下对齐（物理事实，非审美选择）

字符图看着「像 ASCII art」，但它能不能用完全押在 Zpix 的字宽上（实测 `public/fonts/zpix.ttf`，`unitsPerEm = 1200`）：

| 字符类 | advance | @12px | 含义 |
|---|---|---|---|
| 制表符 `─ │ ┌ └ ├ ▼ ▲`、箭头 `→ ↑ ↓ ←`、汉字、U+3000 | 1300/1200 em | **13.00px** | 同为「全角格」，故**能精确对齐** |
| ASCII（`A` `-` 等） | 700/1200 em | 7.00px | 半宽，**只能放在不参与右对齐的位置** |
| 半角空格 | 500/1200 em | 5.00px | 不能当缩进（会逐行错位），缩进一律 U+3000 |

三条由此推出的写作纪律（全部由单测守）：缩进只用 U+3000；参与对齐的字符必须全角；每行 ≤40 全角格（正文列内宽 544px ÷ 13px ≈ 41.8）。

## 行距：两次踩坑换来的下限（本 ADR 的核心教训）

Zpix 汉字的**墨高只有 0.9167 em**（12px 字号 → 11px），故行高决定一切：

| 行高 | 行间墨隙 | 结果 |
|---|---|---|
| 12px（1em） | **1px** | 作者：「字都粘一起了」——第一版为了 `│` 连成不断开的竖线，把行高压成了 1em |
| 16px | 5px | 作者：「行间距近乎贴一起」——16px 是全局排版档位里 12px 字号的配对，但它服务于**小标签 / 丝印** |
| **20px** | **9px** | 定稿。连续阅读块应按正文标准：站点正文 16px 配 28px 行高 = 1.75 倍 → 12px 对应 21px，取 4px 阶的 20px |

**两个结论**：
- **禁用纵向导轨符**（`│ ┌ ┐ └ ┘ ├ ┤ ┬ ┴ ┼`）：它们墨高满格（1.0000 em），要连续就必须行高 ≤ 墨高，与「行间墨隙 ≥ 8px」数学上互斥；改用整行箭头（`↓ → ▼`），它们不依赖纵向连续。
- **阈值要写「标准」，不能只写「故障模式」**：第一版守卫的下限是「不粘」（3px），于是它**放过了 16px 那个中间态**——照样绿。下限提到 8px（「不紧」）之后，16px 立刻被拦住（`5.00px < 8`）。

## 度量与守线（两侧各带常驻反例）

**源码 / 字体层** `tests/unit/flow-diagram.spec.ts`（遍历所有文章的 ```flow 块，加图自动覆盖）：
字符 Zpix 有字形（防静默回退系统字体）· 缩进只用 U+3000 · 每行 ≤40 全角格 · 图块非空 · 禁用纵向导轨符 · **行间墨隙 ≥8px、字间墨隙 ≥1.5px、行高 ∈ 4px 阶** · 配置契约（`excludeLangs: ['flow']` 仍在）。

**渲染层** `tests/e2e/flow-diagram.spec.ts`（源码层看不见层叠——同一文件里 `.prose pre code { line-height: 20px }` 就能把它抢走）：
计算样式（12px / 20px / Zpix / 字距 0 / 无 Shiki inline 样式）· 渲染行距 = 声明行高的整数倍 · 全角格前进量 = 13px 整数 · **canvas 像素扫描的真实墨迹间隙** · 主题跟随。

**两侧各有一条常驻反例自检**（把行高取 1em，度量必须判「紧」）——守卫必须证明自己不是恒绿的（先例：2026-09-10 那条「箭头不被挖空板切掉」因属性取错而恒绿了一天）。

**量墨迹的三个坑**（写进测试注释防复发）：
- canvas 的 `measureText().actualBoundingBox*` 在 Chrome 里**整数取整**：`迁` 量出 left=1/right=12，把真实的 2px 字间空隙吃掉了 → 只能扫像素。
- canvas 默认**亚像素定位**，逐字 `fillText` 会把间隙抹平（横向量出 0px）→ 必须按整数前进量显式定位，才与 DOM 一致（DOM 侧用 1x 截图核对：11px 墨 + 2px 隙）。
- 阈值取 50% 不透明（128）：低阈值会被**面板底纹**（实测色差 30）连成一片，误判成「粘」。

## 配置前提：为什么必须动 astro.config.mjs

Astro 7 的 markdown 处理器是 Sätteri，代码块默认过 Shiki，而 Shiki 会**把主题色写成 `<pre>` 的 inline style**（`background-color:#24292e;color:#e1e4e8`），站点 CSS 不写 `!important` 压不过；且未知语言 `flow` 会被**静默归一成 plaintext**（实测拿不到 `data-language="flow"`）。试过写 remark 插件接管，Astro 7 要求装 `@astrojs/markdown-remark`（不加依赖）。最终用官方开关解决：

```js
markdown: { syntaxHighlight: { type: 'shiki', excludeLangs: ['flow'] } }
```

图因此作为原始围栏输出 `<pre><code class="language-flow">`，颜色 / 字体完全由站点 CSS 接管（`pre:has(> code.language-flow)`，`:has()` 是因为围栏语言落在 `<code>` 上、`<pre>` 自身没有类）。

**顺带发现（未处理，另议）**：站点其余代码块仍是 Shiki `github-dark`（深蓝 `#24292e` + Consolas），13 套主题下都不跟主题。

## 退役清单（本次一并删除）

| 删除 | 说明 |
|---|---|
| `src/lib/diagram-art.ts` | 6 张图的 SVG 数据与渲染器 |
| `src/components/ArticleFigure.astro` | 图面板组件（含 `.afig-*` 样式与信号包动画） |
| `figure:` frontmatter 字段 | `src/content.config.ts` 里的 `z.enum(FIGURE_KINDS)` |
| `tests/unit/diagram-art.spec.ts`、`tests/e2e/figure-signal.spec.ts` | 旧管线专用守线 |
| `tests/e2e/density.spec.ts` 两组插图用例、`font-coverage.spec.ts` 的图内用字用例、`typography-scale.spec.ts` 的白名单条目 | 口径随对象消失 |

**新增「退役不得回流」契约**（`tests/unit/content-structure.spec.ts`）：任何文章再写 `figure:` 即红；`src/**` 里再出现 `diagram-art` / `ArticleFigure` / `.afig-` 即红（引用已删模块会编译失败，注释里残留会误导后来者）。

## 边界

- 图的**表达力**弱于 SVG：只有线 / 箭头 / 缩进 / 字符，画不了分区框、虚线语义、右栏芯片阵列。这是本次接受的代价——要「逻辑关系与流程」，不要「装饰」。
- 12px 字号（Zpix 原生网格）比正文小一档；窄屏仍横向滚动（同旧 SVG，字符图不会回流）。
- `/lab` 交互图册不动：它仍是 archify 产物 + iframe 隔离（ADR-0016），与文章字符图并存不替代。
