/**
 * sky-time —— 「窗外」时间系统：真实日出日落锚定的太阳高度引擎（ADR-0020）。
 *
 * 核心主张：**晨昏不是时间表，是太阳高度角**。画面的一切参数（天空调色板、
 * 天体位置、星星强度、窗灯比例、点亮仪式）都是 sunAlt（太阳高度，-1..1）的
 * 连续函数——这把「黄昏 / 清晨 / 正午 / 深夜」从离散档位变成连续漂移，
 * 也让首访「世界快进」仪式退化为一次 sunAlt 插值。
 *
 * 纯函数，零 DOM；单测 tests/unit/sky-time.spec.ts。
 */

/** 一天的晨昏锚点（Unix ms）。来自 Open-Meteo daily=sunrise,sunset，或本地近似。 */
export interface DayAnchors {
  sunriseMs: number;
  sunsetMs: number;
}

/** 无 API 数据时的近似晨昏：本地 6:30 / 18:30（广州全年实际在 5:40–7:10 / 17:45–19:15 之间） */
export function fallbackAnchors(nowMs: number): DayAnchors {
  const d = new Date(nowMs);
  const at = (h: number, m: number) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m).getTime();
  return { sunriseMs: at(6, 30), sunsetMs: at(18, 30) };
}

/** anchors 合理性校验：日落必须晚于日出，且昼长在 2–22 小时（脏数据回退近似值） */
export function saneAnchors(a: DayAnchors, nowMs: number): DayAnchors {
  const dayLen = a.sunsetMs - a.sunriseMs;
  if (!Number.isFinite(dayLen) || dayLen < 2 * 3600e3 || dayLen > 22 * 3600e3)
    return fallbackAnchors(nowMs);
  return a;
}

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

/**
 * 太阳高度 sunAlt ∈ [-1, 1]：白天 = sin(日弧π)，夜晚 = -sin(夜弧π)。
 * 日弧 = 日出→日落；夜弧 = 日落→次日日出（夜长按 24h−昼长 推算，无需昨日/明日数据）。
 */
export function sunAltAt(nowMs: number, anchors: DayAnchors): number {
  const a = saneAnchors(anchors, nowMs);
  const dayLen = a.sunsetMs - a.sunriseMs;
  const nightLen = 24 * 3600e3 - dayLen;
  if (nowMs >= a.sunriseMs && nowMs <= a.sunsetMs) {
    return Math.sin(((nowMs - a.sunriseMs) / dayLen) * Math.PI);
  }
  // 夜晚：日落之后 or 日出之前（凌晨的夜弧从「昨晚日落」起算）
  const prevSunset = nowMs > a.sunsetMs ? a.sunsetMs : a.sunriseMs - nightLen;
  return -Math.sin(clamp01((nowMs - prevSunset) / nightLen) * Math.PI);
}

/**
 * 天体水平弧位 0..1（日出东方 → 正午中天 → 日落西方；月亮同理走夜弧）。
 * 返回 -1 = 该天体在地平线下（不可见）。
 */
function arcX(nowMs: number, anchors: DayAnchors, body: 'sun' | 'moon'): number {
  const a = saneAnchors(anchors, nowMs);
  const dayLen = a.sunsetMs - a.sunriseMs;
  const nightLen = 24 * 3600e3 - dayLen;
  if (body === 'sun') {
    if (nowMs < a.sunriseMs || nowMs > a.sunsetMs) return -1;
    return clamp01((nowMs - a.sunriseMs) / dayLen);
  }
  const prevSunset = nowMs > a.sunsetMs ? a.sunsetMs : a.sunriseMs - nightLen;
  if (nowMs >= a.sunriseMs && nowMs <= a.sunsetMs) return -1;
  return clamp01((nowMs - prevSunset) / nightLen);
}

/** 某一时刻的完整天空状态（绘制层只读这个结构） */
export interface SkyMoment {
  /** 太阳高度 -1..1（一切画面参数的主驱动量） */
  sunAlt: number;
  /** 白昼度 0..1（0 = 深夜，1 = 太阳高于暮光带） */
  daylight: number;
  /** 星光强度 0..1（daylight 的补，暮光带内平滑过渡） */
  starlight: number;
  /** 太阳：水平弧位 0..1（-1 不可见）与高度 0..1（0 = 贴地平线） */
  sunX: number;
  sunY: number;
  /** 月亮：同上 */
  moonX: number;
  moonY: number;
}

