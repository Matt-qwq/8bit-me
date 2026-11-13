/**
 * ambience —— 「窗外」环境音：**雨声与雷击放真实录音**，只剩风走 Web Audio 合成
 * （ADR-0020 的听觉一侧）。
 *
 * 设计契约：
 * - **画面与声音同源**：雨声音量只由天气参数 `rain` 推出，风声只由 `wind` 推出——
 *   雨大则雨声更响，风大则风声更响、阵风更深。画面在动而声音能对上，才像「窗外」
 *   而不是「播放器」。
 * - **惰性 + 手势解锁**：AudioContext 不在页面加载时创建（会撞浏览器自动播放策略，
 *   且给不看的访客白烧 CPU）。首次 pointerdown/keydown 且当时已有 pending 天气参数
 *   才点火；此后 updateAmbient 每分钟级调用只做平滑滑音。录音元素同理惰性创建，
 *   只在「真的有雨」时才 new + play()。
 *   注意手势监听是 `once: true`（只跑一次）：若它跑的时候还没有 pending 参数（或当时
 *   静音），这次手势就白被消费了 —— 所以 updateAmbient 每次会顺手 kick 一下可能处于
 *   suspended 的 ctx 兜底，下次手势也会补解锁。
 * - **静音偏好复用 sfxPref**（`8bitme:sfx`，不新开键）：一次开关同时管 chip-tune
 *   SFX 与环境音，作者的「静音」语义才完整。updateAmbient 每次都重查，
 *   切静音后 ≤1s（调用周期）环境音淡出。
 * - **失败一律静默**：拿不到 AudioContext / resume 被拒 / 录音 404 / 任何异常都只
 *   影响声音，页面永不因音频报错（与 weather.ts 「静默降级」同一纪律）。
 *
 * **为什么雨声从合成换成录音（2026-09-22 作者裁决：「为什么不用真实雨声？」）**：
 * Web Audio 白噪改了三版都没过 —— ① 单级 bandpass(1100–2600Hz, Q 0.5) 其实是一条
 * 横跨中高频的宽带通，听感是电视雪花屏；② 白噪 buffer 只有 2s 且首尾硬接，环绕点
 * 每 2 秒一次阶跃，听感是一声闷响（作者实抓「跟心跳一样，很有压力感，听着烦」）；
 * ③ 修掉接缝、拆成暗频谱雨幕体 + 高频碎响两层之后，仍被判「太吵」。
 * 结论不是参数没调好，是**方法错了**：环境声是拟真物（窗外真的在下雨），白噪再叠
 * 低通也只是「噪声像雨」；而像素复古语言属于视觉与 UI 音效（chip-tune 的 SFX 照旧），
 * 不该拿去管天气。所以雨改播 CC0 录音循环 `public/audio/rain-loop.mp3`
 * （OpenGameArt — AMB Rain Loop 1，作者 kresiek-the-furry）。
 *
 * **雷声已移除（2026-09-23 作者裁决：「算了，不要雷声了，太吓人了」）**：
 * 两任真实雷击录音（OGA Jerimee / freesound 四段池）都试过，作者最终只要安静 ——
 * 雷暴保留**视觉**（闪电簇式调度 + 暖白渐变罩，见 BgFx / nextThunderStrike），
 * 但**不出声**。雨声照旧；雨声阵性涌动保留，触发点改到**闪电时刻**（`noteThunderFlash`，
 * 由 BgFx 在闪电那一帧调）——雷暴的雨势起伏与闪电同源，与「雷雨配合」同一直觉。
 * 合成 rumble 与录音池也一并退役：雷声没了，它们的存在理由也就没了，
 * 雷声没了它也没意义了。
 * 风仍走合成：风是唯一的**连续**环境声，录音循环的接缝比合成贵。
 *
 * 纯逻辑（ambientMix / rainLoopVolume / rainSurgeFactor）在
 * tests/unit/ambience.spec.ts；运行时路径依赖 AudioContext 与 HTMLAudioElement，
 * node 环境不存在，故不做单测（以源码契约守住接线）。
 */

import { url } from './config';
import { sfxPref } from './prefs';

/** 夹到 0..1（音量槽：AudioParam 与 HTMLMediaElement.volume 都只吃这个区间，越界会抛） */
function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

// ---------------- 纯函数：天气 → 混音参数 ----------------

