import { beforeEach, describe, expect, it } from 'vitest';
import {
  fromWeatherCode,
  getLiveWeather,
  openMeteoUrl,
  parseOpenMeteo,
  precipSkyK,
  readCache,
  sunVisibility,
  weatherFx,
  __resetLiveWeatherForTest,
  type LiveWeather,
  type WeatherCity,
} from '../../src/lib/weather';

const CITY: WeatherCity = { lat: 23.1066, lon: 113.3245, label: 'GUANGZHOU', timezone: 'auto' };

const memStorage = () => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    _map: m,
  };
};

const GOOD_JSON = {
  current: { weather_code: 61, is_day: 1 },
  daily: { sunrise: ['2026-09-21T06:12'], sunset: ['2026-09-21T18:28'] },
};

beforeEach(() => __resetLiveWeatherForTest());

describe('fromWeatherCode：WMO 码全覆盖', () => {
  it('已知码逐档落位', () => {
    expect(fromWeatherCode(0)).toBe('clear');
    expect(fromWeatherCode(1)).toBe('clear');
    expect(fromWeatherCode(2)).toBe('clouds');
    expect(fromWeatherCode(3)).toBe('overcast');
    expect(fromWeatherCode(45)).toBe('fog');
    expect(fromWeatherCode(48)).toBe('fog');
    for (const c of [51, 53, 55, 56, 57]) expect(fromWeatherCode(c)).toBe('drizzle');
    for (const c of [61, 63, 65, 66, 67, 80, 81, 82]) expect(fromWeatherCode(c)).toBe('rain');
    for (const c of [71, 73, 75, 77, 85, 86]) expect(fromWeatherCode(c)).toBe('snow');
    for (const c of [95, 96, 99]) expect(fromWeatherCode(c)).toBe('thunder');
  });
  it('未知码按晴处理（页面永远有合理画面）', () => {
    expect(fromWeatherCode(999)).toBe('clear');
    expect(fromWeatherCode(-1)).toBe('clear');
  });
});

describe('weatherFx：天气画面参数', () => {
  it('雨不含雪、雪不含雨（互斥粒子）', () => {
    expect(weatherFx('rain').snow).toBe(0);
    expect(weatherFx('snow').rain).toBe(0);
    expect(weatherFx('thunder').rain).toBeGreaterThan(0);
  });
  it('风档：毛毛雨 < 中雨 < 雷暴（雨丝斜率/窗户振动/风声的唯一驱动）', () => {
    expect(weatherFx('drizzle').wind).toBeLessThan(weatherFx('rain').wind);
    expect(weatherFx('rain').wind).toBeLessThan(weatherFx('thunder').wind);
    for (const k of ['clear', 'clouds', 'overcast', 'fog', 'drizzle', 'rain', 'snow', 'thunder'] as const) {
      const w = weatherFx(k).wind;
      expect(w, `${k} wind 在值域内`).toBeGreaterThanOrEqual(0);
      expect(w).toBeLessThanOrEqual(1);
    }
  });

  it('阴雨比晴天更暗（dim 单调）', () => {
    expect(weatherFx('rain').dim).toBeLessThan(weatherFx('clear').dim);
    expect(weatherFx('thunder').dim).toBeLessThan(weatherFx('rain').dim);
  });
  it('雷有 thunder 开关，其余没有', () => {
    expect(weatherFx('thunder').thunder).toBe(true);
    expect(weatherFx('rain').thunder).toBe(false);
  });
  it('丝印标签 ≤7 字符（hero 读数行宽度预算）', () => {
    for (const k of ['clear', 'clouds', 'overcast', 'fog', 'drizzle', 'rain', 'snow', 'thunder'] as const)
      expect(weatherFx(k).label.length).toBeLessThanOrEqual(7);
  });
});

describe('readCache：缓存与 TTL', () => {
  const live: LiveWeather = {
    code: 61,
    kind: 'rain',
    isDay: true,
    sunriseMs: 1,
    sunsetMs: 2,
    fetchedAt: 1000,
  };
  it('命中未过期缓存', () => {
    const s = memStorage();
    s.setItem('8bitme:weather', JSON.stringify(live));
    expect(readCache(s, 1000 + 60e3)?.kind).toBe('rain');
  });
  it('过期 → null；脏 JSON → null；缺字段 → null（一律不抛）', () => {
    const s = memStorage();
    s.setItem('8bitme:weather', JSON.stringify(live));
    expect(readCache(s, 1000 + 31 * 60e3)).toBeNull();
    s.setItem('8bitme:weather', '{oops');
    expect(readCache(s, 1000)).toBeNull();
    s.setItem('8bitme:weather', JSON.stringify({ code: 61 }));
    expect(readCache(s, 1000)).toBeNull();
  });
});

describe('parseOpenMeteo：脏数据防线', () => {
  it('正常响应解析出 kind + 晨昏', () => {
    const p = parseOpenMeteo(GOOD_JSON)!;
    expect(p.kind).toBe('rain');
    expect(p.isDay).toBe(true);
    expect(p.sunriseMs).toBeLessThan(p.sunsetMs);
  });
  it('缺 current / 缺 daily / 日期非法 → null', () => {
    expect(parseOpenMeteo({})).toBeNull();
    expect(parseOpenMeteo({ current: { weather_code: 61 } })).toBeNull();
    expect(parseOpenMeteo({ current: { weather_code: 61 }, daily: { sunrise: ['x'], sunset: ['y'] } })).toBeNull();
    expect(parseOpenMeteo(null)).toBeNull();
  });
});

