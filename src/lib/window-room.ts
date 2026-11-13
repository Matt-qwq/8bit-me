/**
 * window-room —— 首屏「一整扇窗」的几何：窗的外缘 = 视口四边，景色是首屏的全部内容。
 *
 * 背景（作者 2026-09-26 裁决，ADR-0027）：**首页是整个窗，hero 挪到下一章**。
 * 此前（ADR-0024）窗是「室内墙上的凹洞」——墙在四边都不贴视口、洞只占视口
 * ~52%×75%、左缘推到 40% 给 hero 文字让位。这一版反转成：**窗占满首屏**
 * （墙厚 0，框外缘贴视口边），站点标题/说明/工位整体下移到下一章 `#hero`。
 *
 * **拆棂观景窗（ADR-0028，2026-10-02 作者批）**：MULLION / MULLION_X / TRANSOM_FRAC
 * 与 WindowSpec 的 transomY / mullion / mullionX 全部退役——分格棂是「铁窗/监狱
 * 隐喻」的几何源头（作者 e72df81 后仍不满意），玻璃连成整块，首屏读作
 * 「装在暖木框里的一整幅夜景」。「这是窗」的语法由**框 + 洞深阶梯 + 窗台**
 * 承担（棂退役是推翻 ADR-0024 的「窗棂是最强窗线索」，0027 的整扇窗语法不动）。
 *
 * 全部纯函数 + 整数输出：同 w/h 必得同几何（可单测、可复现）。
 */

// ---------------- 常量 ----------------

/**
 * 窗几何的唯一数据源。数值分两类：
 * - **固定件**（FRAME / REVEAL / SHADOW / …）：不随视口变，是「这扇窗」的材质。
 * - **比例 + 上下限**（*_FRAC / *_MIN / *_MAX）：随视口走，但钳在合理区间。
 */
export const WINDOW = {
  /** 框宽（画在玻璃之外；要放得下三档剖面：外缘阴影 / 框面 / 内缘受光） */
  FRAME: 18,
  /**
   * 洞内缘受光边宽（兼容字段）：天光打在窗洞侧壁上——没有它洞是一块死黑。
   * 旧 drawWindowFrame 现行绘制直接用它做三边受光条，**语义不改**。
   */
  REVEAL: 3,
  /**
   * 洞深阶梯：index 0 = 贴玻璃（最暗），值为该阶厚度 px，从玻璃向室内。
   * 单色受光条看着像贴纸，逐级变亮的厚度才读作「有进深」。
   * 台阶递减（5 → 4 → 3）模拟近处的洞壁更亮、更薄的视觉透视。
   * 注意：阶梯画在**玻璃之内**（盖住景的边），所以可见景宽 = 洞宽 − 2×depth。
   */
  REVEAL_STEPS: [5, 4, 3] as const,
  /** 框投在景色上的内阴影（像素阶，不用渐变） */
  SHADOW: 8,

  /** 下区（洞底到视口底） = 窗台 + 这道缝；不再留墙脚（首屏整扇窗） */
  BOTTOM_GAP: 4,
  /** 窗台总厚 = clamp(round(h*0.06), 44, 64) */
  SILL_FRAC: 0.06,
  SILL_MIN: 44,
  SILL_MAX: 64,

  /** 桌面 / 窄屏分界（desk-room 与本模块共用；首屏整扇窗后两档几何已统一） */
  NARROW_MAX: 900,
} as const;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

// ---------------- 接口 ----------------

export interface WindowSpec {
  /** 玻璃区：景色被裁进这里，视口绝对坐标（x/y = 左上角） */
  x: number;
  y: number;
  w: number;
  h: number;
  /** 框宽（画在玻璃之外，框的外缘 = 视口边） */
  frame: number;
  /** 窗台总厚（洞底之下；旧绘制直接用） */
  sill: number;
  /** 兼容字段：洞内缘受光边宽 = 3（旧 drawWindowFrame 在用，勿改语义） */
  reveal: number;
  /** 洞深阶梯：index 0 = 贴玻璃（最暗），值为该阶厚度 px；从玻璃向室内 */
  revealSteps: number[];
  /** 框投在景上的内阴影深度 */
  shadow: number;
  /** 四周墙厚：top/side = 0（窗占满首屏），bottom = 窗台 + 一道缝 */
  wall: { top: number; side: number; bottom: number };
}

// ---------------- 几何 ----------------

/**
 * 由视口尺寸解出窗几何。**桌面与窄屏同一套**：窗占满首屏，没有墙，
 * 玻璃内缩 = 框宽（框的外缘正好落在视口边上）。
 *
 * 三件事由此推导，改 FRAME 时全跟着走：
 * - 可见景宽 = 洞宽 − 2×洞深阶梯总厚（阶梯盖在景的边上）；
 * - 窗台在洞底之下，盆栽、小灯与月光带都长在它上面。
 */
export function windowSpec(w: number, h: number): WindowSpec {
  const K = WINDOW;
  const frame = K.FRAME;
  const sill = clamp(Math.round(h * K.SILL_FRAC), K.SILL_MIN, K.SILL_MAX);
  // 下区 = 窗台 + 一道缝（旧口径的「窗台 + 20px 墙脚」是凹洞语法，已随 ADR-0027 退役）
  const bottomZone = sill + K.BOTTOM_GAP;

  const holeX = frame;
  const holeY = frame;
  const holeW = Math.max(2, w - 2 * frame);
  const holeH = Math.max(2, h - bottomZone - holeY);

  return {
    x: holeX,
    y: holeY,
    w: holeW,
    h: holeH,
    frame,
    sill,
    reveal: K.REVEAL,
    revealSteps: [...K.REVEAL_STEPS],
    shadow: K.SHADOW,
    wall: { top: 0, side: 0, bottom: bottomZone },
  };
}
