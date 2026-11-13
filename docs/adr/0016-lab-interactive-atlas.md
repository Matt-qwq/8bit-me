# ADR-0016：/lab 交互式图册（archify 产物 + 像素皮肤）

- 日期：2026-09-10
- 状态：已落地，**待作者本地观感验收**
- 相关：ADR-0004（机器叙事）、ADR-0013（`@font-face` 静默失效）、ADR-0014（生成式封面）、ADR-0015（铁律阈值化）、`docs/specs/line-hierarchy.md`、`docs/specs/typography-metrics-v1.md`

## 背景 / 问题

文章插图（`src/lib/diagram-art.ts`，P3-7）是**构建期内联 SVG**：跟 13 套主题变色、零 JS、零外链、3.7 KB。它解决的是「读完即走、不打断阅读」。
（**后续（2026-09-11）**：文章侧已改由 markdown 里的 ```flow 字符图承载，旧 SVG 管线整体删除，见 ADR-0019；本 ADR 里关于文章图的那句只作历史记录。）

但有一类需求它满足不了：**上手转**。pan / zoom / 按层聚焦 / 搜索节点 / 演示模式 / 导出——这些需要运行时。作者 2026-09-10 拍板：**并存**，不替代（原话「选 2」）。

于是问题变成：**怎样把一份 640 KB + 4 个 `<script>` 的第三方交互产物，塞进一个「零运行时、零外链、单一媒介」的站点，而不把纪律撑破。**

## 一、前置调研（读了什么 → 落点）

| 来源（实读） | 事实 | 落点 |
|---|---|---|
| `~/.agents/skills/archify/SKILL.md` + `schemas/dataflow.schema.json` | 只有 `dataflow / architecture / workflow / sequence / lifecycle` 五型；`dataflow` 的 stage 是**横向轴** | 本图选 `dataflow`；但**代价**见风险 1 |
| `archify doctor` / `validate` / `deliver` | 校验器给 9 项 showcase 检查（`label_route_clearance` / `container_border_runs` / `relationship_corridors` …），并给可执行建议坐标 | 用它做**授权期**的几何质检（本站没有任何等价物） |
| `assets/template.html` 实读 | ①颜色全走 `--*` token（`--bg` / `--database-stroke` / `--arrow` …），**零硬编码色值**；②`<noscript>` 里藏一个 Google Fonts 外链；③`?embed=1` 是它自己的画廊模式（连工具栏一起藏） | ①皮肤可派生 ②必须剥 ③参数必须改名 |
| 同上的 JS（`--archify-reader-width`） | 它自己把阅读列上限设成 **960px** → 图内 12 单位字恒为 9.3px | 本站优先级是「字先于构图」，需放开上限 |
| `开发流程文档` 铁律 + ADR-0015 | 底纹 ≤2 层 / 对比 ≤1.55；结构线 2·4px；单一媒介种子 | 见 §二 |
| ADR-0013 | `@font-face` 由模板字符串注入时 `url(var(...))` 非法 → Zpix 静默失效 | 皮肤里的字体 URL 是**字面量**，并由单测比对 |

## 二、媒介转换前置检查（慢道五步）

判为**慢道**的理由：命中「新增线元素」——产物带来一整套图内线系统。

1. **线元素盘点**：泳道虚线框 ×5、节点框 ×5、数据流折线 ×4、legend 引例线 ×2、面板边框 ×1（站内）。
2. **各条的实质功能**：泳道框 = 阶段边界；节点框 = 构件边界；折线 = **关系 + 方向**（承载「这一跳做了什么」）；legend = 图例；面板边框 = 容器边界。全部是分隔 / 引导 / 位置 / 关系四类之一，**无纯装饰线**。
3. **结构同构的物理媒介**：**机箱内的背板走线（backplane）**——分层插槽（泳道 = 插槽导轨）、插件板（节点 = 板卡）、板间互连（折线 = 数据总线）。与站点已有的 PCB 种子同源，不引入第二套语言。
4. **重映射为媒介组件**：
   - 线宽 → 全部归一到 **2px**（archify 原产物散着 `0.5/1/1.4/1.5/1.8`，其中三档不在白名单内）
   - 圆角 → **0**（产物里 102 处 `border-radius` 与 `rx="2/4/5/6/10"` 全部清零）
   - 颜色 → 节点/泳道/箭头 `--gb-2`，文字 `--gb-3`，底色 `--gb-0`；**无第五色**
   - 字体 → Zpix（站内子集，相对路径引用，不内联 base64）
   - 关掉它的背景网格层（`.c-grid`）——不占装饰层预算
5. **新媒介增强而非损害可读性**：图内 12 用户单位字实测屏幕 **11.1–11.6px**（三档视口），与站内插图的 12px 同档；线宽单档 2px；对比度随 13 套主题走既有的 `--gb-*` 契约。

### 自我否定三问

① **装饰层是否在预算内？** 是。`/lab` 未新增任何常驻装饰层（产物自带的网格层被 `display:none`）；层数仍 ≤2，对比度仍走既有契约。
② **移除装饰层后 UI 是否仍有结构感？** 是。面板边框 + 四角定位点 + 图内线系统独立成立。
③ **UI 元素是否独立表意？** 是（§二.2：每条线都有分隔/引导/位置/关系功能）。

→ 通过。

## 三、决策

**采纳 `/lab` 图册，三条硬边界：**

1. **产物是提交进仓库的静态文件**，不是构建链的一环。
   `scripts/atlas/build.mjs` 是**授权工具**（需本地 archify skill，不在 `package.json`）。
   理由：让 `npm run build` 依赖 `~/.agents/skills/archify` 会把构建链钉死在这台机器上。
   与 `scripts/subset-font.mjs` 同级——产物进 `public/lab/`，漂移由单测守。

2. **iframe 做文档级隔离**。
   640 KB + 4 个 `<script>` 的独立文档若内联，全站「零外部脚本」的约定就废了；
   iframe 让它碰不到本站 DOM/CSS，出问题只坏这一格。代价是跨文档不继承 CSS 变量 → 主题必须手动同步。

3. **主题 CSS 从 `themes.ts` 派生，不手写。**
   archify 有 ~35 个颜色 token；手写一份映射会在作者改主题时悄悄漂移成第 14 套观感。
   现在 13 套主题块由 `buildSkinCss(THEMES)` 生成，单测逐字比对已提交产物——**漂移即红**。

## 四、实现要点（都踩过）

| 坑 | 症状 | 处置 |
|---|---|---|
| `?embed=1` 撞名 | archify 自己也读这个参数进画廊模式，**把 pan/zoom 工具栏一起藏了**，页面看上去"D 没做出来" | 改名 `gb-chrome=min`，命名空间化 |
| `--archify-reader-width` | 它的 JS 动态设成 960px，图内字恒 9.3px | `html[data-gb] .container{max-width:none}` |
| `data-wide-diagram` + `overflow:hidden` | 图右半边（stage 04/05）**被永久裁掉且够不着** | 强制 `overflow-x:auto` |
| `stroke-width` 是 SVG 属性 | 属性权低于任何 CSS 规则，但也低于它的预设块 | 皮肤里显式 `stroke-width:2!important` |
| 两套主题开关 | archify 自带 Light/Dark 会写自己的 `data-theme`，与本站互相覆盖 | `gb-chrome=min` 下隐藏 `#btn-theme` |
| 头部大标题 | 24px 的 Zpix 撑成三行，且与页面 `h1` 重复 | `gb-chrome=min` 下隐藏 `.header` |
| 帧内空带 | 图容器高度由宽高比定死，内容底边 446–526px 浮动 | 容器 `flex:1` 吃掉余量并纵向居中 |
| Google Fonts 外链 | 藏在 `<noscript>` 里，JS 关掉时**真的会发起请求** | `build.mjs` 剥离 + 单测断言零外链 |

## 五、图内几何：那条大空白与它的守卫（2026-09-10 作者发现后补）

### 现象与根因

成品上线后作者指出：`svg/text[1]`（泳道阶段标签）与 `svg/g[2]/rect[2]`（节点框）之间空了一大片。

**根因不在我们写的规格，而在 archify 渲染器内部的不同步**（`renderers/dataflow/render-dataflow.mjs`）：

