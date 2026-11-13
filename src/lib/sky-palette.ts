/**
 * sky-palette —— 「窗外」天空调色板：按太阳高度（sunAlt）连续插值的关键帧系统。
 *
 * 媒介决定形式（像素美学）：天空**不是**平滑渐变，而是 6 条离散色带 + 带间
 * 拜耳抖动过渡（SNES/GBA 天空的经典做法）。本模块只产出「某一 sunAlt 下
 * 应该用什么颜色」，抖动与绘制在 BgFx 的 offscreen 预渲染里。
 *
 * 帧锚点是 sunAlt（-1..1），不是钟点——真实世界的晨昏本就由太阳高度决定，
 * 冬天 17:40 的黄昏与夏天 19:00 的黄昏因此自动各自正确。
 *
 * 纯函数，零 DOM；单测 tests/unit/sky-palette.spec.ts。
 */

/** 单帧完整配色：6 条天空色带（顶→底）+ 天体 + 云双面 + 窗灯 + 江面 + 星光基准 */
export interface SkyFrame {
  /** 锚点：太阳高度 -1..1 */
  alt: number;
  /** 天空色带，从头顶到地平线（像素色带，非渐变） */
  bands: readonly [string, string, string, string, string, string];
  /** 天体芯色（太阳或月亮，绘制层按昼夜各取） */
  sun: string;
  /** 太阳光晕（additive 踏阶外扩的晕色） */
  sunGlow: string;
  /** 月亮芯色与环形山色 */
  moon: string;
  moonCrater: string;
  /** 云：受光面 / 背光面 */
  cloudHi: string;
  cloudLo: string;
  /** 城市窗灯（夜晚逐户点亮） */
  windowLit: string;
  /** 江面基色（波光在其上闪） */
  water: string;
  /** 远山体色（大气透视最淡的一层：几乎融进天空，只留一点冷调） */
  ridgeFar: string;
  /** 近山体色（在远山之前，更暗更实；岭南山偏青绿，不是石头灰） */
  ridgeNear: string;
  /** 星星基准强度 0..1（与 sky-time 的 starlight 取小） */
  star: number;
  /** 远景山脊相对天际线的淡化系数 0..1（越小越淡，大气透视） */
  haze: number;
}

/**
 * 8 个关键帧（调色参考 DawnBringer 系与真实岭南天空：高湿度的低日带偏金红）。
 * 色带刻意「顶深底亮」——地平线永远比头顶亮，这是大气散射的像素化表达。
 */
