# 像素猫（导航 1 睡 + 页脚 2 追）+ 设置改右侧折叠仓：外部 skill 落地与 reduced-motion 裁决

## 背景 / 问题

- 作者要求：导航栏一只猫趴着睡觉、页脚两只猫追逐打闹，都用像素画；底部 5 个设置按钮挪到
  中间右边，做成侧边按钮（折叠仓）。
- 开发流程文档 铁律：任何视觉设计动工前**必读**外部设计 skill（styleseed / animation-principles /
  ap-motion-vocab），并把「读了什么原则 → 为何适用于本任务」记进文档；**不带着目录当读过书**。
- 本机三个 skill **均未安装**（`~/.agents/skills/` 下只有 archify 与 engineering/productivity 系列）。
  作者裁定：**「得安装先，这是基础」** → 安装作为 Step 0 先决，未完成不动产品代码。

## 一、安装（Step 0）与装后实测

来源、星级、许可证、风险依据本仓 `docs/research/github-skills-animation-design.md`（2026-08-27 调研）。

| 项 | 结果 |
|---|---|
| 可达性 | `git ls-remote` 两个仓 ✅；但 **`git clone` 到 github.com 失败**（port 443 超时）。`api.github.com` 与 `raw.githubusercontent.com` 可达 |
| 安装方式 | 因 clone 不通，改为**按精选清单经 `raw.githubusercontent.com` 逐文件抓取** 28 份 SKILL.md（4 styleseed + 24 animation-principles）。未用 `npx skills add`/安装脚本——遵循调研文档「审查后以拷贝式安装优先」的供应链对策 |
| 安装位置 | `~/.agents/skills/`。⚠️ **`~/.codebuddy/skills/` 是「每 skill 一个链接」而非父目录 junction** |
| 踩坑 | Git Bash `ln -s` 在本机**静默生成副本而非链接**（写入穿透测试失败）→ 改用 PowerShell `New-Item -ItemType Junction` 重建，再测写入穿透通过 |
| 装后实测 | 28/28 份 frontmatter 有 `name` + `description`；junction 写入穿透 OK；源目录完好 |

## 二、实读了什么（原文摘录，非目录）

- **`styleseed/ss-motion`**：五种种子 Spring/Silk/Snap/Float/Pulse；「smooth, silky, fluid,
  elegant, composed, continuous」→ **Silk**。**两条反律覆盖全表**：① **一个产品一个种子**
  （项目已有种子就对齐，不引入第二种人格）；② 永不延迟 payload。命名动作含
  `pulse-beat`（循环缩放脉冲 = "alive"）、`stagger-cascade`、`toggle-curtain`。
  禁用：自造种子名、第三方动画库、**经本 skill 加无限循环**。
- **`styleseed/engine/DESIGN-LANGUAGE.md` §43（107KB 原文，按需抓取）**：app/data 面禁令含
  「NO Infinite loop animations (except skeleton pulse)」；但**品牌/落地页走 Cinematic tier**，
  该禁令不适用（「Don't apply dashboard restraint to a landing page」）。Cinematic 护栏**全为必需**：
  purposeful（非装饰性抖动）、60fps（只动 transform/opacity）、不挡首读与主动作、
  **`prefers-reduced-motion` fully honored（关掉动效页面仍完整连贯，只是静止）**、
  **One motion language（一个缓动族、一个种子）**。
- **`animation-principles/continuous-infinite`**：Squash&Stretch **5–10% 振幅**、「呼吸而非弹跳」；
  **呼吸/脉冲 2000–4000ms**、**环境背景 5000–15000ms**；**周期用质数关系、多元素不同步**；
  循环须 seamless（首尾帧完全一致）；**"invisible by design"——几秒后还被注意到就是过头了**；
  反模式含「同步多个循环」「周边视觉的大幅移动」。
- **`animation-principles/accessible-motion`**：**Always Avoid 含「Infinite animations」**；
  Potentially Harmful 含「Large moving areas (>1/4 viewport)」；**WCAG 2.2.2**：移动内容 >5s 须可暂停。

### 一处证据修正（诚实记录）