```js
rowYs: [128, 242, 356, 470, 584],                 // 写死的行坐标表
height: viewBox[1] - stageY - stageBottomPad,     // 泳道高却线性跟 viewBox
const y = layout.rowYs[node.row] + (node.yOffset || 0);   // 节点 y 只看 rowYs
```

节点 y 恒由 `rowYs[row]` 决定，泳道却随 `viewBox[1]` 一起长。
于是「泳道顶→节点顶」与「节点底→泳道底」两段留白**全靠人工算术对齐**——
写歪 1 个单位看不出来，写歪 46 个就是作者看到的那条缝。

**archify 自己的校验器不查这件事**：它只查「节点有没有超出可读区」（`node.y >= 104`）
与元素间碰撞，**不查「泳道内部有没有大片没用上的空白」**——因为对它的用例
（每阶段 2–3 行）那是正常布局。对本站这种「每阶段 1 行」的内容才成为缺陷。

### 修法与它的硬墙

`node.y >= stageY + stageH + 22 = 104` 是**硬约束**（实测把 yOffset 再往下推 1 个单位，
`validate` 直接失败）。阶段标签基线固定在 y=68，所以
**「标签底 → 节点顶」的理论下限就是 33.75 单位**，不可能再小。

顺带发现：`tag` 字段渲染为 `data-detail="fine"`，在默认的 `read` 档下 `opacity:0`
——**作者写的内容被静默丢弃**，而它正是「这一层的纪律」。

### 采用的双行布局（v8）

把纪律从「框底看不见的一行」升为**第二行节点**，泳道自然被真内容填满：

| 行 | 内容 | 类型 | y / 高 |
|---|---|---|---|
| row 0 | 这一层放什么（源库 → ODS → DWD → 上层 → 报表） | `database` | y=104（offset −24）/ 72 |
| row 1 | 这一层的纪律（重跑幂等 / 只增不改 / …） | `backend` | y=204（offset −38）/ 72 |

画布压到 `viewBox [1240, 360]`（两维均 ≥360 是 schema 下限）。
效果：**泳道最大空白 57.75 → 33.75（正好是硬墙），节点框内空洞 120.65 → 33.25**。
附带好处：与站内静态插图的「紧凑层块 + 纪律」结构一致，且纪律不再是看不见的内容。

### 机制：两条缺一不可的几何指标

`scripts/atlas/geometry.mjs`（纯函数，零 IO）把产物内联 SVG 解析成内容带，
逐泳道与逐框求「未被内容覆盖的最长连续空白」。**两条都要守**：

| 版本 | 泳道空白 | 框内空洞 | 覆盖率 |
|---|---|---|---|
| v1（修复前） | 57.75 ✗ | 120.65 ✗ | 71.3% |
| v6（只把框填满） | 33.75 ✓ | 126.65 ✗ | 79.8% |
| **v8（当前）** | **33.75 ✓** | **33.25 ✓** | 63.9% |

> **v6 那行是这套守卫存在的理由**：只守泳道的话 v6 会满分通过，
> 而它只是把空白从泳道搬进了框里（作者报的问题换个地方重现）。
>
> 另一个反直觉点：**v6 的覆盖率反而高于 v8**（79.8% vs 63.9%）——
> 因为覆盖率把「框」当内容，框越大越显得「填满」。
> 所以覆盖率只能当辅助信号，真正的判据是上面那两条「最长无内容带」。

阈值与理由写在 `tests/unit/lab.spec.ts` 的 `/lab 图内几何` 描述块里；
**泳道阀值 36 不是审美选择，是上游的硬墙（下限 33.75 + 余量）**，不要再调低。

解析器自身有一道 `assertParsed` 自检（泳道/节点框/文字三类都得解析到），
防止 archify 升级后标记一变、指标全部静默归零而测试仍绿。

## 七、挖空层：那个「关掉不认识的第三方元素」的坑（2026-09-10 作者发现）

### 现象

悬停节点时，走线标签（如「幂等写入」）被箭头线穿过、读不出来。

### 根因是我的错，不是 archify 的

当初写皮肤时我把两个 class 归成「装饰层」一起关了：

```css
html[data-gb] .c-grid,html[data-gb] .c-mask{display:none!important}   /* ✗ */
```

而 archify 模板里白纸黑字写着 `.c-mask` 的职责：

```
1. opaque mask rect (.c-mask) to hide arrows underneath   ← 就是它
2. styled rect (.c-<type>) with 1.5px stroke
3. text (.t-primary / .t-muted)
```

`.c-mask { fill: var(--mask) }` 是**挖空层**（数据流渲染器用它两处：① 遮节点下面的泳道虚线；
② 遮走线标签下面的箭头线）。我**没查它干什么**，看名字像装饰就关了。

**修法**：只关 `.c-grid`，把 `.c-mask` 留着并钉住填充 `--mask`（本站已把 `--mask` 设成 `--bg`，
所以开着正好等于「用背景色挖空」）。实测关/开两张像素图：关掉时线条直接穿过「幂等写入」的笔画。

### 机制：未登记的 `display:none` 一律拒绝

这个 bug 的本质是「**关掉一个不认识的第三方元素**」。所以守线不能写成「别关 .c-mask」
（那只能防住这一个），而要是「**关任何东西都得登记并写理由**」：

1. **生成期硬闸**（`scripts/atlas/skin.mjs`）：`HIDDEN_ALLOWLIST` 列出允许关的选择器；
   `buildSkinCss` 扫自己产出的 CSS，见到未登记的 `display:none` **直接抛错**。
   写理由的位置就是表本身——下一个人得先回答「它干什么的」。
2. **单测**：白名单与实际 CSS 双向对齐（既防未登记，也防僵尸条目）；
   外加一条「`.c-mask` 必须开着且填 `--mask`」的定点回归。
3. **e2e 行为断言（两条）**：
   - 产物里每个 `.c-mask` 都得真的在画（display / visibility / opacity 三条都查）；
   - **像素差分**：同一区域拍两次（正常 vs 临时关掉挖空层），断言两张图**必须不同**——
     若一样，就证明挖空层没在遮线。这条比「断言元素存在」硬，它直接证明了「线确实被遮住了」。

> 附带踩到一个真坑：自检函数第一版写成 `return \`…\`; assertNoUnregisteredHiding(css);`
> —— **return 之后是死代码**，直到跑红证才发现自检根本没跑。单测里因此钉了一条源码契约
> （必须是 `const css = \`@font-face`，不能是 `return \`@font-face`）。

## 八、代价（如实登记）

1. **产物 645 KB / brotli 88 KB 每张图**，且 archify 模板（约 89%）**每张图重复一份**。
   3 张图 = 约 264 KB（brotli）。缓解：产物只在访问 `/lab/<id>/` 时才被请求，不进首屏、不进文章页。
2. **`dataflow` 只有横向 stage 轴**，与图题「自下而上」的语义不完全一致（本站静态插图是纵向的，语义更贴）。
3. **中文节点要撑到 150–168px**（英文约 120px 够），stage 间距被压缩。
4. **手改产物不可行**：像素皮肤是对另一份 CSS 的覆盖层，archify 升级模板后选择器可能变。
   守线是单测逐字比对 + e2e computed-style，**不靠人眼**。

## 九、不做什么

- ❌ 不替换文章插图。静态 SVG 仍是正文的主角（更快、跟随主题、可断言）。
- ❌ 不把产物内联进 Astro 页面。
- ❌ 不为 archify 加 npm 依赖（它是 skill，不是包）。
- ❌ 不借它的校验器改本站插图的坐标（可以作为未来的独立项，本 ADR 不含）。

## 十、验证

- 单测 26 条（`tests/unit/lab.spec.ts`；**§十二 之后为 37 条**）：产物存在 / 主题不漂移 / 零外链 / 字体相对路径 / 纯 LF / 媒介约束 / **未登记 display:none 拒绝 + `.c-mask` 必须开着** / 路由契约 / **图内几何三条（泳道空白、框内空洞、覆盖率）**。
- e2e 15 条（`tests/e2e/lab.spec.ts`；**§十二 之后为 22 条**）：路由渲染 / 导航可达 / **切换站内主题后 iframe 内部真的换肤** / 浅色主题不被 `prefers-color-scheme` 覆写 / 字 ≥11px / 线宽恰为 `['2px']` / 单主题开关 / 工具栏保留 / **挖空层真的在画 + 像素差分证明** / 无横向溢出 / 零报错零外链。
- 改前红证据：主题漂移 1 红、外链 4 红、产物缺失 6 红、CRLF 3 红、断开 `postMessage` 1 红；
  几何守卫：旧规格 2 红（`57.75 > 36` 与框内空洞）、**打地鼠形态 1 红（泳道✓但框内 `126.65 > 48`）**；
  挖空层守卫：生成期抛错 + 单测 2 红 + e2e 2 红（`挖空层被隐藏了` / `像素没任何变化`）。

