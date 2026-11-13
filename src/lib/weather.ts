/**
 * weather —— 「窗外」天气系统：Open-Meteo 对接 + WMO 码映射 + 缓存降级（ADR-0020）。
 *
 * 设计契约：
 * - **主站唯一运行时外部请求**（作者 09-21 批准的例外）；失败/超时/脏数据一律
 *   静默降级为 null——天空照常按本地时间走，只是没有雨雪，页面不可能因此报错。
 * - 30 分钟 localStorage 缓存（Open-Meteo 免费档 10k 次/日：一个访客一天最多
 *   48 次请求，缓存击穿了也远低于配额）。
 * - 数据归属：**作者城市**（广州塔 23.1066, 113.3245）——全世界访客看到的都是
 *   「我家窗外」，无定位授权弹窗（弹窗会毁掉第一眼）。
 *
 * 纯逻辑可测：fromWeatherCode / weatherFx / readCache 全是纯函数或注入 storage；
 * fetchLiveWeather 的 fetcher 可注入。单测 tests/unit/weather.spec.ts。
 */

// ---------------- WMO weathercode → 天气种类 ----------------

export type WeatherKind =
  | 'clear'
  | 'clouds' // 疏云
  | 'overcast' // 阴
  | 'fog'
  | 'drizzle'
  | 'rain'
  | 'snow'
  | 'thunder';

/** WMO Weather interpretation codes（Open-Meteo 文档口径，全覆盖） */
export function fromWeatherCode(code: number): WeatherKind {
  switch (code) {
    case 0:
    case 1:
      return 'clear';
    case 2:
      return 'clouds';
    case 3:
      return 'overcast';
    case 45:
    case 48:
      return 'fog';
    case 51:
    case 53:
    case 55:
    case 56:
    case 57:
      return 'drizzle';
    case 61:
    case 63:
    case 65:
    case 66:
    case 67:
    case 80:
    case 81:
    case 82:
      return 'rain';
    case 71:
    case 73:
    case 75:
    case 77:
    case 85:
    case 86:
      return 'snow';
    case 95:
    case 96:
    case 99:
      return 'thunder';
    default:
      return 'clear'; // 未知码不恐慌，按晴处理（页面永远有合理画面）
  }
}

/** 天气画面参数（绘制层的唯一输入） */
export interface WeatherFx {
  kind: WeatherKind;
  /** 雨强 0..1（drizzle 0.35 / rain 0.7 / thunder 1） */
  rain: number;
  /** 雪强 0..1 */
  snow: number;
  /** 云量 0..1（clear 0.15 / clouds 0.45 / overcast 0.9 / 雨雪 0.75+） */
  cloud: number;
  /** 天空压暗系数 1..0.55（阴雨世界向灰收拢） */
  dim: number;
  /** 雾带强度 0..1 */
  fog: number;
  /** 风 0..1（雨丝斜率 / 窗户振动 / 风声音量的唯一驱动） */
  wind: number;
  /** 雷闪开关 */
  thunder: boolean;
  /** 实况读数丝印（≤7 字符） */
  label: string;
}

/**
 * 太阳/月亮/星星的可见度 0..1：云量越高越被遮住。
 * 没有它会出现「雨天一轮大太阳」这种穿帮（云画了但天体照样全亮）。
 * clear → 1，疏云 → ~0.74，阴/雨/雪 → ~0.1–0.2。
 */
export function sunVisibility(cloud: number): number {
  return Math.max(0, Math.min(1, (1 - cloud) * 1.35));
}

/**
 * 降水对星月的额外压暗 0.35..1：雨/雪越大，星与月越被「纱」罩住。
 * sunVisibility 只管云遮，但雨夜 0.2 的残亮仍读作「雨夜满天星」（2026-10-06
 * 独立评审：大雨/雪夜里星场与月相照常全亮，是天气实况感最易识破的破绽）。
 * 月亮要「可辨但被罩住」，所以压到 0.35 封底而不是 0。
 */
export function precipSkyK(rain: number, snow: number): number {
  const p = Math.max(0, Math.min(1, Math.max(rain, snow)));
  return 1 - p * 0.65;
}

export function weatherFx(kind: WeatherKind): WeatherFx {
  switch (kind) {
    case 'clear':
      return { kind, rain: 0, snow: 0, cloud: 0.15, dim: 1, fog: 0, wind: 0.12, thunder: false, label: 'CLEAR' };
    case 'clouds':
      return { kind, rain: 0, snow: 0, cloud: 0.45, dim: 0.92, fog: 0, wind: 0.2, thunder: false, label: 'CLOUDY' };
    case 'overcast':
      return { kind, rain: 0, snow: 0, cloud: 0.9, dim: 0.7, fog: 0, wind: 0.3, thunder: false, label: 'OVCAST' };
    case 'fog':
      return { kind, rain: 0, snow: 0, cloud: 0.6, dim: 0.78, fog: 0.8, wind: 0.05, thunder: false, label: 'FOG' };
    case 'drizzle':
      return { kind, rain: 0.35, snow: 0, cloud: 0.75, dim: 0.74, fog: 0.25, wind: 0.4, thunder: false, label: 'DRIZZL' };
    case 'rain':
      return { kind, rain: 0.7, snow: 0, cloud: 0.85, dim: 0.62, fog: 0.1, wind: 0.55, thunder: false, label: 'RAIN' };
    case 'snow':
      // 下雪天是「灰白世界」不是「亮蓝天 + 白点」：压暗更多（实测 0.86 时天空仍像晴天）
      return { kind, rain: 0, snow: 0.8, cloud: 0.9, dim: 0.68, fog: 0.2, wind: 0.25, thunder: false, label: 'SNOW' };
    case 'thunder':
      return { kind, rain: 1, snow: 0, cloud: 0.95, dim: 0.6, fog: 0.1, wind: 0.85, thunder: true, label: 'THUNDR' };
  }
}

