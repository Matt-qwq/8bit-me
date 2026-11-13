/**
 * section-trans —— 章节切换·抖动溶解转场（纯函数，零 DOM）
 *
 * 规格：docs/specs/section-trans-v1.md（ADR-0026 引用本模块）。
 * 定位：**像素视觉语言**，不是游戏场景手法——把站内已在用的拜耳抖动
 * （窗外色带的过渡画法）从「景色的画法」长成「章节交接的画法」。
 *
 * 一条公式、两个方向（阈值 v = 该格的切换时刻，阶段进度 ≥ v 即切换）：
 *   v(gx,gy) = (BAYER8[(gx+ox)&7][(gy+oy)&7]/64) · DITHER_SPAN + |k| · 波行程
 *   波行程：k > 0 时 = dist(格心,波心)/射程（破：从波心向外扩着熄灭）；
 *           k < 0 时 = 1 − dist/射程（聚：从边缘向波心聚着点亮）。
 *   **两处归一（实现期校准，见 ADR-0026）**：① 距离除以「射程」= 波心到格网四角的
 *   最远距离（不是整幅对角线——波心常在带中心，用整幅对角线会让远角提前撞 1）；
 *   ② 拜耳项乘 DITHER_SPAN、斜率取 1−DITHER_SPAN，两者之和恒 ≤1
 *   （0.55·63/64 + 0.45 = 0.991）。不归一的话高拜耳值格会挤在 progress=1
 *   同一帧爆开（收尾硬切）、而聚方向会在开场一帧全亮，抖动波两头都烂尾。
 *   DITHER_SPAN 必须让拜耳项**主导**：它占满 0..1 时全区域都是抖动的密度场
 *   （真溶解）；压小到 0.25 会退化成「实心色块 + 抖边」的擦除（看过图才知道）。
 * 每格切换前闪 1 帧（即逝，无缓动）——破闪 --c-text 极性（冷暗脉，灯丝断），
 * 聚闪 --c-accent（暖金亮，台灯接电）；格本体破 = 冷暗、聚 = 暖暗。
 * 格本体的对比度量规校准（实现期实测，见 ADR-0026）：规格原稿 0.35 在恒暗档上
 * 对底 2.87:1，整屏读作“亮灰闪”而非“熄灭”；收到 0.26（对底 2.11:1）
 * 仍能读出抖动图案（格 vs 暗面板 1.53:1、vs 底色 2.11:1，加 1 帧亮闪勾出波前）。
 *
 * 格生命（四态）：破 0 未动 → 1 闪 → 2 冷暗格；聚 2 暖暗格 → 1 闪 → 3 点亮（清）。
 * 「仅聚」（常规章界）= 开场满格暖暗（吸气）→ 聚（呼气）——首次交接给完整双阶段，
 * 其后只留呼吸。
 *
 * 几何：格铺满整个视口（列数 = 视口宽/96 的整数格，坐标全整数）；**绘制**时按实时的
 * 「from 章可见带 ∪ to 章可见带」裁剪——仪式长在滚动上，不是全屏假覆盖。
 * 波心 = 两章**当前**可见带的中心（每帧 reanchor，跟着滚动走）；起源线 = 章节边界
 * **当前**视口 y（光束所在）。进度 = 时间项 + 滚动项（快滚被压缩，慢滚由时间兑底）。
 *
 * 单测：tests/unit/section-trans.spec.ts。
 */

import { mulberry32 } from './sky-scene';

/**
 * 8×8 拜耳矩阵（0..63 每个值恰一次）——抖动阈值的空间相位。
 * 与窗外天空的抖动（sky-palette 的 BAYER8，2026-10-05 起同为 8×8）同族同档：
 * 64 级阈值是两种像素抖动共同的细颗粒下限——4×4 的行密度两档交替会在
 * 大面积渐变上读作横纹（天空已实测 ±5 RGB），转场格阵同理。自持一份，零跨模块依赖。
 */
