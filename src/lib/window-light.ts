/**
 * window-light —— 「窗外世界」从画框改成嵌在墙上的真窗后，所需的**窗光学纯函数**。
 *
 * 只负责「一间夜晚的房间」里那扇窗的光交换与玻璃物性：
 * ① 室内墙/框配色（由主题 Palette 派生，`frameProfile` 的三档剖面比例取自
 *    现有 drawWindowFrame，保持同一套「室内受光木面」语言）；
 * ② 夜里月光透窗洞在窗台/墙面投下的斜亮带（`moonSpill`）；
 * ③ 夜里玻璃上身后的室内暖光倒影（`indoorReflection`）；
 * ④ 玻璃冷色罩（`glassTint`）与冷夜结露（`frost`）、暴雨起雾（`mistGlass`）。
 *
 * 纯函数、零 DOM；几何输出一律整数，alpha 显式保留两位小数。
 * 颜色一律由入参派生，除 '#000000' / '#ffffff' 两个 lerp 锚点外零字面量色。
 *
 * 本模块独立于并行任务 window-room.ts（用本地结构类型，不互相 import）。
 * 单测：tests/unit/window-light.spec.ts。
 */

import { lerpHex } from './sky-palette';
import type { Palette } from './palette';

/** 矩形（整数像素几何） */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 本地 clamp01（T4 会统一公共小工具，本模块先自带） */
function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

/** 四舍五入到两位小数（alpha 显式口径） */
function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

// ---- ① 墙面与框体配色 ----

/** 室内墙面基色：比页面底色亮一点但仍是暗墙 */
export function wallFace(p: Palette): string {
  return lerpHex(p.bg, p.light, 0.12);
}

/** 墙顶室内灯浅阶（室内灯从上方打下来，墙顶比墙面亮） */
export function wallLit(p: Palette): string {
  return lerpHex(wallFace(p), p.light, 0.1);
}

/**
 * 框三档剖面 + 内缘受光 + 台沿暗线（比例取自现有 drawWindowFrame）。
 * `skyBand` 是窗洞外的天光色（内缘侧壁被天光打亮）。
 */
export function frameProfile(
  p: Palette,
  skyBand: string
): {
  face: string;
  faceShade: string;
  faceLit: string;
  reveal: string;
  lip: string;
} {
  const face = lerpHex(p.bg, p.light, 0.34); // 框面（室内受光木面）
  const faceShade = lerpHex(face, '#000000', 0.38); // 背光档（外缘/槽底）
  const faceLit = lerpHex(face, '#ffffff', 0.22); // 受光档（外棱/梃顶）
  const reveal = lerpHex(p.light, skyBand, 0.34); // 内缘受光（天光打窗洞侧壁）
  const lip = lerpHex(p.bg, '#000000', 0.7); // 台沿 / 框与玻璃的缝
  return { face, faceShade, faceLit, reveal, lip };
}

// ---- ② 月光透窗亮带 ----

/**
 * 夜里月光透过窗洞在窗台/墙面投的斜亮带；白天/月光不可见返回 null。
 *
 * 亮带宽度取 `max(40, hole.w*0.16)`（窄窗时封顶到洞宽，保证完整落在洞内）；
 * 中心被夹在洞内，故 x 区间随 moonX 单调不降且永远含于 hole。
 */
export function moonSpill(
  hole: Rect,
  moonX: number,
  starlight: number
): {
  x0: number;
  x1: number;
  alphaTop: number;
  alphaLow: number;
} | null {
  if (starlight < 0.5) return null;

  const band = Math.min(hole.w, Math.max(40, Math.round(hole.w * 0.16)));
  const half = band / 2;
  const lo = hole.x + half;
  const hi = hole.x + hole.w - half;
  const center = hi < lo ? hole.x + hole.w / 2 : Math.min(Math.max(moonX, lo), hi);
  const x0 = Math.min(Math.max(Math.round(center - half), hole.x), hole.x + hole.w - band);
  const x1 = x0 + band;

  const alphaTop = round2(0.1 * clamp01((starlight - 0.5) / 0.5));
  const alphaLow = round2(alphaTop * 0.55);
  return { x0, x1, alphaTop, alphaLow };
}

// ---- ③ 玻璃上的室内反光（已退役 2026-11-13）----
// 原 indoorReflection / reflectionLayers：夜里在玻璃上画一盏「身后那盏灯的倒影」。
// 作者实拍裁决「去掉，无法辨认是什么东西」——它在夜空里无论怎么调（1px 线 →
// 三层软边 → 纵向灯柱 → 点阵外圈）都读作第二个天体（「天空最上面是月亮，
// 下面还有个像太阳的东西」）。认不出来的光学层比没有更糟，整段删除。
// 玻璃的物性改由 ④ 冷罩 / 结露 / 起雾 + 雨梳痕承担。

