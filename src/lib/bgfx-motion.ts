/**
 * bgfx-motion —— bg-fx 视口自适应量与滚动视差的纯函数层（extract-for-testability）。
 *
 * 职责：把 BgFx 组件内联的「密度/长度/振幅/厚度」经验式与滚动视差数学抽到单一
 * 可测模块 —— 观感参数基线的唯一数据源。组件只声明粒子状态与绘制步。
 *
 * 08-31 修正结论（致未来 WebGPU 迁移）：本模块是「设计规格」层——数值语义可平移进
 * WGSL 常量（量化/踏阶/密度公式几乎 1:1），但渲染模型（粒子数组 → 坐标哈希）不迁移，
 * 且 GPU 版视觉效果需按既定验收矩阵重新验收，不可「直接迁移直接可用」。
 */

/** 视差强度：滚动 1px → 近层星尘最多偏移 22%（像素踏阶取整） */
export const PARALLAX_STRENGTH = 0.22;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** 星尘密度：随视口面积线性，钳 [70, 170]（全屏性能约定；dpr ≤1.5 由 fx runtime 管） */
export function starCount(area: number): number {
  return Math.round(clamp(area / 9000, 70, 170));
}

/** 像素雨列数：随宽度线性（1px 一列），钳 [20, 90] */
export function rainColumns(w: number): number {
  return Math.round(clamp(w / 4, 20, 90));
}

/** 雨滴长度区间（px）：视口自适应区间，供该帧随机取样 */
export function rainLengthRange(): [number, number] {
  return [7, 25];
}

/** 合成波振幅：随屏高线性（主波/次波比例固定 0.1 / 0.07） */
export function waveAmplitude(h: number): { a1: number; a2: number } {
  return { a1: h * 0.1, a2: h * 0.07 };
}

/** scan 光带厚度：随相位脉动 2..6px（细带；全屏配弱尾后不再有全宽高亮块） */
export function scanThickness(phase: number): number {
  return 2 + Math.round(Math.max(0, Math.sin(phase)) * 4);
}

/** scan 淡尾 alpha：第 i 步（0..n-1）→ 单调递减，末步仍 >0（尾随时间残留，弱尾） */
export function scanTailAlpha(i: number, n: number): number {
  const t = (i + 1) / (n + 1);
  return 0.55 * (1 - t);
}

/**
 * 滚动视差位移：scrollY × 深度 × 强度，取整（像素踏阶，贴合像素语言）。
 * 深度约定：0 = 远景（贴视口不动，如天空）、1 = 近景（以 22% 页速随滚动漂移）。
 */
export function parallaxShift(
  scrollY: number,
  depth: number,
  strength = PARALLAX_STRENGTH
): number {
  return Math.round(scrollY * depth * strength);
}

/** 视口内纵坐标：含视差偏移后的卷绕，恒落 [0, h)——任何 y/h/scroll 输入都安全 */
export function starViewY(
  y: number,
  h: number,
  scrollY: number,
  depth: number,
  strength = PARALLAX_STRENGTH
): number {
  const v = y - parallaxShift(scrollY, depth, strength);
  return ((v % h) + h) % h;
}

// ===================== 机箱内部（core：机器叙事） =====================
// 结构层 = PCB 设计图（走线簇 + 芯片块），停帧即成立的一张图（评审门 5）；
// 事件层 = 信号包（TRACE）/ 尘埃（DUST）/ 待机灯（LED）；全部零依赖 canvas2D。

export interface TraceSeg {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** 曼哈顿长（像素） */
  len: number;
}

export interface Trace {
  segs: TraceSeg[];
  /** 累计长（像素） */
  total: number;
}

export interface MachineChip {
  x: number;
  y: number;
  w: number;
  h: number;
  main: boolean;
  /** 引脚坐标（8px 网格，供走线锚定） */
  pins: { x: number; y: number }[];
}

