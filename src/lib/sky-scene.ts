/**
 * sky-scene —— 「窗外」场景几何：远山与湖面 / 像素云 / 天气粒子的确定性生成层。
 *
 * 画面（ADR-0020 作者 09-21 定稿 A 案）：**远山与湖面**。天空占约三分之二，
 * 两层山脊剪影（远山淡、近山实，大气透视），山脚一片静水倒映天空的颜色——
 * 黄昏整片湖是金红的，深夜是墨蓝带星；水边几丛芦苇剪影随风轻摆。
 *
 * 为什么不是城市天际线（原稿）：竖线 + 暗块 + 密集窗格的构成天然压迫，
 * 楼群还把画面下半部封死，吃掉天空的呼吸感（作者原话：「太压抑了」）。
 *
 * 全部纯函数：同 w/h 必得同画面（可单测、可复现）。确定性 rng（mulberry32）：
 * 山是静止的，动的只有云、雨雪、涟漪、波光与芦苇的摇摆。
 */

/** mulberry32 确定性伪随机（小、快、可播种） */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------- 远山与湖面 ----------------

/** 芦苇丛（前景剪影）：几根细杆，顶端随风轻摆 */
export interface Reed {
  /** 丛的根部 x */
  x: number;
  /** 根部 y（画面底部附近） */
  baseY: number;
  /** 每根杆：横向偏移 + 高度 + 摇摆相位（dx 让一丛散开，而不是叠成一根） */
  stalks: { dx: number; h: number; ph: number }[];
  /** 纵深 0..1（0 = 远/淡小，1 = 近/暗大） */
  depth: number;
}

/**
 * 岸树剪影（2026-09-23「景色太简单」加密度）：地平线上的团冠树，远看是一团
 * 有高低差的暗色块——岸线不再是一条光秃秃的直线。画在 land 缓存帧里（静止）。
 */
export interface TreeCluster {
  /** 根部 x（树干中心） */
  x: number;
  /** 根部 y（岸树 = 地平线；岛树 = 岛面） */
  baseY: number;
  /** 树干高（px） */
  trunk: number;
  /** 树冠块 [dx, dy, w, h][]（相对根部；dy ≤ 0 向上） */
  blocks: [number, number, number, number][];
  /** 长在小岛上（水面中的滩涂，不是岸线） */
  isle: boolean;
}

/** 小岛：水面中的一小块滩涂，载着一丛树——湖面中景的视觉锚点 */
export interface Isle {
  x: number;
  w: number;
  /** 露出水面高度（px） */
  h: number;
}

export interface ScenerySpec {
  /** 湖面线（近山山脚）：以下皆为水 */
  horizonY: number;
  /** 远山脊线采样点 [x, y][]（大气透视最淡层，在后方且更高） */
  farRidge: [number, number][];
  /** 中山脊线采样点（远与近之间的第三层：两层的画面只有「前后」，三层才有「纵深」） */
  midRidge: [number, number][];
  /** 近山脊线采样点（稍暗，在前方且更低——两层错开才有纵深） */
  nearRidge: [number, number][];
  /** 前景芦苇丛（左右两侧，不挡画面中央） */
  reeds: Reed[];
  /** 岸树 + 岛树（地平线剪影层） */
  trees: TreeCluster[];
  /** 水面小滩涂（至多一座；没有树的湖面缺一个中景锚点） */
  isle: Isle;
  /** 山体皴纹（近山）：脊线下的明暗竖纹，破掉「纯色块剪影」 */
  hatch: HatchStroke[];
}

/** 皴纹：山脊下的一条竖纹。shade 0 = 背光暗纹，1 = 受光亮纹 */
export interface HatchStroke {
  x: number;
  /** 纹顶 y（在脊线之下、地平线之上） */
  y: number;
  len: number;
  shade: 0 | 1;
}

/**
 * 山脊线：三段正弦叠加（大轮廓 + 中起伏 + 小锯齿），恒在 horizonY 之上。
 * amp 越大山越高；peaks 越大峰越多。
 */
export function ridgeLine(
  w: number,
  horizonY: number,
  amp: number,
  peaks: number,
  seed: number
): [number, number][] {
  const rng = mulberry32(seed);
  const p0 = rng() * Math.PI * 2;
  const p1 = rng() * Math.PI * 2;
  const p2 = rng() * Math.PI * 2;
  // 采样步长（px）：440 点级密度让山脊台阶踏面 ~3px——大格子（w/220 时代 ~6px）
  // 在 1:1 天空下会明显看出「楼梯齿太粗」
  const step = Math.max(2, Math.round(w / 440));
  // 尖峰函数：三角波（|2frac-1|）→ 峰尖谷圆，这是「山」而不是「沙丘」的关键；
  // 纯正弦叠加出来的总是平缓的包，看着像沙丘/波浪
  const tri = (x: number) => Math.abs(2 * (x - Math.floor(x)) - 1);
  const pts: [number, number][] = [];
  for (let x = 0; x <= w; x += step) {
    const u = x / w;
    // 大峰（主山脊）+ 中峰（次峰）+ 小锯齿（岩棱），三层都是尖峰
    const shape =
      0.62 * (1 - tri(u * peaks + p0 / 6.283)) +
      0.26 * (1 - tri(u * peaks * 2.7 + p1 / 6.283)) +
      0.12 * (1 - tri(u * peaks * 5.9 + p2 / 6.283));
    pts.push([x, Math.round(horizonY - amp * (0.22 + 0.78 * shape))]);
  }
  return pts;
}