// ---- ④ 玻璃冷色罩 / 结露 / 起雾 ----

/** 玻璃冷色罩（隔着玻璃的观感）：取窗外天空的冷带色，极淡铺一层 */
export function glassTint(coolSkyBand: string): { color: string; alpha: number } {
  return { color: coolSkyBand, alpha: 0.04 };
}

/** 冷夜结露条件（晴夜冷透才有：有雨时被雨盖过） */
export function frost(
  starlight: number,
  rain: number
): { edge: boolean; cornerBoost: boolean } | null {
  if (starlight > 0.6 && rain < 0.1) return { edge: true, cornerBoost: true };
  return null;
}

/** 暴雨玻璃起雾 alpha：rain < 0.85 → 0；否则线性升到 0.12 封顶 */
export function mistGlass(rain: number): number {
  if (rain < 0.85) return 0;
  return round2(Math.min(0.12, ((rain - 0.85) / 0.15) * 0.12));
}

// ---- ⑤ 框棂接光 + 夜暖晕（去铁窗，2026-10-02；窗台小灯 2026-10-02 拆除——作者「跟没有一样，很多余还抢镜头」） ----

/**
 * 框/棂的接光三档（窗是屋里唯一接太阳的面）。
 *
 * 铁窗感的根因（四时段实测）：旧 face = lerp(bg, light, 0.34) 与昼长无关——
 * 正午是「亮天空上的深灰横条」（铁栅），深夜是「比夜空亮一个量级的灰棂」
 * （黑夜里泛光的铁条）。接光后：正午被太阳晒成暖亮木（提白 0.32d + 掺
 * 18%d 的 accent 暖），深夜沉成暗木（压黑 0.45(1−d)），黄昏自然落在中间。
 *
 * 三档语义与 frameProfile 相同；**只替换窗这一章**（drawWindowFrame）的用法，
 * 室内侧木器（desk-room 的桌/CRT 壳）仍走 frameProfile——室内夜里靠台灯，
 * 不接太阳。reveal/lip 与天光挂钩，仍由 frameProfile 提供。
 */
export function sunlitFrame(
  p: Palette,
  daylight: number
): { face: string; faceLit: string; faceShade: string } {
  const d = clamp01(daylight);
  const base = lerpHex(p.bg, p.light, 0.34); // 与 frameProfile.face 同源基线（连续起点）
  const face = lerpHex(
    lerpHex(lerpHex(base, '#ffffff', 0.32 * d), p.accent, 0.18 * d),
    '#000000',
    0.45 * (1 - d)
  );
  return {
    face,
    faceLit: lerpHex(face, '#ffffff', 0.22),
    faceShade: lerpHex(face, '#000000', 0.38),
  };
}

/** 夜里框/棂内缘暖受光带强度：daylight ≤ 0.35 起亮，深夜 1（线性渐入） */
export function warmEdgeAlpha(daylight: number): number {
  const t = 0.35;
  if (daylight >= t) return 0;
  return round2((t - daylight) / t);
}

/** 夜暖晕白昼阈值：daylight 低于它才起晕（原窗台灯同门，灯拆除后沿用） */
export const GLASS_WARM_DAY = 0.22;

/**
 * 夜暖晕（ADR-0028 拆棂观景窗的配套）：夜里室内灯光漫上玻璃——从窗底向
 * 上升的三段暖带（alpha 向上递减），让首屏夜色的**底部有屋里的暖**，
 * 而不只是细条变颜色。白天关门（≥ GLASS_WARM_DAY 返 null）；强度随夜深渐入。
 * 全洞宽（室内灯光在玻璃上漫开）。原与窗台灯同门，灯拆除后独立成门。
 *
 * 2026-10-06 独立评审：旧 0.1/0.06/0.03 三档的暖金压不住夜空蓝底（合成
 * R−B 全负，三段带被读成湖水分层）——最下段提到 0.3（0.15 混白纯暖下
 * R−B 转正 ≥+10），向上 0.18 / 0.09 保持递减淡出。
 */
export function glassWarm(
  hole: Rect,
  daylight: number
): { y: number; h: number; alpha: number }[] | null {
  if (daylight >= GLASS_WARM_DAY) return null;
  const a = round2((GLASS_WARM_DAY - daylight) / GLASS_WARM_DAY);
  const total = Math.round(hole.h * 0.18);
  const h3 = Math.round(total * 0.35); // 最下段（贴窗底，最暖）
  const h2 = Math.round(total * 0.33);
  const h1 = Math.max(1, total - h3 - h2);
  const yBottom = hole.y + hole.h;
  return [
    { y: yBottom - h3, h: h3, alpha: round2(0.3 * a) },
    { y: yBottom - h3 - h2, h: h2, alpha: round2(0.18 * a) },
    { y: yBottom - h3 - h2 - h1, h: h1, alpha: round2(0.09 * a) },
  ];
}
