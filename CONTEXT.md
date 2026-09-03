# CONTEXT.md — 8bit-me Glossary

> 本文件仅作 glossary 使用，不承载实现细节或 spec。本版本为公开仓治理版（已去除作者个人/运营内容），技术术语与私有工作仓保持一致。语言约定：中文描述 + 专业术语英文。

## 站点与定位

- **8bit-me**：本项目（站点）名。定位 = 长期博客（blog）+ 8-bit 实验场（retro-experiment playground）：内容上持续更新，视觉/交互上以复古像素美学贯穿全站。
- **retro-experiment（8-bit 实验）**：以复古游戏机美学为基底的视觉/交互特性集合。v1 含 pixel font、CRT overlay、chip-tune SFX、avatar sprite 四项；v2 已落地 canvas animation（hero bg-fx）与 gamified interaction（见 easter egg / 404 mini-game）。
- **chip-tune SFX（芯片音效语言，v1→v3）**：全站可交互元素的程序化合成音（Web Audio，零音频文件）。按**角色分音**（见 sound role）；触发走中央委托（document 级拾取 `data-sfx-role` / `data-sfx-hover`，尊重 `8bitme:sfx` 门控）；映射表 `SOUND_ROLES` 与 `playRole()` 落 `src/lib/sfx.ts`。每次发声同步派发 `8bit:fx`（click→波纹 / nav→扫光 / hover→星火），视觉联动沿用 v1 协议。_Avoid_: 逐组件散装 `if (sfxEnabled()) playClick()`（漏接根因，曾致导航/主题全静默）、每按钮独有音色（破坏语言）、hover 全站出声（刷屏）。
- **sound role（音效角色）**：chip-tune SFX 的角色分类维度，六类各一个专属音效——**nav**（站内页面移动，上行双音）/ **click**（站外链接与普通确认，单音方波）/ **toggle**（开关翻转，咔哒双音）/ **select**（主题选择，上行三连 arp）/ **game**（打地鼠命中，噪声打击）/ **hover**（主控件悬停，极短 tick）。元素标 `data-sfx-role`，主控件另标 `data-sfx-hover`。_Avoid_: 全站单一音效、把 nav 链接当 click 声、把 game 复用 click。
- **GB palette（Game Boy 四色）**：全站主调色板，#0f380f / #306230 / #8bac0f / #9bbc0f。

## 站点结构（site structure）