/**
 * 「远山与湖面」布局（确定性）。
 *
 * **山与湖整体压在 0.72h 以下**（2026-09-21 作者反馈「#hero 的第一块遮挡了窗外的景色」）：
 * 首屏的 hero 面板占据约 0.32h–0.71h 的中央横带，山脊原本正落在它的下缘后面，
 * 于是**中央的山全被面板挡掉、只剩左右两条边**。把地平线压到 0.80h 之后，
 * 远山近山 + 湖面整条横带落在面板下方，全宽可见；面板上方则留给天空、云、日月。
 * - 湖面线 0.80h
 * - 远山：脊线基准 0.775h、振幅 0.06h（更淡）
 * - 近山：脊线基准 0.795h、振幅 0.048h（2026-10-05 评审④：0.03h 太矮，
 *   加上白天偏青绿读作「绿篱笆」——要有山的体量，仍压在 0.72h 线之下）
 * - 芦苇：左右两侧各 2 丛（画面中央 60% 留空）
 * - 岸树：4–6 丛团冠树贴在地平线上；另有一座载树小岛在水面中景
 * - 皴纹：近山脊线下偏山脚分布的明暗竖纹（密度 22%，见 hatchStrokes）
 */
export function genScenery(w: number, h: number, seed = 20260921): ScenerySpec {
  const rng = mulberry32(seed);
  const horizonY = Math.round(h * 0.8);
  const farRidge = ridgeLine(w, Math.round(h * 0.775), h * 0.06, 3.2, seed + 11);
  // 中山（2026-11-13）：夹在远/近之间——三层错开 13–15px，叠出「远淡中灰近实」
  // 的纵深；两层时代远景只有前后两片，读作两块色板。
  const midRidge = ridgeLine(w, Math.round(h * 0.786), h * 0.054, 4.3, seed + 17);
  const nearRidge = ridgeLine(w, Math.round(h * 0.795), h * 0.048, 5.5, seed + 23);

  const reeds: Reed[] = [];
  const clump = (x: number, depth: number) => {
    const n = 6 + Math.floor(rng() * 5);
    const spread = h * 0.055 * (0.6 + depth * 0.8);
    const stalks = Array.from({ length: n }, () => ({
      dx: Math.round((rng() - 0.5) * spread),
      h: Math.round(h * (0.1 + rng() * 0.1) * (0.65 + depth * 0.7)),
      ph: rng() * Math.PI * 2,
    }));
    reeds.push({ x: Math.round(x), baseY: h + 2, stalks, depth });
  };
  // 左岸两丛 + 右岸两丛（近丛更靠内，远丛贴边）；画面中央 60% 留空
  clump(w * 0.05, 0.4);
  clump(w * 0.125, 0.85);
  clump(w * 0.885, 0.6);
  clump(w * 0.955, 0.35);

  // ---- 岸树 + 小岛（2026-09-23 场景加密度）----
  const trees: TreeCluster[] = [];
  const treeAt = (x: number, baseY: number, isle: boolean, scale: number): TreeCluster => {
    const trunk = Math.max(2, Math.round((2 + rng() * 3) * scale));
    // 树冠：3–5 块堆出团冠（底宽顶窄、左右错落，不是矩形堆叠的「积木」）
    const n = 3 + Math.floor(rng() * 3);
    const cw = Math.round((7 + rng() * 8) * scale);
    const blocks: [number, number, number, number][] = [];
    let bx = -Math.round(cw / 2);
    for (let k = 0; k < n; k++) {
      const bw = Math.max(2, Math.round(cw * (0.3 + rng() * 0.3)));
      const bh = Math.max(2, Math.round((2 + rng() * 3) * scale));
      const dy = -trunk - Math.round((k + 1) * (2.2 * scale) + rng() * 1.5);
      blocks.push([bx, dy, bw, bh]);
      bx += Math.max(2, Math.round(bw * (0.55 + rng() * 0.3)));
      if (bx > Math.round(cw / 2)) break;
    }
    return { x: Math.round(x), baseY: Math.round(baseY), trunk, blocks, isle };
  };
  // 岸树：4–6 丛贴地平线，横向散开（最小间距 9%w，不挤成一团）
  const nTrees = 4 + Math.floor(rng() * 3);
  const treeXs: number[] = [];
  for (let k = 0; k < nTrees; k++) {
    for (let tries = 0; tries < 24; tries++) {
      const x = w * (0.03 + rng() * 0.94);
      if (treeXs.every((tx) => Math.abs(tx - x) > w * 0.09)) {
        treeXs.push(x);
        trees.push(treeAt(x, horizonY, false, 0.8 + rng() * 0.5));
        break;
      }
    }
  }
  // 小岛：水面中景（避开门面中央 0.45–0.62w，免得恰好顶在 CTA 视线上），载一丛树。
  // 2026-10-05 评审⑤：旧尺寸（w≈0.03w、露 2–3px、树 ×0.9–1.2）在 1440 宽下读不出，
  // 「中景锚点」名存实亡——放大到能被看见的一档，仍是一个低矮滩涂。
  const isleSide = rng() < 0.5 ? 0.2 + rng() * 0.22 : 0.66 + rng() * 0.2;
  const isle: Isle = {
    x: Math.round(w * isleSide),
    w: Math.max(24, Math.round(w * (0.05 + rng() * 0.012))),
    h: 3 + Math.floor(rng() * 2),
  };
  trees.push(treeAt(isle.x, horizonY - isle.h, true, 1.3 + rng() * 0.3));

  return {
    horizonY,
    farRidge,
    midRidge,
    nearRidge,
    reeds,
    trees,
    isle,
    hatch: hatchStrokes(nearRidge, horizonY, seed + 37),
  };
}