export interface MachineTrace {
  segs: TraceSeg[];
  total: number;
  /** 线宽：2 = 电源轨 / 1 = 信号线（评审 R7） */
  px: number;
  from: 'chip' | 'edge';
  to: 'chip' | 'edge';
}

/** 8px 网格对齐（评审 R2） */
export function snap8(n: number): number {
  return Math.max(8, Math.round(n / 8) * 8);
}

/** 段是否穿过净空矩形（轴对齐，评审 R5） */
export function segHitsRect(s: TraceSeg, r: { x1: number; y1: number; x2: number; y2: number }): boolean {
  return (
    Math.max(Math.min(s.x1, s.x2), r.x1) <= Math.min(Math.max(s.x1, s.x2), r.x2) &&
    Math.max(Math.min(s.y1, s.y2), r.y1) <= Math.min(Math.max(s.y1, s.y2), r.y2)
  );
}

/** 引脚生成：主芯每侧 5 个、辅芯每侧 3 个（2×4 px，间距 8px 网格） */
export function chipPins(c: { x: number; y: number; w: number; h: number }, main: boolean): { x: number; y: number }[] {
  const n = main ? 5 : 3;
  const pins: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    const off = (i + 1) * 8;
    pins.push({ x: c.x + off, y: c.y }, { x: c.x + off, y: c.y + c.h }); // 上下
    pins.push({ x: c.x, y: c.y + off }, { x: c.x + c.w, y: c.y + off }); // 左右
  }
  return pins;
}

/** 单条走线路由：起点（必须是某 pin）→ 目标（另一 pin 或视口边缘），Z 形 2 弯，全 8px 网格，恒达终点 */
export function genRoute(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  rng: () => number
): Trace {
  const segs: TraceSeg[] = [];
  let total = 0;
  const push = (a: number, b: number, c: number, d: number) => {
    const len = Math.abs(c - a) + Math.abs(d - b);
    if (len > 0) {
      segs.push({ x1: a, y1: b, x2: c, y2: d, len });
      total += len;
    }
  };
  // Z 形：横 → 竖 → 横 → 竖，弯点随机，恒止于 (x1,y1)
  const mx = snap8(x0 + (x1 - x0) * rng());
  const my = snap8(y0 + (y1 - y0) * rng());
  push(x0, y0, mx, y0);
  push(mx, y0, mx, my);
  push(mx, my, x1, my);
  push(x1, my, x1, y1);
  if (segs.length === 0) push(x0, y0, x1, y1);
  return { segs, total };
}

