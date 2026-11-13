import { describe, expect, it } from 'vitest';
import { WINDOW, windowSpec, type WindowSpec } from '../../src/lib/window-room';

/**
 * 真窗几何守卫（作者 2026-09-26 裁决，ADR-0027：首屏一整扇窗）。
 *
 * 判据与几何同源：玻璃内缩、框外缘贴边、墙体账目、洞深阶梯的整数账，全部从
 * windowSpec 输出直接量，不绕间接特征。几何常量一律取自 WINDOW，不在用例里写死比例。
 */

const DESKTOP = [1440, 900] as const;
const NARROW = [
  [800, 600],
  [480, 800],
] as const;
/** 多尺寸扫描（含窄屏与极小视口）：新几何只有一套口径，所有尺寸走同一组不变量 */
const SIZES = [DESKTOP, ...NARROW, [320, 480] as const, [1920, 1080] as const] as const;
/** 所有数值字段（含嵌套 wall 与 revealSteps 元素）必须是整数 */
function integers(s: WindowSpec): number[] {
  return [
    s.x,
    s.y,
    s.w,
    s.h,
    s.frame,
    s.sill,
    s.reveal,
    ...s.revealSteps,
    s.shadow,
    s.wall.top,
    s.wall.side,
    s.wall.bottom,
  ];
}

describe('windowSpec：首屏一整扇窗（框外缘贴视口边，墙厚 0）', () => {
  it('确定性：同尺寸两次调用深度相等', () => {
    expect(windowSpec(1440, 900)).toEqual(windowSpec(1440, 900));
  });

  it('玻璃内缩恰为 WINDOW.FRAME，框外缘贴视口边（多尺寸扫描）', () => {
    for (const [w, h] of SIZES) {
      const s = windowSpec(w, h);
      // 玻璃四边内缩都恰是框宽（旧口径「洞占视口 ~52%×75%、左缘推到 40% 让 hero」
      // 已随 ADR-0027 反转）
      expect(s.frame, `${w}×${h} 的框宽不是 WINDOW.FRAME`).toBe(WINDOW.FRAME);
      expect(s.x, `${w}×${h} 的左内缩不是框宽`).toBe(s.frame);
      expect(s.y, `${w}×${h} 的上内缩不是框宽`).toBe(s.frame);
      expect(w - s.x - s.w, `${w}×${h} 的右内缩不是框宽`).toBe(s.frame);
      // 框的外缘正好落在视口边上（墙厚 0）
      expect(s.x - s.frame, `${w}×${h} 的框左缘没贴视口边`).toBe(0);
      expect(s.y - s.frame, `${w}×${h} 的框上缘没贴视口边`).toBe(0);
      expect(s.x + s.w + s.frame, `${w}×${h} 的框右缘没贴视口边`).toBe(w);
    }
  });

  it('墙体账目：top/side 为 0（窗占满首屏），bottom = 窗台 + 一道缝，洞 + 框 + 下区 = 视口', () => {
    for (const [w, h] of SIZES) {
      const s = windowSpec(w, h);
      // 没有上墙 / 侧墙——窗的外缘就是视口四边（旧「四边留墙」是凹洞语法）
      expect(s.wall.top, `${w}×${h} 还有上墙`).toBe(0);
      expect(s.wall.side, `${w}×${h} 还有侧墙`).toBe(0);
      // 下区 = 窗台 + BOTTOM_GAP（旧口径的「窗台 + 20px 墙脚」随 ADR-0027 退役）
      expect(s.wall.bottom, `${w}×${h} 的下区不是窗台 + 缝`).toBe(s.sill + WINDOW.BOTTOM_GAP);
      expect(s.sill).toBeGreaterThanOrEqual(WINDOW.SILL_MIN);
      expect(s.sill).toBeLessThanOrEqual(WINDOW.SILL_MAX);
      // 纵向账目自洽：上框 + 玻璃高 + 下区 = 视口高
      expect(s.y + s.h + s.wall.bottom, `${w}×${h} 的纵向账目不平`).toBe(h);
    }
  });

  it('桌面与窄屏同几何（ADR-0027 统一档）：窄屏不再有「缩洞居中」的第二套口径', () => {
    const desktop = windowSpec(1440, 900);
    const narrow = windowSpec(480, 800);
    // 关键分档量（洞的左右内缩）同值：都等于框宽，窄屏不再另算 84% 居中
    expect(narrow.x).toBe(desktop.x);
    expect(narrow.x).toBe(WINDOW.FRAME);
    // 洞宽只由视口宽减两倍框宽决定（没有任何窄屏系数）
    expect(desktop.w).toBe(1440 - 2 * WINDOW.FRAME);
    expect(narrow.w).toBe(480 - 2 * WINDOW.FRAME);
  });

  it('全字段整数输出（含洞深阶梯每一阶）', () => {
    const viewports = [DESKTOP, ...NARROW, [320, 480] as const, [1440, 600] as const];
    for (const [w, h] of viewports) {
      for (const n of integers(windowSpec(w, h))) {
        expect(Number.isInteger(n), `${w}×${h} 的字段 ${n} 不是整数`).toBe(true);
      }
    }
  });

  it('洞深阶梯不吞掉景色：可见景宽/高仍为正，且阶梯总厚 < 洞宽/洞高的一半', () => {
    const depth = WINDOW.REVEAL_STEPS.reduce((a, b) => a + b, 0);
    for (const [w, h] of SIZES) {
      const s = windowSpec(w, h);
      // 阶梯画在玻璃之内（盖住景的边），可见景 = 洞 − 2×depth，两边都要留得下景
      expect(s.w - 2 * depth, `${w}×${h} 的阶梯把景色横向吞没了`).toBeGreaterThan(0);
      expect(s.h - 2 * depth, `${w}×${h} 的阶梯把景色纵向吞没了`).toBeGreaterThan(0);
      expect(depth, `${w}×${h} 的阶梯总厚 ≥ 洞宽一半`).toBeLessThan(s.w / 2);
      expect(depth, `${w}×${h} 的阶梯总厚 ≥ 洞高一半`).toBeLessThan(s.h / 2);
    }
    // 旧断言「depth + frame 塞得进最薄的墙」已随 ADR-0027 消失：墙没了
    // （wall.top/side = 0），阶梯改画在玻璃之内，风险从「漫出视口」变成「吞掉景色」。
  });

  it('拆棂观景窗（ADR-0028）：spec 不再有棂几何（transomY/mullion/mullionX 已退役）', () => {
    const s = windowSpec(1440, 900) as unknown as Record<string, unknown>;
    expect('transomY' in s, 'transomY 应已从 WindowSpec 退役').toBe(false);
    expect('mullion' in s, 'mullion 应已从 WindowSpec 退役').toBe(false);
    expect('mullionX' in s, 'mullionX 应已从 WindowSpec 退役').toBe(false);
    expect((WINDOW as Record<string, unknown>).MULLION).toBeUndefined();
  });

  it('极小视口 320×480 不崩，且玻璃区仍够大（≥120px）', () => {
    const s = windowSpec(320, 480);
    expect(s.w).toBeGreaterThanOrEqual(120);
    expect(s.h).toBeGreaterThanOrEqual(120);
  });

  it('WINDOW 是唯一数据源：spec 的固定件直接取自常量', () => {
    const s = windowSpec(1440, 900);
    expect(s.frame).toBe(WINDOW.FRAME);
    expect(s.reveal).toBe(WINDOW.REVEAL);
    expect(s.shadow).toBe(WINDOW.SHADOW);
    expect(s.revealSteps).toEqual([...WINDOW.REVEAL_STEPS]);
  });
});
