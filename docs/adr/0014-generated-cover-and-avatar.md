# ADR-0014：生成式封面像素图 + hero 终端头像 v2

- 日期：2026-09-08
- 状态：已落地（Phase 2 / Phase 3），**待作者本地观感验收**
- 相关：ADR-0004（机器叙事）、ADR-0006（导航猫 GIF，被本 ADR 影响其「CatSprite 去留」）、`docs/specs/line-hierarchy.md`、`docs/specs/visual-acceptance-matrix.md`

## 背景 / 问题

两处视觉面停在 v1：

1. **封面**：18 篇文章的 `cover` 是 emoji 字符串，`CoverBlock` 渲染成文本 `.cover-glyph`。emoji 由系统字体渲染——**不随 13 套主题变色、不是像素语言、不同平台字形不同**；且 `.cover-glyph` 在列表 1.75rem、单篇 2rem，本身就与「同尺寸再现」的意图打架。
2. **头像**：hero 区是 12×15 的占位字符画，页面上直接写着「avatar sprite v1」；且 `* { box-sizing: border-box }` 让 4px 边框把 112px 吃成 104px 内容宽 = **每格 6.5px**，`crispEdges` 下出杂色。

## 一、前置调研（AGENTS 铁律：读了什么原则 → 为何适用于本任务）

| 来源（实读） | 原则 | 落点 |
|---|---|---|
| `docs/research/pixel-typography-readability.md` A2.6 / B3 | 字号必须落 12px 格 | `.cover-glyph` 1.75rem / 2rem 一并删除（元素被像素图取代） |
| `pixel-cat-craft-2026.md` §6.1 | **渲染尺寸必须是网格宽度的整数倍**，否则亚像素花格 | 头像 16 列 × 7px = 112px；封面 16 格 × 5.5px（封面盒受限，见风险） |
| `ap-motion-vocab`（裁剪版） | 一个产品一个种子；禁第三方库；禁经此加无限循环 | 封面/头像**零动画**、零依赖；算法自实现 |
| `animation-principles`（continuous-infinite） | 「invisible by design」；不抢主拍 | 头像静态；封面静态；不给封面加呼吸/闪烁 |
| ADR-0004 | 纯抽象机器叙事，不画具象人脸 | 头像 = CRT 显示器，不画脸 |
| ADR-0012 实测 | `--gb-2` vs `--gb-3` 在 7/13 套主题低于 2:1 | 封面两级配色的已知上限（见风险 1） |

## 二、媒介转换前置检查（五步）

### 封面

1. **线元素盘点**：封面盒 4px 边框、四角 `.pp-pad`、内部字形、`COVER` 丝印。
2. **功能**：盒 = 容器边界；角点 = 铭牌定位点；字形 = 「这篇的视觉指纹」；丝印 = 说明文字。
3. **同构媒介**：冲压铭牌 + 铭牌上的**打孔矩阵图案**（如工业铭牌冲孔编码 / PCB 丝印矩阵）。
4. **重映射**：字形 → **16×16 打孔矩阵**（两条 `<path>` 而不是 256 个 `<rect>`）；`COVER` 丝印 → **删除**（图案已自证是封面，且丝印占 24px 会破坏同尺寸再现）。
5. **可读性**：图案对盒底最低对比 `--gb-2` vs `--gb-0` = 4.02:1（dawnbringer-ember 最差），全主题可辨。

**自我否定三问**：① 氛围来自背景？**否**（图案是封面盒内的 UI 本体）。② 移除背景仍有结构感？**是**（4px 边框 + 四角点 + 图案独立成立）。③ 独立表意？**是**（图案 = 该篇的确定性指纹，同篇两处必相同）。→ 通过。

### 头像