开发流程文档 把「单强调色 / 8px 网格 / 像素语言」归于 styleseed。实抓 `engine/DESIGN-LANGUAGE.md`
（107KB 全文）**检索不到 "single accent" / "pixel" 字样**，"8px" 仅出现在字号表而非网格规范。
本仓调研文档也自述 styleseed 内容为「awesome 清单引述，**未抓原文**」→ 该归属属**二手转述、未证实**。
本站的 `--gb-2` 单强调色、`--step: 4px` 网格、像素语言是**本站自有约束**，继续照做，但**不再假托 styleseed 出处**。

## 三、裁决（作者明示，且是在被告知上述证据之后作出）

> **猫照常播（WAAPI），即使 `prefers-reduced-motion: reduce`。**

- 与 styleseed §43 护栏「`prefers-reduced-motion` fully honored」及 accessible-motion
  「Always Avoid: Infinite animations」**直接冲突**。经向作者出示原文后，作者选择**明示覆写**。
- 本记录即为「记下裁决」：属**知情覆写**，非无知违规；与 ADR-0004 对 ap-motion-vocab 冲突的处理
  同一手法（把冲突与裁决写进 ADR，防未来读者困惑）。
- **主动缓解（不计入裁决，是我为压低代价自加）**：
  - 振幅取 continuous-infinite 下限 **5–6%**（"呼吸而非弹跳"），不取更大值；
  - 呼吸周期 **2.4s**（落在 2000–4000ms 区间），追逐 **6s**（落在 ambient 5000–15000ms 区间）；
  - 两猫周期取**非同步**值，避免同步循环反模式；
  - **只动 transform/opacity**，不改布局（60fps 护栏）；
  - 猫为 `aria-hidden` 装饰层，不进入 tab 序、不读屏、不遮挡内容与主操作。

## 四、原则 → 本任务的落点（铁律要求的那张表）

| 原则（出处） | 在本任务的应用 |
|---|---|
| 一种子一产品（ss-motion 反律① / §43 One motion language） | 猫呼吸、追逐、仓展开**统一 Silk** `cubic-bezier(0.22,0.9,0.24,1)`；不引第二种人格 |
| Silk ← "smooth/silky/continuous"（ss-motion 映射表） | 本站种子本就是 Silk，与映射一致，无需改 |
| 禁第三方动画库（ss-motion / ap-motion-vocab②） | 全部 WAAPI + CSS，与零依赖栈一致 |
| 呼吸 5–10%、周期 2000–4000ms（continuous-infinite） | 导航睡猫 `scaleY 1↔1.06`（6%）、2.4s 循环 |
| ambient 5000–15000ms、周期质数不同步（同上） | 页脚双猫追逐 6s，两只周期错开不同步 |
| 循环 invisible by design（同上） | 振幅压下限；不抢章节 PPT 翻页这个"主拍" |
| purposeful，非装饰性抖动（§43 护栏） | 猫=PCB 丝印吉祥物（真实 PCB 常见），属品牌叙事而非纯抖动；仓=侧边接插件（结构件） |
| 只动 transform/opacity（§43 60fps） | 猫用 scaleY/translateX，仓用 translateX/opacity |
| Never delay the payload（ss-motion 反律②） | 不对正文/卡片内容做延迟入场；猫与仓不阻塞首读 |
| **reduced-motion（§43 + accessible-motion）** | **按第三节裁决覆写：照常播**；缓解措施同上 |

## 五、媒介转换前置检查（开发流程文档 铁律）

- 线元素 → 功能：Nav `border-bottom 4px` = 母线（分隔/引导）；链接 `::after` = 通电导线（激活）；
  卡片 chip-shadow = 焊盘立体；`body::before` PCB 走线 = 背景结构；`--step: 4px` = 焊盘网格。
- 同构物理媒介 → **电路板（PCB）**（`--tx-rail/trace/dim/grid` 与代码注释已把全站建在其上）。
- 重新映射：导航睡猫 = **丝印层吉祥物**；页脚双猫 = 同层丝印；右侧折叠仓 = **侧边接插件/排针**
  （板沿 I/O 端口，按下向板内弹出针脚）。
- 自我否定三问：①氛围来自背景？**否**（猫是前景丝印，仓是结构件）。②去掉背景仍有结构感？
  **是**（焊盘阴影/4px 网格/母线边框独立）。③元素独立表意？**是**（猫=装饰，仓=容器）。
  → **通过，可动工。**
