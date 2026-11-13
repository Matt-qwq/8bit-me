import { describe, expect, it } from 'vitest';
import { easeSilk, lightThemeLineFactor, mix } from '../../src/lib/bgfx-motion';

/**
 * bgfx-motion —— 世界（窗外）侧纯函数契约
 *
 * 2026-09-25：**机箱 core 退役**（作者：「core 退役换成 world 背景」）。本文件原先
 * 覆盖的机器叙事族（genMachineLayout / genManhattanTrace / cameraFor / contentBox /
 * genSectionTargets / packetPos / ledPhase / dustSpawn / snap8 / segHitsRect / chipPins
 * / genTracesFor / genRoute）随实现一并删除——测试跟着被删的实现走，不留孤儿。
 * 另有 tests/unit/bgfx-glow.spec.ts（双芯辉光 coreGlow）整文件退役。
 *
 * 保留 = world 仍在消费的三个纯函数：
 *   · easeSilk —— 点亮仪式的 JS easing（唯一运动种子）
 *   · mix —— 插值基元
 *   · lightThemeLineFactor —— 按底色亮度缩放线 alpha（恒暗档下恒 1，契约仍在）
 */

describe('easeSilk —— 本站唯一运动种子（cubic-bezier(0.22,0.9,0.24,1)）', () => {
  it('端点精确：easeSilk(0)=0、easeSilk(1)=1', () => {
    expect(easeSilk(0)).toBeCloseTo(0, 5);
    expect(easeSilk(1)).toBeCloseTo(1, 5);
  });
  it('越界输入被钳制到 [0,1]', () => {
    expect(easeSilk(-1)).toBeCloseTo(0, 5);
    expect(easeSilk(2)).toBeCloseTo(1, 5);
  });
  it('单调不减（减速感：Silk）', () => {
    let prev = -1;
    for (let x = 0; x <= 1.0001; x += 0.05) {
      const v = easeSilk(x);
      expect(v).toBeGreaterThanOrEqual(prev);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      prev = v;
    }
  });
});

describe('mix —— 线性插值基元', () => {
  it('端点与中点', () => {
    expect(mix(0, 10, 0)).toBe(0);
    expect(mix(0, 10, 1)).toBe(10);
    expect(mix(0, 10, 0.5)).toBe(5);
  });
  it('e=0.5 对负区间也成立', () => {
    expect(mix(-20, -10, 0.5)).toBe(-15);
  });
});

describe('浅色主题绘制系数（theme readout，P1-5）', () => {
  it('深色底（亮度 ≤64）不降透明度', () => {
    for (const luma of [0, 15, 32, 64]) {
      expect(lightThemeLineFactor(luma), `luma=${luma}`).toBe(1);
    }
  });

  it('浅色底（亮度 ≥192）降到 0.4', () => {
    for (const luma of [192, 220, 240, 255]) {
      expect(lightThemeLineFactor(luma), `luma=${luma}`).toBe(0.4);
    }
  });

  it('中间区间线性过渡且单调不增', () => {
    let prev = lightThemeLineFactor(64);
    for (let luma = 65; luma <= 192; luma += 1) {
      const v = lightThemeLineFactor(luma);
      expect(v, `luma=${luma} 应 ≤ 前一档`).toBeLessThanOrEqual(prev + 1e-9);
      expect(v, `luma=${luma} 应在 [0.4,1]`).toBeGreaterThanOrEqual(0.4 - 1e-9);
      expect(v).toBeLessThanOrEqual(1 + 1e-9);
      prev = v;
    }
  });

  it('单档取值：DARK 走 1（全亮；LIGHT 已退役）', async () => {
    const { MODES, relativeLuminance } = await import('../../src/lib/themes');
    for (const m of MODES) {
      const factor = lightThemeLineFactor(relativeLuminance(m.colors.bg) * 255);
      expect(factor, m.key).toBe(1);
    }
  });
});