/** 环境音混音参数（纯函数输出，运行时只负责把它写到节点上） */
export interface AmbientMix {
  /** 风链目标增益 0..0.09 */
  windGain: number;
}

/**
 * 天气参数 → 混音参数（纯函数，单测锁死单调性与量级）。
 * 只剩风：雨声已改播录音，不再经过 Web Audio 合成（见文件头）。入参形状保留
 * `{ rain, wind }`（调用方原样传 WeatherFx 子集），不为了少一个字段去动调用点。
 */
export function ambientMix(fx: { rain: number; wind: number }): AmbientMix {
  return { windGain: fx.wind * 0.09 };
}

/**
 * 雨强 → 真实雨声循环的音量 0..1（纯函数）。
 * 实值：drizzle(0.35) 0.4775 / rain(0.7) 0.705 / thunder(1) 0.9。
 * 只管「下雨时的量」：雨停（rain = 0）由调用方 gate 成 0，不在这里给静音特例，
 * 否则 0.25 的底噪会在晴天一直躺着（静音时漏出底噪，是环境音最容易犯的错）。
 */
export function rainLoopVolume(rain: number): number {
  return clamp01(0.25 + rain * 0.65);
}

/**
 * 噪声 buffer 的「环绕点」修复：把尾部 fade 个采样与头部交叉淡化。
 *
 * 交叉淡化的目标索引取**反向对齐的头部采样**（`data[fade - 1 - i]`），于是权重 k 走到
 * i = fade - 1 时恰好落在 `data[0]` 上 —— 尾部末采样 ≈ 头部首采样，环绕点两侧取值连续。
 * 若照直取 `data[i]` 作目标，末尾落在 `data[fade - 1]` 上，环点两侧仍是两个独立随机值
 * ——交叉了但没有连续。
 *
 * 纯函数（只碰 Float32Array），单测直接验证「环点差值」与「只动尾部」。
 * 雨链退役后这段仍在用：风链与雷声 burst 共用同一份循环白噪。
 */
export function crossfadeNoiseLoop(data: Float32Array, fade: number): void {
  const len = data.length;
  if (len < 4) return;
  const n = Math.max(1, Math.min(fade, Math.floor(len / 2)));
  for (let i = 0; i < n; i++) {
    const k = i / n;
    const j = len - n + i;
    data[j] = data[j]! * (1 - k) + data[n - 1 - i]! * k;
  }
}

// ---------------- 运行时参数 ----------------

/** 白噪 buffer 长度 s（风、雷共用；循环播放） */
const NOISE_SEC = 2;
/**
 * 噪声 buffer 首尾交叉淡化时长 s（20ms）。
 * 为什么必须有：白噪是逐点随机的，环绕点（末采样 → 首采样）也是一次随机跳变，
 * 经低通后成一个阶跃冲击，每 NOISE_SEC 就响一下。
 */
const NOISE_FADE_SEC = 0.02;
/** 风链带通：低频呼啸段 */
const WIND_HZ = 320;
const WIND_Q = 1.1;
/** master 总增益 */
const MASTER_GAIN = 0.9;
/** 阵风 LFO：0.07Hz（≈14s 一阵，比人耳能听出的颤音慢得多，只是「忽大忽小」） */
const GUST_HZ = 0.07;
/** 阵风深度 = 风增益目标值的比例（±60% 起伏） */
const GUST_DEPTH = 0.6;
/** 滑音时间常数 s：风强变化无感切换（约 3τ ≈ 3s 到位） */
const SMOOTH_TAU = 0.9;

/**
 * 雨声录音的路径。必须带 base：子路径部署（ASTRO_BASE=/8bit-me/）下裸写
 * `/audio/rain-loop.mp3` 会 404，而 HTMLAudio 的失败是**静默**的（只发 error 事件），
 * 没人会发现雨没了。所以与 BaseLayout 引字体同一口径，走 lib/config.ts 的 url()。
 */
const RAIN_AUDIO_SRC = url('audio/rain-loop.mp3');
/** 雨声音量淡入淡出的步进周期 ms（30ms×0.03 ≈ 1s 走完 0..0.9，听不出台阶） */
const RAIN_FADE_MS = 30;
/** 每步音量增量（配合 RAIN_FADE_MS 定淡出时长；只求「切雨/切静音时不咔」） */
const RAIN_FADE_STEP = 0.03;

// ---------------- 雨声：真实录音循环（HTMLAudio，独立于 Web Audio 引擎） ----------------