## 十一、复现 / 维护

```bash
npx vite-node scripts/atlas/build.mjs              # 全部图（需本地 archify skill）
npx vite-node scripts/atlas/build.mjs <id>         # 只重建一张
```

**何时必须重跑**：① 新增/修改图规格（`scripts/atlas/specs/*.dataflow.json`）；② **改动 `src/lib/themes.ts`**（皮肤会漂移，单测会红）；③ **改 `scripts/atlas/skin.mjs`**（生成器改了不重跑，产物与生成器就不一致，前两条单测会红）。

**改皮肤时的硬要求**（§十二 立的机制）：新增/修改任何一条覆写，都必须先在 `OVERRIDES` 里回答「archify 原本干什么 / 我改成什么 / 凭什么」；
关掉任何第三方元素还必须同时进 `HIDDEN_ALLOWLIST`。忘了登记不用等测试报 —— `buildSkinCss()` 自己会抛。

**新增一张图前**先跑一次几何体检，避免把带大空白的图直接提交：

```bash
npx vite-node scripts/atlas/build.mjs <id>   # 产物写进 public/lab/
npm run test:unit                            # 几何三条会当场报出空白最大的那条泳道
```

## 十二、覆写审计：把「别靠 class 名猜职责」变成机制（2026-09-10 全场审计）

### 为什么要有这一节

落地后连撞的三个 bug（§五 大空白、§七 挖空层、以及 `data-detail="fine"` 被 `opacity:0` 吞掉）
是同一个病：**覆写第三方产物时看名字猜职责**。§七 只治了 `display:none` 一种药，
而 `buildSkinCss()` 里还有十几条别的覆写，一条都没被同等审过 —— 一量就发现**两条是死选择器，从落地起就没生效过**。

这轮的产出不是一个补丁，而是三样东西：

1. **`OVERRIDES` 登记表**（`scripts/atlas/skin.mjs`）：每一条选择器都必须写「archify 原本干什么 / 我们改成什么 / 凭什么（带源码位置或实测数字）」。
   `assertEveryOverrideRegistered()` 在**生成期**扫自己产出的 CSS，见到未登记的规则直接抛错 —— 与 `HIDDEN_ALLOWLIST` 同构，但覆盖面是整份皮肤。
   两张表的一致性（白名单 ⊆ 登记表）与闸门本身的自检（改坏三类变体必须被拦）都有单测。
2. **九条新守卫**（单测 +11 / e2e +6），每条都带改前红证，见下面两张表。
3. **一份被量出来的清单**，包括四条「虚惊」——**没有测量就没有资格删规则**。

### 12.1 确认的缺陷（已修，附改前红证）

| # | 缺陷（实测） | 根因 | 修法 | 红证 |
|---|---|---|---|---|
| 1 | **首访双主题**：无 localStorage 时站内 `--gb-0=#0e1526`（默认 sms-surf）而 iframe `--bg=#0f380f`（gb-green） | `lab/[id].astro` 把回退主题写死成 `'gb-green'`；而 BaseLayout 只在**有存过主题时**才写 `data-theme`，默认色由 `global.css :root` 给 —— `MutationObserver` 只在「变更」时补，首访永远不被纠正 | 回退值改成 `DEFAULT_THEME`（`define:vars` 注入），并注明为什么不能写死 | e2e「没有存过主题时…」：`站内 #0e1526 vs 图内 #0f380f` |
| 2 | **preset 一键脱轨**：点 Signal Flow / Blueprint / Editorial，`--bg` 变 `#030711` / `#06131f` / `#181611` —— 图册当场变成第 14/15/16 套观感 | 模板的预设色块写作 `[data-preset="…"][data-theme="…"]`（特异性 0,2,0），皮肤主题块 `html[data-gb="…"]` 只有（0,1,1） | 主题块提到 `html:root[data-gb="…"]`（0,2,1），并加特异性单测钉住 | e2e「preset 抢不走站内配色」红 |
| 3 | **隐藏按钮 ≠ 关掉开关**：`#btn-theme` 藏了，按 T 仍把 `data-theme` 翻成 light，并往**同源 localStorage** 写 `archify-theme=light` | archify 的主题快捷键是 doc 级 keydown，与按钮显隐无关；而全站键名约定是 `8bitme:*` | boot 脚本在 `gb-chrome=min` 下捕获阶段吞掉 T | e2e「T 不该往同源 localStorage 写 archify-*」红 |
| 4 | **触摸拖拽双重位移**：390px + 150% 下横滑一次，`scrollLeft 0→147` **且** `translateX -420.5→-440.5` | archify 的 pan 在 `scale>1` 时生效，与容器原生横滚同时作用；100% 时不会（pan 在 `scale<=1` 直接 return） | boot 脚本：非鼠标指针 + 容器可横滚 + 目标不是交互元素 → 捕获阶段截断（站点立场「宁可让读者滚一下」） | e2e：`pan 不该同时位移`（Expected `-287.5` / Received `-307.5`） |
| 5 | **泳道框规则从落地起就是死的**：`html[data-gb] .c-lane rect` 是后代选择器，而 class 挂在 `<rect class="c-lane">` 自己身上 —— 实测 computed `stroke-dasharray: 6px, 6px`（archify 原值）、`fill: rgba(0,0,0,0)` | 看名字猜结构 | 改成 `.c-lane`，虚线才真的落到 8,8 | 单测「泳道框的选择器必须命中 `<rect>` 自己」+ e2e「泳道框真的是 8,8 虚线」双红 |
| 6 | **结构线对比度不足**：泳道（阶段边界）vs 底色最低 **1.88:1**（midnight-arcade），13 套里 12 套低于 WCAG 1.4.11 的 3:1；文字 token 最低 **2.72:1**（dawnbringer-ember `--text-dim`） | `mix(bg, gb2, 0.45)` 等固定比例，对深色主题系统性地不够 | 改成**抬底**：`max(原比例, mixForContrast(…, 目标))` —— 够用的主题不动，不够的才抬（结构线 3:1、文字 4.5:1） | 单测「结构线 ≥3:1、文字 token ≥4.5:1」红（`gb-green --lane-stroke 2.1469 < 3`） |
| 7 | **Zpix 前进量非整数**：皮肤施加的 11px / 14px 实测前进量 **11.9151 / 15.1686**（Zpix CJK 是 13/12 em） | 皮肤没跟站内的 `--ls-*` 字距修正 | 11px → `+0.083333px`、14px → `-0.166667px`（= 站内 `--ls-14`，同一条公式 `zpixTracking()`），12px 天然为整数 | 单测「每个字号都带字距修正」红 |
| 8 | **可读性断言取错元素**：原 e2e 只量「第一个 `svg text`」（9 档 → 11.63px），图里最小的 7/8 档（10.2–10.7px）从没被守过 | 断言写成了 `querySelector('svg text')` | 改成量全部带 `font-size` 的 text，判据用用户单位 ≥11，屏幕值另记 | 断言收紧即时生效（旧断言在最小字上本来就是错的） |

| 9 | **箭头被挖空板切掉一截**（作者看图发现「箭头被遮挡了」）：屏幕上只有一条短棍 + 一个悬空三角 | **不是皮肤的问题**（A/B 对比 HEAD 产物逐像素同形）：`labelPoint()` 默认把标签放在走线上方 10 单位（`geometry.mjs:1227`），而标签板是 `y = ly-11, h = 27` → 板底在 ly+16，**正好盖住线**。流程长度 65 单位、板宽 51–61 单位 → 板子几乎吃满整条线，连箭头尾部一起抹掉 | 规格层给每条 flow 加 **`labelDy: -18`**（把标签与它的板抬到线之上）。板底 ly+16 = 128 < 线 139 → 线与箭头完整可见；板子改去遮泳道虚线（27 单位的缺口，视觉上可接受） | e2e「走线的箭头端点不许落在挖空板里」：去掉 `labelDy` 后 **4 条走线全部被标记**（`0/240,140 · 1/455,140 · 2/670,140 · 3/885,140`） |

