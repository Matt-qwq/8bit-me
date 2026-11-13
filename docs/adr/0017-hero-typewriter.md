# ADR-0017：首屏打字机（hero typewriter）

- 日期：2026-09-11
- 状态：已落地，**待作者本地观感验收**（节奏/光标/与开机仪式的叠加）
- 相关：ADR-0004（机器叙事）、ADR-0007（音效角色）、ADR-0013（Zpix 排版与 `@font-face`）、ADR-0014（生成式封面/头像）、ADR-0015（铁律阈值化）、`docs/specs/line-hierarchy.md`、`docs/specs/typography-metrics-v1.md`、`docs/specs/visual-acceptance-matrix.md`

## 背景 / 问题

首屏（`#hero`）是全站唯一 100% 曝光面，却也是唯一**完全静态**的一块：文字只在载入时播一次 `hero-rise`（0.32s 上浮），此后一动不动。而站点叙事是一台机器——`AvatarSprite` 就是 CRT 终端（屏内本来就有示波器波形 + 方块光标）、`.kicker` 是「Press START」丝印、BgFx core 有「走线级联上电」的开机仪式。**机器在开机，终端却已经把字打完了**。

作者 2026-09-11 提出：hero 需要有打字机效果。

## 作者已确认的决策

| 决策 | 取值 |
|---|---|
| 打字范围 | **`h1` + `tagline` + `intro` 三行**（57 字素）。`kicker` / CTA / 站况读数（POSTS·THEMES·UPDATE）一律不动 |
| 重播策略 | **每次首页加载/刷新打一次**；页内滚到 `#about` 再回 `#hero` 不重播（标题不会在眼前消失重打） |

### 范围修订（2026-09-11，作者反馈）

初版只打 `h1` + `tagline`（21 字素）。作者看到实际效果后指出：

> 「Matt 的工程复盘站：做过的项目、踩过的坑、沉淀下来的做法，都在这里」这句话不用打字机吗？
> 只有上面在打字，下面不打字，很突兀

成立：hero 面板里三行文案是一个**连续语句**（标题→副标→自述），只打前两行会让「终端打印」这个动作在中间断开。intro 纳入范围。

连带两个决定：
- **节奏从 58ms/字 调到 32ms/字**：三行 57 字素按原节奏要 3.9s，太长。
- **`clip-path` 从矩形升级成 L 形阶梯**（见 §二）：intro 在桌面就是 **2 行**（`max-width: 34rem`）、移动端也是 2 行，而 `inset()` 是**一个矩形** —— 多行会变成「两行同时左→右擦除」，不是打字。

范围里那句「站况读数不打」不是审美偏好：读数是**要紧数据**（篇数/主题数/更新日期），延迟它违反 `ap-motion-vocab` 反规则 2「绝不延迟内容」。范围由 `tests/unit/typewriter.spec.ts` 的**源码契约**钉死（带 `data-tw-line` 的必须恰好是 `h1` / `.tagline` / `.intro`，`.hero-status` / `.hero-cta` / `.kicker` 带一个就红）。

## 一、媒介映射（快道）

打字机 = **终端打印机**：机器上电（BgFx 开机仪式）→ 终端把站名打印出来（hero）。光标复用 `AvatarSprite` 屏内方块光标与 cursor-fx `block` 形态的既有语言——**零新颜色、零新形状、零新依赖**。它不是装饰层、不是线元素、不是第二套媒介，是既有「终端」媒介的一个动作。

### 铁律自查（快道四问）

① 不新增背景层 ✓ ② 不新增线元素（`clip-path` 不是线；光标是实心块，**刻意不用 `border`/`outline`/`box-shadow`**——那会变成线元素、触发慢道与 `line-hierarchy` 登记）③ 不改任何底纹不透明度 ✓ ④ 不改结构线宽度/颜色 ✓
→ **走快道**：跳过媒介转换前置检查，`docs/specs/line-hierarchy.md` 不登记（登记对象是线元素，这里没有）。

### 自我否定三问

