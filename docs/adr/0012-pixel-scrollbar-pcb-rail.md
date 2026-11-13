# ADR-0012：像素滚动条（板边双导轨 + 游标）

- 日期：2026-09-08
- 状态：已落地，待作者本地预览验收
- 相关：ADR-0005（PCB 媒介映射先例）、`docs/specs/scrollbar-acceptance-matrix.md`

## 背景 / 问题

作者要求「像素风滚动条」。滚动条是浏览器 chrome，不受 DOM 控制，能做造型的只有
`::-webkit-scrollbar` 伪元素族（Blink/WebKit）与标准 `scrollbar-color`/`scrollbar-width`
（Gecko 及 Chromium 121+）。本 ADR 记录：为什么选纯 CSS、为什么这样映射媒介、
以及一轮**实测证伪**推翻了首版方案里的哪些断言。

## 一、前置调研（开发流程文档 铁律：读了什么原则 → 为何适用于本任务）

| 来源（实读） | 原则 | 落点 |
|---|---|---|
| `ap-motion-vocab` | 一个产品一个种子（反律①）；禁第三方库；禁经此加无限循环 | 滚动条**不引入第二运动人格**：无编排动画，状态切换靠形状/面积（且 Blink 实测忽略伪元素上的 `transition`，故不写 transition） |
| `animation-principles`（timing / staging） | 微交互 100–200ms；装饰不得抢内容焦点 | 静置态**不填实心 accent**（否则是全站面积最大的实心强调色块）；不做脉冲/呼吸/滚动联动 |
| `styleseed/ss-tokens`、`ss-motion` | 单强调色 / 8px 网格 / 像素语言 | **按 ADR-0005 的证据修正**：这三条**不再假托 styleseed 出处**（实抓原文检索不到），是**本站自有约束**。本次照做：只用 `--gb-0..3`、`--step` 网格、硬边 |
| 本站 ADR-0005 | 媒介 = PCB（排针/焊盘/丝印） | 滚动条复用同一媒介族（板边导轨），不引第二媒介 |
| 本站 `.skill-bar` 语言 | 「未点亮段 = 描边空格，像电平表的空槽」 | 游标静置 = 空心框，悬停/拖拽 = 填实（复用既有「未点亮 → 点亮」词汇） |

## 二、媒介转换前置检查（五步）

1. **线元素盘点**：滚动条宽度边、轨道、拇指、端部箭头、圆角/投影。
2. **功能**：轨道 = 行程容器；拇指 = 位置指示 + 拖拽手柄；刻度 = 位置读数；端部箭头 = 无新功能。
3. **同构物理媒介**：**板边双导轨 + 游标**（PCB 板沿的走线槽与滑接件）。
4. **重新映射**：轨道 → 导轨槽（两侧 2px `--gb-2` 导轨线）；拇指 → **游标框**（2px `--gb-2` 框 + `--gb-0` 空芯）；箭头 → 删除（无功能不映射）；圆角/模糊/渐变 → 删除（非 PCB 语言）。
5. **可读性验证**：只有两层可见元素，都用「对 `--gb-0` 有契约保证」的色——`--gb-2` vs `--gb-0` 恒 ≥4.0:1（新增单测锁），`--gb-3` 本方案不用作描边。

**自我否定三问**：① 氛围来自背景？**否**（滚动条就是线元素本身）。② 移除背景仍有结构感？**是**（双导轨 + 游标框两段结构独立成立）。③ 独立表意？**是**（游标长度 = 剩余行程，位置 = 进度，可拖拽）。→ 通过。

## 三、裁决

**做**：纯 CSS、全站启用、无 JS、无开关、无偏好键。

| 项 | 决定 |
|---|---|
| 尺寸 | `--sb-size: 16px`（4 × `--step`）；≤560px 降 12px |
| 轨道 | `background-color: var(--gb-0)`（= 页面底色，不填充）+ 两侧 2px `--gb-2` 导轨 |
| 游标 | `background-color: var(--gb-0)` + `box-shadow: inset 0 0 0 2px var(--gb-2)`；`min-height: calc(var(--sb-size) * 2)` |
| 悬停/拖拽 | `background-color: var(--gb-2)` —— **空芯填实**（面积变化，非色相翻转） |
| 端部 | `::-webkit-scrollbar-button { display: none }` |
| Gecko 回退 | `@supports not selector(::-webkit-scrollbar) { * { scrollbar-color: var(--gb-2) var(--gb-0) } }` |
| 布局占位 | `html` 与 `main#main > section > .container` 加 `scrollbar-gutter: stable` |

**被否决的方案**
- **JS 自绘滚动条**：要接管拖拽/键盘/触屏/a11y，且会和 `index.astro` 已接管的 wheel/keydown 整屏翻页抢事件——收益（Firefox 也能像素化）不值这个风险。
- **全站统一 `scrollbar-width: thin` + `scrollbar-color`**：跨浏览器一致且无布局位移，但像素造型全丢，与需求冲突。
- **实心 `--gb-2` 游标 + `--gb-0` 隔离环**（首版）：游标会成为全站面积最大的实心强调色块（16×~175px ≈ 2800px²，是 SideDock 焊盘的 8.75 倍）；且 `--gb-0` 环在浅色主题里是**最浅色**，环变成发丝高光，语义反了。
- **hover 用 `--gb-2` → `--gb-3` 色相翻转**（首版）：13 套主题里 `--gb-3` vs `--gb-2` 有 **7 套低于 2:1**（gb-green 仅 1.20），且浅色主题的 `--gb-3` 是**最深色**（nes-punch `#2a2a31`、inkpaper `#141414`），「白热」会变成「变黑」。
- **8px 刻度 / 2px 槽壁**（首版）：实算 `--gb-1` vs `--gb-0` 全 13 套仅 1.03–1.32:1、`--gb-3`@10% vs 轨道仅 1.18–1.34:1——**13 套主题全部不可见**，等于只写在文档里。且会与 `body::before` 的 45° 网格、CRT 扫描线抢「第三套线纹」（08-31 板级评审刚把扫描线从 35% 降到 18% 让走线当唯一线性主角）。