> **9 号的教训（假绿的第三种形态）**：这条守卫的第一版写成 `g.querySelector('[data-edge-key]')`，
> 而 edge 属性是挂在 `<g>` **自己**身上的 —— 查询永远返回 null，断言恒绿。
> 是**先跑去掉 `labelDy` 的红证**才发现它根本没在检查（若只跑绿的一次，会以为「已经守住了」）。
> 与 §七 那条「return 之后是死代码」同类：**新增守卫必须立刻跑一次反例**。

> **8 号附带发现的取舍**：图内最小字是 **10.2px（舞台掉到 min-width 1150）/ 10.66px（1440 视口）**，
> 仍是全站最小的字。**不能再抬**：走线标签的挖空框是 archify 按原文大小算好的（「只取可信行」框宽 61 单位），
> 而 12px 下 Zpix 的 CJK 每字 13 单位 → 5 字 65 单位，**溢出框外 2 单位**，箭头线会从文字边上露出来（§七 那个 bug 换处复现）。
> 这条用 e2e「文字不超出自己的挖空框」当刹车：把 7/8 档改成 12px，实测 `「TRY_CAST」超出挖空框 6.44 单位` 直接红。

### 12.2 逐条覆写：原本职责 → 处置

登记表本体在 `scripts/atlas/skin.mjs` 的 `OVERRIDES`（每条都带理由与源码位置）。这里只登记**判定结论**：

| 覆写 | archify 原本怎么做 | 处置 |
|---|---|---|
| `*` 的 `font-family` / `border-radius` / `box-shadow` | JetBrains Mono（产物已剥外链）+ 102 处圆角 + 软阴影 | 保留。**已核实没有焦点环依赖 box-shadow**：模板的 `:focus-visible` 一律用 `outline`（`template.html:951-960`），实测工具栏按钮焦点仍是 `2px solid` |
| `*` 的 `animation/transition duration:0` | trace 动画、`data-detail` 淡入、toast、camera 位移 | 保留，**并把风险查清**：模板里**零个 `transitionend` 依赖**；三处 `animationend` 状态机（关系脉冲 `:7908`、引导故事载体 `:9662`、路由脉冲 `:12193`）实测 **0s 动画仍会触发 `animationstart`+`animationend`**（浏览器实验：`{"duration":"0s","events":["start","end"]}`），所以不会把元素永久留在图上。代价是「动效被静默打平」——`btn-motion` 在本图里本来就不出现（本图无 `data-animation="trace"`，实测 `btn-motion` 是 `display:none`） |
| `svg text{fill:var(--text)!important}` | `.t-primary/.t-muted/.t-dim/.t-<type>` 六类语义色 | 保留并写明理由：图内字最小 11px，像素字在这个尺寸下再降对比就是笔画并死；实测压平后全部文字 vs 底色 ≥12.4:1。**代价**：`.t-*` 语义色在图内失效（构件类型仍由框的 stroke/fill 区分）——原来的 `--text-muted/--text-dim` 主要服务于 iframe 的 HTML chrome |
| `svg path{fill:none}` | — | **删**。实测产物 17 条 `<path>` 全无 `fill` 属性：泳道/网格走 `.c-grid`、走线走 `.a-*`（模板里都写着 `fill:none`），sigil / brand-mark 靠父级继承。这条是冗余保险，删掉后行为不变 |
| `.m-dashed path{stroke-dasharray:8 8}` | `.m-dashed` 是 **marker 的填充类**（`template.html:3980`），marker 里装的是 `<polygon>` | **改靶**为 `.a-dashed,.a-security`（真正的虚线走线类，模板原值 4,4 / 5,5）。当前产物无虚线走线，这条为后续规格准备 |
| `stroke-width:2!important` 打在全部 svg 图形 | 散着 0.5/1/1.4/1.5/1.8 五个值 | 保留。**误伤面已核实**：箭头 marker 是**只有 fill 没有 stroke** 的 `<polygon>` → 不会变胖；被加粗的是 semantic-sigil(1.35)、brand-mark(0.8/1.15) 与雷达节点（视觉复核通过） |
| `svg{shape-rendering:crispEdges}` | 无 | 保留。**只为了线**：担心它继承到 `<text>` 让像素字掉笔画 —— 实测把 text 的 `shape-rendering` 改回 `auto`，同一区域像素**逐字节相同**（Chrome 不对 text 应用该属性） |
| `html[data-gb] .header h1{font-size:16px}` | 头部 24px 标题 | 保留。**不是死代码**：`.header{display:none}` 只在 `gb-chrome=min` 下生效，而站内「在新标签页打开 ↗」给的是**不带参数**的产物地址，那里头部是显示的（实测 h1 = 16px/24px） |
| `font-size` 属性选择器（7/8→11、9/10→12、12→14） | 7–12 用户单位 | 保留。**覆盖完整性有守卫**：产物里出现的档位必须全在覆盖集内（漏一档 = 那档字缩回 7–9px），新增规格若用了新档位会当场红 |
| `?gb-*` 命名空间 | archify 自己读 `beat/embed/focus/lens/openExport/play/present/reach/relation/route/theme/view` 与 hash 参数 | 保留。反向核查：**与 `gb` / `gb-chrome` 无交集**（已写进 boot 注释与 ADR） |
| `<noscript>` 整块剥离（`build.mjs`） | 里面只有 Google Fonts 外链 | 保留，但**这件事本身是「整块删第三方内容」**：已核实该块除字体外为空（`template.html:39-41`）。留待加固：将来若 archify 往 noscript 里加真正的无 JS 兜底，会被静默删掉（列为待办，不在本轮改） |

### 12.3 明确不改的（含理由与数字）

- **`#btn-preset` 视觉风格菜单**：本轮只堵了「抢配色」这条（12.1-2），**没有隐藏它**。
  它仍会改容器背景、悬停软阴影等非 token 样式。两种走向都成立，属作者决策：
  ① 与 `#btn-theme` 同等处理（隐藏并登记，同时吞掉 S 快捷键）；
  ② 保留（承认「视觉风格」是 archify 的功能之一，只是不许改本站四色）。
- **窄屏（390px）体验**：iframe 内可用宽 ~216px，图 min-width 1150 → 约 5 屏横向滚动。
  这是「字先于构图」的直接代价，站内已给「在新标签页打开 ↗」作出口。**作者已确认可接受**（2026-09-11）；
  本轮又把横滚从 5.4 屏降到 4.19 屏（见 13.3）。
- **`--grid` token**：只被已关掉的 `.c-grid` 用，留着是为了「主题块 token 集合完整」而不是因为它有用。

### 12.4 验证

- 单测 37 条（`tests/unit/lab.spec.ts`，本轮 +11）：原 26 条 + 覆写登记表机制（登记完整性 / 无僵尸条目 / 白名单 ⊆ 登记表 / 改坏三类变体必须被拦）+ 主题块特异性 + 泳道选择器 + 字号档位覆盖 + Zpix 字距整数前进量（并与 `global.css` 的 `--ls-*` 交叉核对）+ 结构线/文字对比度抬底（13 套逐套）。
- e2e 22 条（`tests/e2e/lab.spec.ts`，本轮 +7）：默认主题（无 localStorage）同色 / preset 抢不走配色 / T 快捷键被吞且不写 `archify-*` / 泳道 8,8 虚线 / 最小字号（全部带 font-size 的 text）/ 文字不超出挖空框 / 窄屏触摸只滚动不 pan / **走线箭头端点不许落在挖空板里**。
- **改前红证据（全部实跑，不是推断）**：
  - e2e 5 红（皮肤与页面回退到 `ab439ec` 后重跑）：`站内 #0e1526 vs 图内 #0f380f` · preset ✗ · `T 不该往同源 localStorage 写 archify-*` · 泳道 8,8 ✗ · `pan 不该同时位移`（`-287.5` vs `-307.5`）
  - 单测 4 红（定点变异）：结构线不抬底 → `gb-green --lane-stroke 2.1469 < 3` · 去掉 11px 字距 → 「前进量落在整数像素」✗ · 主题块特异性写回 → 登记闸门抛错 · 泳道选择器写回后代选择器 → 「必须命中 `<rect>` 自己」✗
  - 刹车 1 红（变异到 12px）：`「TRY_CAST」超出挖空框 6.44 单位`
  - 箭头 1 红（去掉规格里的 `labelDy`）：4 条走线全被标记