① **装饰层是否在预算内？** 不适用——本次不新增任何背景/装饰层。打字是运动，光标是瞬时构件。
② **移除后 UI 是否仍有结构感？** 是。移除打字机 = 静态 hero，面板/网格/线层级零改动（e2e 的「布局零位移」证明几何与静态版逐值相同）。
③ **UI 元素是否独立表意？** 是。光标只在「正在输入」期间存在（表意输入进度），结束即撤。**常驻闪烁光标会失败在此条**（hero 不是输入框，常驻光标不再表意、还会抢首屏焦点）——故否决。

## 二、实现

三块，职责单一：

### 1. `src/lib/typewriter.ts`（纯逻辑，vitest 目标）

只算**时间线**（谁在第几毫秒出现），DOM 一点不碰：

```ts
export const TYPE = { MS_PER_CHAR: 32, JITTER: 0.4, LINE_GAP: 220, LEAD_IN: 140, BUDGET_MS: 2600 }
splitGraphemes(text)  // 字素簇切分（Intl.Segmenter 优先，退码点）——Range 的 offset 是 UTF-16 码元
planSequence(texts)   // → { lines[{segments, offsets, end}], starts, total, compressed }
revealPolygon(width, rows, glyphs, n)  // 多行裁切形状（L 形阶梯）→ CSS polygon
```

三个不变量（单测锁）：offsets 单调不减 / `total ≤ BUDGET_MS` / 同一 rng 逐字可复现。

**预算为什么是「等比压缩整条时间线」而不是「把每字间隔钳到下限」**：钳下限会在长文案上**反向破预算**（1000 字 × 26ms 下限 = 26s）。等比压缩则永远成立，且保住抖动形状与单调性。文案将来变长也不会拖过预算。

**预算不是目标值，是安全网**：三行文案名义 ≈ 2.4s，预算 2.6s 只留少量余量（单测断言「名义值不压缩」+「名义值明显短于预算」）——否则抖动天天撞顶被压平，「机械感」就没了。

### 多行裁切几何：L 形阶梯（不是矩形）

`clip-path: inset()` 是**一个矩形**，多行文字会变成「两行同时左→右擦除」。hero 的 intro 在桌面就是 2 行，所以必须支持多行：

```
已打完的视觉行  → 整行露出（阶梯上边 = 当前行顶，右侧满宽）
当前行          → 露到最后一个已打印字素的右边界
后面的行        → 完全裁掉（阶梯下边 = 当前行底）
```

顶点序 `(0,0) (W,0) (W,行顶) (x,行顶) (x,行底) (0,行底)`；**单行时退化成矩形**（与旧写法等价），所以不需要两套代码。全部是纯几何，单测锁 7 条（含「已打完的行整行露出」「未打到的行完全不可见」「裁切边钳在盒宽内」「量不到行→零面积」）。

### 2. `src/components/sections/Hero.astro` — 标记 + 两段脚本

- **标记**：`<h1 data-tw-line>` / `<p class="tagline text-pixel" data-tw-line>` / `<p class="intro" data-tw-line>` + 一个模板里就渲染好的 `<div class="tw-caret" aria-hidden hidden>`。
  - 光标必须**在模板里渲染**（不能 `createElement`）：Astro 的 scoped 样式带 `data-astro-cid-*` 属性，运行时造的元素拿不到它，样式会**静默不生效**。
- **`is:inline` 预挂载脚本**（紧跟 `</section>`，解析期就执行）：
  - ① 首帧前把两行裁掉（`clip-path: inset(0 100% 0 0)`）→ 不存在「先显示全字再跳回空白」的闪烁；`clip-path` 不进布局，裁掉后布局与静态版**逐像素一致**；
  - ② 3s 兜底：模块脚本没跑到终态（chunk 404 / 中途抛错 / 被拦）就自己揭幕，文字不可能永久隐藏；
  - ③ `pageshow(persisted)`：bfcache 往返时模块不会重跑，这里负责把裁切清干净；
  - ④ `CSS.supports('clip-path', ...)` 门：老引擎根本不裁，直接静态显示。
  - 无 JS / 脚本被拦 → 整段不执行 → 文字完整可见（渐进增强，e2e 有独立用例）。