/** 天气参数（weather.ts 的 WeatherFx 子集）—— 环境音只需要这两个量 */
export interface AmbientFx {
  rain: number;
  wind: number;
}

/** 录音元素（惰性创建；失败即永久置 null） */
let rainAudio: HTMLAudioElement | null = null;
/** 录音不可用（构造抛错 / error 事件）→ 永远不再重试，页面永不因音频报错 */
let rainAudioDisabled = false;
/** 目标音量（0..1）：步进淡出只朝它走 */
let rainTarget = 0;
/** 淡出步进定时器（到位即 clear，不空转） */
let rainFadeTimer: ReturnType<typeof setInterval> | null = null;

// ---------------- 阵性涌动：雷打起来，雨声跟着涌一下再退掉 ----------------
// 雷暴的雨是阵性的：雷临头时雨急，过后稍歇。雨声 loop 本身恒定，就在雷击出声的
// 那一刻把雨声目标抬一下再放它退潮 —— 这是「雷与雨声节奏互相配合」的最直接实现
// （作者 2026-09-23：应当和雨声节奏互相配合）。
/** 涌起峰值：雨声目标 = 基准 × (1 + PEAK × factor) */
export const RAIN_SURGE_PEAK = 0.18;
/** 快升：雷一响，雨 0.8s 内涌到峰 */
export const RAIN_SURGE_RISE_MS = 800;
/** 慢退：之后 5.2s 线性退回基准 */
export const RAIN_SURGE_TAIL_MS = 5200;
/**
 * 涌动包络（纯函数，ms → 0..1）：0 快升（800ms 到 1）、慢退（5200ms 到 0）。
 * 采样在 updateAmbient 拍（~1s 一次），30ms 步进淡出会在采样点间插值 → 听感平滑。
 */
export function rainSurgeFactor(msSinceStrike: number): number {
  if (!(msSinceStrike > 0)) return 0;
  if (msSinceStrike <= RAIN_SURGE_RISE_MS) return msSinceStrike / RAIN_SURGE_RISE_MS;
  const t = (msSinceStrike - RAIN_SURGE_RISE_MS) / RAIN_SURGE_TAIL_MS;
  return t >= 1 ? 0 : 1 - t;
}
/** 最近一击雷声真正出声的时刻（ms）；-1e9 = 从未响过 */
let lastStrikeMs = -1e9;

function quietPause(a: HTMLAudioElement): void {
  try {
    a.pause();
  } catch {
    /* 静默 */
  }
}

/**
 * 录音加载 / 解码失败（404、格式不支持、网络中断）→ 永久禁用，不再重试。
 * 必须把引用也丢掉：错误态的元素再 play() 只会反复产出 rejected promise
 * （catch 掉也白烧一条链）。页面这边无声无息，不报错。
 */
function onRainAudioError(): void {
  const a = rainAudio;
  if (!a) return;
  rainAudioDisabled = true;
  rainAudio = null;
  rainTarget = 0;
  stopRainFade();
  try {
    a.removeEventListener('error', onRainAudioError);
  } catch {
    /* 静默 */
  }
}

/** 惰性创建录音元素（loop + preload）；构造失败或已禁用 → null */
function rainElement(): HTMLAudioElement | null {
  if (rainAudioDisabled) return null;
  if (rainAudio) return rainAudio;
  if (typeof Audio === 'undefined') return null;
  try {
    const a = new Audio(RAIN_AUDIO_SRC);
    a.loop = true;
    a.preload = 'auto';
    a.volume = 0; // 从 0 起：即使首帧就下雨，也是淡入而不是「啪」一声
    a.addEventListener('error', onRainAudioError);
    rainAudio = a;
    return a;
  } catch {
    rainAudioDisabled = true;
    return null;
  }
}

function setRainVolume(a: HTMLAudioElement, v: number): void {
  try {
    a.volume = clamp01(v);
  } catch {
    /* 静默 */
  }
}

/** 播放（自动播放策略可能拒绝 → 只 catch 掉；下次 updateAmbient 会再试） */
function ensureRainPlay(a: HTMLAudioElement): void {
  if (!a.paused) return;
  try {
    const p = a.play();
    if (p && typeof p.catch === 'function') p.catch(() => undefined);
  } catch {
    /* 静默 */
  }
}

