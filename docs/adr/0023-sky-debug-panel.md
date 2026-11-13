# ADR-0023: 天空调试台（DEV）——天气覆写 + 时间旅行

日期：2026-09-22 状态：已定稿 关联：ADR-0020（窗外世界）

## 背 Compromise
窗外世界的一切由「真实时刻 + 实况天气」驱动。要验一张雨天/深夜/雪后山脊的图，
靠等天亮太慢、改系统时钟太脏。作者要一个调试模式：**能切天气、能切时间**。

## 决策
- **入口**：SideDock 第 5 个 toggle「DEV」（默认关；关掉时逐像素等于没有它）。
  开启后显示调试子面板：
  - **天气行**：一键循环 实况 → 晴 → 疏云 → 阴 → 雾 → 毛毛雨 → 中雨 → 雪 → 雷暴 → 实况；
  - **时间行**：`-1H / +1H / 归零` + 偏移读数（`实况 / ±NH`）。
- **纯逻辑**（`src/lib/debug.ts`）：`wxDebugOn`（`8bitme:wxdebug`）、
  `wxDebugKind`（`8bitme:wx-kind`，脏数据→null）、`clockOffsetMs`（`8bitme:clock-offset`，
  写盘对齐整分钟）、`debugNow()` = 真实时钟 + 偏移、
  `debugWeatherKind(live)` = 开且覆写有效→覆写，否则跟实况（live null→clear）、
  `wxDebugCycleNext()` 纯函数守环序。
- **全链同源**：BgFx 的 `skyMoment` / `moonPhase` 与 Hero 的 LOCAL 读数**统一走
  `debugNow()`**——画面、月相、读数永远同一时刻，不会一边快进一边装睡；
  auto 配色模式随调试时刻的太阳高度换档（拨到深夜房间跟着入夜，是特性不是 bug）。
- **天气覆写即时生效**：SideDock 派发 `8bit:wx-debug`，BgFx 重算
  `applyWx(debugWeatherKind(liveKind))`（重播种云与粒子）；环境音跟着 fx 自动跟随。
  `8bit:clock-debug` 让 Hero 立即重刷时刻（BgFx 下一帧自然读 debugNow）。
- **记忆与开关解耦**：关 DEV 只是失效，覆写/偏移仍在，再开接着调。

## 后果
- 访客默认零感知（入口藏在设置仓、默认关）。
- e2e 用 `page.clock.setFixedTime` 钉假时钟而非真实时刻——日弧/夜弧顶点邻域
  `|ΔsunAlt(1h)|` 可低到 0.0005，真实时刻跑会静默假绿（子代理实抓）。
- 字体子集含新字（实/况/归/零/※）。

## 附录（2026-09-25）：DEV 入口改为**只在 DEV 构建存在**

作者裁决：「不要把 dev 功能上线」。本 ADR 原文的「入口常驻但默认不生效」作废：

- `SideDock` 的 DEV 开关与子面板整体挂在 `import.meta.env.DEV` 门下（**模板不渲染 + 脚本不接线**
  双门）——生产 dist 的 HTML 里连 id 都不存在，不是靠 CSS 藏。
- 调试**机制**不变（键名/归一/事件仍是 `src/lib/debug.ts`）：作者本地改值直接写
  `8bitme:wxdebug` / `8bitme:wx-kind` / `8bitme:clock-offset`，无需 UI。
- 守卫：`tests/e2e/debug.spec.ts` 断言生产 SSR HTML 与 DOM 都不含 DEV 节点，
  并在无 UI 的前提下用同样的键复验天气覆写与时间旅行（判据与画面同源）。
