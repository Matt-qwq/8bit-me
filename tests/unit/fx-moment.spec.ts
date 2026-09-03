import { describe, expect, it } from 'vitest';
import {
  bootOnce,
  createMomentGate,
  isInFreeze,
  nextInRange,
  phosphorDecay,
} from '../../src/lib/fx-moment';

describe('createMomentGate —— 时刻预算闸（有静默、防循环化）', () => {
  it('初次立即放行，冷却期内拒绝', () => {
    const gate = createMomentGate(60000);
    expect(gate.try(0)).toBe(true);
    gate.note(0);
    expect(gate.try(30_000)).toBe(false);
    expect(gate.cooldown(30_000)).toBe(30_000);
  });
  it('超过最小间隔后放行', () => {
    const gate = createMomentGate(60000);
    gate.note(0);
    expect(gate.try(60_001)).toBe(true);
    expect(gate.cooldown(60_001)).toBe(0);
  });
  it('note 更新冷却起点', () => {
    const gate = createMomentGate(10_000);
    gate.note(5_000);
    expect(gate.try(14_999)).toBe(false);
    expect(gate.try(15_000)).toBe(true);
  });
});

describe('nextInRange —— 事件化 jitter（有原因，非固定周期）', () => {
  it('命中 [lo, hi] 区间', () => {
    for (let i = 0; i < 50; i++) {
      const v = nextInRange(() => 0.5, 6000, 12000);
      expect(v).toBeGreaterThanOrEqual(6000);
      expect(v).toBeLessThanOrEqual(12000);
      expect(Number.isFinite(v)).toBe(true);
    }
  });
  it('rng=0 → lo；rng=1 → hi（端点）', () => {
    expect(nextInRange(() => 0, 100, 200)).toBe(100);
    expect(nextInRange(() => 1, 100, 200)).toBe(200);
  });
});

describe('isInFreeze —— PageTrans 窗口冻结（不与转场光束抢戏）', () => {
  it('窗口内冻结，窗口外放行', () => {
    expect(isInFreeze(100, 1000)).toBe(true);
    expect(isInFreeze(1000, 1000)).toBe(false);
    expect(isInFreeze(1500, 1000)).toBe(false);
  });
});

describe('bootOnce —— 会话一次性（开机仪式不复播）', () => {
  const store = new Map<string, string>();
  const read = (k: string) => store.get(k) ?? null;
  const write = (k: string, v: string) => void store.set(k, v);

  it('首次播、二次不播', () => {
    expect(bootOnce('k', read, write, '1')).toBe(true);
    expect(bootOnce('k', read, write, '1')).toBe(false);
  });
  it('storage 异常静默回退（read 抛错 → 按已播处理，不炸）', () => {
    const boom = () => {
      throw new Error('storage blocked');
    };
    expect(bootOnce('k2', boom, write, '1')).toBe(false);
  });
});

describe('phosphorDecay —— 磷光级联衰减（越帧半衰数学）', () => {
  it('每帧 0.94 → 60fps 越 30 帧 ≈ 半衰 0.5s', () => {
    expect(phosphorDecay(0.94, 30)).toBeCloseTo(0.94 ** 30);
    expect(phosphorDecay(0.94, 30)).toBeGreaterThan(0.1);
    expect(phosphorDecay(0.92, 60)).toBeLessThan(0.007);
  });
  it('framesStep=0 → 1（不衰减）', () => {
    expect(phosphorDecay(0.94, 0)).toBe(1);
  });
});