- **section**：首页五个内容区块，单页滚动依次呈现 —— `hero` / `about` / `projects` / `skills` / `contact`。
- **single-page scrolling（单页滚动）**：首页结构约定——五个 section 在一页内滚动连贯展示，不拆分页面。
- **route（路由）**：`/` 首页（单页滚动）；`/blog` 文章列表；`/blog/[slug]` 文章单篇。
- **avatar sprite（像素头像）**：hero 区 8-bit 头像，v1 用代码生成的占位 sprite，后续可替换为用户素材。
- **bg-fx（canvas 背景动画）**：全站统一背景的像素动态背景（v3 挂载上提为 BaseLayout 全站固定视口装饰层 z-index -1；v4 加滚动视差/校参纯函数层；**v5 默认底换成「机箱内部·机器叙事」**）：
  - **core（机箱核心，默认）**：常驻 PCB 结构层（芯片座 + 曼哈顿走线簇，停帧即一张设计图）+ 低频事件层（信号包 6-12s 一只沿走线流动 / 尘埃 15-25s 一颗 / 待机灯 1.6s 呼吸）+ 会话一次开机仪式（走线级联上电 + LED 双闪；sessionStorage `8bitme:boot`）+ 事件响应（click→reticle+信号包回传 / nav→汇聚 / Konami→全亮 / 悬停→近场照明 / 主题→磷光再调谐）；默认静、单强调色（--gb-2），评审门 5 条见验收矩阵
  - **stars/scan/rain/wave/grid**：v4 原样保留，循环按钮人工覆盖；off 关闭
  - 底盘不变：`fx runtime`（palette 适配/additive 门控/启停）、`bgfx-motion.ts`（视差+密度+机器几何纯函数）、`fx-moment.ts`（时刻总线：预算闸 ≤1 次/60s、事件化 jitter、PageTrans 冻结窗、会话仪式标记、磷光衰减数学）；偏好 `8bitme:bgfx`（新增 'core' 白名单）、reduced-motion 降频不冻结
  - **可读性契约（readability seam）**：scrim 玻璃层不变（index heroVivid 首屏免遮 / 其余整页）；core 结构层按「被 72% scrim 压过后仍可辨」设计（用线/块不用细粒子）
  - 性能：dpr ≤1.5、粒子随面积裁剪、标签页隐藏停帧。验收矩阵：`docs/specs/bgfx-acceptance-matrix.md`（v5：core 行 + 评审门 5 条）。_Avoid_: 挂回 hero、无 scrim 裸奔、网格采样判空白、散落特效当编排（六模式轮流即病根）、时刻做成固定周期（要有原因有静默有失效判据）、结构层用细粒子（会被 scrim 碾碎成噪点）。
  - **section reorganization（随 section 重组，ADR-0004）**：在 v5 机箱核心静态 PCB 之上，按当前所在 section 将走线/芯片**重组为 5 种机器态子图**（hero=待机散板 / about=走线汇聚人格模块 / projects=3 芯片簇 / skills=活动总线按技能点亮 / contact=对外信号上行）。纯抽象机器叙事，**不画具象人脸/信封**。图案用**离散 snap + 错峰**变形（每元素 `delay` 错峰 = overlapping action），相机用**连续**推拉。落地：纯函数进 `bgfx-motion.ts`（`genMachineLayout(section)` 五变体 + `easeSilk` + `tweenState` + `cameraFor`），运行时由 `fx-runtime.ts` 喂滚动进度 + 套 `ctx` 相机变换；与既有事件响应（nav汇聚/悬停近场/主题磷光/Konami全亮/click回传）为**基础几何态 + 光照覆盖层**关系。reduced-motion：相机去连续平滑改离散跳变 + 鼠标视差 ×0.5，图案 snap 保留（降频不冻结）。_Avoid_: 引入 Three.js/GSAP、相机振幅过大损可读性、全屏 SVG glow 滤镜、第二运动种子（须统一 Silk）。
  - **2D camera（2D 相机，ADR-0004）**：bg-fx 结构层的虚拟相机 = canvas `ctx` 的 `scale` + `offset` 变换。随滚动进度在 section 间**连续**推拉（空间穿行感），并缓动追随鼠标做**视差**漂移。纯函数 `cameraFor(scrollProgress, mouse, reducedMotion)` 计算，RM 下鼠标 offset ×0.5。属 scroll-*linked*（原生滚动驱动、不劫持），非 scroll-jacking。_Avoid_: 振幅推入空区致糊、与内容层抢焦点（scrim 仍居上）。
  - **dual-core glow（双芯辉光）**：本站**发光类元素的统一语言** —— `--gb-3` 白热亮芯（1 个像素阶）+ `--gb-2` 强调色磷光晕（踏阶方块同心叠加，分中/外两级）。首次定稿于 page transition 的「双芯光束」（白热亮芯 + 强调色磷光晕），后复用至 BgFx core 的电流（信号包本体 + 被它点亮的走线段），解决「SMS Surf 蓝主题下电流蓝压走线蓝、事件不可辨」。物理原型 = 铜箔通电暗处可见的磷光晕；不引第五色（白热芯取自四色内 --gb-3）。_Avoid_: canvas `filter: blur()` / `shadowBlur` 辉光（糊化，破像素语言与 steps() 踏阶）、引入 --gb-2 之外的第五色、抗锯齿渐变边缘、把辉光铺到常态静默的结构线上（辉光是事件语言，非常态装饰）。
  - **white-core gate（白芯门控）**：双芯辉光的出现阈值 —— **只有磷光余辉 `lit > 0.85` 才允许出白热芯**，低于该值只出两级 `--gb-2` 蓝晕。存在的唯一理由：把「常态流动的单个信号包」（`traceLit` 峰值 0.92）与「整板冲亮仪式」（开机仪式 boost 峰值 0.7 / Konami 0.9 / 主题再调谐 0.5）区分开，防止 2.5s 开机仪式变成「整板白热」抢首屏。纯函数 `coreGlow()` 落 `bgfx-motion.ts`，由单测锁死。_Avoid_: 无门控全量套用、把阈值写死进 BgFx 绘制分支（脱离单测即失去回归防线）、为简化而取消门控。
  - **scrim compensation（抗压缩补偿）**：辉光层在被 72% 可读性 scrim 压过的区域（blog / 文章 / 首页首屏以下）**额外补一级绘制**，使其在压暗后仍可辨。沿用既有的非 vivid 补偿描边机制（同族手法）。前置铁律：可读性 scrim 的 72% 是**不可让的契约**，补偿只在绘制侧做加法。_Avoid_: 为让辉光可见去下调 scrim 百分比、在 hero 免遮区重复补偿（会过曝）。