// 旧 genTracesFor 保留（六模式未用、向后兼容），新增机箱专用布局：
export function genMachineLayout(
  w: number,
  h: number,
  rng: () => number
): { chips: MachineChip[]; traces: MachineTrace[] } {
  // 中央净空（hero 文字区，评审 R5）：60%×40%
  const clear = { x1: w * 0.2, y1: h * 0.28, x2: w * 0.8, y2: h * 0.68 };
  const inClear = (x: number, y: number) =>
    x > clear.x1 && x < clear.x2 && y > clear.y1 && y < clear.y2;

  // 主芯：右下（净空外，0.88w 起）；辅芯 2 个靠左（x 带外）——锚点 x 都在净空外，T 形走廊才成立
  const candidates = [
    { x: snap8(w * 0.88), y: snap8(h * 0.72) }, // 主芯 40×40
    { x: snap8(w * 0.1), y: snap8(h * 0.3) },
    { x: snap8(w * 0.1), y: snap8(h * 0.84) },
  ];
  const chips: MachineChip[] = [];
  const addChip = (x: number, y: number, main: boolean) => {
    const c: MachineChip = {
      x,
      y,
      w: main ? 40 : 16,
      h: main ? 40 : 16, // 辅芯 16×16：高 12 会破 8px 网格（引脚 %8）
      main,
      pins: [],
    };
    c.pins = chipPins(c, main);
    chips.push(c);
  };
  addChip(candidates[0].x, candidates[0].y, true);
  for (const cand of candidates.slice(1)) {
    const ok =
      !inClear(cand.x, cand.y) && chips.every((c) => Math.hypot(c.x - cand.x, c.y - cand.y) >= 120);
    if (ok && chips.length < 4) addChip(cand.x, cand.y, false);
  }

  // 走线：6-8 条；2-3 条长电源轨（2px），其余信号线（1px）；起点=某 pin，终点=pin/边缘
  const nTraces = 6 + Math.floor(rng() * 3);
  const edgeTargets = [
    { x: snap8(w * 0.9), y: 8 }, // 上下缘目标 x 必须在净空带外（T 形走廊前提）
    { x: snap8(w * 0.9), y: h - 8 },
    { x: 8, y: snap8(h * 0.5) },
    { x: w - 8, y: snap8(h * 0.5) },
  ];
  const traces: MachineTrace[] = [];
  let attempts = 0;
  while (traces.length < nTraces && attempts < nTraces * 8) {
    attempts++;
    const src = chips[Math.floor(rng() * chips.length)];
    const sp = src.pins[Math.floor(rng() * src.pins.length)];
    const fromChip = true;
    const toChip = rng() < 0.5;
    let tx: number;
    let ty: number;
    let toKind: 'chip' | 'edge';
    if (toChip && chips.length > 1) {
      const dst = chips[Math.floor(rng() * chips.length)];
      if (dst === src) continue;
      const tp = dst.pins[Math.floor(rng() * dst.pins.length)];
      tx = tp.x;
      ty = tp.y;
      toKind = 'chip';
    } else {
      const e = edgeTargets[Math.floor(rng() * edgeTargets.length)];
      tx = e.x;
      ty = e.y;
      toKind = 'edge';
    }
    const route = genRoute(sp.x, sp.y, tx, ty, rng);
    let route2 = route;
    if (route.segs.some((s) => segHitsRect(s, clear))) {
      route2 = genRouteAvoid(sp.x, sp.y, tx, ty, clear); // 兜底 T 形走廊路由
      if (route2.segs.some((s) => segHitsRect(s, clear))) continue;
    }
    const px = route2.total > 300 ? 2 : 1; // 长电源轨 2px / 信号线 1px（评审 R7）
    traces.push({ segs: route2.segs, total: route2.total, px, from: 'chip', to: toKind });
  }
  return { chips, traces };
}

/** 绕行兜底（评审 R5 保证）：3 段 T 形走廊路由——纵段仅发生在锚点列（x 带外），永不穿禁区 */
export function genRouteAvoid(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  clear: { x1: number; y1: number; x2: number; y2: number }
): Trace {
  const segs: TraceSeg[] = [];
  let total = 0;
  const push = (a: number, b: number, c: number, d: number) => {
    const len = Math.abs(c - a) + Math.abs(d - b);
    if (len > 0) {
      segs.push({ x1: a, y1: b, x2: c, y2: d, len });
      total += len;
    }
  };
  const T = Math.max(8, Math.round((clear.y1 - 8) / 8) * 8);
  push(x0, y0, x0, T);
  push(x0, T, x1, T);
  push(x1, T, x1, y1);
  return { segs, total };
}

