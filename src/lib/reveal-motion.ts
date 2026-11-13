/**
 * reveal-motion —— 首页「一镜到底」章节进场编排（纯函数，零 DOM）
 *
 * 方案：docs/plans/home-scroll-reveal-redesign-2026-09.md（候选 A）。
 * 拆掉 fullpage 翻页骨架后，首页回归原生连续滚动；本模块只保留**编排表 + 常量 +
 * 标题扫入齿数计算**，DOM 接线（IO / WAAPI / 视差）住在 src/pages/index.astro。
 *
 * 词汇统一（A4）：标题先行 → 内容 stagger 浮入；Silk easing；**首次揭示后不重放**
 * （Q2：连续滚动下每次进出重放 = 快速滚动闪烁）。
 * 光束 DNA 元素级（A5）：`.section-title` 的 2px accent 下划线用 steps() 整齿扫入，
 * 两段变齿比例沿用 trans-math 的 `curtainKeyframes('in')`（0.65/0.35 快起慢收）。
 *
 * 单测：tests/unit/reveal-motion.spec.ts。
 */
import { TRANS } from './trans-math';

export const REVEAL = {
  /** 单元素入场时长 ms（A4：460 → 380） */
  DUR: 380,
  /** 错峰步长 ms（A4：85 → 60） */
  STAGGER: 60,
  /** 入场幅度 px（A4：30 → 12） */
  DIST: 12,
  /** IO 触发阈值（A4：0.55 → 0.2，连续滚动早触发，避免空窗） */
  THRESHOLD: 0.2,
  /** 单一运动种子 Silk（事实源：docs/specs/motion-vocab.md），与打字机/hero-rise 同族 */
  EASING: 'cubic-bezier(0.22, 0.9, 0.24, 1)',
  /** hero 离场视差系数（A3/Q5）：translateY(scrollY × 0.3)，transform-only + rAF */
  HERO_PARALLAX: 0.3,
} as const;

export interface RevealStep {
  /** section 选择器（home 独有；footer 不是 section，照样进编排表 = A7） */
  readonly sec: string;
  /** 依次揭示的元素选择器：**第一个 = 标题位**（delay 0 + 触发受光带扫入） */
  readonly mods: readonly string[];
}

/**
 * 编排表（确定性契约，单测锁）：
 * 每章标题先行，随后各卡片/模块按 REVEAL.STAGGER 依次浮入。
 * projects 的 6 张卡随骨架一起回到统一编排（A6：子屏/分页器已退役）。
 */
export const REVEAL_PLAN: readonly RevealStep[] = [
  // hero 无 reveal 子元素（mods 空 = 不藏首屏，打字机/LCP 链路一根手指不碰）
  { sec: '#hero', mods: [] },
  { sec: '#about', mods: ['.section-title', '.pixel-panel p', '.meta li', '.featured li'] },
  { sec: '#projects', mods: ['.section-title', '.pixel-panel.card'] },
  { sec: '#skills', mods: ['.section-title', 'li.row'] },
  { sec: '#contact', mods: ['.section-title', 'li'] },
  // footer：随文档流自然进入，内容浮入沿用同一词汇（A7，不加仪式）
  { sec: 'footer.footer', mods: ['.foot-line', '.foot-credit'] },
];

/** 元素在本章内的错峰 delay：下标 0（标题位）0ms，其后每元素 +STAGGER */
export function revealDelay(index: number): number {
  return Math.max(0, index) * REVEAL.STAGGER;
}

/**
 * 标题扫入齿数（A5）：宽度 / TRANS.TOOTH 向上取整，且 ≥1。
 * 宽度 ≤0（布局未就绪）按 1 齿兜底，绝不产出 steps(0)。
 */
export function sweepTeeth(widthPx: number): number {
  if (!Number.isFinite(widthPx) || widthPx <= 0) return 1;
  return Math.max(1, Math.ceil(widthPx / TRANS.TOOTH));
}

/**
 * 受光带扫入 keyframes：两段 steps() 变齿，入段比例 0.65/0.35
 * （同 `curtainKeyframes('in')`：前 50% 时间走 65% 齿 = 快起慢收）。
 * steps=1（nB<1）回退单段整齿。
 */
export function sweepKeyframes(teeth: number): Keyframe[] {
  const steps = Number.isFinite(teeth) ? Math.max(1, Math.floor(teeth)) : 1;
  const nA = Math.max(1, Math.round(steps * 0.65));
  const nB = steps - nA;
  if (nB < 1) {
    return [{ width: '0%', easing: `steps(${steps})` }, { width: '100%' }];
  }
  const mid = Number(((nA / steps) * 100).toFixed(4));
  return [
    { width: '0%', easing: `steps(${nA})` },
    { width: `${mid}%`, easing: `steps(${nB})` },
    { width: '100%' },
  ];
}
