/**
 * fx-moment —— bg-fx「编排时刻」总线（orchestration，08-31 调研两家报告的共同结论）。
 *
 * 评审门（任何时刻动工前逐条过，见 docs/specs/bgfx-acceptance-matrix.md）：
 * 1) 单强调色（每帧唯一活色 = --gb-2，结构层一律灰阶）
 * 2) 10s 窗口只有一个焦点动作（编排时刻 > 散落特效）
 * 3) 静置密度预算（静置移动对象 ≤4、单对象 ≤3px、总面积 <1/4 视口、并发「醒」时刻 ≤2）
 * 4) 时长档位（交互 ≤300ms / 区混合 500-1200ms / 签名 1200-2000ms deliberate）
 * 5) 停帧构图（冻结一帧仍是一张成立的设计图）
 *
 * 本模块只承载事件化触发与预算的纯逻辑：时刻要有原因（事件驱动而非固定周期）、
 * 有静默（预算闸 + 触发后兜底）、有失效判据（F/T），否则只是换皮的散落特效。
 * 富随机分布用传入 rng（可测）；无 DOM 依赖。
 */

export interface MomentGate {
  /** 距上次时刻不足 minIntervalMs → 拒绝（预算闸，防时刻退化成新循环） */
  try(now: number): boolean;
  /** 记录一次已消耗的时刻（由宿主在时刻真正演出时调用） */
  note(now: number): void;
  /** 距离可再触发还需多少 ms（>0 表示冷却中） */
  cooldown(now: number): number;
}

export function createMomentGate(minIntervalMs: number): MomentGate {
  let last = -Infinity;
  return {
    try(now: number): boolean {
      return now - last >= minIntervalMs;
    },
    note(now: number): void {
      last = now;
    },
    cooldown(now: number): number {
      return Math.max(0, minIntervalMs - (now - last));
    },
  };
}

/** 事件化 jitter：在 [loMs, hiMs] 内取随机等待（rng 注入可测） */
export function nextInRange(rng: () => number, loMs: number, hiMs: number): number {
  return loMs + rng() * (hiMs - loMs);
}

/** 全局冻结窗（PageTrans 转角窗口内禁用时刻，防与光束抢戏） */
export function isInFreeze(now: number, freezeUntil: number): boolean {
  return now < freezeUntil;
}

/** 会话内一次性标记（开机仪式：首帧播、刷新不重播；storage 可注入可测） */
export function bootOnce(
  key: string,
  read: (k: string) => string | null,
  write: (k: string, v: string) => void,
  mark: string
): boolean {
  let v: string | null = null;
  try {
    v = read(key);
  } catch {
    // storage 不可用 → 按已播处理（避免每次刷新重播仪式）
    return false;
  }
  if (v === mark) return false;
  try {
    write(key, mark);
  } catch {
    /* 写失败静默：本次会话仍播，下次加载可能重播——storage 异常环境可接受 */
  }
  return true;
}

/**
 * 磷光级联衰减因子：每帧乘子 → 亮迹半衰（纯度函数，step 循环外链）。
 * decayPerFrame 0.94 ≈ 0.5s 半衰（60fps）；0.90 ≈ 0.17s（快速熄灭）。
 */
export function phosphorDecay(decayPerFrame: number, framesStep: number): number {
  return Math.pow(decayPerFrame, framesStep);
}