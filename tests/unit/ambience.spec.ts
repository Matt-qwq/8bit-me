import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ambientMix,
  crossfadeNoiseLoop,
  RAIN_SURGE_PEAK,
  RAIN_SURGE_RISE_MS,
  RAIN_SURGE_TAIL_MS,
  rainLoopVolume,
  rainSurgeFactor,
  thunderStrike,
} from '../../src/lib/ambience';
import { mulberry32 } from '../../src/lib/sky-scene';
import { weatherFx } from '../../src/lib/weather';

/* ---------- ambientMix：天气 → 混音参数（纯函数，只剩风） ---------- */

/** 三种天气的 rain/wind 取自 weather.ts 的实况参数表（不另造一套数） */
const CLEAR = weatherFx('clear'); // rain 0, wind 0.12
const DRIZZLE = weatherFx('drizzle'); // rain 0.35, wind 0.4
const RAIN0 = weatherFx('rain'); // rain 0.7, wind 0.55
const THUNDER = weatherFx('thunder'); // rain 1, wind 0.85

describe('ambientMix：天气 → 混音参数（雨已改播录音，混音只剩风）', () => {
  it('输出只有 windGain 一个槽（雨不再进 Web Audio 合成，键不许残留）', () => {
    expect(Object.keys(ambientMix({ rain: 0.7, wind: 0.55 }))).toEqual(['windGain']);
    for (const fx of [CLEAR, DRIZZLE, RAIN0, THUNDER]) {
      expect(ambientMix(fx)).toEqual({ windGain: fx.wind * 0.09 });
    }
  });

  it('风强递增 → windGain 严格递增', () => {
    const a = ambientMix(DRIZZLE);
    const b = ambientMix(RAIN0);
    const c = ambientMix(THUNDER);
    expect(a.windGain).toBeLessThan(b.windGain);
    expect(b.windGain).toBeLessThan(c.windGain);
  });

  it('非负且不过量：风增益 ≤0.09（master 0.9 之上再叠雷也不能削顶）', () => {
    for (const fx of [CLEAR, DRIZZLE, RAIN0, THUNDER]) {
      const mix = ambientMix(fx);
      expect(mix.windGain).toBeGreaterThanOrEqual(0);
      expect(mix.windGain).toBeLessThanOrEqual(0.09);
    }
    expect(ambientMix({ rain: 1, wind: 1 }).windGain).toBeCloseTo(0.09, 10);
  });

  it('雨强不影响混音（雨的听感走录音音量，不在这里二次叠加）', () => {
    expect(ambientMix({ rain: 0, wind: 0.55 })).toEqual(
      ambientMix({ rain: 1, wind: 0.55 })
    );
  });
});

/* ---------- rainLoopVolume：雨强 → 录音音量（纯函数） ---------- */