/** L 形曼哈顿走线：自芯片出发，2-3 段 90° 直角弯走向视口边缘（1px 结构线） */
export function genManhattanTrace(
  x0: number,
  y0: number,
  w: number,
  h: number,
  rng: () => number
): Trace {
  const segs: TraceSeg[] = [];
  let total = 0;
  const push = (x1: number, y1: number, x2: number, y2: number) => {
    const len = Math.abs(x2 - x1) + Math.abs(y2 - y1);
    if (len > 0) {
      segs.push({ x1, y1, x2, y2, len });
      total += len;
    }
  };
  const horiz = rng() < 0.5;
  const sign = rng() < 0.5 ? 1 : -1;
  const edge = 10;
  if (horiz) {
    // 水平弯折段 + 竖向奔边段（+ 可选第三段回折，2-4 段）
    const bendX = Math.round(clamp(x0 + sign * (24 + rng() * 90), edge, w - edge));
    push(x0, y0, bendX, y0);
    const endY = sign > 0 ? h - edge : edge;
    push(bendX, y0, bendX, endY);
    if (rng() < 0.4) {
      const endX = Math.round(clamp(bendX - sign * (12 + rng() * 40), edge, w - edge));
      push(bendX, endY, endX, endY);
    }
  } else {
    const bendY = Math.round(clamp(y0 + sign * (24 + rng() * 90), edge, h - edge));
    push(x0, y0, x0, bendY);
    const endX = sign > 0 ? w - edge : edge;
    push(x0, bendY, endX, bendY);
    if (rng() < 0.4) {
      const endY = Math.round(clamp(bendY - sign * (12 + rng() * 40), edge, h - edge));
      push(endX, bendY, endX, endY);
    }
  }
  // 兜底：极端情形（首段归零）给一段直出，保证结构层非空
  if (segs.length === 0) {
    push(x0, y0, x0, y0 + (sign > 0 ? Math.max(24, h * 0.2) : -Math.max(24, h * 0.2)));
  }
  return { segs, total };
}

/** 信号包位置：按累计进度 u∈[0,1] 沿折线定位（含所在段索引，供磷光点亮段） */
export function packetPos(
  segs: TraceSeg[],
  total: number,
  u: number
): { x: number; y: number; seg: number } {
  const target = clamp(u, 0, 1) * total;
  let acc = 0;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (target <= acc + s.len) {
      const d = s.len === 0 ? 0 : (target - acc) / s.len;
      return { x: Math.round(s.x1 + (s.x2 - s.x1) * d), y: Math.round(s.y1 + (s.y2 - s.y1) * d), seg: i };
    }
    acc += s.len;
  }
  const last = segs[segs.length - 1];
  return { x: Math.round(last.x2), y: Math.round(last.y2), seg: segs.length - 1 };
}

/** 待机灯呼吸：1.6s 周期（60fps 下 sin(t*0.06)），输出 [0,1] */
export function ledPhase(t: number): number {
  return 0.5 + 0.5 * Math.sin(t * 0.06);
}

/** 尘埃出生窗口：靠视口中部 1/3 带（避开四缘控件簇），输出 {x, y} */
export function dustSpawn(w: number, h: number, rng: () => number): { x: number; y: number } {
  return { x: rng() * w, y: h * 0.25 + rng() * h * 0.5 };
}

/** 走线簇生成：主角芯片固定右上，配角沿边，出线 1-2 条/芯片；返回 traces */
export function genTracesFor(
  w: number,
  h: number,
  rng: () => number,
  chipPoints: { x: number; y: number }[]
): Trace[] {
  const traces: Trace[] = [];
  for (const c of chipPoints) {
    const n = 1 + Math.floor(rng() * 2);
    for (let i = 0; i < n; i++) {
      traces.push(genManhattanTrace(c.x + rng() * 4 - 2, c.y + rng() * 4 - 2, w, h, rng));
    }
  }
  return traces;
}

// ===================== section reorganization（ADR-0004） =====================
// 在 v5 机箱核心静态 PCB 之上，按 section 将走线/芯片重组为 5 种机器态子图。
// 全部为纯函数：可测、零副作用；组件只声明绘制步与 tween 时钟。

export type SectionId = 'hero' | 'about' | 'projects' | 'skills' | 'contact';
export const SECTION_IDS: SectionId[] = ['hero', 'about', 'projects', 'skills', 'contact'];

/**
 * Silk easing：cubic-bezier(0.22, 0.9, 0.24, 1) —— 本站唯一运动种子（ap-motion-vocab）。
 * canvas 粒子 tween 需 JS easing（CSS/WAAPI easing 不能直接用于逐粒子）。x∈[0,1] → y，单调。
 */
