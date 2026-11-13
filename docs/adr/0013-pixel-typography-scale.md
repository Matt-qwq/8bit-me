# ADR-0013：像素排版可读性层（行高 / 型阶 / 字号档 / 加粗）

- 日期：2026-09-08
- 状态：已落地（Phase 1 + 当日重排 v2），**待作者本地 A/B 终判**（行距 28 vs 24、prose h2 20 vs 24、faux bold 是否可接受）
- 相关：`docs/research/pixel-typography-readability.md`（数据源）、`docs/specs/visual-acceptance-matrix.md`、`docs/specs/line-hierarchy.md`

## 背景 / 问题

像素字体 Zpix 是 **12px 像素网格**、全站只有 **400 字重**。但站点从未按自己的网格校过排版：

| 缺口 | 原值 | 后果 |
|---|---|---|
| 正文行高 | `line-height: 1.7` → 14px 档 23.8px / 16px 档 27.2px | 非 4px 阶，每行基线落在亚像素（关抗锯齿下笔画行间不均） |
| prose h2 | `0.95rem` = 15.2px | **比正文 16px 还小**，章节层级倒挂 |
| prose h3 | `0.8rem` = 12.8px | 破自家「<14px 笔画并死」注释 |
| 字号档 | 18.4 / 15.2 / 14.4 / 13.6 / 12.8 / 9.6 / 8.8 / 7.2px 共 8 档碎片 | 型阶不可解释、不可维护 |
| 字距 | `0.5px` | 每个汉字被加非格点间距 |
| `pre` 边框 | 3px | 全站唯一非 4px 边框 |
| 加粗 | `@font-face` 仅 400，`<strong>` 走浏览器 faux bold，`.prose` 连规则都没有 | 像素字重影/糊边 |

`docs/research/pixel-typography-readability.md` 已量化全部问题并给出 C2-1…C2-11 映射，但从未实现。

## 一、前置调研（AGENTS 铁律：读了什么原则 → 为何适用于本任务）

| 来源（实读） | 原则 | 落点 |
|---|---|---|
| `docs/research/pixel-typography-readability.md` A2.3 / A2.6 | 像素字基线必须落整数网格；28px = 4px 阶，对 14px=2.0、16px=1.75 均在 CJK 舒适区 | body 行高 28px、标题 56/36/28/20px |
| 同上 A2.1 / A2.6 | Zpix 12px 格：12/24/36/48 整数倍最干净；<14px 笔画并死 | 字号只留 12/14/16/18/20/24/32/48 八档 |
| 同上 A2.4 | 代码块是独立阅读单元 | `pre` 4px 边框、`pre code` 14px/20px、行内 code 0.875em、`li+li` 0.5em |
| 同上 A2.5 | faux bold 三条出路 | 选**选项 1**（显式 `font-weight:700` + 写作层降密度）；作者放大 200% 判定重影不可接受时转选项 3（`.hl` 像素高亮） |
| `ap-motion-vocab`（本站裁剪版） | 一个产品一个种子；不引第二运动人格 | 本 ADR **零新增动画**，只是度量归整 |
| `animation-principles`（timing） | 装饰不得抢内容焦点 | 小件行高收紧（12px 字 → 16px 行高），不靠加大留白制造「高级感」 |

## 二、自我否定三问

① 氛围是否来自背景？**否**（改的是文字度量本身）。② 移除背景后仍有结构感？**是**（行高/型阶在纯白底上同样成立）。③ 元素独立表意？**是**（每个字号档都对应一个信息层级）。→ 通过。

## 三、裁决

**行高全部取 4px 整数阶，且每个改字号的选择器必须显式配行高**（否则继承 body 的 28px 会撑开小件）：

| 字号 | 行高 |
|---|---|
| 12px | 16px |
| 14px | 20px |
| 16px（正文） | 28px |
| 18px | 24px |
| 20px | 28px |
| 24px | 28px |
| 32px | 36px |
| 48px | 56px |
| Hero h1 `clamp(1.5rem,6vw,2rem)` | 36px |

字号允许档：`0.75 / 0.875 / 1 / 1.125 / 1.25 / 1.5 / 2 / 3rem`（+ 行内 code 的 `em` + `clamp()`）。
prose：h2 → 1.25rem、h3 → 1.125rem、单篇 h1 → 1.125rem、`.meta`/`.back` → 0.75rem。

## 四、实现要点与防线

- 落地文件：`src/styles/global.css`、`src/pages/blog/[slug].astro`、`src/pages/blog/index.astro`、各 section/组件样式（Hero / Nav / Footer / SideDock / Projects / Skills / 404 / Konami / AvatarSprite）。
- **连带必做**：博客时间线丝印两行行高变化后重算 `.tl-mark` 的 `gap`/`padding`（16 + 4 + 20 → 中心 36px = 焊盘中心），否则 `tests/e2e/blog-timeline.spec.ts` 的 ±2px 对齐断言必红。
- 防线（AGENTS 测试触发表）：
  - `tests/unit/typography-scale.spec.ts`：字号档位白名单、凡 rem 字号必配行高、3px 边框清零、prose 型阶源码契约（红-绿已验证：把 `.tag` 改回 0.55rem 即报错）。
  - `tests/e2e/typography.spec.ts`：computed style 断言（正文 28px、h2 20/28、h3 18/24、pre 4px、行内 code 14px、375px 下 14px/28px）。

