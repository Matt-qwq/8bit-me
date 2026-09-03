# 方案：自动化测试防线 v1（被推敲透的方案）

> 来源：grill-with-docs-cn 轮次制质询（2026-08 作者两轮问答定稿）。主产物 = 本方案；术语已入 CONTEXT.md（测试/testing 节）；ADR 判定见文末。
> 状态：**决策已共享待确认，未授权不写实现代码**。

## 0. 一句话

给 8bit-me 立一条**纯本地、手动 `npm test`、不进 CI/不触 Netlify** 的自动化回归防线：先 e2e 冒烟（Playwright + 系统 Chrome）把「页面能开、控制台不炸」钉死，再按「出过 bug 模块优先」逐步抽纯逻辑补单元（Vitest）。

## 1. 决策记录（Round 1–2 作者逐题拍板）

| # | 决策点 | 定稿 | 备选（被否/后补） |
|---|---|---|---|
| R1-Q1 | 防什么 | **A+B+C+D 全要**，按成本分层实现 | – |
| R1-Q2 | 跑在哪 | **A 纯本地 npm script**（`npm test` 手动跑） | B GitHub Actions 后补候选 · C 只要 CI 否 |
| R1-Q3 | 层级 | **C 两层都要分阶段**：先 e2e 冒烟，后按需单元 | A 单元优先否（要动组件）· B 纯 e2e 否 |
| R2-Q1 | 冒烟 MVP | **仅 A 全路由渲染 + 控制台零报错**（四路由 `200` + `console.error`/`pageerror` 计数 0） | B 主题系统 · C 转场导航 · D 彩蛋/深交互 —— 全部后补 |
| R2-Q2 | 门禁 | **A 流程约定**：部署前 `npm test` 全绿，写进 开发流程文档 部署铁律 | B 脚本自动前置（等测试稳定再谈）· C 纯诊断否 |
| R2-Q3 | 时长预算 | **B 全量 1–3 分钟**（MVP 冒烟 ≤1.5min） | A <1min · C 无所谓 |

## 2. 架构（实现层，归 agent 定）

- **e2e**：`@playwright/test` + 系统 Chrome（`channel: 'chrome'`，路径已确认存在），**免下载浏览器**（避免 ~300MB 安装与墙内下载风险）。
- **测试对象**：`npm run preview`（dist 产物）——最贴近上线物；preview 由 playwright `webServer` 拉起，端口从 4322 起向后扫（`scripts/astro-port.mjs`，避开常跑的 dev 与 Windows 排除端口段——4322 曾落在 Hyper-V 保留段导致 EACCES）。
- **test 脚本**：`"test": "npm run build && playwright test"`（build 前置 = 复用现有门禁；dev 循环可 `playwright test` 快路径）。
- **单测（第二阶段）**：Vitest（TS 原生），测**可 import 纯模块**（`themes` / `prefs` / `sfx` / `posts` / `config`）+ 后续提取的模块。
- **目录**：`tests/e2e/*.spec.ts`；提取逻辑进 `src/lib/`。
- **新增依赖**：仅 devDependencies（`@playwright/test` 起步；`vitest` 第二阶段装），不引入任何运行时依赖。

## 3. 证据引用（每条关键主张都有出处；凭断言即打回）

| 主张 | 证据 |
|---|---|
| 项目无任何测试脚本 | `package.json:7-13`（scripts 仅有 dev/sync/typecheck/build/preview/astro） |
| 无测试依赖 | `package-lock.json` grep `vitest|playwright|jest|@playwright|happy-dom|jsdom` 空（本会话已查） |
| 无 CI | `.github` 不存在（`ls -a` 已查） |
| 唯一门禁 = typecheck + build | `package.json:11-12`；`netlify.toml:6`（build command = `npm run typecheck && npm run build`） |
| post schema 由 Zod 在 sync/build 校验 | `src/content.config.ts:8-29` |
| 可被单测直接 import 的纯模块仅 5 个 | `src/lib/`（themes 109 行 / prefs 110 / sfx 85 / posts 23 / config 101，共 428 行，`wc -l` 已查） |
| 主要交互逻辑埋在组件内联 script | `src/components/` 14 个含 `<script>` 组件；PageTrans 齿格/光束常量与算法在 `PageTrans.astro:30-121` |
| 路由仅 4 个 | `src/pages/`：`index.astro` / `404.astro` / `blog/index.astro` / `blog/[slug].astro` |
| 系统 Chrome / Edge 可用作 Playwright channel | `/c/Program Files/Google/Chrome/Application/chrome.exe` 与 Edge 路径存在（已查）；npm registry 直连可取 playwright 1.62.1 |
| 部署铁律 = 本地验收 → typecheck+build 全绿 → 手动 CLI 部署 | `开发流程文档`（Development flow）；`历史交接文档` 剩余事项 |