- **easter egg（彩蛋，v2）**：Konami 密码（↑↑↓↓←→←→BA）触发全屏像素爆裂 + 提示 toast，可重复触发；零依赖、装饰性。
- **cursor-fx（自定义光标装置，v2）**：桌面级三层一体鼠标效果——像素光标（五种形态循环切换：frame 框选默认 / dot 单点 / block 方块 / cross 全屏十字线 / reticle 十字括号；悬停按状态放大）+ 光屑尾迹（主题色 additive 辉光）+ 点击脉冲环；随 13 套主题变色，touch 设备跳过，reduced-motion 退化为静态光标；偏好 '8bitme:cursor' 存形态而非开关。运行底层：fx runtime。
- **fx runtime（特效运行时，canvas fx runtime）**：BgFx / CursorFx 两类 canvas 特效的共享底层——palette 适配（从 `--gb-*` 读色、hex→rgba、暗度判定）＋ 画布运行骨架（dpr ≤1.5 clamp、resize、`data-theme` MutationObserver 跟随、visibilitychange 启停节流）；**additive 门控 = 背景色 --gb-0 亮度 < 128**（浅色主题退回 source-over 防洗白）。落于 `src/lib/palette.ts`（纯函数）与 `src/lib/fx-runtime.ts`（近纯控制器）；宿主特效组件只声明 draw 步 + 粒子状态。_Avoid_: 各特效组件自带一份取色/暗度判定/观察者（CursorFx 曾用 isDark(accent) 门控、与 bg 判定漂移一次）、全量提取（只提取稳定共享层）。
- **404 mini-game（像素打地鼠，v2）**：404 页内置 20 秒点击打地鼠小游戏，计分 + 最佳纪录（localStorage 键 `8bitme:404best`）。
- **reveal animation（进入动画）**：index 页非 hero section 随滚动分块进场（像素级 steps 过渡）；reduced-motion 下恒可见。
- **page transition（CRT 光束扫屏，v3）**：站内页面跳转的全屏幕帘转场——劫持内部链接播放出场幕帘 → 跳转 → 新页入场揭示。v3 为**单一签名形态**：**光束永远向下扫**——出场（关机）深色幕布锚顶 0→满、光束贴下缘先行压暗；入场（开机）幕布锚底 满→0、光束贴上缘随扫点亮新页。视觉语言：**恒定暗场** = 幕布恒为深底（取当前主题 --gb-0 暗化，不随浅色主题变浅）——13 主题统一「关机黑屏」读感；**双芯光束** = 白热亮芯 + 强调色磷光晕（--gb-2 派生）；**尾迹** = 磷光余晖拖影（时间残留），已否决不加。运动 = WAAPI steps() 整齿阶跃（**齿高 16px**，高度恒为齿的整数倍 = 永远对格）；**变齿速率** = 出先慢后快（慢起加速盖满）、入先快后慢（快起减速揭幕），分段 keyframe 每段整齿对格；匀齿（uniform）保留为候选。时长 出 0.34s / 入 0.28s；覆盖因子 1.3（横竖屏切换中段不露缝）；极小屏按屏高缩齿钳制。收尾干净停住，零闪烁。访客 reduced-motion 恒播不区分（无分级降级）。全站常播、无开关 UI、无偏好键。演变：v2 的 ZOOM / ZIP / CLAMP / TEAR / SWEEP 五形态与黄线主轴支点已废弃。_Avoid_: 黄线主轴转场、形态循环按钮、`8bitme:trans` 偏好、负片闪/横抖/推镜/平滑缓动、抖色棋盘纹理（布料感）、光束尾迹（拖影）。灵感锚点：CRT 显像管开机/关机光束。

## 内容（content）