## 四、实现要点与实测证据

**只有两个可见层，颜色全部有契约保证**

| 色对 | 13 套主题实测范围 | 用途 |
|---|---|---|
| `--gb-2` vs `--gb-0` | **4.02–11.43:1**（最差 dawnbringer-ember） | 导轨、游标框、通电填充 |
| `--gb-3` vs `--gb-2` | 1.20–3.48:1（7 套 <2:1） | **不用**（这是否决色相翻转的量化依据） |
| `--gb-1` vs `--gb-0` | 1.06–1.95:1 | **不用**（调色板里不存在中对比中性色） |

**A/B 实测（headful Chrome 152，逐像素采样）——边框 vs inset 阴影**

```
A border 2px   : x=4 纯 gb-2，x=5 = 55,116,199（抗锯齿混合）→ 实际只有 1px 干净
B inset shadow : x=4,5 均为纯 gb-2                          → 干净 2px
```
→ 采用 `box-shadow: inset`（与 `.px-box` 注释里的既有结论一致）。

**渲染分层实测（高饱和色替换后采样，验证三层都真的画出来）**

```
y=0..126   游标：x=1/14 环 + x=8 芯
y=130..699 轨道：x=1/14 导轨 + x=8 轨道底
```
→ `:vertical` / `:horizontal` 导轨变体确实渲染；游标高度 ≈127px（`min-height` 32px 在本站长文里不生效，只作兜底）。

**自动化边界（重要）**

- headless Chrome **不绘制**滚动条、也不占布局宽度（`innerWidth - clientWidth === 0`，加 `--disable-features=OverlayScrollbar` 同样为 0）→ 截图/e2e 尺寸断言都测不到「画成什么样」。
- 但 `getComputedStyle(el, '::-webkit-scrollbar-thumb')` **能取到级联值** → e2e 用它守 13 套主题跟随、Nav/主题面板隐藏不回归、`scrollbar-color` 未误开（`tests/e2e/scrollbar.spec.ts`）。
- `getComputedStyle` **不解析** `::-webkit-scrollbar-track:vertical`（返回空）→ 导轨规则只能由单测的源码契约 + 作者本地预览守。
- 合成鼠标事件**打不到滚动条** → `:hover` 状态无法自动验证，只能真机手验。

## 五、已知代价与风险

| 代价/风险 | 说明 | 缓解 |
|---|---|---|
| overlay 平台被强制成常驻经典条 | 在 macOS / Win11 Fluent overlay / ChromeOS 等平台，只要写了 `::-webkit-scrollbar`（哪怕不写 width），「悬停才现的细条」就变成常驻 16px 经典条（`0 → 16px`）。Windows 本地是 15→16px，作者自己看不到这个差异 | 作者 Windows-first，接受；本 ADR 记录 |
| `scrollbar-gutter: stable` 的真实作用 | **只解决「滚动条出现/消失时内容横跳」**；对根元素在 overlay 平台是空操作（实测 delta 仍为 0），**修不了**上面那条转换 | 已在 `.container` 上用来修 `#skills` 屏 343 vs 359 的既有横跳 |
| Gecko 只有两色 | Firefox 无 `::-webkit-scrollbar`，只能给 `scrollbar-color` 两色 | 门用 `not selector(::-webkit-scrollbar)`（测冲突条件本身）；**禁用 `-moz-appearance` 之类代理条件**——Chromium 若补该别名，门会误开，`scrollbar-color` 会压掉像素化并让 Nav/主题面板的隐藏滚动条复活 |
| `:hover` 反馈 | 合成事件测不到，且 Blink 忽略伪元素上的 transition | 状态变化靠面积（空芯→填实），不依赖动画；真机手验 |
| 移动端 | overlay 滚动条忽略本段 | 预期降级 |

## 六、明确不做

- 不加 SideDock 开关、不加 `8bitme:*` 偏好键（滚动条是基础 chrome，非特效；与 page transition「全站常播、无开关 UI」一致）。
- 不做端部像素箭头（16px 档放不下，且无功能）。
- 不做滚动联动/脉冲/呼吸（违反「滚动条不演出」）。
- 不引第五色（单强调色铁律）。
- `forced-colors` 无需分支：实测 UA 会接管滚动条配色。

## 七、验收

见 `docs/specs/scrollbar-acceptance-matrix.md`（作者本地预览用）。门禁：
`npm run typecheck` → `npm run test:unit` → `npm run build` → `npm test`。

## 八、演变

- **v1（首版，未落地即被推翻）**：实心 `--gb-2` 游标 + `--gb-0` 隔离环 + `--gb-0` 槽壁 + `--gb-3` 10% 8px 刻度 + `border` 描边 + `@supports (-moz-appearance: none)` 门 + `transition: steps(2)`。
- **v2（本 ADR 落地版）**：双导轨 + 空心游标框，悬停填实；删掉全部不可见层；描边改 inset 阴影；门改 `not selector(::-webkit-scrollbar)`；删 transition。
- 推翻 v1 的证据来自两轮子代理证伪 + 本节全部实测（13 套主题对比度实算、headful 逐像素采样、headless 能力边界）。