## 4. 风险表

| 风险 | 应对/缓解 | 回滚路线 |
|---|---|---|
| 系统 Chrome 版本漂移致 e2e 偶发失败 | channel 钉 `chrome`；偶发失败人工复核后再重跑；长期不稳再换 Playwright bundled chromium（一次性下载成本） | 删 devDeps + 删 tests + 还原 开发流程文档 一行即全回滚 |
| preview 未构建导致误测 | `npm test` 前置 `npm run build`；webServer 指向 `npm run preview` | 同上 |
| 控制台警告（autoplay/隐私模式等非 error）被误判失败 | 断言只 fail on `console.error` / `pageerror`；warning 记日志不 fail，配白名单可扩展 | 同上 |
| dev 循环每次 build +15~20s | 预算 1–3min 内可容纳；提供 `--skip-build` 快路径 | 同上 |
| 作者常在跑 dev(4321)，端口冲突 | preview 从 4322 起自动后移（扫描器，见 playwright.config.ts） | 同上 |
| 测试设施破坏现有 typecheck 门禁 | 验证清单第 1 项强制保持全绿；playwright 测试文件 tsconfig 归属明确（排除或纳入二选一，落地时定） | 同上 |
| Windows 排除端口段（Hyper-V/WSL 保留，如 4239–4338 曾吞掉 4321/4322）致 EACCES 硬崩 | dev/preview/playwright 统一走 `scripts/astro-port.mjs` 先绑定探测再起服（2026-09-03 修复） | 同上 |
| 探针 `scripts/cdn-*.mjs` 与新 e2e 重复 | 本方案**不删**；待后补交互用例覆盖对应场景后再清理 | 保留即安全 |

## 5. 验证清单（可勾验，先实现后逐项勾）

- [x] `npm run typecheck && npm run build` 在测试设施加入后**保持全绿**（2026-08-29 落地后复跑：typecheck ✓ build ✓ 10 页）
- [x] `npm test`（e2e 冒烟）全绿 ≤1.5min（实测 **5.5s**），5 用例 = 首页/列表/文章/`/404`直达/未知路径回退，`console.error`/`pageerror` 计数 0
- [x] **杀毒试验**：向 Nav.astro 注入 `console.error('poison-test…')` → `npm test` **5/5 全红**且每条抓到 poison 文本；撤回 → 复绿（防线真实有效，非恒绿假防线）
- [x] 开发流程文档 部署铁律已加第 3 步「`npm test` 全绿」（流程约定，非脚本拦截）
- [x] 新增依赖全部在 `devDependencies`（仅 `@playwright/test`），运行时依赖零新增
- [x] CONTEXT.md「测试/testing」术语节已写入
- [x] `.gitignore` 已排除 `/test-results/` `/playwright-report/` `/playwright/.cache/`

**落地时修正的两个实况**（校验清单字面应贴近现实，否则防线会误报）：
1. **404 状态**：静态托管对 404 页常回 404 状态（内容仍渲染），断言状态放宽为 `[200,404]` + heading 断言；`/404` 直达与未知路径两用例分开写。
2. **404 资源日志**：Chrome 对 404 响应自动记一条 `Failed to load resource: 404`——属导航结构性产物非 JS 报错，未知路径用例用 `ignoreConsoleError` 精确放行，其余任何 console.error 照抓。
3. **`npx playwright test` 不 rebuild**：只测现状 dist（本次杀毒第一次就因此没红）；必须走 `npm test`（= build 前置）才能测到新代码。

### P2 验证清单（2026-08-29 定稿，先实现后逐项勾）

- [x] `npm test` 全链 = `vitest run` + build + e2e 全绿，总时长 ~10s（unit 42 用例 + e2e 6 用例）
- [x] **unit 杀毒**：篡改 formatDate 期望 → vitest 精确变红（指出错误值）；撤回 → 复绿（unit 层真实有效）
- [x] trans-math 单测覆盖：对格（`hFull % t === 0`）、全覆盖视口（≥H）、偏离名义覆盖 ≤ 半齿、极小屏钳制（≤min(16, max(8, H/24))）、光束 8px 封底、步数守恒（`nA + nB === steps` 且 `nA ≥ 1`）、变齿方向（出前段 35% 齿 / 入前段 65% 齿）、steps=1 单段回退
- [x] 转场 e2e：点站内链接 → `#ptrans-host .crt-curtain` 出现 → URL 变更 → 新页幕布清除，全程零 console.error（2.4s）
- [ ] 提取后**作者本地预览验收**转场观感（开发流程文档 铁律，P2-B 完成条件）——待作者预览