- **post（文章）**：博客内容单元，Markdown 文件存于 git 仓库（Markdown content pipeline），无 headless CMS。
- **post schema**：post 的 frontmatter 字段 —— `title` / `date` / `description` / `tags` / `cover` / `draft`。
- **cover（封面）**：post 的像素风封面（sprite / emoji / 自动生成），非必需。双角色：列表页为可点击拇指图（md 档，随卡网格 6rem 列）；单篇页头部为承接侧标（lg 档，与 md 同尺寸 6rem——「点过的图在目的地同尺寸再现」，装饰性 aria-hidden，不占标题支配位）。
- **site copy（站点文案）**：界面可见文案的代称，含首页五 section（tagline / meta description / hero intro / about / skills 脚注 / contact 引导语）与 blog 空态、404 说明等。与文章正文相对；「文字内容」的规范拆法 = site copy × post content。
- **post content（文章内容）**：博客正文（Markdown 源），与 site copy 相对。

## 像素排版与写作（pixel typography & writing）

- **pixel typography（像素排版）**：像素字体（Zpix）下正文排版的约束体系——字号阶梯、行宽、行距需按像素阶对格，中英混排与行内元素（加粗/代码/列表）的呈现规则。与写作层（内容写法）为两层，共同决定文章可读性（readability）：写作层定下限、排版层定上限，两层都管。

## 语言与链接

- **站内语言**：文案中文为主，专业术语保留英文。
- **内容脱敏（de-identified methodology）**：工作产物上公开站的呈现规范——去客户名/数据/代码细节，保留流程/架构/能力证据。_Avoid_: 公开客户与数据。

## 测试（testing）

- **automated test（自动化测试）**：npm 本地脚本驱动的回归防线，两端面——e2e 冒烟（Playwright × 系统 Chrome，免下载浏览器）与按需单元（Vitest × 可 import 纯模块）。部署前以流程约定保证全绿。**分工**：私有工作仓跑本地全链（含 e2e 人工验收）；公开仓 CI 跑 `typecheck` + `test:unit` + `build` 作质量门（badge），e2e 因依赖系统 Chrome 不进 CI。_Avoid_: 部署时自动构建跑测试、e2e 进 CI。
- **e2e smoke（e2e 冒烟）**：最小端到端防线——四条路由（`/` `/blog` `/blog/[slug]` `/404`）渲染 200 + 控制台零 JS 报错（`console.error` / `pageerror` 计数为 0）。_Avoid_: 首版铺深交互（主题切换/彩蛋/深动画）。
- **transition e2e（转场 e2e）**：完整转场链路的 e2e 用例——点站内链接 → CRT 幕布宿主出现 → URL 变更 → 新页幕布清除；证明转场 DOM 链路存活。与「数学单测（逻辑等价）+ 作者视觉验收（观感）」三层互补。_Avoid_: 只靠数学单测/人工验收不测 DOM、把转场视觉交给无自动化防线。
- **npm test 时长预算（1–3 分钟）**：`npm test` 全量运行上限；MVP 冒烟 ≤1.5min，余量留给第二阶段单元。
- **extract-for-testability（提取重构）**：把 .astro 内联 script 里的纯逻辑抽到 `src/lib` 供单测的结构性重构（行为不变，仅移动）。_Avoid_: 全量提取、为测试重写组件。

## 部署与开源形态

- **public snapshot / curated mirror（公共快照·精选镜像，ADR-0009）**：源码以**精选白名单快照**形式公开于 GitHub（`Matt-qwq/8bit-me`，MIT）；原始工作仓改名 `8bit-me-private` 保持私有日常开发。公开仓只含脱敏内容（代码/测试/精选文档/站点内容/字体），不含个人与运营文件；历史为全新根提交（不携带私有提交历史）。同步走 `sync-public.sh` 白名单整仓覆盖，节奏由作者控制（**不可逆发布须人显式触发**，不用 CI 自动推）。此条目取代早期「源码私有·站点公开」决策（ADR-0001）。
- **Netlify deploy**：静态产物托管于 Netlify，构建连接 GitHub 私有工作仓；替代 GitHub Pages（其免费档强制仓库 public，与私有仓冲突）。_Avoid_：Cloudflare Pages、GitHub Pages、Vercel（国内直连不可达）。
- **production URL**：`https://8bit-me.netlify.app/`（Netlify 上构建/部署/环境变量通过 Netlify API 自动化）。