export const SKY_FRAMES: readonly SkyFrame[] = [
  {
    alt: -1.0, // 深夜
    bands: ['#05081a', '#070b22', '#090e2c', '#0b1236', '#0d1640', '#101a4a'],
    sun: '#ffe8d0', sunGlow: '#ff9e4f',
    moon: '#e8ecf5', moonCrater: '#b8c0d4',
    cloudHi: '#1a2246', cloudLo: '#0c1230',
    windowLit: '#ffd27a', water: '#070d20',
    ridgeFar: '#0e1534', ridgeNear: '#070b1e',
    star: 1.0, haze: 0.35,
  },
  {
    alt: -0.35, // 夜
    bands: ['#0a0e28', '#0d1234', '#101640', '#131a4c', '#161e58', '#1a2264'],
    sun: '#ffe8d0', sunGlow: '#ff9e4f',
    moon: '#e8ecf5', moonCrater: '#b8c0d4',
    cloudHi: '#232b56', cloudLo: '#121838',
    windowLit: '#ffd27a', water: '#0a1130',
    ridgeFar: '#161d48', ridgeNear: '#0b1029',
    star: 0.9, haze: 0.4,
  },
  {
    alt: -0.12, // 蓝调时刻（暮光沉尽前的紫蓝）
    bands: ['#1c2054', '#262a66', '#303478', '#3a3e8a', '#4a4a9c', '#5c54a8'],
    sun: '#ffd8a8', sunGlow: '#ff9e4f',
    moon: '#e8ecf5', moonCrater: '#b8c0d4',
    cloudHi: '#3d4279', cloudLo: '#232650',
    windowLit: '#ffd27a', water: '#181c48',
    ridgeFar: '#2b2f6e', ridgeNear: '#1a1d48',
    star: 0.4, haze: 0.5,
  },
  {
    alt: -0.04, // 暮光（太阳刚贴地平线，余晖最浓）
    bands: ['#2e2a62', '#4a3a76', '#6b4a84', '#955a86', '#c26a80', '#e8806e'],
    sun: '#ff8a50', sunGlow: '#ffb060',
    moon: '#e0e4f0', moonCrater: '#b0b8cc',
    cloudHi: '#c9768e', cloudLo: '#5c3a68',
    windowLit: '#ffd27a', water: '#33245c',
    ridgeFar: '#4b3b74', ridgeNear: '#2b2148',
    star: 0.15, haze: 0.55,
  },
  {
    alt: 0.02, // 日出 / 日落（金橙地平线，全站最华丽的一帧）
    bands: ['#3a2f68', '#6b4a84', '#a85e84', '#d9777e', '#f5996f', '#ffc27a'],
    sun: '#ff5e3a', sunGlow: '#ffb347',
    moon: '#e0e4f0', moonCrater: '#b0b8cc',
    cloudHi: '#ffb98a', cloudLo: '#8a5070',
    windowLit: '#ffd27a', water: '#4a2c5c',
    ridgeFar: '#6d4b79', ridgeNear: '#3d2a53',
    star: 0.05, haze: 0.6,
  },
  {
    alt: 0.18, // 低日（清晨 / 傍午的金调）
    bands: ['#3d5f9e', '#5e86c0', '#85aed6', '#b2d0e6', '#d8e8ee', '#ffd9a0'],
    sun: '#ffd76a', sunGlow: '#ffec9e',
    moon: '#e0e4f0', moonCrater: '#b0b8cc',
    cloudHi: '#fdf6e8', cloudLo: '#b0c4d8',
    windowLit: '#ffe8a8', water: '#3a5c88',
    ridgeFar: '#8aa6c8', ridgeNear: '#3d5f68',
    star: 0, haze: 0.65,
  },
  {
    alt: 0.55, // 日间
    bands: ['#2f6cc0', '#4c84d0', '#69a0e0', '#8cbdf0', '#b0d8f8', '#cfe9fb'],
    sun: '#fff3c4', sunGlow: '#ffed9e',
    moon: '#e8ecf5', moonCrater: '#b8c0d4',
    cloudHi: '#f8fbff', cloudLo: '#c2dcec',
    windowLit: '#fff0b8', water: '#2f5c96',
    ridgeFar: '#829fc8', ridgeNear: '#3a6660',
    star: 0, haze: 0.7,
  },
  {
    alt: 0.9, // 正午（通透亮蓝）
    bands: ['#1f5fbc', '#3f7ecf', '#5f9ae4', '#84b8f4', '#a8d2fa', '#cbe8fd'],
    sun: '#fffbe8', sunGlow: '#fff3b0',
    moon: '#e8ecf5', moonCrater: '#b8c0d4',
    cloudHi: '#ffffff', cloudLo: '#c8e2f2',
    windowLit: '#fff0b8', water: '#2a5a9c',
    ridgeFar: '#8ea8cf', ridgeNear: '#3f6b5c',
    star: 0, haze: 0.75,
  },
] as const;

// ---- hex RGB 插值工具 ----
export function hexToRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}
function rgbToHex(r: number, g: number, b: number): string {
  const c = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}