**P2 落地发现与修正**（均记入本方案）：
1. **覆盖因子对齐偏差**：`Math.round` 对齐齿网格后，hFull 可比名义 1.3× 少最多半齿（H=768 → 992 vs 名义 998），非 bug（08-28 验收定稿的 round 行为），断言改为「≥ 视口高 + 偏离 ≤ 半齿」。
2. **astro:content 虚拟模块**：vitest node 环境无法解析，posts.spec 用 `vi.mock('astro:content')` 拦截；顺带把 `getPublishedPosts`（draft 过滤 + 日期倒序）纳入内容完整性测试。
3. **`CollectionEntry` 无 `slug` 字段**（是 `id`）：typecheck 门禁拦住了错误用法（这就是测试写错会被门禁抓的活例）。

### P4 验证清单（2026-08-29，导航与内链防线）

- [x] **改前红**：新写的 `nav-links.spec.ts` 在修 bug 前失败 **5 条**（`/blog`、文章页、`/404` 锚点断裂 + 跨页跳转失效 + 1 条用例自身写错）——防线真实有效，非恒绿假防线
- [x] **改后绿**：`Nav.astro` 改为「首页纯锚点 / 非首页降级为 `/#anchor`」后，7 条全绿（8.1s）
- [x] **单测杀毒**：把 `config.ts` 的 `#hero` 篡改 `#heroo` → `nav-contract.spec.ts` 立刻红，失败信息可直接定位（「nav '首页' 指向 #heroo，但首页没有这个 section id」）；撤回 → 复绿
- [x] **契约单测零浏览器**：4 条用例 ~20ms，用 `node:fs` + 正则解析 `.astro`/`.md`，零新增依赖
- [x] **主动发现的第二个 bug（防线的真正价值）**：`toggles.spec.ts` 的 SSR 首帧断言抓到 —— `BgFx.astro` 写死 `STARS` 且 `aria-pressed="true"` / `aria-label="背景特效：星尘浮游"`，与 `DEFAULT_MODE='off'` 完全相反；`CursorFx.astro` 写死 `CURSOR` 而默认形态是 `frame`。访客在 JS 执行前会看到误导标签。已修 → 6 条全绿
- [x] **开关三态一致**：CRT / SFX / Cursor / BgFx / 主题切换，各断言「状态翻转 + `8bitme:*` 落盘 + reload 复现」三件事，共 6 条用例
- [x] `npm run typecheck` / `build` 保持全绿；`npm test` 拆层后仍一条命令跑全链
- [x] 全量：单测 108（+4）· e2e 36（+13）· 总时长 ~33s，在 1–3 分钟预算内

## 6. 明确不做（防随手扩范围）

- 首版 e2e **不测**主题切换/彩蛋/bgfx 深交互（冒烟仅渲染 + 零报错；R2-Q1 作者只勾了 A）。**已修订（P2，2026-08-29）**：转场 e2e 随 PageTrans 提取一并补入（作者 P2-R2-Q1 拍板提前）；主题/彩蛋/bgfx 仍后补
- **已修订（P4，2026-08-29）**：**导航与内链断言不再后补**，已作为「通用不变量」落地（`tests/e2e/nav-links.spec.ts` + `tests/unit/nav-contract.spec.ts`）。理由见 §7 Phase 4 —— 把交互测试当「按模块排期」是本次漏 bug 的结构性原因，改为「先守住跨模块的通用不变量，再按模块补细节」。主题/彩蛋/404 地鼠的**行为细节**仍属后补，但「开关点了要生效」这类不变量同属 P4 覆盖范围
- **不做 CI**、不碰 GitHub Actions（R1-Q2 已定本地，Actions 只作第二阶段候选）
- 测试**不进** `scripts/部署脚本` 自动拦截（R2-Q2 已定流程约定，等测试稳定再议）
- **不做全量提取重构**（R1-Q3 已定按需抽取；每次抽取动组件文件须单独授权）
- 不引入 jest / cypress / 非系统浏览器下载
- 本轮**不删** `scripts/cdn-*.mjs` 过时探针（保留至后补用例覆盖）

## 7. 实施计划（Phase 1 = 已完成✅；Phase 2 = 本记录；Phase 3 = 后补，另开 grill）

