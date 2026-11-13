import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  WX_DEBUG_KINDS,
  clockOffsetMs,
  debugNow,
  debugWeatherKind,
  setClockOffsetMs,
  setWxDebugKind,
  wxDebugCycleNext,
  wxDebugKind,
  wxDebugOn,
} from '../../src/lib/debug';
import { installMemoryStorage, removeMemoryStorage } from './helpers/local-storage';
import type { WeatherKind } from '../../src/lib/weather';

/**
 * 天空调试台（天气覆写 + 时间旅行）—— 纯逻辑契约。
 *
 * 运行期接线由 tests/e2e/debug.spec.ts 守（「点了真的生效」）；这里守三条基准：
 *  ① 默认关（访客不受影响）；② 脏存储不恐慌（一律回落到「无覆写 / 零偏移」）；
 *  ③ 时间旅行真的改变 debugNow（BgFx 与 Hero 共用的时刻源只有一个）。
 */

describe('默认值（无存档 / 存储可用）', () => {
  beforeEach(() => installMemoryStorage());
  afterEach(() => removeMemoryStorage());

  it('总开关默认关；无覆写；偏移 0；debugNow == Date.now()', () => {
    expect(wxDebugOn.get()).toBe(false);
    expect(wxDebugKind()).toBeNull();
    expect(clockOffsetMs()).toBe(0);
    const before = Date.now();
    const now = debugNow();
    const after = Date.now();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(after);
  });

  it('调试关：debugWeatherKind 恒等于实况（含 null → clear）', () => {
    expect(debugWeatherKind('snow')).toBe('snow');
    expect(debugWeatherKind('rain')).toBe('rain');
    expect(debugWeatherKind(null)).toBe('clear');
    expect(debugWeatherKind(undefined)).toBe('clear');
    // 即使有覆写，开关没开也无效
    setWxDebugKind('snow');
    expect(debugWeatherKind('rain')).toBe('rain');
  });
});

describe('天气覆写', () => {
  beforeEach(() => {
    installMemoryStorage();
    wxDebugOn.set(true);
  });
  afterEach(() => removeMemoryStorage());

  it('开且覆写合法 → 覆写优先；开但无覆写 → 跟实况', () => {
    expect(wxDebugKind()).toBeNull();
    expect(debugWeatherKind('drizzle')).toBe('drizzle');
    setWxDebugKind('snow');
    expect(wxDebugKind()).toBe('snow');
    expect(debugWeatherKind('drizzle')).toBe('snow');
    expect(debugWeatherKind(null)).toBe('snow');
  });

  it('脏数据（不在 8 种天气表里）→ 读 null，且不劫持实况', () => {
    localStorage.setItem('8bitme:wx-kind', 'hacker');
    expect(wxDebugKind()).toBeNull();
    expect(debugWeatherKind('fog')).toBe('fog');
    expect(debugWeatherKind(null)).toBe('clear');
  });

  it('setWxDebugKind(null) 清除覆写（键被移除，而非写入空串）', () => {
    setWxDebugKind('thunder');
    expect(localStorage.getItem('8bitme:wx-kind')).toBe('thunder');
    setWxDebugKind(null);
    expect(localStorage.getItem('8bitme:wx-kind')).toBeNull();
    expect(wxDebugKind()).toBeNull();
  });

  it('8 种天气逐档往返（表与 WeatherKind 同源，不写死字符串）', () => {
    for (const k of WX_DEBUG_KINDS) {
      setWxDebugKind(k);
      expect(wxDebugKind()).toBe(k);
      expect(debugWeatherKind(null)).toBe(k);
    }
  });

  it('循环环：[实况, ...8 种] 首尾相接，末尾回实况', () => {
    // 实况 → clear → clouds → … → thunder → 实况
    const walked: (string | null)[] = [];
    let cur: (typeof WX_DEBUG_KINDS)[number] | null = null;
    for (let i = 0; i < WX_DEBUG_KINDS.length + 1; i++) {
      cur = wxDebugCycleNext(cur);
      walked.push(cur);
    }
    expect(walked.slice(0, WX_DEBUG_KINDS.length)).toEqual([...WX_DEBUG_KINDS]);
    expect(walked[WX_DEBUG_KINDS.length]).toBeNull();
    // 不在环里的值（脏数据）→ 从实况档起步（第一档 clear）
    expect(wxDebugCycleNext('hacker' as WeatherKind)).toBe(WX_DEBUG_KINDS[0]);
  });
});

describe('时间旅行', () => {
  beforeEach(() => installMemoryStorage());
  afterEach(() => removeMemoryStorage());

  it('setClockOffsetMs(-1.5h) → debugNow 恰好慢 1.5h（差值口径，避开两次 Date.now 的采样间隙）', () => {
    setClockOffsetMs(-5_400_000);
    expect(clockOffsetMs()).toBe(-5_400_000);
    const diff = Date.now() - debugNow();
    expect(Math.abs(diff - 5_400_000)).toBeLessThan(1000);
  });

  it('写盘前对齐到整分钟（秒级差值对画面无意义）', () => {
    setClockOffsetMs(3_600_000 + 29_000);
    expect(clockOffsetMs()).toBe(3_600_000);
    setClockOffsetMs(3_600_000 + 31_000);
    expect(clockOffsetMs()).toBe(3_660_000);
  });

  it('脏偏移（非数字 / Infinity）→ 0；set 非有限数不写坏值', () => {
    localStorage.setItem('8bitme:clock-offset', 'yesterday');
    expect(clockOffsetMs()).toBe(0);
    localStorage.setItem('8bitme:clock-offset', 'Infinity');
    expect(clockOffsetMs()).toBe(0);
    setClockOffsetMs(Number.NaN);
    expect(clockOffsetMs()).toBe(0);
    expect(Math.abs(debugNow() - Date.now())).toBeLessThan(50);
  });

  it('叠加语义：+1H 再 +1H = +2H，归零回 0（SideDock 的 nudge 契约）', () => {
    setClockOffsetMs(clockOffsetMs() + 3_600_000);
    setClockOffsetMs(clockOffsetMs() + 3_600_000);
    expect(clockOffsetMs()).toBe(7_200_000);
    setClockOffsetMs(0);
    expect(clockOffsetMs()).toBe(0);
  });
});

describe('存储不可用（隐私模式）', () => {
  beforeEach(() => removeMemoryStorage());

  it('读一律回退默认、写静默不抛（开关仍在本会话内「不生效」= 访客安全侧）', () => {
    expect(wxDebugOn.get()).toBe(false);
    expect(wxDebugKind()).toBeNull();
    expect(clockOffsetMs()).toBe(0);
    expect(Math.abs(debugNow() - Date.now())).toBeLessThan(50);
    expect(debugWeatherKind('snow')).toBe('snow');
    expect(() => setWxDebugKind('rain')).not.toThrow();
    expect(() => setClockOffsetMs(3_600_000)).not.toThrow();
  });
});