- **模块脚本**（`<script>`，可 import `src/lib`）：状态机 `html[data-tw] = on → done`（这个属性同时是内联兜底计时器读的标志，不是测试专用探针）。

```
接管(dataset.tw='on')
  → 等字体：document.fonts.load('32px'/'14px' Zpix) 与 400ms 超时赛跑
      └ 超时/失败 → 直接 finish()（静态揭幕）。**不许用回退字体的前进量裁字**（见 §四.2）
  → 前置校验（任一不满足 → finish()）：每行有非空白文本、hero 在视口内、
      时间线长度 == 实量到的字素数
  → 逐字素用 Range 量左/右边界与**视觉行号**（拍平全部文本节点，同 pixel-grid.spec.ts 手法）
  → rAF 逐帧：到点重算 `revealPolygon(...)`（L 形阶梯）；本行打完**立刻撤掉本行裁切**
  → 光标：实心块，位置由「下一个要打的字」的真实 rect 推导
      （行内换行与跨行都自然成立：x 取下一字左边界、y 取它的字格顶，落在哪行就跟到哪行）
  → 全部打完 → finish()：清裁切 + 收光标 + dataset.tw='done'
  中断：resize → finish()（已量边界失效）；任何异常 → safe() 兜到 finish()
```

- **不假设单一文本节点**：初版用 `childNodes.length === 1` 判断可量，于是将来往 h1/intro 里加 `<strong>`/`<a>` 会**静默**降级成不打字。现改为「拍平全部文本节点、逐字素列表」，与 `pixel-grid.spec.ts` 同手法。

- **样式**：`.hero-text { position: relative }`（光标宿主）+ `.tw-caret`（实心 `--gb-3` 方块 + `steps(2)` 闪烁）。宽度/高度由脚本按当前行的字格实测注入（h1 32px / tagline 14px 两档自动同高）。reduce 下闪烁由 `global.css` 的全局块压成 0.01ms×1（无 `forwards` → 回到实心常态），与 `.kicker` 的 blink 同待遇，**不需要额外规则**。
- **顺手删掉一处死规则**：`.hero-text > :nth-child(1..5) { animation-delay }` 只给了 delay、没给 animation-name，真正跑动画的是 `.hero-inner > *`，那 5 条从未生效（`getComputedStyle` 实查确认）。删它还有第二个理由：`.hero-text` 现在多了光标（第 5 个子元素），那组规则一旦被「修好」会把光标也推下 8px。

### 3. reduced-motion：**照播不区分**

与 `PageTrans`（「访客 reduced-motion 恒播不区分」）和首页整屏翻页（`reveal.spec.ts` 守的 WAAPI 豁免）同一条既有约定。作者系统就是 reduce=true，门控等于让作者永远看不到这个效果。e2e 有独立用例守「reduce 下仍采到中间态」。

## 三、否决方案（防后来者重走）

| 方案 | 否决理由 |
|---|---|
| CSS `width: 0→100%` + `steps(N)` + `border-right` 光标 | ①CJK 前进量非整数（14px → 15.0px，加 0.1em 字距后 16.4px），`steps` 必裁在半字形上；②`white-space: nowrap` 改布局、窄屏会溢出（`type-geometry.spec.ts` 的溢出组会红）；③`border-right` 是**线元素** → 触发慢道 + line-hierarchy 登记 |
| 逐字 `<span>` + opacity 逐个点亮 | 动 DOM：`letter-spacing` 在 inline box 边界的行为、`innerText`（Playwright `toContainText`）、`font.spec.ts` 的 Zpix 层叶子扫描、`pixel-grid` 的逐字对格全部进入影响面。本站被「静默字形/对格漂移」咬过多次（U1 换字体、子集缺字、逐字对格），**不碰文本节点**是最强的守恒选择 |
| `mask-image` 渐变擦除 | 软边（渐变边缘）= 反像素语言；`clip-path` 硬边与像素语言一致，且边界能精确落在字符 rect 上 |
| 逐字 chip-tune SFX | 浏览器 autoplay 策略下首访多半无声；21 连音会刷屏（同 ADR-0007 对 hover「极小声防刷屏」的理由）。**不做** |