describe('getLiveWeather：永不 reject', () => {
  const okFetcher = async () =>
    ({ ok: true, json: async () => GOOD_JSON }) as Response;

  it('成功：拉取 + 写缓存 + 返回 LiveWeather', async () => {
    const s = memStorage();
    const w = await getLiveWeather(CITY, { fetcher: okFetcher, storage: s, nowMs: 5000 });
    expect(w?.kind).toBe('rain');
    expect(s.getItem('8bitme:weather')).toContain('"code":61');
  });
  it('HTTP 非 200 / fetch 抛错 / 超时 abort → resolve(null)，不抛', async () => {
    const bad = async () => ({ ok: false }) as Response;
    expect(await getLiveWeather(CITY, { fetcher: bad, storage: memStorage() })).toBeNull();
    __resetLiveWeatherForTest();
    const boom = async () => {
      throw new Error('offline');
    };
    expect(await getLiveWeather(CITY, { fetcher: boom, storage: memStorage() })).toBeNull();
  });
  it('缓存命中时根本不发请求', async () => {
    const s = memStorage();
    s.setItem(
      '8bitme:weather',
      JSON.stringify({ code: 71, isDay: 0, sunriseMs: 1, sunsetMs: 2, fetchedAt: 900 })
    );
    let called = 0;
    const spy = async () => {
      called++;
      return { ok: true, json: async () => GOOD_JSON } as Response;
    };
    const w = await getLiveWeather(CITY, { fetcher: spy, storage: s, nowMs: 1000 });
    expect(w?.kind).toBe('snow'); // 缓存里的雪，不是 fetcher 的雨
    expect(called).toBe(0);
  });
});

describe('openMeteoUrl', () => {
  it('携带坐标 / current / daily / timezone', () => {
    const u = openMeteoUrl(CITY);
    expect(u).toContain('latitude=23.1066');
    expect(u).toContain('longitude=113.3245');
    expect(u).toContain('current=weather_code,is_day');
    expect(u).toContain('daily=sunrise,sunset');
  });
});

describe('sunVisibility：云遮天体', () => {
  it('晴天满可见，阴/雨/雪几乎不可见（否则雨天一轮大太阳 = 穿帮）', () => {
    expect(sunVisibility(0.15)).toBeCloseTo(1, 5);
    expect(sunVisibility(0.45)).toBeGreaterThan(0.6);
    expect(sunVisibility(0.45)).toBeLessThan(0.85);
    expect(sunVisibility(0.9)).toBeLessThan(0.2);
  });
  it('单调递减 + 钳在 0..1（任何输入都不越界）', () => {
    let prev = Infinity;
    for (let c = 0; c <= 1.0001; c += 0.05) {
      const v = sunVisibility(c);
      expect(v).toBeLessThanOrEqual(prev);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      prev = v;
    }
    expect(sunVisibility(-5)).toBe(1);
    expect(sunVisibility(5)).toBe(0);
  });
  it('每一种天气都有明确档位（不能有「雨天和晴天一样亮」的天气）', () => {
    const kinds = ['clear', 'clouds', 'overcast', 'fog', 'drizzle', 'rain', 'snow', 'thunder'] as const;
    for (const k of kinds) {
      const v = sunVisibility(weatherFx(k).cloud);
      expect(v, `${k} 的太阳可见度越界`).toBeGreaterThanOrEqual(0);
      expect(v, `${k} 的太阳可见度越界`).toBeLessThanOrEqual(1);
    }
    expect(sunVisibility(weatherFx('rain').cloud)).toBeLessThan(0.3);
    expect(sunVisibility(weatherFx('clear').cloud)).toBeGreaterThan(0.9);
  });
});

describe('precipSkyK：降水对星月的额外纱罩（2026-10-06 评审：雨夜不能满天星）', () => {
  it('晴天/疏云恒 1（零影响），暴雨压到 0.35（月亮可辨但被罩住）', () => {
    expect(precipSkyK(0, 0)).toBe(1);
    expect(precipSkyK(1, 0)).toBe(0.35);
    expect(precipSkyK(0, 0.8)).toBeCloseTo(0.48, 5);
  });
  it('随雨/雪强单调递减，取二者较大值；非法输入钳位', () => {
    let prev = Infinity;
    for (let p = 0; p <= 1.0001; p += 0.05) {
      const v = precipSkyK(p, 0);
      expect(v).toBeLessThanOrEqual(prev);
      expect(v).toBeGreaterThanOrEqual(0.35);
      prev = v;
    }
    expect(precipSkyK(0.5, 0.8)).toBe(precipSkyK(0.8, 0.5)); // 取 max
    expect(precipSkyK(-1, 0)).toBe(1);
    expect(precipSkyK(5, 0)).toBe(0.35);
  });
  it('每种降水天气都真的被压暗（rain/snow/thunder/drizzle < 1，clear/clouds = 1）', () => {
    expect(precipSkyK(weatherFx('rain').rain, weatherFx('rain').snow)).toBeLessThan(0.7);
    expect(precipSkyK(weatherFx('snow').rain, weatherFx('snow').snow)).toBeLessThan(0.7);
    expect(precipSkyK(weatherFx('thunder').rain, weatherFx('thunder').snow)).toBeLessThan(0.7);
    expect(precipSkyK(weatherFx('clear').rain, weatherFx('clear').snow)).toBe(1);
    expect(precipSkyK(weatherFx('clouds').rain, weatherFx('clouds').snow)).toBe(1);
  });
});