/** 停掉淡出定时器（到位或重置时调用；不碰元素本身） */
function stopRainFade(): void {
  if (rainFadeTimer === null) return;
  clearInterval(rainFadeTimer);
  rainFadeTimer = null;
}

function ensureRainFade(): void {
  if (rainFadeTimer !== null) return;
  rainFadeTimer = setInterval(stepRainFade, RAIN_FADE_MS);
}

/** 每 RAIN_FADE_MS 朝 rainTarget 走一步；到位后写死终值，淡到 0 就 pause 省电 */
function stepRainFade(): void {
  const a = rainAudio;
  if (!a) {
    stopRainFade();
    return;
  }
  const delta = rainTarget - a.volume;
  if (Math.abs(delta) < RAIN_FADE_STEP) {
    setRainVolume(a, rainTarget);
    if (rainTarget === 0) quietPause(a);
    stopRainFade();
    return;
  }
  setRainVolume(a, a.volume + (delta > 0 ? RAIN_FADE_STEP : -RAIN_FADE_STEP));
}

/**
 * 设定雨声目标音量（0 = 淡出后停）：>0 时确保元素已建、已在播，再交给步进淡入。
 * play() 只在这里被调（也就是只在「手势解锁」与「updateAmbient 且有雨且未静音」
 * 两条路上），不在模块加载时播任何东西。
 */
function rainSetTarget(target: number): void {
  const v = clamp01(target);
  rainTarget = v;
  if (v <= 0) {
    if (!rainAudio) return; // 没有元素就没有要淡的东西
    if (rainAudio.paused && rainAudio.volume === 0) {
      stopRainFade();
      return;
    }
    ensureRainFade();
    return;
  }
  const a = rainElement();
  if (!a) return;
  ensureRainPlay(a);
  ensureRainFade();
}

/**
 * 雨声的天气驱动（与 AudioContext 引擎互不影响，故单独一条路）：
 * - 下雨（rain > 0）且未静音 → 目标音量 rainLoopVolume(rain)；
 * - 雨停 / 静音 / fx 为 null（bgfx 关或滚离）→ 目标 0，步进淡出，到 0 后 pause。
 */
function applyRain(fx: AmbientFx | null): void {
  if (fx === null || !(fx.rain > 0) || !sfxPref.get()) {
    rainSetTarget(0);
    return;
  }
  // 阵性涌动乘在基准音量上：闪电后 0.8s 内 +18%、再 5.2s 退潮（rainLoopVolume 基准不变）
  const surge = rainSurgeFactor(Date.now() - lastStrikeMs);
  rainSetTarget(rainLoopVolume(fx.rain) * (1 + RAIN_SURGE_PEAK * surge));
}

/** 重置 / 拆掉：停表、丢引用、摘监听、清 src（不再留下一个还能自己响的元素） */
function releaseRainAudio(): void {
  stopRainFade();
  rainTarget = 0;
  const a = rainAudio;
  rainAudio = null;
  if (!a) return;
  try {
    a.pause();
    a.removeEventListener('error', onRainAudioError);
    // 摘掉 src 而不是只写 `src = ''`：空串会被解析成文档自身 URL，某些浏览器会照它
    // 再发一次请求；removeAttribute + load() 是「摘掉媒体资源」的标准写法（顺带中止
    // 还在跑的加载，不留一个后台继续缓冲的元素）。
    a.removeAttribute('src');
    a.load();
  } catch {
    /* 静默 */
  }
}

// ---------------- 风 / 雷：Web Audio 引擎（模块级单例） ----------------

interface Engine {
  ctx: AudioContext;
  master: GainNode;
  windGain: GainNode;
  /** 阵风 LFO 深度节点：连到 windGain.gain 做 audio-rate 调制 */
  gustGain: GainNode;
  noise: AudioBuffer;
  /** 需要 stop() 的一次性起点（风链的循环噪声源） */
  sources: AudioBufferSourceNode[];
  /** 常驻振荡器（阵风，不随音量归零而停） */
  oscs: OscillatorNode[];
}

let engine: Engine | null = null;
/** AudioContext 拿不到（老浏览器 / 构造抛错）→ 永远禁用，不反复重试。**只影响风与雷**，雨声录音不受牵累。 */
let disabled = false;
/** 最近一次 updateAmbient 收到的参数：手势解锁时用它点火 */
let lastFx: AmbientFx | null = null;