// ---------------- 实时天气获取（Open-Meteo，免费无 key） ----------------

export interface LiveWeather {
  code: number;
  kind: WeatherKind;
  isDay: boolean;
  /** 当日日出/日落（Unix ms，本地时区） */
  sunriseMs: number;
  sunsetMs: number;
  fetchedAt: number;
}

export interface WeatherCity {
  lat: number;
  lon: number;
  label: string;
  /** Open-Meteo timezone 参数（'auto' 或 IANA 名） */
  timezone: string;
}

const CACHE_KEY = '8bitme:weather';
/** 30 分钟 TTL：天气分钟级变化没必要追，晨昏漂移由本地时钟驱动 */
export const WEATHER_TTL_MS = 30 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5000;

interface StorageLike {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

/** 读缓存：命中且未过期则返回；任何脏数据一律 null（不抛） */
export function readCache(
  storage: StorageLike,
  nowMs: number,
  ttlMs = WEATHER_TTL_MS
): LiveWeather | null {
  try {
    const raw = storage.getItem(CACHE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<LiveWeather>;
    if (
      typeof v.code !== 'number' ||
      typeof v.sunriseMs !== 'number' ||
      typeof v.sunsetMs !== 'number' ||
      typeof v.fetchedAt !== 'number' ||
      nowMs - v.fetchedAt > ttlMs
    )
      return null;
    return { ...v, kind: fromWeatherCode(v.code), isDay: !!v.isDay } as LiveWeather;
  } catch {
    return null;
  }
}

function writeCache(storage: StorageLike, w: LiveWeather): void {
  try {
    storage.setItem(CACHE_KEY, JSON.stringify(w));
  } catch {
    /* storage 不可用：不缓存，下次再拉 */
  }
}

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

/** Open-Meteo 响应解析（脏数据 → null，不抛） */
export function parseOpenMeteo(json: unknown): Omit<LiveWeather, 'fetchedAt'> | null {
  try {
    const j = json as {
      current?: { weather_code?: number; is_day?: number };
      daily?: { sunrise?: string[]; sunset?: string[] };
    };
    const code = j?.current?.weather_code;
    const sr = j?.daily?.sunrise?.[0];
    const ss = j?.daily?.sunset?.[0];
    if (typeof code !== 'number' || !sr || !ss) return null;
    const sunriseMs = new Date(sr).getTime();
    const sunsetMs = new Date(ss).getTime();
    if (!Number.isFinite(sunriseMs) || !Number.isFinite(sunsetMs)) return null;
    return {
      code,
      kind: fromWeatherCode(code),
      isDay: j.current?.is_day === 1,
      sunriseMs,
      sunsetMs,
    };
  } catch {
    return null;
  }
}

export function openMeteoUrl(city: WeatherCity): string {
  return (
    `https://api.open-meteo.com/v1/forecast?latitude=${city.lat}&longitude=${city.lon}` +
    `&current=weather_code,is_day&daily=sunrise,sunset&timezone=${encodeURIComponent(city.timezone)}&forecast_days=1`
  );
}

/**
 * 拉取实时天气（缓存优先）。**永不 reject**：任何失败都 resolve(null)。
 * 模块级单例（inflight 去重）：BgFx 与 Hero 读数行共享同一次请求。
 */
let inflight: Promise<LiveWeather | null> | null = null;
export function getLiveWeather(
  city: WeatherCity,
  deps: { fetcher?: Fetcher; storage?: StorageLike; nowMs?: number } = {}
): Promise<LiveWeather | null> {
  if (inflight) return inflight;
  const storage = deps.storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined);
  const nowMs = deps.nowMs ?? Date.now();
  if (storage) {
    const hit = readCache(storage, nowMs);
    if (hit) return Promise.resolve(hit);
  }
  const fetcher =
    deps.fetcher ?? (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : undefined);
  if (!fetcher) return Promise.resolve(null);

  inflight = (async () => {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
      const res = await fetcher(openMeteoUrl(city), { signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) return null;
      const parsed = parseOpenMeteo(await res.json());
      if (!parsed) return null;
      const live: LiveWeather = { ...parsed, fetchedAt: nowMs };
      if (storage) writeCache(storage, live);
      return live;
    } catch {
      return null; // 断网/超时/被拦：静默降级
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** 测试专用：重置模块级单例（避免用例间串扰） */
export function __resetLiveWeatherForTest(): void {
  inflight = null;
}