export function easeSilk(x: number): number {
  const cx = 0.22;
  const cy = 0.9;
  const c2x = 0.24;
  const c2y = 1;
  const bx = (t: number) => 3 * (1 - t) ** 2 * t * cx + 3 * (1 - t) * t ** 2 * c2x + t ** 3;
  const by = (t: number) => 3 * (1 - t) ** 2 * t * cy + 3 * (1 - t) * t ** 2 * c2y + t ** 3;
  const xi = clamp(x, 0, 1);
  let lo = 0;
  let hi = 1;
  let t = xi;
  for (let i = 0; i < 22; i++) {
    t = (lo + hi) / 2;
    if (bx(t) < xi) lo = t;
    else hi = t;
  }
  return by(t);
}

/** 线性插值（tween 基元） */
export function mix(a: number, b: number, e: number): number {
  return a + (b - a) * e;
}

/** 2D 相机：随滚动推拉（scale）+ 鼠标视差（offset）。reduced 下视差振幅 ×0.5。 */
export interface CameraState {
  scale: number;
  ox: number;
  oy: number;
}
export const CAMERA = { minScale: 1, maxScale: 1.32, parallax: 14 } as const;
export function cameraFor(
  scrollProgress: number,
  mouseX: number,
  mouseY: number,
  reduced: boolean
): CameraState {
  const sp = clamp(scrollProgress, 0, 1);
  // 连续推拉：sin 剖面（端点 1、中段峰）—— 空间穿行感（kavindu 相机 dolly 的 2D 翻译）
  const scale = mix(CAMERA.minScale, CAMERA.maxScale, Math.sin(sp * Math.PI));
  const amp = CAMERA.parallax * (reduced ? 0.5 : 1);
  return { scale, ox: -mouseX * amp, oy: -mouseY * amp };
}

// ---- 确定性机箱板：固定 4 芯片 + 7 走线，元素 id 稳定，供 tween 逐元素对应 ----

const CHIP_MAIN = 40;
const CHIP_AUX = 16;

/** 固定走线连通性（chip 索引对；'edge' = 通向视口边缘的出/入站走线） */
interface TraceSpec {
  a: number;
  b: number | 'edge';
  /** 边缘锚点（分数，运行时 ×w/×h） */
  edge?: { fx: number; fy: number };
}
const TRACE_SPECS: TraceSpec[] = [
  { a: 0, b: 1 },
  { a: 0, b: 2 },
  { a: 0, b: 3 },
  { a: 1, b: 2 },
  { a: 2, b: 3 },
  { a: 1, b: 'edge', edge: { fx: 0.06, fy: 0.5 } },
  { a: 3, b: 'edge', edge: { fx: 0.94, fy: 0.5 } },
];

/** 每 section 的 4 芯片锚点（分数坐标，运行时 ×w/×h 并 8px 量化）。纯机器态、不画具象物。 */
function chipAnchors(section: SectionId): { fx: number; fy: number; main: boolean }[] {
  switch (section) {
    case 'hero': // 待机散板：四角松散铺开
      return [
        { fx: 0.86, fy: 0.7, main: true },
        { fx: 0.12, fy: 0.28, main: false },
        { fx: 0.12, fy: 0.82, main: false },
        { fx: 0.7, fy: 0.18, main: false },
      ];
    case 'about': // 走线汇聚到「人格模块」：向中心（净空外）收拢
      return [
        { fx: 0.62, fy: 0.62, main: true },
        { fx: 0.32, fy: 0.32, main: false },
        { fx: 0.32, fy: 0.66, main: false },
        { fx: 0.6, fy: 0.32, main: false },
      ];
    case 'projects': // 3 芯片簇：三辅芯分立为三个模块
      return [
        { fx: 0.88, fy: 0.2, main: true },
        { fx: 0.25, fy: 0.42, main: false },
        { fx: 0.5, fy: 0.62, main: false },
        { fx: 0.75, fy: 0.42, main: false },
      ];
    case 'skills': // 活动总线：辅芯排成一条横向 bus（技能条概念，机器化）
      return [
        { fx: 0.12, fy: 0.5, main: true },
        { fx: 0.36, fy: 0.5, main: false },
        { fx: 0.56, fy: 0.5, main: false },
        { fx: 0.78, fy: 0.5, main: false },
      ];
    case 'contact': // 对外信号上行：主芯压到底边，出站走线向外缘
      return [
        { fx: 0.5, fy: 0.85, main: true },
        { fx: 0.2, fy: 0.8, main: false },
        { fx: 0.5, fy: 0.2, main: false },
        { fx: 0.8, fy: 0.8, main: false },
      ];
  }
}

