/**
 * site-hud —— 右下常驻挂件的数据数学（纯函数，零 DOM）。
 *
 * 挂件措辞 = 站内丝印语言（LOG n / UPDATED 日期，作者 2026-10-01 裁决），
 * 不用游戏词（LEVEL/XP）——09-26 定稿「像素视觉语言，不是游戏手法」。
 * 数据链与 about .meta / hero 站况读数同源（getPublishedPosts）。
 *
 * 进度条语义：下一档 = 文章数的下一个 10 整数倍；到档即清零重走（LOG 20 时
 * 条归零 = 新一章开始，不「满条永远满」）。格数离散（整数格 = 像素语言，
 * 不用百分比平滑填充）。
 *
 * 单测：tests/unit/site-hud.spec.ts。
 */

/** 进度条总格数（条宽 = CELLS × (CELL+GAP)，整数格） */
export const HUD_BAR_CELLS = 10;

export interface HudMilestone {
  /** 上一档（含 0）：LOG n 的 n − done = prev */
  prev: number;
  /** 下一档：prev + 10 */
  next: number;
  /** 本档已走格数（0..CELLS，整数） */
  done: number;
}

/**
 * 文章数 → 档位数学：prev = ⌊n/10⌋×10，done = n − prev。
 * 非法输入（负数 / NaN / 非有限）一律按 0 处理，绝不产出负格或 NaN 格。
 */
export function hudMilestone(count: number): HudMilestone {
  const n = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  const prev = Math.floor(n / HUD_BAR_CELLS) * HUD_BAR_CELLS;
  return { prev, next: prev + HUD_BAR_CELLS, done: n - prev };
}

/**
 * 进度条实心格数（0..CELLS，整数）。count 恰好落档（如 20）时返回 0
 * —— 条清零重走，与 hudMilestone 的 prev/next 同一口径。
 */
export function hudBarCells(count: number, cells: number = HUD_BAR_CELLS): number {
  const total = Number.isFinite(cells) && cells > 0 ? Math.floor(cells) : HUD_BAR_CELLS;
  const { done } = hudMilestone(count);
  return Math.min(total, done);
}
