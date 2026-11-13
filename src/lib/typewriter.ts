/**
 * 首屏打字机（hero typewriter）—— 纯逻辑层（vitest 目标，零 DOM 依赖）
 *
 * 媒介映射（见 ADR-0017）：站点叙事是一台机器——`CrtTerminal` 就是 CRT 终端，
 * 屏幕里本来就有示波器波形 + 方块光标；`.kicker` 是「Press START」丝印；
 * BgFx core 有「走线级联上电」的开机仪式。打字机 = **终端打印机**：
 * 机器上电（bg-fx）→ 终端把站名打印出来（hero）。零新颜色、零新形状、零新依赖。
 *
 * 本模块只算**时间线**（谁在第几毫秒出现），DOM 量边界与逐帧推进在 Hero.astro 的
 * 内联模块脚本里。这样节奏参数可单测、可复现，不用开浏览器。
 *
 * 关键不变量：
 *   ① offsets 单调不减（打字不能倒退）；
 *   ② total ≤ BUDGET_MS（超预算时整条时间线**等比压缩**，不砍字、不改单调性）；
 *   ③ 同样的 rng 两次调用逐字相同（确定性）。
 *
 * _Avoid_: 把节奏常量散在组件里、用 `steps()` 近似（CJK 前进量非整数，会裁在半字形上）、
 *          在纯逻辑层碰 DOM（`Range` 只能拿真浏览器量，量完再喂进来）。
 */

/** 打字机节奏基线（观感参数的唯一数据源；调参只改这里） */
export const TYPE = {
  /** 单字基准间隔（ms） */
  MS_PER_CHAR: 32,
  /** 每字间隔的抖动幅度（±比例）：机械打字不是节拍器，匀速会读成进度条 */
  JITTER: 0.4,
  /** 行间停顿（打完一行 → 下一行起打），像终端的换行回车 */
  LINE_GAP: 220,
  /** 起打前静默（避开 PageTrans 入场幕帘 280ms 的前段，别让两场动画抢同一拍） */
  LEAD_IN: 140,
  /**
   * 全串时长硬上限（ms）。超预算时**整条时间线等比压缩**，而不是把每字间隔钳到下限——
   * 钳下限会在长文案上反向破预算（1000 字 × 26ms 下限 = 26s），等比压缩则永远成立。
   *
   * 取值理由（2026-09-11 作者反馈「intro 不打字很突兀」后扩到 3 行）：
   *   21 字素 → 57 字素（h1 + tagline + intro）。按 32ms/字名义 ≈ 2.4s，
   *   与 BgFx 开机仪式（走线级联上电 2.5s）同拍——首访时「机器上电 + 终端打印」一起结束。
   *   预算定 2600 是**安全网**（不是目标值）：名义值留出余量，抖动不会天天撞顶被压平。
   */
  BUDGET_MS: 2600,
} as const;

/** 一个可打印单元：grapheme 文本 + 它在原串里的 UTF-16 码元起点 */
export interface Grapheme {
  /** grapheme 文本（可能多码元，如 emoji ZWJ 序列） */
  text: string;
  /** UTF-16 码元起点 —— `Range.setStart/setEnd` 用的就是这个口径 */
  index: number;
}

/**
 * 按**字素簇**切分（不是按码元）：`Range` 的 offset 是 UTF-16 码元，
 * 代理对（emoji）若按码元拆开会取到半个字符的 rect。优先 `Intl.Segmenter`
 * （能正确把 `👨‍👩‍👧` 当一个字），老引擎退化为逐码点（`for...of`）。
 */
export function splitGraphemes(text: string): Grapheme[] {
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    try {
      const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
      return [...seg.segment(text)].map((s) => ({ text: s.segment, index: s.index }));
    } catch {
      /* 引擎有 Segmenter 但构造失败（极老实现）→ 走下面的码点退化 */
    }
  }
  const out: Grapheme[] = [];
  let i = 0;
  for (const ch of text) {
    out.push({ text: ch, index: i });
    i += ch.length;
  }
  return out;
}

export interface PlanOpts {
  /** 随机源（可注入固定序列 → 单测可复现）；默认 Math.random */
  rng?: () => number;
  /** 覆盖单字基准间隔 */
  msPerChar?: number;
  /** 覆盖抖动幅度 */
  jitter?: number;
  /** 覆盖起打静默 */
  leadIn?: number;
  /** 覆盖全串预算 */
  budget?: number;
  /** 覆盖行间停顿 */
  lineGap?: number;
}

/** 单行的打字计划 */
export interface TypingPlan {
  segments: Grapheme[];
  /** 每个字素的**开始显示**时刻（ms，相对整串起点；长度 === segments.length） */
  offsets: number[];
  /** 本行最后一个字素显示完成的时刻（ms，相对整串起点） */
  end: number;
}

/** 多行（hero：h1 → tagline）的打字计划 */
export interface SequencePlan {
  lines: TypingPlan[];
  /** 每行起打时刻（ms，相对整串起点） */
  starts: number[];
  /** 整串打完的时刻（ms，相对整串起点）；恒 ≤ budget */
  total: number;
  /** 是否发生过预算压缩（留档给 e2e / 调试，不参与渲染） */
  compressed: boolean;
}

