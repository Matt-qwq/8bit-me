/**
 * bgfx-motion —— bg-fx 世界（窗外）侧的纯函数层（extract-for-testability）。
 *
 * 2026-09-25：**机箱 core 模式退役**（作者裁决：背景只留 world；core 的机器叙事
 * 绘制/布局/相机/信号包全部删除，连同它的单测）。本模块现在只剩：
 *   ① lightThemeLineFactor —— 浅色主题下的线亮度系数（世界/天气共用）
 *   ② easeSilk / mix —— 点亮仪式（world boot）用的 JS easing 与插值基元
 *   ③ scrimCoverage —— 可读性 scrim 覆盖度（随滚动 0→1，驱动抗压缩补偿）
 * 旧结论仍成立（致未来 WebGPU 迁移）：本模块是「设计规格」层，数值语义可平移，
 * 但渲染模型不迁移，GPU 版视觉需按验收矩阵重新验收，不可「直接迁移直接可用」。
 */

/**
 * 浅色主题绘制系数（theme readout，roadmap P1-5）
 *
 * 背景：additive 门控（`--c-bg` 亮度 < 128）只在**混合模式**上分叉——浅色主题
 * 退回 source-over 后，走线从「发光」变成「实心深色细线」：实测 inkpaper 背景带
 * 最大亮度阶跃 0.447 / nes-punch 0.466，是深色主题（sms-surf 0.308 / gb-green 0.143）
 * 的 1.5–3 倍——即「铅笔线」观感的物理来源。
 *
 * 本函数给出「按底色亮度缩放的不透明度系数」：浅色主题把线压淡（但仍留得住形状），
 * 使亮线不再穿过文字。**不是关掉走线**，而是降一档。
 *
 * 返回值 ∈ [0.5, 1]：
 *   - 底色亮度 ≤ 64（深色）→ 1（不降）
 *   - 底色亮度 ≥ 192（浅色）→ 0.5（降一半）
 *   - 中间线性过渡（避免主题切换时跳变）
 */
export function lightThemeLineFactor(bgLuma: number): number {
  const lo = 64;
  const hi = 192;
  if (bgLuma <= lo) return 1;
  if (bgLuma >= hi) return 0.4;
  return 1 - 0.6 * ((bgLuma - lo) / (hi - lo));
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));


/**
 * Silk easing：cubic-bezier(0.22, 0.9, 0.24, 1) —— 本站唯一运动种子（事实源：docs/specs/motion-vocab.md）。
 * canvas 粒子 tween 需 JS easing（CSS/WAAPI easing 不能直接用于逐粒子）。x∈[0,1] → y，单调。
 */
export function easeSilk(x: number): number {
  const cx = 0.22;
  const cy = 0.9;
  const c2x = 0.24;
  const c2y = 1;
  const bx = (t: number) => 3 * (1 - t) ** 2 * t * cx + 3 * (1 - t) * t ** 2 * c2x + t ** 3;
  const by = (t: number) => 3 * (1 - t) ** 2 * t * cy + 3 * (1 - t) * t ** 2 * c2y + t ** 3;
  const xi = clamp(x, 0, 1);
  let lo = 0;
  let hi = 1;
  let t = xi;
  for (let i = 0; i < 22; i++) {
    t = (lo + hi) / 2;
    if (bx(t) < xi) lo = t;
    else hi = t;
  }
  return by(t);
}

/** 线性插值（tween 基元） */
export function mix(a: number, b: number, e: number): number {
  return a + (b - a) * e;
}

/**
 * 可读性 scrim 覆盖度 0..1 —— 驱动抗压缩补偿的强度。
 * content 模式（blog / 文章 / 404）：scrim 整页覆盖 → 恒 1。
 * hero-vivid 模式（index）：scrim 顶边在 100vh，随滚动从 0 线性升到 1；
 * 线性而非阈值切换，避免翻页到半屏时辉光亮度突跳。
 */
export function scrimCoverage(scrollY: number, viewportH: number, vivid: boolean): number {
  if (!vivid) return 1;
  return clamp(Math.max(0, scrollY) / Math.max(1, viewportH), 0, 1);
}