- 作者本地观感验收（§三.4 与 P3）：**仍未取得**。重点看：浅色主题 `inkpaper` / `nes-punch` 的泳道框是否偏重（本轮把它从 2.32:1 抬到 3:1）、390px 窄屏横向滚动、以及 12.3 那两个待定项。

---

## 十三、作者观感验证的结论 + 两处改动（2026-09-11）

上一轮交接把三件事挂在「作者签字」上（§十二 12.3）。本轮由 agent 自己看图 + 实测逐条验完，
并把其中一条从「待定」升级成「有硬证据的缺陷」后修掉。**观感项已由作者签字确认**
（2026-09-11：「我看了没问题」，见 13.5），
本节给的是可复算的数字与结论，不是「我觉得」。

### 13.1 三项待签字的实测结论

| 待签 | 结论 | 证据 |
|---|---|---|
| 浅色主题泳道虚线是否偏重 | **不偏重，判据成立** | 13 套实测对比度 3.00–3.36（`inkpaper` 3.06 / `nes-punch` 3.01），全部由 `mixForContrast` 抬底而来；4× 放大截图确认虚线与节点框「同色系但更轻」——虚线 8,8 减半墨量 + 透明填充，节点框 2px 实线围实心块，两重降权 |
| 首访配色 | **已修好，逐像素可证** | 无 localStorage 时 `parent --gb-0 = #0e1526` 且 `iframe body bg = rgb(14,21,38)`，二者一致；切 3 套主题各验一次，`frameDataGb` 恒等于父页 `data-theme` |
| 390px 窄屏横滚 | **属实，5.4 屏** | iframe 250px / 可用 216px / 图 1150 单位 → `.diagram-container` scrollWidth/clientWidth = 5.4 |

附带量了站内壳文字对比度（13 套 × 面包屑 / 导语 / h1）：6.02–17.64，全过 4.5:1。

### 13.2 视觉风格菜单：从「小瑕疵」升级为「真缺陷」，整组藏掉

**上一轮的判断错了一半**。§十二 12.3 写的是「它仍会改容器背景、悬停软阴影等非 token 样式」，
语气像小瑕疵；实测出来的硬伤在 `signal-flow`：

- 它给 `.diagram-container` 挂一条**写死的**渐变
  `linear-gradient(rgba(8,20,38,.82), rgba(3,8,18,.94))`（浅色主题则是 `rgba(255,255,255,.9)` 一类的近白）。
  不是 `--gb-*` 派生的颜色。`gb-green` 的 `#0f380f` 底被压成 `(9,26,34)→(4,11,18)` 的藏青。
- 像素差分（iframe 区域，1440×522）：**61.3% 像素改变、平均通道差 11.6** ——
  量级与「换一套主题」相同，正是单媒介铁律要禁的东西。
- **为什么上一轮的特异性守线抓不到**：`tests/unit/lab.spec.ts` 那条只比
  `--bg` / `--lane-stroke` / `--text` 谁赢；皮肤确实赢了这些 token，
  但 `background-image` **皮肤从未写过**，既没被覆写、也没人看。
  **教训与「关掉 `.c-mask`」同类：token 白名单不等于「非 token 样式已看守」。**

**修法：入口 + 能力两道，缺一不可。**

1. **入口**：`html[data-gb] .preset-wrap{display:none!important}`。
   **两种打开方式都藏**（选择器不带 `gb-chrome` 作用域）——
   `#btn-theme` 与 `.header` 是「有用但在 iframe 里重复/打架」，所以只在 `min` 下藏；
   而预设菜单的唯一功能就是「换成另一套视觉身份」，没有哪个上下文需要它，
   且硬伤在 standalone 下同样发生，而页面自己就在推「在新标签页打开 ↗」，只藏 iframe 等于留后门。
2. **能力**：`html[data-gb] .diagram-container{background-image:none!important}`。
   藏入口只说明「没人会按到」；`data-preset` 不是只有菜单能改（archify 升级 / URL 参数 /
   devtools 都行）。classic 下该属性本来就是 `none`，压掉它不改默认观感。
3. **快捷键**：`S` 与 `T` 同构 —— 藏按钮 ≠ 关掉开关。
   实测（焦点在 iframe 内）按 S 会在 `classic→signal-flow→blueprint→editorial` 之间循环。
   吞法**两者不同**：`.preset-wrap` 两种方式都藏 → S 一律吞；
   `#btn-theme` 只在 `min` 下藏 → T 只在 `min` 下吞（否则 standalone 下
   一个可见的按钮配一个死快捷键）。

**旁证（用来划清边界，避免过度归因）**：`editorial` 只加一条
`linear-gradient(90deg, <gb-0 混 58%>, transparent 12%)`，**是主题派生的**、无害；
`blueprint` 在容器层无变化。所以严格说只有 `signal-flow` 有硬伤 ——
但既然要藏就整组藏，留一半只会制造「有的能点有的不能点」的困惑。

### 13.3 窄屏内边距：白吃 33% 屏宽

390px 下**在开始横滚之前**，图已被四层内边距吃掉 128px（每侧 64px）：
`lab-wide` 外边距 24 + 它的 padding 12 + 面板边框 4 + 面板 padding 24。
这一屏本来就要横向滚动，留白是纯损失。

`@media (max-width: 640px)`：`lab-wide` 外边距收到 12px、padding 归 0、面板 padding 收到 **16px 下限**
（不能再小：`.pp-pad` 角点带占离内边框 8–16px，低于 16px 角标会切入内容，插图上踩过一次）。

实测：iframe **250 → 314px**，可用宽 216 → 280，横滚 **5.4 → 4.19 屏**；四角点与 frame 重叠面积均为 0。

**踩到的坑（写在这里防再犯）**：media query 一开始写在 `.lab-stage` 规则**之前**，
同特异性下源码顺序决定胜负，于是被后面的 `padding:24px` 覆盖 ——
写了 media query 但 frame 仍只拿到 274px。**必须放在 `.lab-stage` 之后。**

### 13.4 顺手勘误一条：≤960px 侧栏「压住内容 37px」

上一轮 §十二登记为「内容被压 37px」。实测那是**盒子级**重叠，不是字压字：
`.lab-meta` 的**文字墨迹**只有 12–213px 宽，dock 在 635px 处，
960 / 700 / 390 三档 `inkOverlap` 全为 `false`。`/lab` 页面上没有真正的压字。

**但发现一条真的（既有，非本轮引入）**：390px 下 iframe 底边落在视口底（822 vs 844），
而 SideDock 固定在右下（y 767–832），于是 **archify 底部工具栏的 Zoom-in 按钮被完全盖住**
（改前 34px 全遮、改后 37px 全遮 —— 改前后都存在）。
**可达性无碍**：页面滚动 60px 后按钮即完全露出（实测 `scrollY=60 → covered:false`）。
这是固定停靠栏与可滚内容的固有交互（V7 把 dock 放右下时假定「底缘是唯一没有内容的一带」，
这条假定对 `/lab` 不成立）。**不属本轮范围，登记为已知项。**

### 13.5 验证

- 单测 **379**（+2：视觉风格菜单两道压制 / S 与 T 的吞法差异）；e2e **178**（+2：菜单被藏且 S 换不动预设 / 窄屏内边距两指标）。
- **改前红证据（4 条，全部实跑）**：
  1. 皮肤回退 `23050c8` + 重建产物 → `.preset-wrap 必须被 display:none 藏掉` 红
  2. 只去掉 S 的吞掉（保留 CSS 隐藏）→ `按第 1 次 S 后预设被轮换了（S 没被吞掉）`：`Expected "classic" / Received "signal-flow"`
  3. 只去掉 `background-image` 那条 → `强制 data-preset="signal-flow" 后容器背景被改写了`：`Received "linear-gradient(rgba(8, 20, 38, 0.82), rgba(3, 8, 18, 0.94))"`
  4. 窄屏 padding 退回 24px → `390px 下 iframe 只有 298px`（阈值 300）