export const BAYER8: readonly (readonly number[])[] = [
  [0, 32, 8, 40, 2, 34, 10, 42],
  [48, 16, 56, 24, 50, 18, 58, 26],
  [12, 44, 4, 36, 14, 46, 6, 38],
  [60, 28, 52, 20, 62, 30, 54, 22],
  [3, 35, 11, 43, 1, 33, 9, 41],
  [51, 19, 59, 27, 49, 17, 57, 25],
  [15, 47, 7, 39, 13, 45, 5, 37],
  [63, 31, 55, 23, 61, 29, 53, 21],
];

export const SECTION_TRANS = {
  /** 横向格数：格尺寸 = 视口宽 / 96（1440 → 15px 整） */
  CELLS_ACROSS: 96,
  /** 破阶段时长 ms（完整双阶段） */
  BREAK_DUR: 240,
  /** 聚阶段时长 ms（完整双阶段） */
  GATHER_DUR: 360,
  /** 常规章界：仅聚 ms（开放旋钮 300↔420） */
  GATHER_ONLY_DUR: 300,
  /** 两次仪式最小间隔 ms（观感命门：不刷屏） */
  MIN_GAP: 900,
  /** 阈值斜率（唯一公式的 |k| = 波速旋钮；符号 = 方向）：破为正、聚为负 */
  K_BREAK: 0.45,
  K_GATHER: -0.45,
  /** 拜耳项在阈值里的跨度（与 |k| 互补，和 ≤1 保证不撞顶）：开放旋钮。
      必须**主导**——小了就成了「实心色块 + 抖边」的擦除，不是抖动溶解 */
  DITHER_SPAN: 0.55,
  /** 格本体混色比例（bg → text / accent）：规格 0.35 → 实测 0.26（对比度量规校准，见 ADR-0026） */
  BODY_MIX: 0.26,
  /** 破→聚 格本体暖化时长比（聚阶段的 progress 占比）：避免全场冷暗一帧翻暖的硬切 */
  WARM_UP: 0.4,
  /** 光束：2px accent 整齿横扫一次（复用 REVEAL 的整齿扫入语言） */
  BEAM_H: 2,
  BEAM_TOOTH: 16,
  /** 滚动联动：滚过这么多 px 就抵得上仪式自己走完一整场（与时间项相加）——
      快滚被压缩（仪式跟着滚动抢跑完），慢滚/停住也不会挂在那里（时间项兑底，≤750ms） */
  SCROLL_SWEEP_PX: 900,
  /** 单帧滚动项的封顶 px（一帧跳几百像素不能把整场仪式直接跳过去——仪式是事件，不是刷子） */
  SCROLL_BOOST_CAP_PX: 120,
} as const;

/** 整场预算（规格 ≤750ms）：完整双阶段 240 + 360 = 600ms，留出帧抖动余量 */
export const MAX_TOTAL = SECTION_TRANS.BREAK_DUR + SECTION_TRANS.GATHER_DUR;

/** 格生命四态（顺序即破→聚的生命周期） */
export const CELL_PENDING = 0;
export const CELL_FLASH = 1;
export const CELL_VEIL = 2;
export const CELL_CLEAR = 3;

/** 可见带（视口 y，已裁剪到 [0,h]） */
export interface BandRect {
  y0: number;
  y1: number;
}

/** 放炮那一刻的真实滚动几何（覆盖区域 = 两章可见带的并） */
export interface CeremonyRects {
  /** 视口尺寸（CSS px） */
  w: number;
  h: number;
  /** from 章可见带 */
  from: BandRect;
  /** to 章可见带 */
  to: BandRect;
  /** 起源线：章节边界在视口里的真实 y */
  originY: number;
}

/** 格坐标（可为小数：格心 / 波心都用格单位，距离无量纲） */
export interface GridPoint {
  gx: number;
  gy: number;
}

export type CeremonyPhase = 'break' | 'gather' | 'done';