// ---------------- 山体皴纹 ----------------

/**
 * 山体皴纹：沿脊线稀疏挂竖纹（国画皴法的像素表达）。
 * 没有它山就是两块纯色剪影——平得像纸。
 *
 * 2026-10-05 评审④改两件事（旧版 45% 密度 + 3–11px 等长，近山只有 27px 高时
 * 整条山读作等距梳齿/栅栏）：
 * - **密度 22%**：每 ~15px 才一根，打破等距节奏；
 * - **纹顶偏山脚分布**（山体上部 35% 保持干净——那里是受光边+暗棱双线的地盘），
 *   长度随所剩山体走（3–14px），山脚纹长、贴脊纹短，皴才有「下山坡」的方向。
 */
export function hatchStrokes(
  pts: [number, number][],
  horizonY: number,
  seed: number
): HatchStroke[] {
  const rng = mulberry32(seed);
  const out: HatchStroke[] = [];
  for (const [x, ry] of pts) {
    if (rng() > 0.22) continue;
    const body = horizonY - ry; // 这根采样柱上的山体厚度
    if (body < 6) continue; // 太薄的山脚不皴（避免挤成一条实线）
    const y = Math.min(Math.round(ry + body * (0.35 + rng() * 0.5)), horizonY - 6);
    const maxLen = Math.min(14, horizonY - y - 1);
    if (maxLen < 3) continue;
    out.push({ x, y, len: Math.round(3 + rng() * (maxLen - 3)), shade: rng() < 0.4 ? 1 : 0 });
  }
  return out;
}

// ---------------- 渔舟 / 飞鸟 ----------------

/** 渔舟参数（唯一数据源）：游移/起伏都是帧单位 @60fps */
export const BOAT = {
  /** 游移角频率（两个慢正弦叠加 → 长时间不重复的漂移轨迹） */
  WANDER_W1: 0.0006,
  WANDER_W2: 0.00023,
  /** 游移幅度（×视口宽）：主摆 + 次摆，恒在窗洞内 */
  RANGE1: 0.17,
  RANGE2: 0.07,
  /** 随波起伏 */
  BOB_W: 0.016,
  BOB_AMP: 1.5,
  /** 水面纵向位置（×水高的比例，从地平线往下） */
  LANE: 0.38,
  /** 船灯亮起的星光阈值（starlight ≥ 此值才点灯） */
  LAMP_STAR: 0.25,
} as const;

/**
 * 渔舟位姿：抛锚的船随潮水缓慢游移（两个慢正弦叠加，不是匀速直线——
 * 匀速读作「玩具船在轨道上」）+ 随波起伏。x/y 全整数（像素语言）。
 */
export function boatPose(
  t: number,
  w: number,
  horizonY: number,
  h: number
): { x: number; y: number } {
  const waterH = Math.max(1, h - horizonY);
  const x =
    w * 0.5 +
    Math.sin(t * BOAT.WANDER_W1) * w * BOAT.RANGE1 +
    Math.sin(t * BOAT.WANDER_W2 + 1.7) * w * BOAT.RANGE2;
  const bob = Math.sin(t * BOAT.BOB_W) * BOAT.BOB_AMP;
  return {
    x: Math.round(x),
    y: Math.round(horizonY + waterH * BOAT.LANE + bob),
  };
}