- 产物已重建（`public/lab/warehouse-layers.html`，639 → 641 KB）。
- **作者观感签字：已取得（2026-09-11）**。作者本地预览后回复「我看了没问题」，
  针对本节 13.2 的改动（视觉风格菜单整组消失，工具栏只剩 Present / Export）。
  连同 13.1 三项实测结论（泳道虚线不偏重 / 首访配色一致 / 窄屏横滚可接受）一并视为通过。
  未部署 —— 需作者显式说「部署/上线」。

---

## 十四、作者授权自行裁决的两个尾巴（2026-09-11）

作者看过观感后回复「我看不出问题，你决定吧」，把 13.4 留下的两件事交给我裁决。
两件**都不改代码**，但都给出了可复算的依据 —— 下面写清「为什么不动」，
免得下一轮有人把它当未修缺陷重新捡起来。

### 14.1 图例计数徽章的最小字（7.75px）：**不动，现状更好**

13.1 只量到「图内最小字 10.66px（节点副行）」；本轮逐元素枚举发现还有**一个 7.75px 的孤例**：
`<g data-legend-count-badge>` 里的那个「5」（`data store` 图例项的计数）。它**没有 `font-size` 属性**，
所以皮肤那条 `svg [font-size="7"]` 规则压根不匹配它 —— 7.75px 是 archify 给它的 inline 8 用户单位 × 缩放 0.969 的结果。

**为什么不能抬**：这个徽章在 archify 模板里是**圆形**（`<rect rx="7">`，14×14 单位），
但本站皮肤有一条 `html[data-gb] svg rect{rx:0!important;ry:0!important}`
（像素语言：圆角归零）——**于是它实际渲染成 14×14 的方框**。
我一度按「圆」去算（字符四角到圆心距离 vs 半径 7），得出「8 单位就已溢出」的结论，**那是错的**：
约束是方框，不是圆。

按方框重测 + 4× 放大对比（`_scratch/lab-visual/badge-now.png` vs `badge-raised.png`）：

| 字号 | 渲染 | 观感 |
|---|---|---|
| **8 单位（现状）** | 7.75px | 数字在 14×14 方框里**正好居中**，四周留白均匀 |
| 10 单位（模拟抬档） | 12px | 数字**顶满框**、左右几乎贴边，明显发挤 |

**结论：现状是设计好的尺寸，抬了更差。** 另外它是 `aria-hidden="true"` 的装饰性计数
（只随图例项同时出现，不承载独立信息），也不是可读性文字。故不改，也不为它加断言 ——
没有缺陷可守，加了反而是给「现状」上锁（archify 改版时会无谓变红）。

### 14.2 390px 的缩放控件：**不是缺陷，但「能用」只靠 8px 巧合**

13.4 登记「390px 下 Zoom-in 按钮被 SideDock 完全盖住」，当时判「可达性无碍（滚 60px 就露出）」。
本轮把这件事查到底，**结论要修正两次**：

**第一次修正：那个测量被 dev 工具条污染了。** 用 `elementFromPoint` 做 hit-test 时，
`astro-dev-toolbar` 浮在页面底部，把一堆按钮全判成「被挡」。
**必须在生产产物（`astro build` + preview）下测**，dev 下的遮挡结论不可信。

**第二次修正：真正被挡的只有 1 个按钮，且它不是不可达。** 生产下 390px：

- `.diagram-nav`（缩放控件的容器）是 archify 自带的 **`overflow-x: auto`** 可横滚容器，
  390px 下**有 110px 可滚量**。
- 初始状态：「Zoom in again」恰好落在 dock 下方、「Zoom in」在视口外 —— 那是**横滑前**的位置。
- **横滑到底后，三个缩放控件（Zoom out / Zoom in again / Zoom in）中心点 hit-test 全部无遮挡。**

**双指捏合不能作为替代入口**：实测**无效** —— 而且 **standalone 直接打开产物同样无效**，
即与本站那两条 `stopPropagation`（吞 S/T、窄屏触摸只滚动）**无关**，是 archify 本身没有这个手势。

**所以没有缺陷要修。但**：nav 右缘 321px vs dock 左缘 329px —— **只差 8px**。
「窄屏下缩放能用」不靠设计保证，靠这 8px 巧合；任何人改 dock 宽度、nav 定位或 `.lab-wide` 宽度
都可能破掉它，而破掉后的症状是「手机上放大不了」，静默且难查。
**故立守线**（`tests/e2e/lab.spec.ts`：`390px：侧栏停靠栏不得挡住 iframe 内的交互控件`）：
断言 ① 初始 nav 右缘 ≤ dock 左缘；② 横滑 nav 到底后三个缩放控件全部无遮挡。

**反例已跑**（开发流程文档 硬经验：新增守卫必须立刻跑一次反例）：
把 SideDock 的 `right: 0.75rem` 改成 `3rem` → 立刻红，
报错为 `nav 右缘 321 已进入侧栏（左缘 293）—— 缩放控件会被挡`，随后已恢复。

### 14.3 验证

- 单测 **379**（未变）；e2e **179**（+1：侧栏停靠栏不得挡控件）。
- 反例 1 条：SideDock `right` 0.75rem → 3rem → 断言红（见 14.2）。
- 未改任何产品代码（本节只加了一条 e2e 守卫）。未部署。

---

## 十五、入场通电：把「图在动」加进这块静态图册（2026-09-17）

动画线第二块（第一块是文章插图的信号包，见 ADR-0017 与 `line-hierarchy.md` §七）。
目标一句话：`/lab/<id>` 进入时，图内 4 条走线**一次性上电** —— 虚线沿走线扫过一遍
（每条 2.4s，错峰 160ms），扫完**定格为原本的 2px 实线**，之后完全静止。

### 15.1 上游机制（引用带位置，均已在本机 archify 上复核）

| 机制 | 位置 | 本站怎么用 |
|---|---|---|
| `meta.animation: "trace"` 是该图种合法字段 | `archify/schemas/dataflow.schema.json:39` | 规格里开这一个字段 |
| 只有 trace 才产出 `data-animation="trace"`（SVG 根）与 `data-animate="edge" style="--step:N"`（**挂在每条走线 `<path>` 自己身上**） | `archify/renderers/shared/cli.mjs:169-176` 被 `renderers/dataflow/render-dataflow.mjs:374`（走线）/ `:364`（节点）调用 | 产物里 4 条走线 + 10 个节点各一条；默认静态产物**一条都没有** |
| 入场动画本体 | `archify/assets/template.html:4580-4583`：`html[data-ambient-motion="running"] svg[data-animation="trace"] [data-animate="edge"]{animation:archify-edge-flow 2.4s linear 1;animation-delay:calc(var(--step,0) * 160ms)}` | 时长/阶跃由皮肤改写，`animation-name`/错峰/播放时机仍归上游 |
| 关键帧 | `template.html:4623-4628`：`0%{dasharray:10 8; dashoffset:54; opacity:.42}` → `88%{dashoffset:0}` → `99.9%{…}` → `100%{dashoffset:0;opacity:1}`（**100% 不声明 dasharray**） | 末帧离散跳回基态 = 干净实线（实测稳态 `stroke-dasharray:none`） |
| reduced-motion | `template.html:4703-4711`：`@media (prefers-reduced-motion:reduce){svg[data-animation="trace"] [data-animate]{animation:none!important}}`（特异性 0,2,1，带 `!important`） | 本站豁免**刻意不带 `!important`**，见 15.3-④ |
| 节点脉冲 | `template.html:4629-4635`：`filter:drop-shadow(0 0 8px …)` + `stroke-width:1.5→2.4` | **不豁免**（糊化辉光 + 撞线宽白名单） |
| 暂停开关 | `template.html:4812` `#btn-motion`（默认 `hidden`），`template.html:6915` `STORAGE_KEY='archify-motion'`，`location 6942/6958/7115` 写 `data-ambient-motion` | 藏掉 + 清历史键，见 15.3-⑤ |