export interface Ceremony {
  readonly fromId: string;
  readonly toId: string;
  /** +1 = 向下滚（to 在下方），-1 = 向上滚 */
  readonly dir: 1 | -1;
  /** 完整双阶段（破+聚+光束）还是仅聚 */
  readonly full: boolean;
  readonly seed: number;
  /** 抖动相位 0..7（同 (from,to) 恒同一套图案 = 这一章的签名） */
  readonly ox: number;
  readonly oy: number;
  /** 格边长 px（整数） */
  readonly cell: number;
  readonly cols: number;
  readonly rows: number;
  /** 射程（格单位）= 波心到格网四角的最远距离（距离项归一化分母）——随滚动重锚 */
  breakReach: number;
  gatherReach: number;
  breakCenter: GridPoint;
  gatherCenter: GridPoint;
  /** 起源线：章节边界**当前**在视口里的真实 y（随滚动重锚） */
  originY: number;
  readonly total: number;
  phase: CeremonyPhase;
  /** 已过 ms */
  t: number;
  /** 当前阶段进度 0..1 */
  progress: number;
  /** 光束进度 0..1（仅完整双阶段的聚阶段非零） */
  beam: number;
  readonly cells: Uint8Array;
  /** 本步新闪的格（1 = 本步刚进入 flash；闪只活 1 步） */
  readonly flashed: Uint8Array;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * 章节签名种子：FNV-1a 32 位。同 (from,to) 恒同值——「从 about 回到 about
 * 永远同一套图案」（跨到别的章换一套）。确定性 → 单测直接锁图案。
 */
export function hash32(from: string, to: string): number {
  const s = `${from}\u0000${to}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** 抖动相位 (ox, oy) ∈ 0..7：seed → mulberry32 → 两个相位整数 */
export function ditherPhase(seed: number): { ox: number; oy: number } {
  const rnd = mulberry32(seed >>> 0);
  return {
    ox: Math.min(7, Math.floor(rnd() * 8)),
    oy: Math.min(7, Math.floor(rnd() * 8)),
  };
}

/**
 * 唯一阈值公式（k 的符号 = 方向，公式本体不因方向而变）：
 *   v = (bayer8[(gx+ox)&7][(gy+oy)&7]/64) · DITHER_SPAN + k · dist(格心,波心)/射程
 * gx/gy = 格下标（整数）；波心与射程都用格单位。结果钳到 [0,1]：钳制只是兜底
 * （参数区已保证 max v ≤1），让有限步收敛永远成立。
 */
export function threshold(
  gx: number,
  gy: number,
  center: GridPoint,
  k: number,
  reach: number,
  ox: number,
  oy: number
): number {
  const b = BAYER8[(gx + ox) & 7]![(gy + oy) & 7]! / 64;
  const dx = gx + 0.5 - center.gx;
  const dy = gy + 0.5 - center.gy;
  const r = Math.hypot(dx, dy) / Math.max(1, reach);
  // k 的符号 = 波的行进方向（行程 = 该格距波心的归一化距离，聚方向取补）；
  // |k| = 斜率（波速旋钮），钳到 1−DITHER_SPAN 保证阈值不撞顶。
  const travel = k >= 0 ? r : 1 - r;
  const slope = Math.min(Math.abs(k), 1 - SECTION_TRANS.DITHER_SPAN);
  return clamp01(b * SECTION_TRANS.DITHER_SPAN + slope * travel);
}

/** 射程 = 波心到格网四角的最远距离（格单位）——距离项的归一化分母 */
export function reachFrom(center: GridPoint, cols: number, rows: number): number {
  let best = 0;
  for (const [cx, cy] of [
    [0, 0],
    [cols, 0],
    [0, rows],
    [cols, rows],
  ] as const) {
    best = Math.max(best, Math.hypot(cx - center.gx, cy - center.gy));
  }
  return Math.max(1, best);
}

/**
 * 重锚几何到**当前**滚动（每帧调，仪式长在滚动上）：
 * 波心 = 两章**当前**可见带的中心；起源线 = 边界**当前**视口 y。
 * 只动几何、不动格状态——格只会朝前走（0→1→2→3），不会因为波心移动而闪回。
 */
export function reanchor(st: Ceremony, rects: CeremonyRects): void {
  const gx = (st.cols - 1) / 2;
  st.breakCenter.gx = gx;
  st.breakCenter.gy = (rects.from.y0 + rects.from.y1) / 2 / st.cell;
  st.gatherCenter.gx = gx;
  st.gatherCenter.gy = (rects.to.y0 + rects.to.y1) / 2 / st.cell;
  st.breakReach = reachFrom(st.breakCenter, st.cols, st.rows);
  st.gatherReach = reachFrom(st.gatherCenter, st.cols, st.rows);
  st.originY = rects.originY;
}

/**
 * 仪式梯度（规格 §5）：**首次章界交接** = 完整双阶段 + 光束签名；
 * 其余章界 = 仅聚（呼吸）。首屏现在是「窗」那一章（ADR-0027），
 * 所以首次交接是 window → hero（旧的 hero → about 已成第二次）。
 */
export function isFullCeremony(fired: boolean, fromId: string, toId: string): boolean {
  return !fired && fromId === 'window' && toId === 'hero';
}

/**
 * 起一场仪式：格铺满视口、波心取两章可见带的中心、相位从 seed 派生。
 * `full = false`（默认）= 仅聚（开场满格暖暗，吸气）；`full = true` = 破 → 聚。
 */
export function makeCeremony(
  fromId: string,
  toId: string,
  dir: 1 | -1,
  rects: CeremonyRects,
  seed: number,
  full = false
): Ceremony {
  const w = Math.max(1, Math.round(rects.w));
  const h = Math.max(1, Math.round(rects.h));
  const cell = Math.max(1, Math.round(w / SECTION_TRANS.CELLS_ACROSS));
  const cols = Math.max(1, Math.ceil(w / cell));
  const rows = Math.max(1, Math.ceil(h / cell));
  const { ox, oy } = ditherPhase(seed);
  const gx = (cols - 1) / 2;
  const midRow = (band: BandRect): number => (band.y0 + band.y1) / 2 / cell;
  const breakCenter = { gx, gy: midRow(rects.from) };
  const gatherCenter = { gx, gy: midRow(rects.to) };
  const cells = new Uint8Array(cols * rows);
  // 仅聚：开场满格暖暗——「其后只留呼吸」的吸气帧
  if (!full) cells.fill(CELL_VEIL);
  const breakDur = full ? SECTION_TRANS.BREAK_DUR : 0;
  const gatherDur = full ? SECTION_TRANS.GATHER_DUR : SECTION_TRANS.GATHER_ONLY_DUR;
  const st: Ceremony = {
    fromId,
    toId,
    dir,
    full,
    seed,
    ox,
    oy,
    cell,
    cols,
    rows,
    breakReach: 1,
    gatherReach: 1,
    breakCenter,
    gatherCenter,
    originY: rects.originY,
    total: breakDur + gatherDur,
    phase: full ? 'break' : 'gather',
    t: 0,
    progress: 0,
    beam: 0,
    cells,
    flashed: new Uint8Array(cols * rows),
  };
  reanchor(st, rects);
  return st;
}

/**
 * 推进一步（dt = 毫秒；scrollDelta = 本帧滚动 px，与滚动同一物理）：
 * ① 上一步闪的格落定（闪只活 1 帧）；② 阶段推进（破 → 聚 → done）；
 * ③ 本步到达阈值的格进入闪。就地推进 state 并返回它（状态机，零 DOM）。
 * 进度 = 时间项（dt/阶段时长）+ 滚动项（|scrollDelta|/SCROLL_SWEEP_PX）：
 * 快滚被压缩（滚动项抢跑完），慢滚/停住由时间项兑底（整场 ≤750ms）。
 */
export function step(st: Ceremony, dt: number, scrollDelta = 0): Ceremony {
  if (st.phase === 'done') return st;
  const d = Number.isFinite(dt) && dt > 0 ? dt : 0;
  const px = Number.isFinite(scrollDelta)
    ? Math.min(Math.abs(scrollDelta), SECTION_TRANS.SCROLL_BOOST_CAP_PX)
    : 0;
  const boost = (px / SECTION_TRANS.SCROLL_SWEEP_PX) * st.total;
  st.t += d + boost;

  // ① 上一步闪的格落定（先按**当前**阶段落定，再谈换阶段）
  const settle = st.phase === 'break' ? CELL_VEIL : CELL_CLEAR;
  for (let i = 0; i < st.cells.length; i++) {
    if (st.cells[i] === CELL_FLASH) st.cells[i] = settle;
  }
  st.flashed.fill(0);

  const breakEnd = st.full ? SECTION_TRANS.BREAK_DUR : 0;
  const gatherDur = st.full ? SECTION_TRANS.GATHER_DUR : SECTION_TRANS.GATHER_ONLY_DUR;
  const end = breakEnd + gatherDur;

  // ② 收场：未落定的格一律落定（破没来得及切的补成暖暗，闪格点亮）
  if (st.t >= end) {
    for (let i = 0; i < st.cells.length; i++) {
      if (st.cells[i] === CELL_PENDING) st.cells[i] = CELL_VEIL;
      else if (st.cells[i] === CELL_FLASH) st.cells[i] = CELL_CLEAR;
    }
    st.phase = 'done';
    st.progress = 1;
    st.beam = st.full ? 1 : 0;
    return st;
  }

  const nextPhase: CeremonyPhase = st.t >= breakEnd ? 'gather' : 'break';
  if (nextPhase !== st.phase) {
    // 破 → 聚 交接：未动的格补成暖暗（全场已在暗处），随后由聚点亮
    for (let i = 0; i < st.cells.length; i++) {
      if (st.cells[i] === CELL_PENDING) st.cells[i] = CELL_VEIL;
    }
    st.phase = nextPhase;
  }

  const pStart = st.phase === 'break' ? 0 : breakEnd;
  const pDur = st.phase === 'break' ? SECTION_TRANS.BREAK_DUR : gatherDur;
  st.progress = clamp01((st.t - pStart) / pDur);
  st.beam = st.full && st.phase === 'gather' ? st.progress : 0;

  // ③ 本步到达阈值的格 → 闪 1 帧
  const isBreak = st.phase === 'break';
  const center = isBreak ? st.breakCenter : st.gatherCenter;
  const k = isBreak ? SECTION_TRANS.K_BREAK : SECTION_TRANS.K_GATHER;
  const reach = isBreak ? st.breakReach : st.gatherReach;
  const want = isBreak ? CELL_PENDING : CELL_VEIL;
  for (let r = 0; r < st.rows; r++) {
    for (let c = 0; c < st.cols; c++) {
      const i = r * st.cols + c;
      if (st.cells[i] !== want) continue;
      if (threshold(c, r, center, k, reach, st.ox, st.oy) <= st.progress) {
        st.cells[i] = CELL_FLASH;
        st.flashed[i] = 1;
      }
    }
  }
  return st;
}

/** 还活着吗（runtime 的 shouldRun 判据：仪式结束即停帧） */
export function alive(st: Ceremony | null): boolean {
  return st !== null && st.phase !== 'done';
}

/**
 * 放炮裁决（纯节流矩阵）：同章不重放 / 两次仪式间隔 ≥900ms / reduced 恒 false。
 * `lastFired = -Infinity` 表示从未放过。
 */
export function shouldFire(
  prev: string | null,
  cur: string | null,
  now: number,
  lastFired: number,
  reduced: boolean
): boolean {
  if (reduced) return false;
  if (!cur || cur === prev) return false;
  if (!Number.isFinite(now)) return false;
  return now - lastFired >= SECTION_TRANS.MIN_GAP;
}