/** 飞鸟参数 */
export const BIRD = {
  /** 扑翼角频率（rad/帧）——扑一次约 0.3s */
  FLAP_W: 0.35,
  /** 队列水平速度（px/帧 @60fps） */
  SPEED: 1.6,
  /** 首群出现的帧（确定性：e2e 能等到） */
  FIRST_AT: 300,
  /** 两群之间的最小间隔（帧） */
  GAP: 60 * 18,
} as const;

/** 扑翼相位：true = 翼尖朝上（V 字），false = 翼放平 */
export function birdWingUp(t: number): boolean {
  return Math.sin(t * BIRD.FLAP_W) > 0;
}

// ---------------- 湖面倒影（随波扭曲 + 柔化，2026-09-23 二轮） ----------------

/**
 * 倒影参数（唯一数据源）。
 *
 * 静态镜像（旧版）是一张「倒挂在水面上的照片」——纹丝不动，一眼假。
 * 现在倒影改为**动态逐行采样**：从 land 缓存帧里取镜像行，每行做正弦水平
 * 错位（随波扭曲），透明度随纵深衰减 + 低频呼吸（柔化），另有一批「破镜」
 * 行随时间流动（波浪把镜像打断的暗带）。
 */
export const REFLECT = {
  /** 逐行镜像采样的行高（px；2px 行 = 免费柔化 + 减半 drawImage 次数） */
  STEP: 2,
  /** 扭曲的纵向角频率（rad/px）：相邻行错位连续变化 = 波形连续 */
  SHEAR_Y: 0.12,
  /** 扭曲的时间角频率（rad/帧）——波在流，不是冻结的水纹 */
  SHEAR_T: 0.021,
  /** 水平错位上限（px；近岸处还要乘纵深系数） */
  SHEAR_MAX: 3,
  /** 破镜行的时间流速（rad/帧） */
  GAP_T: 0.021,
  /** 倒影基准不透明度（贴岸最实） */
  ALPHA: 0.3,
  /** 向近观者衰减到的最低比例（1 = 不衰减） */
  ALPHA_FLOOR: 0.3,
} as const;

/**
 * 倒影某行的水平错位（整数 px）：纵向低频正弦 × 时间流动 × 纵深放大——
 * 越靠近观察者波越大（近岸处的镜像断得最厉害，贴地平线处接近平直）。
 */
export function reflectShear(y: number, t: number, ph: number, depth: number): number {
  return Math.round(
    Math.sin(y * REFLECT.SHEAR_Y + t * REFLECT.SHEAR_T + ph) *
      REFLECT.SHEAR_MAX *
      (0.3 + 0.7 * depth)
  );
}

/**
 * 倒影某行的不透明度：贴岸最实、向近观者衰减（0.3 倍），叠加低频呼吸
 * （水面亮度起伏）。柔化 = 不再是一张恒定透明度的硬镜像。
 */
export function reflectAlpha(depth: number, t: number, ph: number): number {
  const decay = 1 - depth * (1 - REFLECT.ALPHA_FLOOR);
  const breathe = 0.8 + 0.2 * Math.sin(t * 0.013 + ph);
  return REFLECT.ALPHA * decay * breathe;
}

/**
 * 「破镜」行：这行倒影几乎消失（露出水色），图案随时间向下流——
 * 静水镜面每隔几行被打断一次，才是水而不是镜。
 */
export function reflectGap(y: number, t: number, ph: number): boolean {
  return Math.sin(y * 0.085 - t * REFLECT.GAP_T + ph) < -0.55;
}

// ---------------- 窗 ----------------
// 真窗几何已迁到 `window-room.ts`（ADR-0027 后是「整扇窗占满首屏」版 windowSpec；
// 旧的「墙上凹洞」与更早的「视口减一圈画框」都已退役）。

/** 脊线在给定 x 处的高度（线性插值；用于山影倒影与雾带定位） */
export function ridgeAt(pts: [number, number][], x: number): number {
  if (pts.length === 0) return 0;
  if (x <= pts[0]![0]) return pts[0]![1];
  const last = pts[pts.length - 1]!;
  if (x >= last[0]) return last[1];
  let i = 0;
  while (i < pts.length - 2 && pts[i + 1]![0] < x) i++;
  const a = pts[i]!;
  const b = pts[i + 1]!;
  const t = (x - a[0]) / Math.max(1, b[0] - a[0]);
  return a[1] + (b[1] - a[1]) * t;
}

// ---------------- 云 ----------------

/**
 * 云的运动与变形参数（唯一数据源；单测按这里的数值守线）。
 *
 * 作者 2026-09-21 反馈三件事，各有对应字段：
 * - 「太快了」→ `SPEED_*`：原来近层 0.34 px/帧（26 px/s），读作贴纸在滑
 * - 「像是匀速行驶」→ `GUST_*`：两个不同频率的正弦相乘 → 阵风式加减速，
 *   且长时间看没有固定周期（单一正弦仍是「有节奏的匀速」）
 * - 「每朵云的形状像是固定的」→ `MORPH_*`：每块各自的低频**整数**伸缩
 * - 垂直起伏 `BOB_*`：真实云随气流微微上下，纯水平漂移就是贴纸
 *
 * 单位是**帧**（60fps）：周期 60s ≈ 3600 帧 → ω ≈ 2π/3600 ≈ 0.0017。
 */