function makeNoise(c: AudioContext): AudioBuffer {
  const len = Math.max(1, Math.floor(c.sampleRate * NOISE_SEC));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  // 生成后立刻压平环绕点（运行时只用被单测覆盖的纯函数做这件事）
  crossfadeNoiseLoop(data, Math.round(c.sampleRate * NOISE_FADE_SEC));
  return buf;
}

function createContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor) return null;
  try {
    return new Ctor();
  } catch {
    return null;
  }
}

/** 自动播放策略：suspended 时尝试 resume，被拒也无所谓（下次手势还会再试） */
function kick(c: AudioContext): void {
  if (c.state !== 'suspended') return;
  try {
    const p = c.resume();
    if (p && typeof p.catch === 'function') p.catch(() => undefined);
  } catch {
    /* resume 同步抛错（少见）—— 静默 */
  }
}

/**
 * 建引擎 + 挂风链 + 启动常驻源。返回是否可用。
 * 链拓扑（固定不变，只有增益在动）：
 *   风：    noise → bandpass(320, 1.1) → windGain → master(0.9) → destination
 *   阵风：  sine(0.07Hz) → gustGain → windGain.gain
 * 阵风 LFO 常驻不随音量归零而停（停了再启会有相位跳变）。
 * （雨链退役后只剩风这一条噪声源，旧的「三链错相位启动」口径一并删掉：不再存在
 *   同相叠加的爆点，也就不需要给起点加偏移。）
 */
function startEngine(): boolean {
  if (engine) return true;
  if (disabled) return false;

  const c = createContext();
  if (!c) {
    disabled = true;
    return false;
  }

  const noise = makeNoise(c);

  const master = c.createGain();
  master.gain.value = MASTER_GAIN;
  master.connect(c.destination);

  // 风链
  const windFilter = c.createBiquadFilter();
  windFilter.type = 'bandpass';
  windFilter.frequency.value = WIND_HZ;
  windFilter.Q.value = WIND_Q;
  const windGain = c.createGain();
  windGain.gain.value = 0;
  const windSrc = c.createBufferSource();
  windSrc.buffer = noise;
  windSrc.loop = true;
  windSrc.connect(windFilter);
  windFilter.connect(windGain);
  windGain.connect(master);

  // 阵风 LFO：只调 depth，不随音量归零而停（停了再启会有相位跳变）
  const gustOsc = c.createOscillator();
  gustOsc.type = 'sine';
  gustOsc.frequency.value = GUST_HZ;
  const gustGain = c.createGain();
  gustGain.gain.value = 0;
  gustOsc.connect(gustGain);
  gustGain.connect(windGain.gain);

  windSrc.start();
  gustOsc.start();

  engine = {
    ctx: c,
    master,
    windGain,
    gustGain,
    noise,
    sources: [windSrc],
    oscs: [gustOsc],
  };
  kick(c);
  return true;
}

/** 把 mix 平滑写到节点上（风强的变化无感） */
function applyMix(mix: AmbientMix): void {
  const e = engine;
  if (!e) return;
  const t = e.ctx.currentTime;
  e.windGain.gain.setTargetAtTime(mix.windGain, t, SMOOTH_TAU);
  e.gustGain.gain.setTargetAtTime(mix.windGain * GUST_DEPTH, t, SMOOTH_TAU);
}

/** 关掉：目标增益全 0（平滑淡出），LFO 与链拓扑原样保留 */
function rampDown(): void {
  const e = engine;
  if (!e) return;
  const t = e.ctx.currentTime;
  e.windGain.gain.setTargetAtTime(0, t, SMOOTH_TAU);
  e.gustGain.gain.setTargetAtTime(0, t, SMOOTH_TAU);
}

/**
 * 环境音主入口（BgFx 每分钟级调用一次）：
 * - 雨声：先走（录音不经 AudioContext，所以引擎不可用时雨仍在）——
 *   fx 为 null（bgfx 关 / 滚离）/ 静音 / rain 为 0 → 目标 0 淡出；否则目标 rainLoopVolume。
 * - 风：fx 为 null 或静音 → 目标增益全 0；引擎未启动则什么都不做，
 *   否则惰性启动并把当前风力滑过去。
 */
export function updateAmbient(fx: AmbientFx | null): void {
  lastFx = fx;
  try {
    applyRain(fx);
    if (fx === null || !sfxPref.get()) {
      if (engine) rampDown();
      return;
    }
    if (!startEngine()) return;
    kickEngine();
    applyMix(ambientMix(fx));
  } catch {
    /* 音频只是装饰 —— 任何失败都不能影响页面 */
  }
}