- **Phase 1（2026-08-29 完成）**：Playwright + 系统 Chrome + 5 冒烟用例 + `npm test` + 开发流程文档 铁律第 3 步 + 杀毒试验通过（见 §5）。
- **Phase 2（P2，2026-08-29 定稿，作者 3 问拍板）**：
  1. **A 纯模块单测（零重构）**：Vitest 测 `themes` / `posts(UTC)` / `prefs` / `sfx` / `config`——localStorage 用自写 stub（成功路径）+ node 环境天然失败路径，不加 happy-dom。
  2. **B 提取 PageTrans 齿格算法**（动组件，作者已授权）：抽纯函数到 `src/lib/trans-math`（齿高钳制 / 光束随齿 / hFull 齿网格对格 / 变齿分段 keyframes），组件机械式调用，逻辑零改动。三层回归防线：数学单测（等价）+ **转场 e2e**（DOM 存活）+ **作者本地预览验收**（观感不劣化，开发流程文档 铁律）。
  3. **一条链**：`npm test` = `vitest run && npm run build && playwright test`（开发流程文档 第 3 步自动涵盖 unit）。
- **Phase 3（后补候选）**：cursor/bgfx 白名单提取、主题切换 e2e、彩蛋/404 地鼠深交互 e2e。每项单独 grill。
- **Phase 4（2026-08-29，由真实漏网 bug 触发）**：
  - **触发**：作者手动发现「在 /blog 点导航『首页』(#hero) 跳不过去」——纯锚点 `siteConfig.nav` 被全站挂载的 `Nav.astro` 渲染到没有对应 id 的博客页/404 页，点击静默失效。而 `routes.spec.ts` 只断言「渲染 + 控制台零报错 + 标题文本」，**从不验证点击后的行为**，23 条用例全绿也证明不了导航能用。
  - **根因（结构性，不是缺一条用例）**：
    1. 覆盖模型是「快照式渲染断言」：无 post-action 断言，交互从未发生。
    2. 两层夹缝：`config.spec.ts` 只验形状（`nav.length>=5`），「锚点是否指向真实 id」是跨文件契约，unit 测不到、e2e 没写，谁都不管。
    3. 排期按「模块」而非「不变量」：导航/主题/彩蛋被列进「后补」，于是改 config.nav 时没有任何机制要求补测。
    4. 门禁无覆盖率阈值、漏跑零代价，测试沦为走过场。
  - **对策（三层拦截，均已落地）**：
    1. **L1 静态契约**（`tests/unit/nav-contract.spec.ts`，vitest，~20ms）：nav 锚点 ↔ 首页 section id 集合一致、nav 顺序 ↔ index.astro 挂载顺序、projects[].url 指向真实且非 draft 的文章。**不开浏览器就拦住「引用指向不存在的东西」**。
    2. **L2 通用不变量**（`tests/e2e/nav-links.spec.ts`）：遍历 4 路由，断言每个 `a[href^="#"]` 的 fragment 能在当前 DOM 解析到元素 —— 一次 `$$eval` 堵死整类「锚点/路由漂移」。
    3. **L3 行为生效**（`tests/e2e/toggles.spec.ts` + `nav-links.spec.ts`）：
       - 锚点跳转后目标 section **进入视口**（`toBeInViewport`）。**关键教训：不能用 hash 判定** —— 目标不存在时浏览器仍会写 `location.hash` 并滚到顶部，`waitForURL(/#about/)` 会假绿。
       - **开关三态一致**：一个开关「能用」= ①可视状态翻转 ②`8bitme:*` 落盘 ③reload 复现，缺一即漏网。
       - **SSR 首帧一致**：按钮的 SSR 输出必须与默认模式相符（这条直接抓出第二个 bug）。
  - **基建**：`playwright.config.ts` 加 `trace/screenshot: on-failure`（此前失败只有一句断言文本 + locator 超时，定位成本高）；`package.json` 拆 `test:unit`（~1s）/ `test:e2e`（含 build ~12s），dev 循环跑秒级层。
  - **流程**：开发流程文档 加「变更 → 测试触发表」，把「改什么必须补什么测」从当次自觉变成硬约定。

## 8. ADR 判定

**本轮不写 ADR**。三条件核查：① 难逆转？否——删 devDeps/tests/开发流程文档 一行即回滚，可逆；② 无上下文会惊讶？方案文档 + CONTEXT 术语已记录；③ 真实权衡与备选？有（本地 vs CI / 冒烟 vs 全量 / 系统 Chrome vs bundled），但均为可在方案文档层留痕的可逆选择，未达 ADR 强度。够格才写、不够格不写。