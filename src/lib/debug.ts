/**
 * debug —— 天空调试台（作者的调试玩具：天气覆写 + 时间旅行）。
 *
 * 背景（ADR-0020「窗外」）：画面的一切都由「真实时刻 + 实况天气」驱动——
 * 想验一张雨天/深夜/雪后山脊的图，靠等天亮太慢，靠改系统时钟太脏。
 * 本模块给 BgFx / Hero 一个**可注入的时间与天气源**：
 *  - 时间：`debugNow()` = 真实时钟 + 偏移（BgFx 的 skyMoment/moonPhase 与
 *    Hero 的 LOCAL 读数统一走它，于是「读数」与「画面」永远同源，不会一边快进一边装睡）。
 *  - 天气：`debugWeatherKind(live)` = 调试打开且覆写有效时用覆写，否则跟实况。
 *
 * 设计契约：
 * - **默认关**：入口（SideDock 的 DEV 按钮）常驻但默认不生效——访客不看设置仓时
 *   与没有这个功能逐像素一致。
 * - 覆写值/偏移**都与开关解耦**：关掉开关只是「让它失效」，记忆还在，
 *   再打开能接着调（对比同一时刻的两种天气是常态用法）。
 * - 脏数据不恐慌：覆写不在 8 种天气表里 / 偏移不是有限数 → 一律当作「无覆写 / 零偏移」。
 * - localStorage 键名集中此处：`8bitme:wxdebug` / `8bitme:wx-kind` / `8bitme:clock-offset`。
 *   读取失败（隐私模式 / 存储被禁用）静默回退，绝不抛。
 *
 * 纯逻辑可测（localStorage 由 tests/unit/helpers/local-storage.ts 注入）：
 * tests/unit/debug.spec.ts。
 */

import { createTogglePref } from './prefs';
import type { WeatherKind } from './weather';

/** 调试模式总开关（默认关——这是作者的调试玩具，访客默认不可见入口有但无害） */
export const wxDebugOn = createTogglePref('8bitme:wxdebug', false);

/** 8 种天气的调试循环顺序（阴→雨→雪的推进顺序，不是字母序） */
export const WX_DEBUG_KINDS = [
  'clear',
  'clouds',
  'overcast',
  'fog',
  'drizzle',
  'rain',
  'snow',
  'thunder',
] as const satisfies readonly WeatherKind[];

/** 天气覆写键（值为 WeatherKind 字面量；无键 = 无覆写） */
const WX_KIND_KEY = '8bitme:wx-kind';
/** 时间旅行偏移键（字符串数字，单位 ms，可负） */
const CLOCK_OFFSET_KEY = '8bitme:clock-offset';

/** 偏移对齐粒度：整分钟（秒级差值对画面无意义，却让存储值不可读） */
const OFFSET_GRANULE_MS = 60_000;

const isWxKind = (v: unknown): v is WeatherKind =>
  typeof v === 'string' && (WX_DEBUG_KINDS as readonly string[]).includes(v);

/** 当前天气覆写（null = 跟实况）；脏数据一律 null */
export function wxDebugKind(): WeatherKind | null {
  try {
    const raw = localStorage.getItem(WX_KIND_KEY);
    return isWxKind(raw) ? raw : null;
  } catch {
    return null;
  }
}

/** 写天气覆写；传 null 清除覆写（回到跟实况） */
export function setWxDebugKind(kind: WeatherKind | null): void {
  try {
    if (kind === null) localStorage.removeItem(WX_KIND_KEY);
    else localStorage.setItem(WX_KIND_KEY, kind);
  } catch {
    /* storage unavailable — ignore */
  }
}

/**
 * 时间旅行偏移 ms（可负）；脏数据 → 0。
 * 读取不做对齐：对齐是不变量，由写入端保证（见 setClockOffsetMs）。
 */
export function clockOffsetMs(): number {
  try {
    const raw = localStorage.getItem(CLOCK_OFFSET_KEY);
    if (raw === null) return 0;
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

/** 写时间偏移（写盘前对齐到整分钟；NaN/Infinity 当作 0） */
export function setClockOffsetMs(ms: number): void {
  try {
    const safe = Number.isFinite(ms) ? ms : 0;
    localStorage.setItem(
      CLOCK_OFFSET_KEY,
      String(Math.round(safe / OFFSET_GRANULE_MS) * OFFSET_GRANULE_MS)
    );
  } catch {
    /* storage unavailable — ignore */
  }
}

/** 调试时钟 = 真实时钟 + 偏移（BgFx 与 Hero 读数的唯一时刻源） */
export function debugNow(): number {
  return Date.now() + clockOffsetMs();
}

/** 有效天气：调试开且覆写有效 → 覆写；否则跟实况（live 可为 null → fallback clear） */
export function debugWeatherKind(live: WeatherKind | null | undefined): WeatherKind {
  if (wxDebugOn.get()) {
    const k = wxDebugKind();
    if (k) return k;
  }
  return live ?? 'clear';
}

/**
 * 调试循环的下一档：环 = [实况(null), ...WX_DEBUG_KINDS]，末尾回到实况。
 * 纯函数（SideDock 的按钮只负责调用与派发事件），单测直接守这段环序。
 * 当前值不在环里（脏数据 / 实况被换过）→ 从实况档起步。
 */
export function wxDebugCycleNext(current: WeatherKind | null): WeatherKind | null {
  const idx = current === null ? -1 : (WX_DEBUG_KINDS as readonly string[]).indexOf(current);
  // 不在环里（脏数据 / 从实况起步）→ 第一档；已在末尾 → 回实况
  if (idx < 0) return WX_DEBUG_KINDS[0];
  if (idx >= WX_DEBUG_KINDS.length - 1) return null;
  return WX_DEBUG_KINDS[idx + 1]!;
}