1. **线元素盘点**：4px 边框、4/8 两阶 chip 阴影、内部字形。
2. **功能**：边框 = 构件边界；阴影 = 立体；字形 = 身份符号。
3. **同构媒介**：**CRT 显示器 / 终端机**（与 BgFx 机箱核心同族）。
4. **重映射**：字形 → 外壳 bezel → 1px `--gb-3` 内唇围出的内凹屏幕 → 示波器波形 + 方块光标 → chin 上 accent 电源灯。**不加 `.pp-pad`**（那是铭牌语言，显示器不是铭牌——媒介不混用）。
5. **可读性**：`--gb-0` vs `--gb-1` 在 13 套主题仅 1.06–1.95:1，故网格里 **`0` 与 `1` 永不邻接**，屏幕与外壳永远隔一层 `--gb-3` 内唇（`0-3` = 6.02–18.31:1）。

**自我否定三问**：① 氛围来自背景？**否**。② 移除背景仍有结构感？**是**（bezel/内唇/屏幕三段结构）。③ 独立表意？**是**（显示器 = 「这台机器在跑什么」）。→ 通过。

## 三、裁决

### 封面：确定性生成（`src/lib/cover-art.ts`）

| 项 | 决定 |
|---|---|
| 算法 | FNV-1a 32 位哈希 → 两路 xorshift32（`:fill` 定填充、`:ink` 定配色） |
| 网格 | 16×16，**水平镜像对称**（只生成左半 8 列） |
| 密度 | 25%–40%；越界用确定性洗牌顺序翻转，**不做重试循环** |
| 配色 | 填充格按 ~30% 分 `a`（`--gb-2`）/ `l`（`--gb-3`），强制各 ≥1 |
| seed | `post.id:cover` —— **沿用 emoji 字段做盐**，schema / frontmatter 零迁移；两篇同 emoji 也因 slug 不同而不同 |
| 渲染 | `CoverBlock` 输出两条 `<path>`，`viewBox 0 0 16 16`、`shape-rendering="crispEdges"`、`aria-hidden` |
| 禁止 | `Math.random` / `Date` / `process.env`（构建期 SSR 必须可复现，否则每次构建封面都在跳） |

### 头像：手绘 16×20 CRT 终端

- 四色全走 `--gb-0..3`；静态；不画脸。
- **`svg { box-sizing: content-box }`**：修正全局 `border-box` 导致的 6.5px/格花格（既有缺陷）。
- `size=112` → 7px/格；删除 `figcaption` 与「avatar sprite v1」文案。

## 四、实现要点与防线

- 落地：`src/lib/cover-art.ts`（新增）、`src/components/CoverBlock.astro`、`src/components/AvatarSprite.astro`、`src/pages/blog/{index,[slug]}.astro`（传 `seed`）、`src/styles/global.css`（删 `.cover-glyph`）。
- 防线：
  - `tests/unit/cover-art.spec.ts`：确定性 / 对称 / 密度 / 字符集 / 18 篇互异 / 源码禁 `Math.random`。
  - `tests/e2e/cover.spec.ts`：列表与单篇 `path d` 全等 + **图案同尺寸**（列表不再渲染 COVER 丝印）+ 切主题 fill 真变 + 每张 ≤2 条 path。
  - `tests/unit/avatar-sprite.spec.ts`：网格 16×20 / 图例字符 / 不透明 ≥120 / 零字面量颜色 / content-box 门禁 / 占位文案清零。
  - `tests/e2e/avatar.spec.ts`：rect ≥120 + 主题跟随 + `figcaption` 为 0。

## 五、已知代价与风险

| 代价/风险 | 说明 | 缓解 |
|---|---|---|
| 两级配色在 7/13 主题近单色 | `--gb-2` vs `--gb-3` 最低 1.20（gb-green）；图案会退化成单色块观感 | 图案对底色仍 ≥4.02:1，形状可辨；要彻底解决需改主题色（不做） |
| 图案同质 | PRNG + 镜像 = identicon 式散点，无「构图」 | 调参入口集中在 `FILL_P`（0.32）与镜像规则；观感不满意可改密度或加粗网格 |
| 列表页 HTML 变重 | `/blog` raw 44→61.7KB（gzip +2.5KB） | 可接受；文章量翻倍后再考虑构建期共享/`<use>` |
| 封面图案非整数缩放 | 单篇 88px / 16 格 = 5.5px/格 | 截图未发现糊；要整数可把图案封顶 64px（牺牲填充率） |
| 头像变宽 | `content-box` 让整体从 112×140 变 120×148 | 375px 未溢出；观感需作者确认 |
| 浅色主题「反相」 | `nes-punch`/`inkpaper` 里 `--gb-3` 最深、`--gb-0` 最浅 → 深 bezel + 浅屏 | 调色板决定的观感，非 bug；作者可判 |
| ~~图案同质~~ | **v3 已解决**：v2 的「PRNG + 镜像 = identicon 式散点」已由轮廓 / 剪影型替代（孤立单点 312 → 0、结构指数 0.17 → 0.86） | 不再靠调密度缓解；换语法见 §八 v3 |