// ---------------- 雷：**无声音**，只剩「闪的强弱抽签」与「雨声涌动锚点」 ----------------

/**
 * 单次雷击的抽签（纯函数，rng 注入）：只剩一个字段 —— 这一道闪是**近亮**还是**远弱**。
 * 雷声已移除（作者「太吓人了」），delay/vol/rate 都随声音一起退役；
 * 闪本身保留簇式随机节奏（见 nextThunderStrike）与近亮/远弱的随机强度 ——
 * 两者都为「随机事件、随机强度，别像循环」服务，只是不再有声音。
 */
export interface ThunderStrike {
  /** 近击（云在头顶 → 闪亮）/ 远击（雷在天边 → 闪弱 55%） */
  near: boolean;
}
const THUNDER_CLOSE_P = 0.7;
export function thunderStrike(rng: () => number): ThunderStrike {
  return { near: rng() < THUNDER_CLOSE_P };
}

/** 闪电时刻：雨声阵性涌动的锚点（BgFx 在闪电那一帧调；雷声已移除，涌动改绑闪） */
export function noteThunderFlash(): void {
  try {
    lastStrikeMs = Date.now();
  } catch {
    /* 静默 */
  }
}

// ---------------- 手势解锁（浏览器自动播放策略） ----------------

let unlockAttached = false;

/**
 * 引擎已在、但处于 suspended（首次手势前就建了 ctx）→ 再试一次 resume。
 * 必须做：`once: true` 的手势监听只跑一次，若它跑的时候还没有 pending 参数
 * （或当时静音），这一次手势就白被消费了 —— 之后靠每次 updateAmbient 与后续手势兜底。
 */
function kickEngine(): void {
  if (engine) kick(engine.ctx);
}

/**
 * 首次手势：有 pending 天气参数且未静音 → 点火（并解锁可能已挂起的 ctx）。
 * 没参数也不早退到「什么都不做」：ctx 可能已在挂起态，解锁比启动更要紧。
 * 不因引擎 disabled 而整体早退 —— 雨声录音与 AudioContext 无关，
 * 引擎拿不到也要把 rainAudio.play() 放进这次真实手势里（否则会被自动播放策略拒）。
 */
function onFirstGesture(): void {
  try {
    kickEngine();
    if (!sfxPref.get() || !lastFx) return;
    applyRain(lastFx);
    if (!startEngine()) return;
    kickEngine();
    applyMix(ambientMix(lastFx));
  } catch {
    /* 静默 */
  }
}

function attachUnlock(): void {
  if (unlockAttached) return;
  if (typeof document === 'undefined') return;
  unlockAttached = true;
  document.addEventListener('pointerdown', onFirstGesture, {
    once: true,
    passive: true,
  });
  document.addEventListener('keydown', onFirstGesture, {
    once: true,
    passive: true,
  });
}

function detachUnlock(): void {
  if (!unlockAttached) return;
  unlockAttached = false;
  if (typeof document === 'undefined') return;
  document.removeEventListener('pointerdown', onFirstGesture);
  document.removeEventListener('keydown', onFirstGesture);
}

attachUnlock();

/**
 * 测试隔离：停掉所有节点、丢掉录音元素、清引用、重新可挂手势监听。
 * 仅供单测/调试使用，生产路径不调用。
 */
export function __resetAmbienceForTest(): void {
  releaseRainAudio();
  rainAudioDisabled = false;
  const e = engine;
  engine = null;
  lastFx = null;
  disabled = false;
  detachUnlock();
  if (!e) {
    attachUnlock();
    return;
  }
  const quiet = (fn: () => void) => {
    try {
      fn();
    } catch {
      /* 未 start / 已停 / 已断开 —— 忽略 */
    }
  };
  for (const s of e.sources) {
    quiet(() => s.stop());
    quiet(() => s.disconnect());
  }
  for (const o of e.oscs) {
    quiet(() => o.stop());
    quiet(() => o.disconnect());
  }
  for (const n of [e.windGain, e.gustGain, e.master]) {
    quiet(() => n.disconnect());
  }
  quiet(() => {
    const p = e.ctx.close();
    if (p && typeof p.catch === 'function') p.catch(() => undefined);
  });
  attachUnlock();
}