## 五、已知代价与风险

| 代价/风险 | 说明 | 缓解 |
|---|---|---|
| 小件字号从 8.8/9.6px 跳到 12px | `.tag` / SideDock / `.cover-tag` 可能变宽或换行 | 三断点 + 13 主题截图巡检；溢出则给该件单独档位 + 注释豁免（当前无豁免项） |
| 28px 在 14px 移动端偏松 | 比值 2.0 | 作者 A/B 定 28 或 24；**26/27 禁用**（非 4px 阶） |
| faux bold 重影 | Zpix 无真粗体 | 默认选项 1；触发条件：作者 200% 放大判定不可接受 → 转 `.hl` |
| `.pixel-btn` 行高 1.4（16.8/19.6px）非 4px 阶 | 作者既定按钮度量 | 显式保留，未纳入本次对格；如要彻底对格需改按钮高度，另议 |
| `outline: 3px`（focus ring） | 是 `outline` 非 `border`，不在「3px 边框」范围 | 保持；焦点环可见性优先 |

## 六、明确不做

- 不改字号阶梯的**档位数量**（不引 15px 之类半档）。
- 不改 13 套主题色值、不改 CRT 扫描线 18% / scrim 72% 契约。
- 不做正文行宽调整（584px ≈ 36.5 字/行，已在 30–40 区间）。
- 不改写作层内容（句长/加粗密度属 `blog-writing` 技能）。

## 七、验收

见 `docs/specs/visual-acceptance-matrix.md` §Phase 1。门禁：`npm run typecheck` → `npm run test:unit` → `npm run build` → `npm test`。

## 八、演变

- **2026-09（本 ADR）**：首次落地。行高 1.7 → 28px；h1–h4 统一 1.1 → 56/36/28/20px；prose h2 15.2 → 20px、h3 12.8 → 18px；8 档碎片字号收敛到 8 档规范字号；pre 3 → 4px；字距归零；`strong` 显式 700。
- **2026-09-08 重排 v2（字体修复后实测驱动）**：作者发现 Zpix 自 2026-09-07 起从未加载（`url(var(...))` 非法 CSS，已修）。真字体回来后重新量，发现两件旧决策站不住：

  **① Zpix 的 CJK 前进量是 13/12 em，不是 1em。** 实测：12px→13.00、14px→15.17、16px→17.33、18px→19.50、20px→21.67、24px→26.00、32px→34.67、48px→52.00。所以只有 **12/24/36/48px 落在整数像素上**；16px 正文下每字 17.33px，浏览器逐字取整后出现 **17/18px 交替**（canvas 墨迹间距实测 `{17,18}`）——像素字最忌的字距抖动。

  **② “正文字距 0”是错的。** 原判据（A2.6）假设 CJK 前进量 1em、零字距天然等距；在 13/12 em 的 Zpix 上不成立。修法：`:root` 定义 `--ls-*` 把每档有效前进量修正到整数（`16px: -0.333333px → 17.0`、`14px: -0.166667px → 15.0`、`18px: -0.5px → 19.0`、`20/32px: -0.666667px → 21.0/34.0`；12/24/48 本就是整数取 0），**每个声明 font-size 的规则都要配对应档的 token**（否则会继承 body 的 -0.333px 到 12px 小件上，反而制造抖动）。

  同时把两处流体尺寸改为离散档（像素字下只有整数档能配精确修正）：body `clamp(14px,1vw+0.5rem,16px)` → **16px / ≤560px 14px**；Hero h1 `clamp(1.5rem,6vw,2rem)` → **32px / ≤640px 24px**。

  **③ 缺字审计**：全站渲染字符里有 3 个 Zpix 无字形（`▚`/`◨`/`✓`），会静默回退系统字体 → 换成 `▓`/`●`/`√`。

  防线：`tests/e2e/pixel-grid.spec.ts`（逐字左边界必须落整数 + 间距恒定；桌面/窄屏/文章页三处）+ `tests/unit/font-coverage.spec.ts`（正文与字形图标必须在 Zpix 里）+ `tests/unit/typography-scale.spec.ts`（token 存在性）。

- **待定**：若作者 A/B 选 24px 行距，改 `global.css` body + 小件行高联动 + 单测期望值（一处改动，两处断言）。
- **2026-09-08 标题尺度再收一档（作者反馈）**：“blog 列表字体太大、正文标题太大”。
  - 列表卡标题：不再用全局 `h3`（24px）→ **18px / 24px**（与 prose h2 同档，列表/正文尺度统一）。
  - 文章正文：h2 20→**18px**、h3 18→**16px**（h3 与正文同档，用 `font-weight: 700` 区分；Zpix 无真粗体，若观感发糊，备选是给 h3 加 2px `--gb-2` 左走线标记）。
  - 顺手修掉一个层级倒挂：文章标题 `.head h1` 原 18px **比 h2 的 20px 还小**（调研 B3 自身矛盾）→ **20px / 28px**，全页最大，h2/h3 逐级递减。