/** Z 形固定 4 段路由（恒 4 段 → 磷光余辉 traceLit 索引稳定），全 8px 网格 */
function routeZ(x0: number, y0: number, x1: number, y1: number): Trace {
  const mx = snap8((x0 + x1) / 2);
  const my = snap8((y0 + y1) / 2);
  const pts: [number, number][] = [
    [x0, y0],
    [mx, y0],
    [mx, my],
    [x1, my],
    [x1, y1],
  ];
  const segs: TraceSeg[] = [];
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[i + 1];
    const len = Math.abs(bx - ax) + Math.abs(by - ay);
    segs.push({ x1: ax, y1: ay, x2: bx, y2: by, len });
    total += len;
  }
  return { segs, total: total || 1 };
}

function makeChip(x: number, y: number, main: boolean): MachineChip {
  const c: MachineChip = { x, y, w: main ? CHIP_MAIN : CHIP_AUX, h: main ? CHIP_MAIN : CHIP_AUX, main, pins: [] };
  c.pins = chipPins(c, main);
  return c;
}

/** 生成某 section 的确定性机箱板（4 芯片 + 7 走线），元素 id 跨 section 稳定 */
export function genSectionTargets(section: SectionId, w: number, h: number): {
  chips: MachineChip[];
  traces: MachineTrace[];
} {
  const anchors = chipAnchors(section);
  const chips = anchors.map((a) => makeChip(snap8(a.fx * w), snap8(a.fy * h), a.main));
  const traces: MachineTrace[] = TRACE_SPECS.map((spec) => {
    const sp = chips[spec.a].pins[0];
    let tx: number;
    let ty: number;
    let toKind: 'chip' | 'edge';
    if (spec.b === 'edge' && spec.edge) {
      tx = snap8(spec.edge.fx * w);
      ty = snap8(spec.edge.fy * h);
      toKind = 'edge';
    } else {
      const dst = chips[spec.b as number].pins[0];
      tx = dst.x;
      ty = dst.y;
      toKind = 'chip';
    }
    const r = routeZ(sp.x, sp.y, tx, ty);
    return { segs: r.segs, total: r.total, px: r.total > 300 ? 2 : 1, from: 'chip', to: toKind };
  });
  return { chips, traces };
}

// ===================== dual-core glow（双芯辉光，ADR-0006 前置） =====================
// 电流/走线被点亮时的发光语言：--gb-3 白热亮芯 + --gb-2 磷光晕（踏阶方块同心叠加）。
// 复用 page transition 已定稿的「双芯光束」语言；像素语言禁 blur/shadowBlur，辉光只许
// 方块外扩。白芯门控把「常态流动的单个信号包」与「整板冲亮的仪式」区分开，防止开机
// 那 2.5s 变成整板白热。全部纯函数，单测：tests/unit/bgfx-glow.spec.ts。

