import { describe, expect, it } from 'vitest';
import { HUD_BAR_CELLS, hudBarCells, hudMilestone } from '../../src/lib/site-hud';

describe('hudMilestone（文章数 → 档位数学）', () => {
  it('整数边界：0 起步 / 档中 / 恰好落档清零 / 跨多档', () => {
    expect(hudMilestone(0)).toEqual({ prev: 0, next: 10, done: 0 });
    expect(hudMilestone(5)).toEqual({ prev: 0, next: 10, done: 5 });
    expect(hudMilestone(19)).toEqual({ prev: 10, next: 20, done: 9 });
    // 恰好落档：条清零重走（新一章开始），不是「满条永远满」
    expect(hudMilestone(20)).toEqual({ prev: 20, next: 30, done: 0 });
    expect(hudMilestone(25)).toEqual({ prev: 20, next: 30, done: 5 });
    expect(hudMilestone(100)).toEqual({ prev: 100, next: 110, done: 0 });
  });

  it('非整数向下取整（19.8 篇不存在）', () => {
    expect(hudMilestone(19.8)).toEqual({ prev: 10, next: 20, done: 9 });
  });

  it('非法输入一律按 0：负数 / NaN / Infinity，绝不产出负格或 NaN 格', () => {
    expect(hudMilestone(-3)).toEqual({ prev: 0, next: 10, done: 0 });
    expect(hudMilestone(Number.NaN)).toEqual({ prev: 0, next: 10, done: 0 });
    expect(hudMilestone(Number.POSITIVE_INFINITY)).toEqual({
      prev: 0,
      next: 10,
      done: 0,
    });
  });

  it('不变量：done ∈ [0, CELLS] 且 prev + done = ⌊n⌋（对一段扫描全成立）', () => {
    for (let n = 0; n <= 55; n++) {
      const m = hudMilestone(n);
      expect(m.done).toBeGreaterThanOrEqual(0);
      expect(m.done).toBeLessThanOrEqual(HUD_BAR_CELLS);
      expect(m.prev + m.done).toBe(n);
      expect(m.next - m.prev).toBe(HUD_BAR_CELLS);
    }
  });
});

describe('hudBarCells（进度条实心格数）', () => {
  it('与 milestone.done 同口径，整数格', () => {
    expect(hudBarCells(0)).toBe(0);
    expect(hudBarCells(19)).toBe(9);
    expect(hudBarCells(20)).toBe(0);
    expect(Number.isInteger(hudBarCells(17.2))).toBe(true);
  });

  it('done 恒 ≤ 总格数（阈值无撞顶）', () => {
    for (let n = 0; n <= 30; n++) {
      expect(hudBarCells(n)).toBeLessThanOrEqual(HUD_BAR_CELLS);
    }
  });

  it('自定义格数只收整数且钳制（cells=5 时 done 9 → 5）', () => {
    expect(hudBarCells(19, 5)).toBe(5);
    expect(hudBarCells(3, 5)).toBe(3);
    // 非法 cells 回落默认档
    expect(hudBarCells(19, Number.NaN)).toBe(9);
    expect(hudBarCells(19, 0)).toBe(9);
  });
});