## 四、实测数据与代价

| 项 | 实测 |
|---|---|
| 打字时长 | 57 字素（3 行）：LEAD_IN 140 + 7×32 + LINE_GAP + 13×32 + LINE_GAP + 37×32 ≈ **2.4s**；`BUDGET_MS = 2600` 是安全网（抖动最坏也不超） |
| 落定时刻（实测） | **2395ms**（`html[data-tw=done]`）。h1 在 **427ms** 已揭幕（逐行揭幕，不等全串） |
| **LCP** | 本站 LCP 元素是 **h1**（不是背景 canvas）。实测 **452ms**（导航猫 IMG 在 196ms 处让位）—— 与只打两行时的 616ms 相比**反而更好**，因为 h1 更早打完。带 `clip-path` 的元素在 Chrome 眼里一直不算「已绘制」，所以「何时撤裁切」直接决定 LCP |
| 与既有采样的关系 | `density.spec.ts` / `hero-contrast.spec.ts` 在导航后 2200ms 采样首屏，此时 intro **还在打**（2378ms 才撤裁切）。它们不受影响：`clip-path` **不进布局**，而对比度探针会把文字 `color: transparent` 后只量背景像素。实测全绿 |
| 字体未就绪时的盒宽 | 回退字体下页面高度变化会让 `.hero-inner` 窄 **4.22px**（487.31 → 483.09）。故所有边界断言用「**已揭幕宽度**（相对文字起点）」而不是「右内缩 px」——拿绝对 px 比会把「盒宽变了」误判成「裁切边错了」（第一版测试就踩了这个） |
| 零成本 | 无新依赖、无新请求、无新颜色、无新线元素、无新背景层。改 `global.css` = 0 行 |
| 坐标系 | **截图评审抓出的真 bug**（非 e2e 发现，因当时只断言了光标 x）：光标整体低了整整一行（实测 68px）。根因 = 量边界时取的是**绝对视口坐标**，而每帧又新取一次 `hostBox` 相减 —— 中间只要发生滚动（首页翻页脚本把 hero 顶从 0 推到 60）或入场动画位移（`hero-rise` 的 `translateY(8px)`），差值就永久偏掉。修法 = **两套坐标系分开存**：`clip-path` 的 inset 用「相对元素自身」，光标用「相对 host 的 padding box」，各取一次、此后不再重取。已固化为断言 ⑤′（光标 y/高必须贴正在打的那行） |

## 五、反例验证（新增守卫必须立刻跑一次反例——全部实测变红后改回）

1. **不揭幕**（`finish()` 不 `removeProperty('clip-path')`）→ 「终态 clip-path 归 none」红。
2. **超时也照打**（不等字体）→ 「字体没就绪就不打字」红。**这条抓出了一个真 bug**：原实现 400ms 超时后照样 `run()`，而此刻字体还没到 → 按**回退字体**的前进量量边界（CJK 14px vs Zpix 15px）→ 裁在半字形上。修法：超时即 `finish()` 静态揭幕。反例用 `page.route` 把子集 woff2 推迟 800ms 复现，已固化为常驻用例。
3. **本行打完不撤裁切** → 「tagline 起打时 h1 已完成」红（症状是每行末字永远少一个，且 LCP 被拖到 1.5s）。
4. **打字机偷改布局**（在 `run()` 里给 h1 加 `letter-spacing`）→ 「布局零位移」红；`BUDGET_MS` 调到 5000 → 单测红；给 `.hero-status` 加 `data-tw-line` → 范围契约红。
5. **光标坐标错位**（`translate` 的 y 加 28px）→ 「光标必须贴在正在打的那一行上」红。
6. **多行裁切退化成矩形**（L 形阶梯上边写死 `y: 0`）→ 单测「已打完的行整行露出」红；**裁切边偏 3px**（落进字里）→ e2e「没有一个字被切一半」红。