## 六、明确不做

- 不做封面手绘 glyph 库（生成式已满足「每篇有指纹」）。
  > **v3 部分推翻**：本条在 v2 时成立（当时只有 PRNG 一途），2026-09-10 改为「每条符号手工画、组合规则由函数派生」——即受控的 glyph 库（18 条，不是每篇一张大图）。**仍然不做**的是「整幅手绘插图」（18 → ∞ 不可维护）。
- 不做封面/头像动画（呼吸职责归导航猫，避免第二循环人格）。
- 不删 `cover` frontmatter 字段（仍是 seed 盐）。
- 不改 13 套主题色值。

## 七、验收

见 `docs/specs/visual-acceptance-matrix.md` §Phase 2 / §Phase 3。门禁：`npm run typecheck` → `npm run test:unit` → `npm run build` → `npm test`。

## 八、演变

- **v1**：emoji 文本封面（`.cover-glyph`）+ 12×15 占位头像（带「avatar sprite v1」文案）。
- **v2（本 ADR）**：生成式像素封面（两条 path、seed 盐、同图同尺寸）+ CRT 终端头像（16×20、content-box 修正）。
- **v3（2026-09-10）**：**封面构图语言换代** —— identicon 噪点矩阵 → **轮廓 / 剪影型**（`src/lib/cover-glyphs.ts` + `src/lib/cover-art.ts`）。头像不变。
  - **动因**：v2 的图案是「差异大 + 无形状」。18 篇实测 **孤立单点 312 个（单片最多 30）/ 最大连通块只占墨迹 0.17 / 墨迹最高 0.383**，读起来像二维码墙（调研：`Random noise isn't memorable`，Arne Niklas Jansson；16×16 图标格的可辨性排序见 `docs/adr` 同批调研报告 §②）。
  - **新语法**：每条符号 = 单一主形 + 2 格粗笔画（96px 下 11px）+ 1 处强调焦点（≤14 格）+ 第 15 行版本跳线；统一家具 = 同 14×13 芯 / 上左 1 格留白 / 第 14 行留空。
  - **数据源**：emoji → 符号表（`GLYPH_BY_EMOJI`，零 frontmatter churn）+ 兜底 + 逐篇覆盖表（`GLYPH_BY_ID`，当前 1 条：两篇共用 🧭 时把「基准 vs 偏移」那篇显式指向 `offset` —— 同符号只靠版本跳线区分时两图只差 2 格 ≈ 0.8% 像素，对相邻两卡近乎同图）。
  - **实测（18 篇 × 13 套主题）**：孤立单点 **0**、结构指数 0.47–0.97、墨迹 [0.133, 0.328]、最像一对 格差 0.074 / ΔRGB>60 0.063（旧值 0.375 / 0.336 —— 差异变小是**预期的**：形状差异取代噪点差异）。
  - **已知取舍**：同 emoji 的两篇若共用符号，靠跳线区分仍偏弱（2 格）；对策写进 `GLYPH_BY_ID` 的注释（撞车时人来挑形状）。强调色在 gb-green 等 7 套主题里仍与浅墨近单色 —— 已按事实设计成**纯焦点**，不承载身份。
  - 守线：`tests/unit/cover-art.spec.ts`（26 条）+ `tests/e2e/cover.spec.ts`（轮廓签名）。改前红 / 改后绿证据：7/10 条硬断言在旧实现下为红（`_scratch/cover-impl/redcheck.mjs`）。