export function lerpHex(a: string, b: string, t: number): string {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  return rgbToHex(
    A[0] + (B[0] - A[0]) * t,
    A[1] + (B[1] - A[1]) * t,
    A[2] + (B[2] - A[2]) * t
  );
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** 解析后的天空帧（bands 为可写数组，供绘制层直接消费） */
export interface ResolvedSky extends Omit<SkyFrame, 'alt' | 'bands'> {
  bands: [string, string, string, string, string, string];
}

/**
 * 帧区间查找：alt 落在帧 i 与帧 i+1 之间，t = 区间内进度。
 * 绘制层用它取「两张预渲染天空帧」做 crossfade（与 sampleSky 同查找逻辑，单源）。
 */
export function frameBracket(sunAlt: number): { i: number; t: number } {
  const F = SKY_FRAMES;
  let i = 0;
  while (i < F.length - 2 && sunAlt > F[i + 1]!.alt) i++;
  const A = F[i]!;
  const B = F[i + 1]!;
  return { i, t: Math.max(0, Math.min(1, (sunAlt - A.alt) / (B.alt - A.alt))) };
}

/**
 * 按太阳高度采样天空：相邻两关键帧逐色插值。
 * alt 超出帧范围时钳到端点帧（深夜 -1 / 正午 0.9 之外不再变化）。
 */
export function sampleSky(sunAlt: number): ResolvedSky {
  const F = SKY_FRAMES;
  const { i, t } = frameBracket(sunAlt);
  const A = F[i]!;
  const B = F[i + 1]!;
  return {
    bands: A.bands.map((c, k) => lerpHex(c, B.bands[k]!, t)) as ResolvedSky['bands'],
    sun: lerpHex(A.sun, B.sun, t),
    sunGlow: lerpHex(A.sunGlow, B.sunGlow, t),
    moon: lerpHex(A.moon, B.moon, t),
    moonCrater: lerpHex(A.moonCrater, B.moonCrater, t),
    cloudHi: lerpHex(A.cloudHi, B.cloudHi, t),
    cloudLo: lerpHex(A.cloudLo, B.cloudLo, t),
    windowLit: lerpHex(A.windowLit, B.windowLit, t),
    water: lerpHex(A.water, B.water, t),
    ridgeFar: lerpHex(A.ridgeFar, B.ridgeFar, t),
    ridgeNear: lerpHex(A.ridgeNear, B.ridgeNear, t),
    star: lerp(A.star, B.star, t),
    haze: lerp(A.haze, B.haze, t),
  };
}

/** 天气压暗：阴/雨/雪时整帧按比例向灰收拢（factor 1 = 不变，0.6 = 阴雨世界） */
export function dimSky(sky: ResolvedSky, factor: number): ResolvedSky {
  const f = Math.max(0.3, Math.min(1, factor));
  if (f >= 0.999) return sky;
  // 山体（植被）比天空/水更先「发灰」：平光下绿植失去光泽，而天色还留得住蓝。
  // 两档去饱和强度：山比带多收 50%，否则阴天时近山绿得像贴上去的（2026-10-05 评审④）
  const d = (hex: string, k: number) => {
    const [r, g, b] = hexToRgb(hex);
    const grey = r * 0.299 + g * 0.587 + b * 0.114;
    // 两步：先去饱和（向该色自己的灰点收拢），再整体压暗。
    // 直接向灰「混色」会把亮带的暗通道抬亮（#b6e3fa 在 f=0.65 下反而变亮），
    // 而真实的阴雨天是「发灰 + 变暗」，两个动作得分开做。
    const sat = 1 - (1 - f) * k;
    const mix = (c: number) => (grey + (c - grey) * sat) * f;
    return rgbToHex(mix(r), mix(g), mix(b));
  };
  const kBand = 0.6;
  const kRidge = 0.9;
  return {
    ...sky,
    bands: sky.bands.map((c) => d(c, kBand)) as ResolvedSky['bands'],
    sun: d(sky.sun, kBand),
    sunGlow: d(sky.sunGlow, kBand),
    cloudHi: d(sky.cloudHi, kBand),
    cloudLo: d(sky.cloudLo, kBand),
    water: d(sky.water, kBand),
    ridgeFar: d(sky.ridgeFar, kRidge),
    ridgeNear: d(sky.ridgeNear, kRidge),
  };
}

/**
 * 色带纵向权重（顶→底）：地平线附近更宽。
 * 均匀六等分会让「黄昏」只剩底部两条带是暖色（实测天空 2/3 仍是紫），
 * 真实晨昏恰恰相反——暖色从地平线向上漫开。权重让底带占 22%、顶带 12%。
 */
export const BAND_WEIGHTS: readonly number[] = [0.12, 0.14, 0.16, 0.17, 0.19, 0.22];

/** 按权重求第 i 条色带的上/下边界（总高 h） */
export function bandBounds(i: number, h: number): { top: number; bottom: number } {
  let acc = 0;
  for (let k = 0; k < i; k++) acc += BAND_WEIGHTS[k]!;
  const top = (acc / 1) * h;
  const bottom = ((acc + BAND_WEIGHTS[i]!) / 1) * h;
  return { top, bottom };
}

/** 拜耳 4×4 抖动矩阵（归一化 0..15/16）：保留作同族基准与历史契约（天空已升级 8×8） */
export const BAYER4: readonly number[] = [
  0, 8, 2, 10,
  12, 4, 14, 6,
  3, 11, 1, 9,
  15, 7, 13, 5,
].map((n) => (n + 0.5) / 16);

/**
 * 拜耳 8×8 抖动矩阵（归一化 0..63/64）：天空渐变的现行抖动档。
 * 为什么升级：4×4 的行密度只有 {3/4, 2/4} 两档交替——过渡区里每隔一行
 * 就整行偏亮/偏暗（实测 ±5 RGB），大面积极渐变上读作横纹。8×8 把阈值相位
 * 铺开到 8 行，残余节奏的占空比从 1/2 降到 1/8，肉眼不再成行。
 */
export const BAYER8: readonly number[] = [
  0, 32, 8, 40, 2, 34, 10, 42,
  48, 16, 56, 24, 50, 18, 58, 26,
  12, 44, 4, 36, 14, 46, 6, 38,
  60, 28, 52, 20, 62, 30, 54, 22,
  3, 35, 11, 43, 1, 33, 9, 41,
  51, 19, 59, 27, 49, 17, 57, 25,
  15, 47, 7, 39, 13, 45, 5, 37,
  63, 31, 55, 23, 61, 29, 53, 21,
].map((n) => (n + 0.5) / 64);

/** 过渡区内某点是否取「下带色」：t = 该点在过渡区的纵向进度 0..1 */
export function ditherTakeLower(col: number, row: number, t: number): boolean {
  return BAYER8[((row & 7) << 3) | (col & 7)]! < t;
}