export const CLOUD = {
  /** 基准漂移速度（px/帧 @60fps） */
  SPEED_NEAR: 0.17,
  SPEED_FAR: 0.075,
  /** 阵风倍率的基准与振幅（乘出 0.30–1.20 倍） */
  GUST_BASE: 0.75,
  GUST_AMP: 0.45,
  GUST_W1: 0.0016,
  GUST_W2: 0.00042,
  /** 形状变形：宽 / 高的角频率（各块再乘各自的倍率） */
  MORPH_W_WIDE: 0.0055,
  MORPH_W_TALL: 0.008,
  /** 大块的最大伸缩量（px）；小块固定 ±1 */
  MORPH_MAX: 3,
  /** 上下起伏角频率 */
  BOB_W: 0.0023,
} as const;

export interface CloudMorph {
  /** 宽 / 高的相位与频率倍率（每块一套 → 同朵云的各块不同步） */
  wPh: number;
  hPh: number;
  wK: number;
  hK: number;
}

export interface PixelCloud {
  /** 组成矩形 [x, y, w, h][]（相对云原点）；**块 0 = 受影底座**，其余受光 */
  blocks: [number, number, number, number][];
  /** 深度 0 = 远层（小而慢），1 = 近层（大而快） */
  depth: number;
  /** 初始 x（可负，从屏外飘入） */
  x: number;
  y: number;
  /** 基准水平漂移速度（px/帧 @60fps），实际速度再乘 `cloudGust()` */
  vx: number;
  w: number;
  h: number;
  /** 阵风相位（每朵不同 → 云与云之间加减速不同步） */
  gustPh: number;
  /** 上下起伏相位与幅度（px） */
  bobPh: number;
  bobAmp: number;
  /** 每块的变形参数（与 blocks 等长） */
  morph: CloudMorph[];
}

/**
 * 阵风倍率：两个不同频率的正弦相乘。
 * 单频正弦的加减速是**可预测的**（看一会儿就知道节奏），相乘后长时间无固定周期，
 * 才像真实的风。输出 0.30–1.20（恒正，云永不倒退）。
 */
export function cloudGust(t: number, ph: number): number {
  return (
    CLOUD.GUST_BASE +
    CLOUD.GUST_AMP * Math.sin(t * CLOUD.GUST_W1 + ph) * Math.sin(t * CLOUD.GUST_W2 + ph * 1.7)
  );
}

/** 上下起伏（整数像素；纯水平漂移读作贴纸，加一点竖直方向才像「浮」） */
export function cloudBob(t: number, ph: number, amp: number): number {
  return Math.round(Math.sin(t * CLOUD.BOB_W + ph) * amp);
}

/**
 * 云的缓慢变形：像素风的「鼓起与消散」。
 * 每块用各自的低频正弦做**整数**伸缩——平滑缩放会产生抗锯齿灰边、破像素语言，
 * 整数伸缩则天然是「这块像素多了一行」。
 * 底边固定、顶边伸缩（底平是云的标志），左右向中心对称。
 */
export function morphCloud(c: PixelCloud, t: number): [number, number, number, number][] {
  return c.blocks.map(([x, y, bw, bh], k) => {
    const m = c.morph[k]!;
    const span = bw > 28 ? CLOUD.MORPH_MAX : 1;
    const dw = Math.round(Math.sin(t * CLOUD.MORPH_W_WIDE * m.wK + m.wPh) * span);
    // 只往上长、不往回缩：收缩会让块顶与它上方那块之间裂出 1px 天空缝
    // （底边固定 → 缩是从上面缩，上一块不会跟着下来）
    const dh = Math.max(0, Math.round(Math.sin(t * CLOUD.MORPH_W_TALL * m.hK + m.hPh)));
    const nw = Math.max(2, bw + dw);
    const nh = Math.max(2, bh + dh);
    return [Math.round(x + (bw - nw) / 2), y + (bh - nh), nw, nh];
  });
}

/**
 * 像素云：**分瓣积云**（平底 + 2–4 个球瓣），确定性。
 *
 * 历史：4 块比例模板 → 大块拼接 → 扫描线排叠（3–7 排横条自底向上收窄）→ 分瓣。
 * 排叠版解决了「悬空方块」，但它**只有宽度一个自由度**：一排一根横条，
 * 不管怎么随机收窄，轮廓都是「一条长板 + 几个台阶」，1:1 下读作灰道道
 * （2026-11-13 实拍：云高 8–12px、宽 150–300px，比例 15:1）。
 * 分瓣把**竖直方向的第二个自由度**加回来：每朵云由 2–4 个椭圆瓣取并集，
 * 轮廓在横向上有多个顶点 → 才有「积云」的体积感。
 */