/** 辉光参数基线（观感参数的唯一数据源；调参只改这里） */
export const GLOW = {
  /** 白芯门控：lit 超过此值芯才取 --gb-3 白热色，否则芯仍用 accent */
  whiteGate: 0.85,
  /** 辉光地板：lit 不超过此值不出晕（与既有 lit>0.5 分支对齐，低于则走预热/dim 态） */
  glowFloor: 0.5,
  /** 中晕 / 外晕相对元素线宽的踏阶外扩量（px） */
  midGrow: 2,
  outerGrow: 4,
  /** 中晕 alpha = min(max, lit × slope) */
  midAlphaMax: 0.42,
  midAlphaSlope: 0.46,
  /** 外晕 alpha = min(max, lit × slope) */
  outerAlphaMax: 0.2,
  outerAlphaSlope: 0.22,
  /** 芯 alpha = min(max, lit × slope) */
  coreAlphaMax: 0.92,
  coreAlphaSlope: 1.1,
  /** 抗 scrim 压暗补偿：芯层补画的 alpha 系数（× 芯 alpha × scrim 覆盖度） */
  compensation: 0.5,
} as const;

/** 色槽：'core' = --gb-3 白热芯；'accent' = --gb-2 磷光晕 */
export type GlowSlot = 'core' | 'accent';

/**
 * 元素形态：'trace' = 线状走线段（禁止外晕 —— 8px 网格下 px+4 的晕会与邻线相糊，
 * 破坏「停帧即一张设计图」）；'packet' = 点状信号包（无长度，允许 px+4 外晕）。
 */
export type GlowKind = 'trace' | 'packet';

export interface GlowLayer {
  /** 相对元素线宽的踏阶外扩量（px）；0 = 元素本体宽度 */
  grow: number;
  /** 绘制 alpha（0..1） */
  alpha: number;
  slot: GlowSlot;
  /** true = 抗 scrim 压暗的补偿层（被可读性 scrim 压住时才补画） */
  compensation?: boolean;
}

/**
 * 可读性 scrim 覆盖度 0..1 —— 驱动抗压缩补偿的强度。
 * content 模式（blog / 文章 / 404）：scrim 整页覆盖 → 恒 1。
 * hero-vivid 模式（index）：scrim 顶边在 100vh，随滚动从 0 线性升到 1；
 * 线性而非阈值切换，避免翻页到半屏时辉光亮度突跳。
 */
export function scrimCoverage(scrollY: number, viewportH: number, vivid: boolean): number {
  if (!vivid) return 1;
  return clamp(Math.max(0, scrollY) / Math.max(1, viewportH), 0, 1);
}

/**
 * 双芯辉光分层：由磷光余辉 lit（0..1）解出该画哪几层、每层多宽多亮。
 * 返回顺序 = 绘制顺序（外晕 → 中晕 → 芯 → 补偿），调用方照序叠画即可。
 * 空数组 = 不出辉光（调用方退回 dim / 预热态）。
 */
export function coreGlow(
  lit: number,
  opts: { kind: GlowKind; scrim?: number } = { kind: 'trace' }
): GlowLayer[] {
  const v = clamp(lit, 0, 1);
  if (v <= GLOW.glowFloor) return [];
  const layers: GlowLayer[] = [];
  // 外晕只给点状信号包：线状走线段用 px+4 会在 8px 网格上与邻线相糊
  if (opts.kind === 'packet') {
    layers.push({
      grow: GLOW.outerGrow,
      alpha: Math.min(GLOW.outerAlphaMax, v * GLOW.outerAlphaSlope),
      slot: 'accent',
    });
  }
  layers.push({
    grow: GLOW.midGrow,
    alpha: Math.min(GLOW.midAlphaMax, v * GLOW.midAlphaSlope),
    slot: 'accent',
  });
  const coreAlpha = Math.min(GLOW.coreAlphaMax, v * GLOW.coreAlphaSlope);
  const slot: GlowSlot = v > GLOW.whiteGate ? 'core' : 'accent';
  layers.push({ grow: 0, alpha: coreAlpha, slot });
  const scrim = clamp(opts.scrim ?? 0, 0, 1);
  if (scrim > 0) {
    layers.push({
      grow: 0,
      alpha: coreAlpha * GLOW.compensation * scrim,
      slot,
      compensation: true,
    });
  }
  return layers;
}