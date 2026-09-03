/**
 * trans-math —— PageTrans 转场量度（纯函数，零 DOM）
 * P2 提取重构：从 PageTrans.astro 机械式抽出（逻辑零改动，作者已授权；视觉验收另见 开发流程文档）。
 * 单测：tests/unit/trans-math.spec.ts。DOM 构建 / 动画调度 / 链接劫持留在组件。
 */
export const TRANS = {
  /** 齿高（步长）px —— 整齿阶跃单元（08-28 深优验收：细 16） */
  TOOTH: 16,
  /** 覆盖因子：hFull = 1.3×视口高，抗转屏中段露缝 */
  COVER: 1.3,
  /** 光束厚度 px */
  BEAM_H: 10,
  /** 双芯白热亮芯厚度 px */
  CORE_H: 3,
  /** 光束辉光半径 px */
  GLOW: 14,
  /** 出场 ms */
  OUT_DUR: 340,
  /** 入场 ms */
  IN_DUR: 280,
} as const;

export type TransDir = 'out' | 'in';

/** 极小屏钳制：齿高 ≤ min(16, max(8, H/24))，永远整齿对格 */
export function toothForHeight(H: number): number {
  return Math.min(TRANS.TOOTH, Math.max(8, Math.round(H / 24)));
}

/** 光束随齿等比缩放、8px 封底 */
export function beamHeightFor(t: number): number {
  return Math.max(8, Math.round(TRANS.BEAM_H * (t / TRANS.TOOTH)));
}

/** hFull 对齐齿网格：整齿步进、永远对格；×COVER 抗转屏中段露缝 */
export function curtainHeightFor(H: number, t: number): number {
  return Math.max(t, Math.round((H * TRANS.COVER) / t) * t);
}

/** 总步数（恒为 hFull/t 的整齿数） */
export function curtainSteps(hFull: number, t: number): number {
  return Math.round(hFull / t);
}

/** 变齿匝幕 keyframes：两段、每段整齿、总步数守恒（08-28 验收：出慢入快）。
 * 出 = 先慢后快（前 50% 时间走 35% 齿，慢起加速盖满）；入 = 先快后慢（前 50% 走 65% 齿，快起减速揭幕）。 */
export function curtainKeyframes(
  dir: TransDir,
  hFull: number,
  steps: number,
  t: number
): Keyframe[] {
  const start = dir === 'out' ? 0 : hFull;
  const end = dir === 'out' ? hFull : 0;
  const fracA = dir === 'out' ? 0.35 : 0.65;
  const nA = Math.max(1, Math.round(steps * fracA));
  const nB = steps - nA;
  if (nB < 1) {
    return [
      { height: `${start}px`, easing: `steps(${steps})` },
      { height: `${end}px` },
    ];
  }
  const mid = t * (dir === 'out' ? nA : steps - nA);
  return [
    { height: `${start}px`, easing: `steps(${nA})` },
    { height: `${mid}px`, easing: `steps(${nB})` },
    { height: `${end}px` },
  ];
}