export function genClouds(
  w: number,
  h: number,
  cover: number,
  seed = 7
): PixelCloud[] {
  const rng = mulberry32(seed * 1000 + Math.round(cover * 100));
  // 云量分两档（2026-09-23 雨天满云）：
  // - cover < 0.6（晴/疏云/雾）：沿用线性档 3–10 朵
  // - cover ≥ 0.6（阴/雨/雪/雷）：**满云**——下限直接抬到 11 朵起，再随云量增密；
  //   雨云的块头也更大（×1.25）、压得更低更沉（y 从 0.04–0.44h 挪到 0.06–0.52h）。
  //   旧线性档下 thunder（cloud 0.95）只有 ~14 朵，雨天的天顶还能看见大片空蓝天，
  //   读作「晴天里下了场雨」。
  const dense = cover >= 0.6;
  const n = dense ? Math.round(11 + (cover - 0.6) * 30) : Math.round(3 + cover * 12);
  const clouds: PixelCloud[] = [];
  for (let i = 0; i < n; i++) {
    // 远近交替（不抽签）：随机抽签会让某一档天气恰好抽到全是近云/全是远云，
    // 画面就只剩一层——而「远小近大」正是云的景深。i%2 保证两层永远都在。
    const depth = i % 2;
    const cw0 = Math.round((depth ? 90 : 56) + rng() * (depth ? 110 : 60));
    const cw = dense ? Math.round(cw0 * 1.25) : cw0;
    // 分瓣积云：一条平底 + 2–4 个球瓣（椭圆截面，取并集）
    const baseH = rng() < 0.5 ? 2 : 4;
    const lobeN = 2 + Math.floor(rng() * 3);
    // 远层更扁：大气透视里远处的云被压扁，远近两层的形状语言要分开
    const tallK = depth ? 1 : 0.78;
    const lobes: { cx: number; r: number; lh: number }[] = [];
    for (let k = 0; k < lobeN; k++) {
      const r = cw * (0.20 + rng() * 0.14);
      lobes.push({
        // 瓣沿底宽铺开、中心带抖动（对称的云像图标）；中心夹在 [r, cw−r] 内，
        // 否则贴边的瓣被云盒切掉一半 → 轮廓一侧是刀切的直线
        cx: Math.min(cw - r, Math.max(r, cw * ((k + 0.5) / lobeN + (rng() - 0.5) * 0.14))),
        r,
        lh: Math.max(4, Math.round(cw * (0.16 + rng() * 0.16) * tallK)),
      });
    }
    const ch = Math.max(...lobes.map((l) => l.lh)) + baseH;

    // 逐 2px 行求瓣的并集 → 行程编码（一行可以有多个不连续段 = 瓣之间的凹口）
    const STEP = 2;
    const rows = Math.ceil(ch / STEP);
    const runsAt: [number, number][][] = [];
    for (let r = 0; r < rows; r++) {
      const rowBot = Math.min(ch, r * STEP + STEP);
      const d = ch - baseH - rowBot; // 该行底边距底座顶的高度（<0 = 落在底座里）
      const on = new Array<boolean>(cw).fill(false);
      if (d < 0) {
        on.fill(true); // 底座整行满宽 —— 云的平底
      } else {
        for (const l of lobes) {
          if (d >= l.lh) continue;
          const halfW = l.r * Math.sqrt(Math.max(0, 1 - (d / l.lh) ** 2));
          const x0 = Math.max(0, Math.round(l.cx - halfW));
          const x1 = Math.min(cw, Math.round(l.cx + halfW));
          for (let x = x0; x < x1; x++) on[x] = true;
        }
      }
      const runs: [number, number][] = [];
      for (let x = 0; x < cw; ) {
        if (!on[x]) {
          x++;
          continue;
        }
        let x2 = x + 1;
        while (x2 < cw && on[x2]) x2++;
        runs.push([x, x2]);
        x = x2;
      }
      runsAt.push(runs);
    }
    // 纵向合并：同一 x 段跨行连续 → 一块（自下往上；单块 ≤4px 保持排叠手感）
    const blocks: [number, number, number, number][] = [];
    const open = new Map<string, { x0: number; x1: number; yTop: number; h: number }>();
    for (let r = rows - 1; r >= 0; r--) {
      const yTop = r * STEP;
      const yBot = Math.min(ch, yTop + STEP);
      const rh = yBot - yTop;
      const seen = new Set<string>();
      for (const [x0, x1] of runsAt[r]!) {
        const key = x0 + ':' + x1;
        seen.add(key);
        const o = open.get(key);
        if (o && o.yTop === yBot && o.h + rh <= 4) {
          o.yTop = yTop;
          o.h += rh;
        } else {
          if (o) blocks.push([o.x0, o.yTop, o.x1 - o.x0, o.h]);
          open.set(key, { x0, x1, yTop, h: rh });
        }
      }
      for (const [key, o] of [...open]) {
        if (!seen.has(key)) {
          blocks.push([o.x0, o.yTop, o.x1 - o.x0, o.h]);
          open.delete(key);
        }
      }
    }
    for (const o of open.values()) blocks.push([o.x0, o.yTop, o.x1 - o.x0, o.h]);
    // 底 → 顶、左 → 右：绘制顺序让底座先落、瓣后叠；blocks[0] 必须是那条平底
    blocks.sort((a, b) => b[1] - a[1] || a[0] - b[0]);
    const morph: CloudMorph[] = blocks.map(() => ({
      wPh: rng() * Math.PI * 2,
      hPh: rng() * Math.PI * 2,
      wK: 0.7 + rng() * 0.7,
      hK: 0.7 + rng() * 0.7,
    }));
    clouds.push({
      blocks,
      depth,
      x: Math.round(rng() * (w + 320)) - 160,
      y: Math.round(h * (dense ? 0.06 + rng() * 0.46 : 0.04 + rng() * 0.4)),
      vx: (depth ? CLOUD.SPEED_NEAR : CLOUD.SPEED_FAR) * (0.7 + rng() * 0.6),
      w: cw,
      h: ch,
      gustPh: rng() * Math.PI * 2,
      bobPh: rng() * Math.PI * 2,
      bobAmp: 2 + Math.round(rng() * 3),
      morph,
    });
  }
  return clouds;
}