**与上传描述的一处漂移（如实记录）**：任务书写的关键帧是
`0% → 88% → 100%` 三帧；本机 archify 里是 `0% → 88% → 99.9% → 100%` **四帧**。
行为等价（都是末帧离散跳回基态），但引用时以本机版本为准。

### 15.2 决策

1. **只豁免走线，不豁免节点**（`html[data-gb] *` → 拆成「除 `[data-animate="edge"]` 外全员归零」+ 一条走线豁免）。
   理由：结构线（`line-hierarchy.md` §一）不许常态变虚线；节点脉冲的 `drop-shadow` 破像素语言。
2. **豁免只补两个声明**（`animation-duration` / `animation-timing-function`），**不带 `!important`**。
   理由：`animation-name`/播放时机归上游（它才拥有 `data-ambient-motion`），本站只改节奏；
   带 `!important` 会反杀上游的 reduced-motion（15.3-④ 有实测反例）。
3. **节奏常量单一数据源**：`skin.mjs` 导出 `TRACE = {DURATION_MS: 2400, STEPS: 12}`，产物 CSS 与单测都从它插值。
   `STEPS: 12` 是整齿阶跃 —— 与站内 CRT 关束 / 打字机同一套运动语言（离散跳变，不是连续插值）。
   **错峰延迟不接管**，仍由上游 `calc(var(--step,0) * 160ms)` 提供（0/160/320/480ms）。
4. **藏掉 `#btn-motion`**：入场是一次性的，跑完没有可暂停的东西；留着等于给「结构线停成虚线段」开入口，
   且它会写第二套偏好键 `archify-motion`（非 `8bitme:*` 约定）。boot script（注入在 `</head>`，
   早于上游 governor）清掉历史值 —— 否则历史 `still` 会让图册永久不播入场且毫无异常。

### 15.3 实测数字与反例（全部实跑，不是推断）

**基线（gb-green 默认主题）**：`animationName=archify-edge-flow`、`animationDuration=2.4s`、
`animationTimingFunction=steps(12, end)`、`animationIterationCount=1`；seek 到 100/1200/2200ms
三个相位 `stroke-dashoffset` 两两不同；扫完稳态 `stroke-dasharray=none` / `stroke-width=2px` /
`opacity=1`，走线颜色 = 父页 `--gb-2`（默认档）/ `--gb-3`（emphasis 档），与主题 token 逐字相同。

**① 反例：豁免规则加 `!important`**
- 只给两条 longhand 加（`animation-duration:2400ms!important;animation-timing-function:…!important`）：
  单测 4「不带 !important」红、单测 5「产物含 TRACE 插值」红；**e2e reduced-motion 仍是绿** ——
  因为动画名仍归上游的 `animation:none!important` 管（如实登记这条判定，不吃「应红」的空头承诺）。
- 写成带 `!important` 的**简写**（`animation:archify-edge-flow 2400ms steps(12,end) 1!important`）：
  reduced-motion 下 `animationName` 从 `none` → `archify-edge-flow`，**e2e reduced-motion 红**。
  这条才是「不得带 `!important`」的真实危险形态（也是最容易被写出来的形态）。

**② 反例：豁免规则整条删掉** → 单测 4 条红（僵尸条目 / 归零顺序 / 选择器缺失 / 常量同源）；
e2e 核心用例红：`阶跃曲线没生效（应是 steps(12,end) 的整齿）Expected "steps(12" / Received "linear"`。

**③ 反例：归零规则误写成 `:not([data-animate="node"])`** → 生成期闸门先抛错（`OVERRIDES` 未登记），
把登记表一并改成 node 后：单测 3 红（`归零规则应恰好一条`），e2e 核心用例红
（`animationDuration Expected "2.4s" / Received "0s"`）—— 走线被归零、节点反而不归零，两个方向都反了。

**④ 反例：`#btn-motion` 不藏**（规则体清空）→ 单测 6 红 + 既有「白名单须真在用」红；
e2e 4 红：`Expected "none" / Received "flex"`。

**⑤ 反例：spec 去掉 `animation` 后重建产物** → 单测 1、2 红
（`meta 少了 "animation":"trace"` / `内联 SVG 根没有 data-animation="trace"`）；
e2e 核心用例红（governor 无能力，`data-ambient-motion` 恒为 `null`）。
这条反例还暴露了一句误导性报错，已修：arm 辅助函数的错误信息现在会同时给出
「根本没开 trace」与「加速器被特异性压住」两种可能，并带上 attribute 实值。

**⑥ 并行负载下的真实竞态（已修）**：首轮全量跑 `tests/e2e/lab.spec.ts` 时，核心用例偶发
`animationName= none`。根因不是产品代码，是**测试的 arm 手法**：若在 governor 自己 settle 之前
把 `data-ambient-motion` 写成 `running`，它随后（由 `animationcancel` 引发的）`settleAmbient`
会把我刚起的动画掐掉。修法是 arm 前先把 duration/delay 压成 0 让它**立刻** settle
（它 settle 时会摘掉 `animationend`/`animationcancel` 监听，此后该属性不再被它改），
等不到 settled 就硬失败。修完连跑 3 次全绿（29/29）。

### 15.4 回滚方式

三层，任一层单独回滚都不会留下半死状态：
1. **只想要静态图**：删掉 `scripts/atlas/specs/warehouse-layers.dataflow.json` 的
   `"animation": "trace"` → 重建产物（`data-animate` 全部消失，豁免规则空转，无副作用）。
2. **只想停动效但保留产物**：删 `skin.mjs` 里那条豁免规则 → 归零规则依旧覆盖全员（含走线）。
3. **连按钮也别藏**：删 `html[data-gb] #btn-motion` 那两条（CSS + 两张登记表）与 boot script 的
   `removeItem` —— 三处都在 `skin.mjs` 里且被单测点名，漏一处就会红。

### 15.5 验证

- 单测 **415**（本轮 +6，全仓 25 个文件）/ e2e **201**（本轮 +4），均为**全仓** `npx vitest run` /
  `npx playwright test` 的总数（与 §14.3 同口径，不是单文件条数）：
  本轮新增两类各 6 条与 4 条 —— 开关 / 产物条数 / 归零拆分 / 豁免精确性 / 常量同源 / 按钮登记；
  真的在跑且稳态实线 / reduced-motion 一步不动 / 中途线宽恒 2px / `#btn-motion` 被藏。
- 产物已重建（`public/lab/warehouse-layers.html`，641 → 644 KB）。
- 反例 5 组 + 竞态 1 组，逐条实跑，见 15.3。
- 未部署 —— 需作者显式说「部署/上线」。

## 十六、第二张图：跨实例迁建（2026-09-17）

批次 B：给图册加**第 2 张图**，验证「这套机制是否只对第一张图成立」。
结论写在最前面：**零新机制**——加图只花了「写规格 → 跑 `build.mjs` → 往 `LAB_DIAGRAMS` 加一条」，
皮肤、trace 入场通电、几何体检、全部静态契约自动覆盖，没有为第二张图写一行运行时/样式代码。

| 项 | 值 |
|---|---|
| id / 产物 | `rpa-migration` / `public/lab/rpa-migration.html`（622 KB 原产物 → **644 KB**，与第一张图同量级） |
| 规格 | `scripts/atlas/specs/rpa-migration.dataflow.json`（`meta.animation: "trace"`、`quality_profile: "showcase"`、`viewBox [1240, 360]`） |
| 内容源 | `src/content/blog/2026-08-29-rpa-migration-methodology.md`（与文章静态插图 `migration-pipeline` **同源两种讲法**：正文插图「读完即走」、图册「上手转」，见 `src/lib/lab.ts` 的模块注释） |
| 讲什么 | 5 段单向流水线（存量 xbot 流程 → HAR 锁事实源 → 1:1 迁移构建 → 保存后反查 → 公共层收敛）；**row0 = 该段的产物，row1 = 该段的纪律/判据**（不重构 / 映射失败必抛错 / 快失败 / 要么对要么报错 / 固定提交顺序）；4 条 flow 各带「这一跳做了什么」+ classification |
| 节点/边 | 10 节点（5 阶段 × 2 行）+ 4 条走线 —— 与 `tests/unit/lab.spec.ts` 的「条数 = 规格条数」断言同源 |