interface Resolved {
  rng: () => number;
  msPerChar: number;
  jitter: number;
  leadIn: number;
  budget: number;
  lineGap: number;
}

function resolve(opts: PlanOpts): Resolved {
  return {
    rng: opts.rng ?? Math.random,
    msPerChar: opts.msPerChar ?? TYPE.MS_PER_CHAR,
    jitter: opts.jitter ?? TYPE.JITTER,
    leadIn: opts.leadIn ?? TYPE.LEAD_IN,
    budget: opts.budget ?? TYPE.BUDGET_MS,
    lineGap: opts.lineGap ?? TYPE.LINE_GAP,
  };
}

/**
 * 多行打字时间线。文本为空 / 全空白时返回空计划（`total = leadIn`），
 * 调用方据此直接走「不打字」分支。
 */
export function planSequence(texts: string[], opts: PlanOpts = {}): SequencePlan {
  const r = resolve(opts);
  const lines = texts.map((t) => splitGraphemes(t));

  const raw: TypingPlan[] = [];
  const starts: number[] = [];
  let cursor = r.leadIn;
  for (const segments of lines) {
    starts.push(cursor);
    const offsets: number[] = [];
    for (let i = 0; i < segments.length; i++) {
      offsets.push(cursor);
      cursor += r.msPerChar * (1 + (r.rng() * 2 - 1) * r.jitter);
    }
    raw.push({ segments, offsets, end: cursor });
    cursor += r.lineGap;
  }
  // 末行之后不该留行间停顿
  const rawTotal = lines.length ? Math.max(r.leadIn, cursor - r.lineGap) : r.leadIn;

  // 预算压缩：整条时间线等比缩放（保单调、保抖动形状、不砍字）
  const scale = rawTotal > r.budget ? r.budget / rawTotal : 1;
  const compressed = scale < 1;
  const scaled = raw.map((l) => ({
    segments: l.segments,
    offsets: l.offsets.map((o) => o * scale),
    end: l.end * scale,
  }));

  return {
    lines: scaled,
    starts: starts.map((s) => s * scale),
    total: rawTotal * scale,
    compressed,
  };
}

/** 单行时间线（`planSequence` 的常用特例） */
export function planTyping(text: string, opts: PlanOpts = {}): TypingPlan {
  const plan = planSequence([text], opts);
  return plan.lines[0] ?? { segments: [], offsets: [], end: plan.total };
}

// ===================== 多行裁切几何（reveal polygon） =====================
// 为什么不能继续用 `clip-path: inset()`：inset 是**一个矩形**，多行文字会变成
// 「两行同时左→右擦除」—— 那不是打字。而 hero 的 intro 在桌面就是 2 行
// （`max-width: 34rem`），移动端同样 2 行，所以必须支持多行。
//
// 形状 = **L 形阶梯**：已打完的视觉行整行露出，当前行露到最后一个已打印字素的右边界。
// 单行时它退化成矩形（与旧写法等价），所以不需要两套代码。
// 全部是纯几何，单测锁（tests/unit/typewriter.spec.ts）。

/** 一个视觉行带（相对元素 border box） */
export interface RowBand {
  top: number;
  bottom: number;
}

/** 一个可打印单元在元素内的几何（相对元素 border box） */
export interface GlyphBox {
  left: number;
  right: number;
  /** 所属视觉行索引（0 = 第一行） */
  row: number;
}

export interface Pt {
  x: number;
  y: number;
}

/**
 * 「已打出 n 个字素」时的裁切多边形顶点（px，相对元素 border box，顺时针）。
 * 顶点序：`(0,0) (W,0) (W,行顶) (x,行顶) (x,行底) (0,行底)`。
 * n = 0 时 x = 0、行顶 = 第一行顶 → 零面积（什么都不露）。
 */
export function revealPolygonPoints(
  width: number,
  rows: RowBand[],
  glyphs: GlyphBox[],
  n: number
): Pt[] {
  const w = Math.max(0, width);
  if (!rows.length) {
    // 量不到行（隐藏 / 字体未就绪）→ 零面积，不露任何东西
    return [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    ];
  }
  const k = n <= 0 ? 0 : Math.min(n, glyphs.length);
  const last = k <= 0 ? null : glyphs[k - 1]!;
  const rowIdx = last ? Math.min(last.row, rows.length - 1) : 0;
  const row = rows[rowIdx]!;
  const x = last ? Math.min(w, Math.max(0, last.right)) : 0;
  return [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: row.top },
    { x, y: row.top },
    { x, y: row.bottom },
    { x: 0, y: row.bottom },
  ];
}

/** 同上，直接给 CSS 值 */
export function revealPolygon(
  width: number,
  rows: RowBand[],
  glyphs: GlyphBox[],
  n: number
): string {
  const pts = revealPolygonPoints(width, rows, glyphs, n);
  return `polygon(${pts.map((p) => `${p.x.toFixed(2)}px ${p.y.toFixed(2)}px`).join(', ')})`;
}