// ---------------- 山脚薄雾（近山体大气的常驻水汽） ----------------

/**
 * 山脚雾坡参数：雾坡从 mistTopY() 向地平线加浓（贴水最浓 0.16）。
 * 唯一数据源——e2e 的 countColor 窗口必须从它派生（雾坡洗掉的行不算纯色）。
 */
export const MIST = {
  /** 雾坡高度占视口高比例 */
  H: 0.03,
  /** 雾坡最低高度（px） */
  MIN: 10,
} as const;

/** 雾坡顶边的 y（此行以上近山体保持纯色；以下被雾逐行溶进天色） */
export function mistTopY(h: number, horizonY: number): number {
  return horizonY - Math.max(MIST.MIN, Math.round(h * MIST.H));
}

// ---------------- 天气粒子参数 ----------------

/** 雨滴数量：随视口宽度与雨强（上限保护性能） */
export function rainDropCount(w: number, intensity: number): number {
  return Math.min(320, Math.round((w / 5.5) * intensity));
}

/** 雪花数量：比雨稀（雪是「飘」不是「泼」） */
export function snowFlakeCount(w: number, intensity: number): number {
  return Math.min(190, Math.round((w / 9) * intensity));
}

/** 雨速档位：远层细慢 / 近层粗快（双层视差） */
export function rainSpeed(depth: number): [number, number] {
  return depth === 0 ? [5.5, 8] : [9, 13];
}

/** 雪片摇摆：横向正弦振幅（px）与下落速度区间 */
export function snowDrift(depth: number): { amp: number; vy: [number, number] } {
  return depth === 0 ? { amp: 0.4, vy: [0.7, 1.1] } : { amp: 0.9, vy: [1.2, 2.0] };
}

/**
 * 湖面涟漪上限：雨强越大越多，但恒有上限（像素湖面不是沸水）。
 * 涟漪只生在水面区（horizonY 以下）。
 */
export function rippleCap(rainIntensity: number): number {
  return Math.round(6 + rainIntensity * 26);
}

// ---------------- 玻璃上的雨（2026-09-23「雨打在玻璃上」） ----------------
//
// 雨粒子是**穿过画面**的（外面的雨），玻璃上还该有自己的雨：贴在窗洞上的
// 滑痕（细、慢、几乎垂直下坠）与暴雨沿窗流的水股（粗、长、更快）。
// 没有这一层，雨天的窗只是一块透明玻璃——「窗外在下雨」少了「我隔着玻璃看」。

/** 雨的观感档（强度 → 三种观感量）：毛毛雨短/慢/近垂直，暴雨长/快/强风斜 */
export interface RainLook {
  /** 雨丝长度倍率 */
  lenMul: number;
  /** 下落速度倍率 */
  vyMul: number;
  /** 风斜系数（vx / vy）：雨越大风越斜 */
  slantK: number;
}

/**
 * 雨丝观感：随雨强变「长短 / 快慢 / 斜度」三件事。
 * - 毛毛雨（0.35）：短（0.85）、慢（0.91）、近垂直（0.17）
 * - 暴雨（1.0）：长（1.40）、快（1.30）、强风斜（0.38）
 * 三条都随 intensity 严格递增，所以「毛毛雨和暴雨看起来一样」必红。
 */
