# bg-fx v5 机箱核心：随 section 重组 + 2D 相机推拉（a'）

将 kavindu `pixel-portfolio` 的「scroll 驱动方块重组 + 相机推拉 + 鼠标视差」移植进 8bit-me，
但**不引入 Three.js / GSAP**（站栈为纯 Astro 7 + 2D canvas，分层铁律禁止新增运行时依赖）。
在**已存在的** bg-fx v5「机箱核心（机器叙事）」静态 PCB 之上，扩展出「随 section 重组」的
机器态编排 + 连续 2D 相机 + 鼠标视差。

## 背景 / 问题

- 作者（08-29 调研 handoff）明确点名喜欢 kavindu 的**交互设计 + 顺滑滚动动画**，希望借鉴。
- kavindu 原版：单文件零构建、Three.js r128 + GSAP + ScrollTrigger，50 个 3D 立方体随 section
  重组为人脸/技能条/信封等具象图，相机 z 推拉 + 鼠标视差，纯 CSS 复古氛围。
- 8bit-me 现状：无 Three.js/GSAP；bg-fx v5 核心 `genMachineLayout`（MachineChip/MachineTrace）
  **已是静态 PCB**（停帧即一张设计图），并已有事件响应覆盖层
  （nav汇聚 / 悬停近场 / 主题磷光 / Konami全亮 / click回传）。
- 冲突：照搬 3D 立方体与现有栈 + 分层铁律（运行时控制器只有 fx-runtime/prefs/sfx 三个、
  canvas 组件须共用 fx-runtime、纯逻辑进 `src/lib`）冲突。故须**翻译**而非复制。

## 决策（经 grilling 五轮锁定）

| 维度 | 决定 |
|---|---|
| 落点 | a'：在现有 v5 机箱核心上做 section 重组，**不引入新栈** |
| 范围 | 全部 5 个 section（hero/about/projects/skills/contact）各一机器态子图 |
| 图案语言 | **纯机器态（抽象）**，不画具象人脸/信封；每 section = 机箱一种运行态 |
| 滚动驱动 | **相机连续**推拉（空间穿行感）+ **图案离散 snap** 重组（每 section 形态清晰） |
| 与现有事件层 | section 重组 = **基础几何态**；现有事件响应 = **光照覆盖层**，互不冲突 |
| reduced-motion | 相机连续推拉→按 section **离散跳变**（去连续平滑）+ 鼠标视差振幅 ×0.5；图案 snap 重组保留（延续「降频不冻结」） |

### 5 section 机器态子图（纯抽象，mapping 草案）
- **hero**：待机散板——走线簇松弛铺开、待机灯呼吸，整机 idle。
- **about**：走线汇聚到「人格模块」——若干 trace 收敛到一个中心芯片（自我表征，非具象脸）。
- **projects**：3 个芯片簇——对应三个项目模块在板上分立点亮。
- **skills**：活动总线——若干总线按技能强度点亮成不同宽度的发光走线（技能条概念，机器化）。
- **contact**：对外信号上行——一只信号包沿 trace 流向外缘节点 / 天线焊盘（出站）。

## 视觉设计前置调研（动工前已读，按 开发流程文档 铁律记录）

- **styleseed**（单强调色 / 8px 网格 / 像素语言）：① 单强调色——本站已强制唯一活色 `--gb-2`，
  本特性不引入第二色；② 8px 网格——所有新增芯片/走线坐标须 **8px 量化对齐**（pixel grid）；
  ③ 像素语言——离散变换用 `steps()` 或像素吸附，杜绝亚像素糊化；④ 关键：**scroll-linked ≠
  scroll-jacking**——本站首页属 brand/landing 页，scroll-*linked*（原生滚动驱动相机、不劫持）
  在 styleseed 的 Cinematic tier 明确允许，scroll-*jacking*（劫持速度）仍全站禁止。
- **animation-principles**（Disney 12 + orchestrated moment）：① Slow-In/Out（减速感）= Silk；
  ② Follow-Through/Overlapping（错峰变形）= kavindu 的 `delay:i*0.01~0.02` 错峰；③ Staging
  （焦点）= 现有 scrim 可读性契约；④ Orchestrated moment = 每 section 重组是一次编排时刻，
  复用 `fx-moment.ts` 的「编排 > 散落」纪律（但 section 切换是用户驱动的状态机，不消耗
  自发事件的预算闸）。
