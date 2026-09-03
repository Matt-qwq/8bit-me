/**
 * chip-tune SFX —— Web Audio API 程序化合成（零音频文件）。
 *
 * v3（2026-09-01，ADR-0007）音效语言定稿：
 * - 按角色分音（sound role），映射表 SOUND_ROLES 落于此（纯数据，单测对象）。
 * - 中央委托：bindSfxRoles() 拾取 [data-sfx-role]（点击/操作）与 [data-sfx-hover]
 *   （主控件悬停），全站一次接线；编程场景（Canvas 命中 / Konami）直接 playRole()。
 * - 方波家族 + 噪声打击：click/toggle/select/nav/hover 用方波，game 用 noise（GB 打击惯例）。
 * - 静音开关偏好委托给 src/lib/prefs.ts 的 sfxPref（默认开）。
 * - 每次发声同步派发 8bit:fx（视觉联动，click→波纹 / nav→扫光 / hover→星火）。
 *
 * _Avoid_: 逐组件散装 if (sfxEnabled()) playClick()（漏接根因）、每按钮独有音色。
 */

import { sfxPref } from './prefs';

/** 当前是否播放音效（默认开，尊重用户此前偏好） */
export function sfxEnabled(): boolean {
  return sfxPref.get();
}

export function setSfxEnabled(on: boolean): void {
  sfxPref.set(on);
}

/** 音效角色：六类各一个专属音效（术语见 CONTEXT.md「sound role」） */
export type SfxRole = 'nav' | 'click' | 'toggle' | 'select' | 'game' | 'hover';

/** 合成波形；'noise' 为噪声打击（AudioBuffer 白噪短爆，非 OscillatorType 原生） */
export type SfxWave = 'square' | 'triangle' | 'sawtooth' | 'sine' | 'noise';

/** 单个合成节点（一个音 = 若干节点按 delay 错峰叠放） */
export interface SoundNode {
  wave: SfxWave;
  /** 频率 Hz（noise 节点无需语义，仍可填但忽略） */
  freq: number;
  /** 时长 s */
  dur: number;
  /** 音量 0..1 */
  vol: number;
  /** 距角色起点的延迟 s */
  delay?: number;
}

export interface SoundSpec {
  nodes: SoundNode[];
  /** 同步派发的 8bit:fx 视觉联动 kind（click/toggle/select/game → click） */
  fx: 'click' | 'nav' | 'hover';
}

/**
 * 角色 → 音效映射表（纯数据，单测锁死：
 * 角色完备、参数合法、全站 data-sfx-role 属性值 ⊆ 本表 keys）。
 */
export const SOUND_ROLES: Record<SfxRole, SoundSpec> = {
  nav: {
    // 站内页面移动：上行双音（arp，沿用 v1 playNav 参数）
    nodes: [
      { wave: 'square', freq: 660, dur: 0.07, vol: 0.03 },
      { wave: 'square', freq: 990, dur: 0.07, vol: 0.03, delay: 0.07 },
    ],
    fx: 'nav',
  },
  click: {
    // 站外链接 / 普通确认：单音方波（沿用 v1 playClick 参数）
    nodes: [{ wave: 'square', freq: 880, dur: 0.08, vol: 0.045 }],
    fx: 'click',
  },
  toggle: {
    // 开关翻转：咔哒双音（短下行）
    nodes: [
      { wave: 'square', freq: 660, dur: 0.05, vol: 0.04 },
      { wave: 'square', freq: 440, dur: 0.06, vol: 0.04, delay: 0.06 },
    ],
    fx: 'click',
  },
  select: {
    // 主题选择：上行三连 arp（C5-E5-G5）
    nodes: [
      { wave: 'square', freq: 523, dur: 0.06, vol: 0.035 },
      { wave: 'square', freq: 659, dur: 0.06, vol: 0.035, delay: 0.07 },
      { wave: 'square', freq: 784, dur: 0.09, vol: 0.05, delay: 0.14 },
    ],
    fx: 'click',
  },
  game: {
    // 打地鼠命中 / START：噪声打击（GB noise 通道惯例）
    nodes: [{ wave: 'noise', freq: 220, dur: 0.08, vol: 0.07 }],
    fx: 'click',
  },
  hover: {
    // 主控件悬停：极短 tick（沿用 v1 playHover 参数，极小声防刷屏）
    nodes: [{ wave: 'square', freq: 1320, dur: 0.045, vol: 0.02 }],
    fx: 'hover',
  },
};

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) ctx = new Ctor();
  // 浏览器自动播放策略：在首次用户手势后 resume
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function blip(
  freq: number,
  dur: number,
  type: OscillatorType,
  vol: number,
  delay = 0
): void {
  const c = getCtx();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(vol, t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain);
  gain.connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

function noiseBurst(dur: number, vol: number, delay = 0): void {
  const c = getCtx();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  const gain = c.createGain();
  gain.gain.setValueAtTime(vol, t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(gain);
  gain.connect(c.destination);
  src.start(t0);
}

/**
 * 按角色播放（中央委托与编程场景共用入口）：
 * 尊重 sfxEnabled 门控；播放后同步派发 8bit:fx 视觉联动。
 */
export function playRole(role: SfxRole): void {
  if (!sfxEnabled()) return;
  const spec = SOUND_ROLES[role];
  if (!spec) return;
  for (const n of spec.nodes) {
    if (n.wave === 'noise') noiseBurst(n.dur, n.vol, n.delay ?? 0);
    else blip(n.freq, n.dur, n.wave, n.vol, n.delay ?? 0);
  }
  emitFx(spec.fx);
}

/**
 * 中央委托（ADR-0007）：一次接线全站。
 * - click 事件拾取 [data-sfx-role]（closest 冒泡），按角色发声；
 *   click 事件天然覆盖键盘 Enter/Space，无需单独处理可访问性。
 * - [data-sfx-hover] 主控件逐个绑 pointerenter（hover 不冒泡、不能委托）→ hover tick。
 * 幂等：同一 root 重复调用会重复监听，调用方保证只挂一次。
 */
export function bindSfxRoles(root: Document | HTMLElement = document): void {
  root.addEventListener('click', (e) => {
    const t = e.target;
    if (!(t instanceof Element)) return;
    const el = t.closest('[data-sfx-role]');
    if (!el) return;
    const role = el.getAttribute('data-sfx-role');
    if (role && role in SOUND_ROLES) playRole(role as SfxRole);
  });
  root.querySelectorAll('[data-sfx-hover]').forEach((el) => {
    el.addEventListener('pointerenter', () => playRole('hover'), { passive: true });
  });
}

/**
 * 音画联动：向全站广播一次 FX 事件，bg-fx（hero canvas 动画）监听后
 * 生成对应光效脉冲（click→波纹 / nav→扫光 / hover→星火）。
 * 仅装饰联动，静默失败无害。
 */
function emitFx(kind: string): void {
  if (typeof window === 'undefined' || typeof CustomEvent === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent('8bit:fx', { detail: kind }));
  } catch {
    /* 无关紧要 —— 忽略 */
  }
}