describe('rainLoopVolume：雨强 → 真实雨声循环音量', () => {
  it('实值：drizzle 0.4775 / rain 0.705 / thunder 0.9（作者定的三档听感）', () => {
    expect(rainLoopVolume(DRIZZLE.rain)).toBeCloseTo(0.4775, 10);
    expect(rainLoopVolume(RAIN0.rain)).toBeCloseTo(0.705, 10);
    expect(rainLoopVolume(THUNDER.rain)).toBeCloseTo(0.9, 10);
  });

  it('rain = 0 → 0.25（只管「下雨时的量」；晴天由 applyRain 门控成 0，不进这个函数）', () => {
    expect(rainLoopVolume(0)).toBeCloseTo(0.25, 10);
    expect(rainLoopVolume(CLEAR.rain)).toBeCloseTo(0.25, 10);
  });

  it('单调递增，三档之间有声压差（不是三档一样响）', () => {
    const seq = [0, 0.35, 0.7, 1].map(rainLoopVolume);
    for (let i = 1; i < seq.length; i++) expect(seq[i]).toBeGreaterThan(seq[i - 1]!);
    expect(seq[3]! - seq[1]!).toBeGreaterThan(0.3);
  });

  it('clamp 到 0..1（越界输入不抛、也不把 volume 写成非法值）', () => {
    for (const v of [-100, -1, -0.4, 0, 1, 1.5, 100]) {
      const out = rainLoopVolume(v);
      expect(out).toBeGreaterThanOrEqual(0);
      expect(out).toBeLessThanOrEqual(1);
    }
    expect(rainLoopVolume(-1)).toBe(0);
    expect(rainLoopVolume(2)).toBe(1);
    expect(rainLoopVolume(Number.NaN)).toBe(0);
    expect(rainLoopVolume(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

/* ---------- crossfadeNoiseLoop：环绕点连续（风/雷共用白噪的接缝修复） ---------- */

/** 一段给定种子的白噪（与 makeNoise 同分布：`Math.random() * 2 - 1`，但不依赖 AudioContext） */
function noiseData(len: number, seed: number): Float32Array {
  const rng = mulberry32(seed);
  const data = new Float32Array(len);
  for (let i = 0; i < len; i++) data[i] = rng() * 2 - 1;
  return data;
}

/** 环绕点差值 = |末采样 − 首采样|：循环播放时每圈就砸这一次阶跃，就是那声「咚」 */
const seamStep = (d: Float32Array): number => Math.abs(d[d.length - 1]! - d[0]!);

/** 48kHz × 20ms（浏览器实况的 fade 长度；算法本身与采样率无关） */
const FADE = 960;
const NOISE_LEN = 96000; // 48kHz × 2s = NOISE_SEC，与运行时同长度

/** 尾部 20ms 窗的方差：防「把尾巴削平/削到 0」这种假修法（连续了，但能量没了） */
function tailVariance(d: Float32Array, n: number): number {
  let sum = 0;
  let sum2 = 0;
  for (let i = d.length - n; i < d.length; i++) {
    sum += d[i]!;
    sum2 += d[i]! * d[i]!;
  }
  const mean = sum / n;
  return sum2 / n - mean * mean;
}

describe('crossfadeNoiseLoop：环绕点连续（风链与雷声仍在共用这份循环白噪）', () => {
  it('反例自检：不交叉淡化时环绕点就是一次独立随机跳变（判据必须红得起来）', () => {
    for (const seed of [1, 7, 42, 1234]) {
      // 白噪逐点独立 → 环点差值是「两个独立随机值之差」，量级 ~0.67（不是 0）
      expect(seamStep(noiseData(NOISE_LEN, seed))).toBeGreaterThan(0.05);
    }
  });

  it('交叉淡化后环绕点连续：残余降到 1/fade 量级（比内部相邻采样低两个数量级）', () => {
    for (const seed of [1, 7, 42, 1234]) {
      const d = noiseData(NOISE_LEN, seed);
      crossfadeNoiseLoop(d, FADE);
      // 数学上界：|(1−k)·tail + k·data[0] − data[0]| = (1−k)|tail − data[0]| ≤ 2/fade
      expect(seamStep(d)).toBeLessThanOrEqual(2 / FADE + 1e-6);
      // 白噪内部相邻采样的典型跳变是 ~0.67；环点低到千分之一以下
      expect(seamStep(d)).toBeLessThan(1 / 100);
    }
  });

  it('真的在做「尾部 → 头部」淡化，且只动尾部（前一半一个采样都不碰）', () => {
    const src = noiseData(NOISE_LEN, 5);
    const d = Float32Array.from(src);
    crossfadeNoiseLoop(d, FADE);
    const n = FADE;
    // i = n−1 处 k → (n−1)/n：末采样 = 原尾/n + data[0]·(n−1)/n
    expect(d[d.length - 1]).toBeCloseTo(
      src[src.length - 1]! / n + src[0]! * ((n - 1) / n),
      6
    );
    for (let i = 0; i < NOISE_LEN - n; i++) expect(d[i]).toBe(src[i]);
    // 尾部也不是被削平/静音换来的连续（长度 fades，能量仍在）
    expect(tailVariance(d, n)).toBeGreaterThan(0.1);
  });

  it('退化输入不抛：空/超短 buffer、fade 超大或非法（夹到 len/2 后仍要连续）', () => {
    expect(() => crossfadeNoiseLoop(new Float32Array(0), FADE)).not.toThrow();
    expect(() => crossfadeNoiseLoop(new Float32Array(3), FADE)).not.toThrow();
    expect(() => crossfadeNoiseLoop(noiseData(100, 3), 0)).not.toThrow();
    expect(() => crossfadeNoiseLoop(noiseData(100, 3), -5)).not.toThrow();
    expect(() => crossfadeNoiseLoop(noiseData(100, 3), 1e6)).not.toThrow();
    const d = noiseData(100, 3);
    crossfadeNoiseLoop(d, 1e6); // 夹到 len/2
    expect(seamStep(d)).toBeLessThanOrEqual(2 / 50 + 1e-6);
  });
});

/* ---------- thunderStrike：闪的强弱抽签（雷声已移除，纯函数只剩 near） ---------- */

/**
 * 雷声已移除（2026-09-23 作者裁决：「算了，不要雷声了，太吓人了」）。
 * 抽签保留：近亮/远弱决定**闪**的强度（随机强度，作者「别像循环」）；
 * delay/vol/rate 全部随雷声一起退役。
 */
describe('thunderStrike：闪的近亮/远弱抽签', () => {
  it('确定性：同种子同结果', () => {
    expect(thunderStrike(mulberry32(42))).toEqual(thunderStrike(mulberry32(42)));
  });

  it('近亮占比 ≈ 70%（400 签 0.6–0.8），且只含 near 一个字段', () => {
    let near = 0;
    for (let seed = 0; seed < 400; seed++) {
      const k = thunderStrike(mulberry32(seed));
      expect(Object.keys(k).sort()).toEqual(['near']);
      if (k.near) near++;
    }
    expect(near / 400).toBeGreaterThan(0.6);
    expect(near / 400).toBeLessThan(0.8);
  });

  it('rng = 1 边界：归入远弱档（< 0.7 判近）', () => {
    expect(thunderStrike(() => 1).near).toBe(false);
    expect(thunderStrike(() => 0).near).toBe(true);
    expect(thunderStrike(() => 0.69).near).toBe(true);
    expect(thunderStrike(() => 0.7).near).toBe(false);
  });
});

/* ---------- 阵性涌动：雷与雨声节奏互相配合 ---------- */

describe('rainSurgeFactor：雷响雨涌（快升慢退的包络）', () => {
  it('形状：0 → 0；升段在 RISE 处到峰 1；之后线性退到 0', () => {
    expect(rainSurgeFactor(0)).toBe(0);
    expect(rainSurgeFactor(-5)).toBe(0); // 负值（从未响过 / 时钟回拨）安全归零
    expect(rainSurgeFactor(400)).toBeCloseTo(0.5, 5);
    expect(rainSurgeFactor(RAIN_SURGE_RISE_MS)).toBeCloseTo(1, 5);
    expect(rainSurgeFactor(RAIN_SURGE_RISE_MS + RAIN_SURGE_TAIL_MS / 2)).toBeCloseTo(0.5, 5);
    expect(rainSurgeFactor(RAIN_SURGE_RISE_MS + RAIN_SURGE_TAIL_MS)).toBe(0);
    expect(rainSurgeFactor(RAIN_SURGE_RISE_MS + RAIN_SURGE_TAIL_MS + 9999)).toBe(0);
  });

  it('快升慢退：升段斜率（1/RISE）显著大于退段斜率（1/TAIL）', () => {
    expect(1 / RAIN_SURGE_RISE_MS).toBeGreaterThan((1 / RAIN_SURGE_TAIL_MS) * 5);
  });

  it('涌动真的接进雨声目标：applyRain 乘 (1 + PEAK × factor)，基准不变', () => {
    expect(applyRainBody).toContain('rainSurgeFactor(Date.now() - lastStrikeMs)');
    expect(applyRainBody).toContain('RAIN_SURGE_PEAK * surge');
    expect(applyRainBody).toContain('rainLoopVolume(fx.rain)');
    // 闪电时刻记录锚点（雷声已移除，涌动改绑闪电：noteThunderFlash 由 BgFx 调）
    expect(bodyOf('export function noteThunderFlash', '// ---------------- 手势解锁（浏览器自动播放策略）')).toContain(
      'lastStrikeMs = Date.now()'
    );
    expect(RAIN_SURGE_PEAK).toBeGreaterThan(0.05);
    expect(RAIN_SURGE_PEAK).toBeLessThan(0.3);
  });
});


/* ---------- 运行时接线契约 ---------- */

/**
 * 本文件上半段全是纯函数；录音元素、淡出定时器、手势解锁这些接线在浏览器里，
 * node 环境跑不了（见模块头「不做单测」）。它们恰好又是「雨声换录音」这件事的
 * 全部要害（路径带不带 base、失败是否静默、晴天下不下雨漏不漏底噪），
 * 所以用源码契约守住（与 tests/unit/line-hierarchy.spec.ts 同一手法）。
 */
const ROOT = process.cwd();
const SRC = readFileSync(join(ROOT, 'src/lib/ambience.ts'), 'utf-8').replace(
  /\r\n/g,
  '\n'
);

/** 从源码取 `const NAME = <数>;` 的值（不写死数字：后续调参不该让测试红） */
function constOf(name: string): number {
  const m = SRC.match(new RegExp(`const ${name} = (-?[\\d.]+);`));
  expect(m, `源码里找不到常量 ${name}`).not.toBeNull();
  return Number(m![1]);
}

/** applyRain 函数体切片：涌动接线断言专用 */
const applyRainBody = (() => {
  const start = SRC.indexOf('function applyRain');
  expect(start, '找不到 applyRain').toBeGreaterThan(0);
  const end = SRC.indexOf('/** 重置 / 拆掉：停表、丢引用、摘监听、清 src', start);
  return SRC.slice(start, end > start ? end : start + 1200);
})();

/** 函数体切片（从某标记到下一标记），用来断言「某段接线里确实做了某事」 */
function bodyOf(from: string, to: string): string {
  const a = SRC.indexOf(from);
  const b = to ? SRC.indexOf(to) : SRC.length;
  expect(a, `源码里找不到 ${from}`).toBeGreaterThanOrEqual(0);
  expect(b, `源码里找不到 ${to}`).toBeGreaterThan(a);
  return SRC.slice(a, b);
}

describe('运行时接线：合成雨链退役（源码契约）', () => {
  it('雨幕体链与碎响链的节点/常量全部删净（不然老链会和新录音一起响）', () => {
    for (const dead of [
      'rainGain',
      'lp1',
      'lp2',
      'patterFilter',
      'patterGain',
      'flutterDepthA',
      'flutterDepthB',
      'bodyDepth',
      'RAIN_FLUTTER',
      'RAIN_LP2_RATIO',
      'RAIN_PATTER',
      'RAIN_BODY',
      'RAIN_MIN_HZ',
      'RAIN_Q',
    ]) {
      expect(SRC, `合成雨链残留：${dead}`).not.toContain(dead);
    }
    // 雨声只剩录音一条路：模块里不许再出现「雨 → master」这类 Web Audio 接线
    expect(SRC).not.toMatch(/rain\w*\.connect/);
  });

  it('ambientMix 不再有雨槽（风链仍在用），且风链拓扑完整', () => {
    const start = bodyOf('function startEngine', 'function applyMix');
    expect(start).toContain('makeNoise(c)');
    expect(start).toContain('gustGain.connect(windGain.gain)');
    expect(start).toContain('windSrc.start()');
    expect(SRC).toMatch(/sources: \[windSrc\]/);
    expect(SRC).toMatch(/oscs: \[gustOsc\]/);
    // 雷声已移除：引擎里不许再有雷的 burst 链（noise 只服务风）
    expect(SRC).not.toContain('synthRumble');
    expect(SRC).not.toContain('rumbleBursts');
    expect(SRC).not.toContain('RUMBLE_LP');
  });

  it('风链五处接线不落下（创建 / 写入 / 淡出 / 重置）', () => {
    const regions: [string, string][] = [
      ['function startEngine', 'function applyMix'],
      ['function applyMix', 'function rampDown'],
      ['function rampDown', 'export function updateAmbient'],
      ['export function __resetAmbienceForTest', ''],
    ];
    for (const [from, to] of regions) {
      expect(bodyOf(from, to), `${from} 段漏了 windGain`).toContain('windGain');
    }
    // 阵风深度必须在「写入」与「淡出」两处都归零（只淡风不淡阵风 = 淡出后仍在抖）
    expect(bodyOf('function applyMix', 'function rampDown')).toContain('gustGain');
    expect(bodyOf('function rampDown', 'export function updateAmbient')).toContain(
      'gustGain'
    );
    expect((SRC.match(/gustGain\.gain/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('makeNoise 真的调用被单测覆盖的 crossfadeNoiseLoop，淡化时长在 10–50ms', () => {
    expect(SRC).toMatch(
      /crossfadeNoiseLoop\(data, Math\.round\(c\.sampleRate \* NOISE_FADE_SEC\)\)/
    );
    const fade = constOf('NOISE_FADE_SEC');
    expect(fade).toBeGreaterThanOrEqual(0.01); // 太短：抹不平阶跃
    expect(fade).toBeLessThanOrEqual(0.05); // 太长：尾巴本身听得见拼接
  });
});

describe('运行时接线：雨声录音（源码契约）', () => {
  it('录音路径带 base（子路径部署下裸 /audio/… 会 404，而录音失败是静默的）', () => {
    expect(SRC).toMatch(/const RAIN_AUDIO_SRC = url\('audio\/rain-loop\.mp3'\)/);
    expect(SRC, '裸绝对路径会在 ASTRO_BASE=/8bit-me/ 下 404').not.toContain(
      "'/audio/rain-loop.mp3'"
    );
  });

  it('惰性创建：new Audio 只在 rainElement 建一个（雷声已移除，不再有第二处），模块加载期不建元素也不播', () => {
    expect((SRC.match(/new Audio\(/g) ?? []).length).toBe(1); // 只有雨
    const body = bodyOf('function rainElement', 'function setRainVolume');
    expect(body).toContain('new Audio(RAIN_AUDIO_SRC)');
    expect(body).toContain('a.loop = true'); // 循环：录音只有几秒
    expect(body).toContain("a.preload = 'auto'");
    expect(body).toContain('a.volume = 0'); // 从 0 起：首帧下雨也是淡入而不是「啪」
    // 模块顶层（imports 之后到第一个函数之前）不许有 play()
    const top = SRC.slice(0, SRC.indexOf('function quietPause'));
    expect(top).not.toMatch(/\.play\(/);
  });

  it('失败静默：error 事件永久禁用（丢引用 + stop 表 + 不再重试），且 play() 的 promise 被 catch', () => {
    const handler = bodyOf('function onRainAudioError', 'function rainElement');
    expect(handler).toContain('rainAudioDisabled = true');
    expect(handler).toContain('rainAudio = null');
    expect(handler).toContain('stopRainFade()');
    expect(handler).not.toMatch(/rainAudioDisabled = false/); // 不许偷偷复活
    expect(bodyOf('function rainElement', 'function setRainVolume')).toContain(
      "a.addEventListener('error', onRainAudioError)"
    );
    const play = bodyOf('function ensureRainPlay', 'function stopRainFade');
    expect(play).toContain('a.play()');
    expect(play, 'play() 被自动播放策略拒绝时不能把异常抛到页面').toMatch(/\.catch\(/);
  });

  it('音量步进淡入淡出：步长/周期成对合理，到位即 clearInterval，淡到 0 就 pause', () => {
    const ms = constOf('RAIN_FADE_MS');
    const step = constOf('RAIN_FADE_STEP');
    expect(ms).toBeGreaterThanOrEqual(10);
    expect(ms).toBeLessThanOrEqual(100);
    expect(step).toBeGreaterThan(0);
    expect(step).toBeLessThanOrEqual(0.2);
    // 淡出速度：0.5–5 音量/秒（慢于 0.5 像卡住，快于 5 会「咔」）
    const perSec = step / (ms / 1000);
    expect(perSec).toBeGreaterThanOrEqual(0.5);
    expect(perSec).toBeLessThanOrEqual(5);
    const fade = bodyOf('function stepRainFade', 'function rainSetTarget');
    expect(fade).toContain('quietPause(a)'); // 到 0 后 pause 省电
    expect(fade).toContain('stopRainFade()');
    expect(bodyOf('function stopRainFade', 'function ensureRainFade')).toContain(
      'clearInterval'
    );
    // 音量写入一律走 clamp（HTMLMediaElement.volume 越界会抛 IndexSizeError）
    expect(bodyOf('function setRainVolume', 'function ensureRainPlay')).toContain(
      'clamp01'
    );
  });

  it('play() 只在「有雨」这条路上被调：rainSetTarget(>0) 才建元素 + 播', () => {
    const setTarget = bodyOf('function rainSetTarget', 'function applyRain');
    const zeroBranch = setTarget.slice(0, setTarget.indexOf('const a = rainElement()'));
    expect(zeroBranch, '目标 0 的分支不许碰播放路径（含 ensureRainPlay）').not.toMatch(
      /ensureRainPlay|\.play\(/
    );
    expect(zeroBranch).toContain('return');
    expect(setTarget).toContain('rainElement()');
    expect(setTarget).toContain('ensureRainPlay(a)');
  });

  it('晴天门控在调用方：rain = 0 时目标是 0（不靠 rainLoopVolume 出静音特例）', () => {
    const gate = bodyOf('function applyRain', 'function releaseRainAudio');
    expect(gate).toContain('fx.rain > 0');
    expect(gate).toContain('sfxPref.get()');
    expect(gate).toContain('rainLoopVolume(fx.rain)');
    // 停雨 / 静音 / fx 为 null 都走同一个 0 目标
    expect(gate).toContain('rainSetTarget(0)');
  });

  it('雨声不被 AudioContext 的失败连坐：updateAmbient 里 applyRain 排在引擎早退之前', () => {
    const body = bodyOf('export function updateAmbient', '// ---------------- 雷');
    const rainAt = body.indexOf('applyRain(fx)');
    const engineAt = body.indexOf('if (!startEngine()) return;');
    expect(rainAt, 'updateAmbient 没驱雨声').toBeGreaterThanOrEqual(0);
    expect(engineAt).toBeGreaterThan(rainAt);
    // 手势解锁同理：引擎 disabled 也要把 play() 放进这次真实手势里
    const gesture = bodyOf('function onFirstGesture', 'function attachUnlock');
    expect(gesture).toContain('applyRain(lastFx)');
    expect(gesture).not.toMatch(/if \(disabled\) return/);
    expect(SRC, 'disabled 只该管引擎，不该拦住雨声').toMatch(
      /只影响风与雷/
    );
  });

  it('reset 清干净：停表 + 丢引用 + 摘监听 + 清 src，并复位禁用标记', () => {
    expect(bodyOf('export function __resetAmbienceForTest', '')).toContain(
      'releaseRainAudio()'
    );
    const release = bodyOf('function releaseRainAudio', 'interface Engine');
    expect(release).toContain('stopRainFade()');
    expect(release).toContain('a.pause()');
    expect(release).toContain('rainAudio = null');
    expect(release).toContain("a.removeEventListener('error', onRainAudioError)");
    expect(release).toContain("a.removeAttribute('src')");
    expect(release).toContain('a.load()');
  });
});

describe('运行时接线：雷声移除（源码契约）', () => {
  it('雷声链删净：录音池 / pickThunderIndex / synthRumble / thunderClap 不许残留', () => {
    for (const dead of [
      'THUNDER_SOURCES',
      'pickThunderIndex',
      'thunderAudios',
      'thunderBad',
      'lastThunderIdx',
      'preBufferThunder',
      'playThunderClap',
      'releaseThunderAudio',
      'thunderClap',
      'thunderRumble',
      'synthRumble',
      'rumbleBursts',
      'THUNDER_AUDIO_SRC',
      'thunder-strike',
      'thunder-close',
      'thunder-crack',
      'thunder-through-window',
    ]) {
      expect(SRC, `雷声残留：${dead}`).not.toContain(dead);
    }
  });

  it('雨声涌动锚点改绑闪电：BgFx 在闪电那一帧调 noteThunderFlash', () => {
    const bg = readFileSync(join(ROOT, 'src/components/BgFx.astro'), 'utf-8').replace(
      /\r\n/g,
      '\n'
    );
    // 闪触发时抽签定强弱；涌动锚点随闪电走（不再有雷声）
    expect(bg).toContain('const strike = thunderStrike(Math.random)');
    expect(bg).toMatch(/flashPeak = strike\.near \? 1 : 0\.55/);
    expect(bg).toContain('noteThunderFlash()');
    expect(bg).not.toContain('thunderRumble');
    expect(bg).not.toContain('thunderClap');
    // 簇式调度：nextThunderStrike 维护 streak，破匀速循环
    expect(bg).toContain('nextThunderStrike(frame, thStreak, Math.random)');
    expect(bg).toContain('thStreak = sched.inCluster ? thStreak + 1 : 0');
    expect(bg).not.toContain('nextLightning');
    // 闪罩：暖白渐变（不是全屏纯白）+ 峰值乘 flashPeak（远闪弱）
    expect(bg).toContain('rgba(255,243,220');
    expect(bg).toContain('createLinearGradient');
    expect(bg).toMatch(/0\.5 \* flashPeak \* p \* p/);
  });

  it('闪电的强弱抽签常量仍在源码里（近亮 70%）', () => {
    expect(SRC).toContain('THUNDER_CLOSE_P = 0.7');
  });
});