- **ap-motion-vocab**（本站运动词汇裁剪版）：① **一个产品一个种子**——本站种子 = **Silk**
  （`cubic-bezier(0.22,0.9,0.24,1)` + 8-bit steps），本特性全部 morph/相机运动统一用 Silk，
  不引入第二种人格；② **禁止第三方动画库（gsap/anime.js）**——印证不引入新栈的决定；
  ③ 注意：ap-motion-vocab 另有「不要通过本站加滚动联动/视差/无限动画」一条，但该条 scoped 于
  其单组件种子/动作职责，且与 bg-fx 既有环境无限循环 + styleseed 的品牌页 scroll-linked 许可
  冲突——**可执行护栏以分层架构 + reduced-motion 为准**，非该 blanket 禁令。已在此记录，防未来读
  者困惑。

## 架构 / 分层落点（严守 开发流程文档 铁律）

- **纯逻辑 `src/lib`**（vitest 目标）：
  - 扩展 `bgfx-motion.ts`：`genMachineLayout(section)` 由单布局升级为 5 个机器态变体
    （或新增 `sectionMotifs` 映射）；新增 `easeSilk(t)`（canvas tween 需 JS easing，非 CSS）
    与 `tweenState(from,to,eased)` 插值（纯、可测）；坐标 8px 量化辅助。
  - 新增（或并入）`cameraFor(scrollProgress, mouse, reducedMotion)`：返回连续 scale + offset
    （parallax），含 RM 半降级分支（纯、可测）。
- **运行时 `fx-runtime.ts`**（仅三个控制器之一）：新增被动滚动监听 → 归一化 section 进度；
  每帧把相机 transform（scale+offset）作为 canvas `ctx` 变换施加到结构层绘制前；鼠标视差
  easing 追随。
- **状态机**：section→phase 映射（复用 index 既有 IntersectionObserver 或新增专用于 bg 的
  observer）；phase 变化触发 chips/traces 从当前态到目标态的**错峰 snap tween**（discrete）。
- **`BgFx.astro`**：只声明 draw 步 + 粒子状态，调用上述 lib；结构层绘制前套相机 transform；
  不写裸编排逻辑。
- **事件响应覆盖层**：nav汇聚 / 悬停近场 / 主题磷光 / Konami全亮 / click回传 **保持不变**，
  作为光照层叠加在基础几何态之上。

## 性能 / 可读性护栏

- dpr ≤1.5、粒子随面积裁剪、标签页隐藏停帧（既有，沿用）。
- 相机 transform 仅一次 `ctx` 变换，开销极低；错峰 tween 复用既有 MachineChip/MachineTrace 数量上限。
- 可读性契约：结构层用线/块（非细粒子），被 72% scrim 压过后仍可辨；相机缩放不得推入空区导致糊。
- 不挂全屏 SVG `feGaussianBlur` glow（kavindu 已知开销点）；磷光用既有 additive（`'lighter'`）辉光。

## 测试触发表（改什么补什么）

- `tests/unit/bgfx-section.spec.ts`（新增）：`genMachineLayout(section)` 对 5 section 返回**互异且
  8px 量化**的目标；`easeSilk` 单调且值域 [0,1]；`tweenState` 插值正确（t=0/1 端点、中段）；
  `cameraFor` 连续 scale 在钳制内、RM 下鼠标 offset ×0.5。
- `tests/e2e/`：滚动穿越各 section 后 bgfx canvas 仍非空采样 + 控制台零报错（相机观感属作者本地验收）。

## 后果

- 不引入 Three.js/GSAP，维持零依赖与分层铁律；栈一致性保住。
- 取得 kavindu 的「顺滑 + 空间感 + 随 section 重组」观感，但用机器叙事语言重写，贴合 8bit-me 人格。
- 工作量：全 5 section + 相机 + 视差，属中大型视觉特性；须走本地 dev 自测 → typecheck/build →
  `npm test` → 作者本地预览确认 → 才部署。
- 风险：相机连续推拉若振幅过大可能损害可读性——以 scrim + 钳制 + 作者预览把关；reduced-motion
  半降级分支须单测覆盖。

## 不在本次范围

- 方向 (b) CursorFx `data-cursor-text` 悬停标签：未做，可后续独立小特性。
- 方向 (c) 调研整理进 docs：kavindu 拆解已在本仓库 handoff/调研文档，未重复搬运。
- 引入真 3D / WebGL：明确否决（违反栈与铁律）。
