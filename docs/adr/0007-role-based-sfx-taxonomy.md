# 0007 - 按角色分音的音效语言（role-based SFX taxonomy + 中央委托）

## 状态
Accepted（2026-09-01，作者 grilling 轮次定稿：全部可交互元素 / 按角色分音 / 主控件小声 hover / 方波家族 + 噪声打击 / 中央委托 + 映射表）

## 背景 / 问题

- 全站按钮此前**几乎全部共用同一个 `playClick`**（880Hz 方波）——dock 5 个 toggle、打地鼠命中全同音。
- 更糟的是**漏接**：导航 4 链接挂着 `data-sfx-nav` 死属性无人监听（`Nav.astro:28/33/41`）、
  主题面板 13 项 + theme-toggle 全静默、404 START 静默；`playHover` / `playNav` 定义了但全站无人调用
  （`src/lib/sfx.ts:62,68`）。根因是逐组件散装接线——10+ 处各写各的，容易漏。
- 站点强调复古芯片音乐美学（chip-tune），但音效侧只有「一种声音」，与「13 主题 / 五模式 bg-fx / 电子感」的
  语言密度不匹配；而视觉层早已按事件分类建好联动（`emitFx`：click→波纹 / nav→扫光 / hover→星火，`sfx.ts:79`）。

## 决策

- **按角色分音**：六类 sound role 各一个专属音效，映射表 `SOUND_ROLES` 落 `src/lib/sfx.ts`（纯数据、可单测）：

  | role | 语义 | 音效 |
  |---|---|---|
  | nav | 站内页面移动（导航/CTA/BACK/博客列表） | 上行双音（沿用 playNav 660→990） |
  | click | 站外链接与普通确认（页脚外链/项目链接/Konami） | 单音方波（沿用 playClick 880Hz） |
  | toggle | 开关翻转（dock trigger / 4 fx toggle / theme-toggle） | 咔哒双音（660→440 下行双短音） |
  | select | 主题选择（13 theme-item） | 上行三连 arp（523→659→784） |
  | game | 打地鼠（命中/START） | 噪声打击（noise burst） |
  | hover | 主控件悬停（dock/主题项/导航/CTA，极小声） | 极短 tick（沿用 playHover 参数） |

- **中央委托 + 映射表**：元素标 `data-sfx-role`（点击/操作角色）与 `data-sfx-hover`（主控件布尔），
  document 级监听分发一次接线全站；`playRole(role)` 为编程接口（Canvas 命中、Konami 等非 DOM 场景直调）。
  全站元素上 `data-sfx-role` 属性值 ⊆ 映射表 keys（跨文件契约，node:fs 快测锁死）。
- **方波家族 + 噪声打击**：保持零音频文件约定（Web Audio 程序化合成，`sfx.ts:1`）；沿用 Game Boy
  硬件真实 4 通道精神——方波为骨（click/toggle/select/nav/hover)、噪声专司打击（game）。
- **门控不变**：`8bitme:sfx` 偏好 + `sfxEnabled()`；`emitFx` 的 `8bit:fx` 视觉联动协议不改。

## 权衡（为何这样）

- **角色分音 vs 同音色音高阶梯 vs 每按钮独有音色**：阶梯（同一方波，操作落不同音高）区分度低、
  仍会腻；每按钮独有（30+ 音色）破坏「一种语言」、用户记不住、维护地狱。角色分音是「语言单元」粒度——
  < 10 类、每类语义可解释、新增按钮 = 标属性而非造音色。
- **中央委托 vs 逐组件接线**：逐组件正是漏接根因（10+ 处手动 `if (sfxEnabled()) playClick()`，
  `SideDock.astro:85/109/136/150/216`）。委托后角色映射收敛为单一纯数据表，单测可锁；
  键盘可达性由 `click` 事件天然覆盖（非 pointerdown）。
- **hover 限定主控件**：全站 hover 出声是刷屏反模式；袖珍复古游戏机菜单光标声是合理传统，
  故只给菜单感控件（dock/主题/导航/CTA）极小声 tick，触屏无 hover 自然豁免。

## 影响 / 验收（按 开发流程文档 流程）

- 新增/改动：`src/lib/sfx.ts`（映射表 + playRole + 委托）、全站组件标 role 并删散装调用、
  `tests/unit/sfx.spec.ts` 扩（映射表完备 + 属性契约）、`tests/e2e/` 增派发断言。
- 审计点：**声音本身 headless 不可断言**，真实听感由作者本地 `npm run dev` audition，人工验收后才可上线。
- 门禁：`npm run typecheck && npm run build && npm test` 全绿。

## 相关

- 术语：`CONTEXT.md`「chip-tune SFX（v1→v3）」「sound role（音效角色）」
- 实现：`src/lib/sfx.ts` / `src/components/SideDock.astro` / `src/components/Nav.astro` / `src/pages/404.astro` / `src/components/Konami.astro`