export function rainLook(intensity: number): RainLook {
  return {
    lenMul: 0.55 + intensity * 0.85,
    vyMul: 0.7 + intensity * 0.6,
    slantK: 0.05 + intensity * 0.33,
  };
}

/**
 * 玻璃滑痕条数（细）：随视口宽与雨强；`< 0.15` 不画（雾/阴天玻璃是干的）。
 * 上限 26 条——再多就成「玻璃结了霜」，滑痕必须稀疏才读作「一滴一滴」。
 */
export function glassStreakCount(w: number, intensity: number): number {
  return intensity < 0.15 ? 0 : Math.min(26, Math.round((w / 110) * (0.5 + intensity)));
}

/**
 * 沿窗流的水股条数（粗）：只有暴雨级（≥ 0.85）才有——thunder(1) → 5 股，
 * rain(0.7) → 0。水股是「雨大到玻璃挂不住水」，中雨不该出现。
 */
export function glassStreamCount(intensity: number): number {
  return intensity >= 0.85 ? Math.round(2 + (intensity - 0.85) * 20) : 0;
}

/** 窗台积水高度（px）：同样只有暴雨级（≥ 0.85），封顶 3px */
export function sillWaterHeight(intensity: number): number {
  return intensity >= 0.85 ? Math.min(3, 2 + Math.round((intensity - 0.85) * 13)) : 0;
}

/**
 * 窗户振动位移（px，整数）：风够大（≥ 0.5）时，每 3.5s（210 帧 @60fps）来一阵
 * 短颤（前 12 帧），峰值 ±(0.6+wind) → wind 0.85 时 ±1..2px。
 * 这是「风拍窗」的暗示：**位置要整数**（像素语言不接受半像素抖动），
 * 且必须由 frame 决定（同帧同果，无随机漂移）。
 */
export function windowShake(frame: number, wind: number): number {
  if (wind < 0.5) return 0;
  const f = ((frame % 210) + 210) % 210; // 每 3.5s 一阵颤（@60fps）
  if (f >= 12) return 0;
  return Math.round(Math.sin(f * 1.8) * (0.6 + wind)); // ±1..±2 px
}

/** 闪电折线的顶点（整数像素坐标） */
export interface BoltPoint {
  x: number;
  y: number;
}

/**
 * 像素闪电线：从天顶附近一路折到地平线附近。
 * 逐段向下 8–18px 横摆 ±9px（**每步都是整数**），限 40 个顶点——
 * 顶点太多会读作「一条歪线」，太少是「一根斜棍」；
 * 40 点 × ~13px/步 ≈ 500px，足够从云里英到 0.8hy（山后）。
 * 首点在 0.06–0.14hy（云里），末点 ≥ 0.8hy（劈到山后）。
 */
export function genBolt(w: number, hy: number, rng: () => number): BoltPoint[] {
  const pts: BoltPoint[] = [];
  let x = Math.round(w * (0.18 + rng() * 0.64));
  let y = Math.round(hy * (0.06 + rng() * 0.08));
  pts.push({ x, y });
  const yEnd = Math.round(hy * (0.8 + rng() * 0.12));
  while (y < yEnd && pts.length < 40) {
    y += Math.round(8 + rng() * 10);
    x += Math.round((rng() - 0.5) * 18);
    x = Math.max(8, Math.min(w - 8, x));
    pts.push({ x, y });
  }
  return pts;
}

/** 涟漪寿命（帧 @60fps）：扩散到消失约 0.4s */
export const RIPPLE_LIFE = 24;

/** 雷闪节奏：**簇式随机雷暴**，不是匀速循环 ——
 * - 连击簇：上一击之后 35% 概率在 1.8–5s 内再来一道（真实雷暴的「一串一串」），
 *   最多连 3 击，之后强制回常规节奏（防无限连）；
 * - 常规间隔 3.5–16.5s，用 `rng()*rng()` 平方分布：短间隔多、长间隔偶发，
 *   打破「隔十秒准时响一次」的机器感（作者 2026-09-23：雷声像是循环播放，不够随机）。
 * reduced-motion 下调用方直接禁用。 */
export interface ThunderSchedule {
  /** 下一击的间隔（帧 @60fps，整数） */
  frames: number;
  /** 这一击算不算簇内连击的延续（调用方以此维护 streak） */
  inCluster: boolean;
}
export const THUNDER_CLUSTER_P = 0.35;
export const THUNDER_CLUSTER_MAX = 3;
export function nextThunderStrike(
  frame: number,
  streak: number,
  rng: () => number
): ThunderSchedule {
  const clustered = streak < THUNDER_CLUSTER_MAX && rng() < THUNDER_CLUSTER_P;
  const sec = clustered ? 1.8 + rng() * 3.2 : 3.5 + rng() * rng() * 13;
  return { frames: Math.round(sec * 60), inCluster: clustered };
}