### 16.1 复用结论：为什么不需要新机制

| 机制 | 为何自动覆盖 |
|---|---|
| 像素皮肤（`skin.mjs`） | 它注入的整套 CSS 只按 `html[data-gb]` / 图内 class 选择，**不区分是哪张图**；`build.mjs` 对每个 spec 注入同一份 |
| 入场通电（trace） | 由规格里一个字段 `meta.animation` 开启，产物自带 `data-animation`；皮肤那条豁免规则按属性匹配 |
| 静态契约（单测） | 产物存在 / 皮肤逐字不漂移 / 零外链 / 纯 LF / 字号档覆盖 / **几何三条**——全部是 `for (const d of LAB_DIAGRAMS)` 遍历 |
| 索引与路由 | `src/pages/lab/index.astro` 与 `[id].astro` 都遍历 `LAB_DIAGRAMS`（无硬编码数量） |
| e2e | 机制类用例只针对一张图取样（它们验的是皮肤与同步机制，不是图的内容），新增图只需一条冒烟 |

**e2e 只改两处定位**（不是新机制）：`.lab-card` 从「唯一元素」变成「多元素」——
`toHaveCount(1)` 写死了数量（加图即红），`page.locator('.lab-card').click()/toBeInViewport()`
在两张卡时会被 Playwright 的 strict mode 直接判失败。改成「按 href 定位 + 计数取 `LAB_DIAGRAMS.length`」，
并补一条第二张图的冒烟（入口通 / 标题对 / 节点与走线条数 / 入场通电扫完定格为 2px 实线）。

### 16.2 布局参数：沿用 §五 v8，实测与第一张图逐位相同

`sublabel`/`tag`/行高/`yOffset` 全部照抄第一张图（row0 `-24`、row1 `-38`、卡高 72、`viewBox [1240,360]`），
实测几何指标**逐位相同**：

| 图 | 泳道空白（限 ≤36） | 框内空洞（限 ≤48） | 覆盖率（限 ≥60%） |
|---|---|---|---|
| warehouse-layers | 33.75 | 33.25 | 63.9% |
| rpa-migration | 33.75 | 33.25 | 63.9% |

两个 33.75 / 33.25 都卡在硬墙（§五：`node.y ≥ 104` 与卡片内文字带分布所决定的极限），
说明这组参数是**该布局的定点**，不是为第一张图碰巧调出来的——第二张图照抄即可，不需要再调。

### 16.3 反例（逐条实跑）

| 注入 | 结果 |
|---|---|
| 规格写 6 个 `stages` 后重建 | 生成期拦下（archify schema）：`/stages must NOT have more than 5 items {"limit":5}`，`code: schema/maxItems`；**未写盘**（`public/lab/` 无新文件） |
| 删掉 row1 的 5 个节点后重建 | 单测红 2 条：`最大空白在 lane0 的 176..286: expected 110 to be less than or equal to 36`、`expected 0.339375 to be greater than or equal to 0.6` |
| 加图但不改 `.lab-card` 计数断言 | e2e「图册索引与单页都渲染且标题正确」红：`Expected: 1 / Received: 2` |
| 规格去掉 `meta.animation` 后重建 | 单测红 2 条（开关缺失 / 产物根无 `data-animation`）；e2e 冒烟红：`Expected: 10 / Received: 0`（trace 关掉后 `data-animate` 一个都不产出） |

### 16.4 人工看图（截图自评，非自动化）

按「视觉看图」规矩自己起服务器截三张（索引页 / 入场中途 / 稳态）+ 两张 3× 局部放大，
确认：索引页两张卡片排版一致、图内无大片空白、字号档与框宽匹配（实测无一条文字超出挖空框、
无一条节点文字超出框宽）、箭头完整未被挖空板切断、走线不穿标签、线宽只有 2px 一档。
顺带复核一条**既有行为**（非本批次引入）：flow 的 `classification` 与节点 `tag` 一样渲染为
`data-detail="fine"`，默认 `read` 档下 `opacity:0` ——第一张图同样如此，故保持一致，不在本批次改。

### 16.5 验证

- `npm run typecheck` 绿；`npm run build` 绿（36 页，含新增的 `/lab/rpa-migration/`）。
- `npx vitest run` **434**（全仓 25 文件，本批 +3：新图的几何三条——遍历式断言自动×2）/ `npx playwright test` **205**（本批 +1：
  `tests/e2e/lab.spec.ts` 新增的第二张图冒烟；同文件 29 → 30 条）。
- 字体子集重跑无 diff（新文案未引入新字形）。
- 未部署 —— 需作者显式说「部署/上线」。

## 附录（2026-10-29）：重建产物时撞上 archify 3.2 的四处变化

本机 archify 升到 **3.2.0**，产物重建从「跑一下就好」变成四件要处理的事（全部已落，618 单测 /
28 条 `/lab` e2e 绿）：

1. **可读性门（`composition/desktop-readability`）**：出版前把图内最小字号按「1440 屏留给图的
   930px」投影，必须 ≥6px。两条 spec 原先把画布写死 `viewBox: [1240, 360]` → 7px × 930/1240 =
   5.25px，直接拒。**画布宽度上限 = 1085**（7 × 930/1085 = 6.0）。现取 1085×360：构图不变、
   只窄 12.5%。删掉 `meta.viewBox` 走自适应也能过，但产出 1068×720（高度翻倍、版面重排），未采用。
2. **新增阅读侧栏（Node Index）**：把全部节点按阶段再列一遍，默认落在图下方约 450px。站内
   iframe 只有 `clamp(480px,58vh,620px)`，与图抢高且内容与图完全重复 → 帧内 `.reader-rail` 与
   `.rail-reveal` 一起藏（standalone 保留完整产品形态，HIDDEN_ALLOWLIST 已登记）。
3. **SVG 最小宽度下限从 1150 改 1085**：旧值是「12 单位 × 1240 画布」时代的算法；新图原生宽
   1085 却仍写 1150，等于强制放大 6%，右侧最后一条泳道虚线被 16px 横向滚动裁出视口。下限取
   **原生画布宽**才在两种屏幕都不出错（宽屏等比放大、窄屏转滚动）。`lab.spec.ts` 同步。
4. **走线入场动画：「入场通电」改由皮肤自己拥有**（本次最重的一处）。3.2 删掉了
   `archify-edge-flow`（产物里 0 次命中；边缘动画改成用户触发的 `.intent-trace-flow` /
   `.route-journey-flow`），旧写法「只改一个不存在的动画的时长」→ 通电静默失效，由 e2e 抓到。
   同时 3.2 新增 `html:not([data-motion-capable="true"]) ... [data-animate]{animation:none!important}`
   ——本站把 animation-duration 全归零，它的能力探测据此判定「跑不了动效」，连带 kill 走线动画。
   处理：皮肤自带 `@keyframes gb-edge-flow` + 完整简写（name/时长/阶跃/延迟），**带 !important
   压过上面那条 kill，但整条被 `@media (prefers-reduced-motion:no-preference)` 门住**（a11y 由门
   保证，不是靠 !important 的自制）；fill 不写 `both`（写了稳态会停在虚线段）。顺带收获：本站
   视觉不再依赖第三方内部动画名。e2e 的 `arm()` 从「逼 governor settle 再置 running」改为
   「直接 `getAnimations()` + pause/seek」，因为 3.2 的 governor 初始态是 `paused`，旧路径等不到。

未采用的方案（记录以免重走）：帧内整条藏 `.toolbar` —— 3.2 把 Present/Export 移到了 body 顶层
`.toolbar`，看起来像新增噪点，但站内已有 e2e 明令「嵌入模式不许把工具栏一起藏掉」（pan/zoom 那条），
且旧版同样有 Present/Export，属于既有产品形态，不动。

附带两件事：产物 644KB → 831KB（+29%），多出来的是 3.2 打进产物的**独立 Viewer**（`viewer` 字样
20 → 901 次）；它在产物里带了一条 `href="https://github.com/tt-a1i/archify"` 署名链接，而
`build.mjs` 的「零外部请求」守卫原本把 `href` 一刀切了。守卫改为按**是否发起请求**判定：禁
`src` / `poster` / `<link href>` / `xlink:href`，放行纯导航的 `<a href>`；`lab.spec.ts` 同步。