/** 白昼度：alt -0.04（暮光边缘）→ 0.25（脱离低日带）线性升到 1 */
export function daylightFor(alt: number): number {
  return clamp01((alt + 0.04) / 0.29);
}

/** 星光强度：alt -0.12（蓝调）以下全亮，-0.12 → 0.20 渐隐 */
export function starlightFor(alt: number): number {
  return 1 - clamp01((alt + 0.12) / 0.32);
}

export function skyMoment(nowMs: number, anchors: DayAnchors): SkyMoment {
  const alt = sunAltAt(nowMs, anchors);
  const daylight = daylightFor(alt);
  const starlight = starlightFor(alt);
  const sx = arcX(nowMs, anchors, 'sun');
  const mx = arcX(nowMs, anchors, 'moon');
  return {
    sunAlt: alt,
    daylight,
    starlight,
    sunX: sx,
    sunY: sx < 0 ? 0 : Math.sin(sx * Math.PI),
    moonX: mx,
    moonY: mx < 0 ? 0 : Math.sin(mx * Math.PI),
  };
}

/**
 * 点亮仪式（首访「世界快进」）：虚拟 sunAlt 从深夜（-0.55）平滑插值到真实值。
 * p ∈ [0,1] 为仪式进度（easeSilk 已由调用方施加）。仪式之外的稳态直接返回真实值。
 * 白天到访 = 日出快进；深夜到访 ≈ 星星/月亮轻微淡入（真实值本就接近地板）。
 */
export const BOOT_ALT = -0.55;
export function bootAlt(realAlt: number, p: number): number {
  const t = clamp01(p);
  return BOOT_ALT + (realAlt - BOOT_ALT) * t;
}

// ---------------- 月相（阴晴圆缺，2026-09-21 作者提出） ----------------

/** 朔望月（ms）：月相周期的天文常量 */
export const SYNODIC_MS = 29.530588853 * 86400_000;
/** 参考新月：2000-01-06 18:14 UTC（天文历表常用的月相纪元） */
export const NEW_MOON_EPOCH_MS = Date.UTC(2000, 0, 7, 2, 14);

/**
 * 月相相位 ph ∈ [0, 1)：0 新月 → 0.25 上弦 → 0.5 满月 → 0.75 下弦 → 1 新月。
 * 从真实时钟推出（测试可用假时钟钉死），无输入随机量。
 */
export function moonPhase(nowMs: number): number {
  const p = ((nowMs - NEW_MOON_EPOCH_MS) % SYNODIC_MS) / SYNODIC_MS;
  return p < 0 ? p + 1 : p;
}

/**
 * 相位 ph 下，月盘某行（纵偏移 dy，盘心为原点）的**受光区间** [x0, x1)
 * （x 为相对月心的整数 px）。null = 该行无受光（新月 / 弦外）。
 *
 * 几何：明暗界线是与月盘共弦的椭圆，半轴 = c·cos(2πph)（c = 该行半弦长）。
 * 盈月亮右（受光区 [a, c]，a = c·cos）、亏月亮左（受光区 [−c, b]，b = −c·cos）——
 * 满月时 a = −c 全盘受光，新月时受光区宽度 < 1px 视为不可见。
 * 北半球默认方向（国内作者，无需翻转）。
 */
export function moonLitRow(dy: number, r: number, ph: number): [number, number] | null {
  const dy2 = dy * dy;
  if (dy2 > r * r) return null;
  const cr = Math.round(Math.sqrt(r * r - dy2)); // 该行半弦长（整数）
  const cos = Math.cos(ph * 2 * Math.PI);
  if (ph < 0.5) {
    const a = Math.round(cr * cos);
    if (cr - a < 1) return null; // 受光 < 1px：新月/细弦不画
    return [a, cr];
  }
  const b = Math.round(-cr * cos);
  if (b + cr < 1) return null;
  return [-cr, b];
}

/** 实况读数用的晨昏标签（丝印语言，与天气词并排）：DAWN/DAY/DUSK/NIGHT */
export function phaseLabel(alt: number): 'DAWN' | 'DAY' | 'DUSK' | 'NIGHT' {
  if (alt >= 0.3) return 'DAY';
  if (alt >= -0.02) return 'DAWN'; // 日出日落低日带（暮光两侧都算「晨昏」）
  if (alt >= -0.14) return 'DUSK';
  return 'NIGHT';
}