> **教训（已写进 AGENTS 硬经验）**：这条光标错位**所有 e2e 当时全绿**，是 agent 自己截图看图才发现的 ——
> 因为第一版只断言了光标的 x 在内容盒内，没断言 y。**「断言存在」不等于「断言对」**；
> 而「自己起服务器 + 自己截图 + 自己看图」是 agent 的活，不是作者的活（见 AGENTS「视觉看图」）。

## 六、守线指针

| 契约 | 落点 |
|---|---|
| 时间线不变量（单调/预算/确定性/字素切分） | `tests/unit/typewriter.spec.ts` |
| **打字范围**（只打 h1 + tagline，读数不许延迟） | `tests/unit/typewriter.spec.ts`（读 `Hero.astro` 源码） |
| 逐字揭示真的发生（逐帧采样，不赌时序） | `tests/e2e/hero-typewriter.spec.ts` |
| 终态无残留 + 光标收起 | 同上 |
| **光标贴在正在打的那一行上**（y / 高 vs 该行字格，防坐标系混用） | 同上 |
| **布局零位移**（打字全程几何 == 无 JS 静态基线，含逐字边界与间距恒定） | 同上（两个互相制约的指标） |
| **没有一个字被切一半**（核心不变量：把裁切多边形当几何区域，逐字素判「整字可见/整字不可见」） | 同上 |
| 揭示是**前缀**（行内不留洞） | 同上 |
| 落定 ≤2200ms（既有采样时刻） | 同上 |
| reduced-motion 下仍打 / 无 JS 降级 | 同上 |
| 零 console 报错 | 同上（`routes.spec.ts` 亦覆盖首页冒烟） |
| 既有防线复核 | `hero-contrast` / `density` / `font` / `pixel-grid` / `type-geometry` / `page-contract` / `reveal` / `transition` 全绿（187 条 e2e） |

`docs/specs/visual-acceptance-matrix.md` **不新增格子**（矩阵已压缩到 ≤4 格；观感由作者本地 `npm run dev` 确认，符合「新发现的缺陷补断言不补格子」）。`docs/specs/line-hierarchy.md` **不改**（走快道，无新线元素）。

## 七、待作者确认的观感项（无法自动化）

> agent 已自起服务器截图并逐张看过（桌面 1440 默认主题 / `gb-green` / `nes-punch` / `inkpaper` + 移动 390，
> 每档取「h1 打完」「tagline 打到一半」「终态」三帧）：**光标位置、贴行、居中跟随、浅色主题下可见性均正常**
> （`inkpaper` 浅底上光标取 `--gb-3` = 深墨，对比充足）。下面这些是**主观取舍**，无法自动判。

1. 节奏：32ms/字 + ±40% 抖动像不像打字（不像就调 `TYPE.MS_PER_CHAR` 一处；三行共 57 字素，总时长会跟着变）。
2. 光标：方块大小（字格高 × 0.5）与 1s `steps(2)` 闪烁是否合适。
3. 与开机仪式 / 入场幕帘的叠加：首访时 bg-fx 走线级联上电（2.5s）与打字（1.6s）同屏是否抢戏。
4. 窄屏居中（≤900px）时光标跟随是否自然（已截图确认位置正确，但「节奏感」需人判）。
5. 13 套主题下光标对比度（`gb-green` / `nes-punch` / `inkpaper` 重点）。

不满意时改哪里：节奏 → `src/lib/typewriter.ts` 的 `TYPE`；光标形状/闪烁 → `Hero.astro` 的 `.tw-caret` 与 `@keyframes tw-blink`；范围 → `data-tw-line` 挂到哪两行（范围契约单测会跟着红，提醒你改了决策）。

## 八、明确不做

- 不打字 `kicker` / CTA / **站况读数**（读数是**要紧数据**：篇数/主题数/更新日期）。
- **不把打字做成“逐行固定时长”**：整串是一条时间线，行间停顿只是换行回车（`LINE_GAP`）。
- 不做逐字音效；不做常驻闪烁光标（铁律③）。
- 不与 BgFx 开机仪式耦合（不读不写 `8bitme:boot`——那是 sessionStorage 会话一次，与「每次加载打一次」的决策不一致）。
- 不引入任何依赖；不改 `global.css`；不动主题；不新增验收矩阵格。
