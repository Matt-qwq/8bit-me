/**
 * desk-room —— 「窗边工位」静物几何（T8）：书桌 / CRT 壳 / 台灯 / 茶杯 / 一摞书 / 卡带锚点。
 *
 * 定位：真窗（window-room.ts）把「窗外世界」钉进了墙上的凹洞，房间因此成立；
 * 但房间里还只有墙和窗，人味为零。T8 把**窗边的一张工位**放进左下角——
 * 桌、显示器壳、台灯、茶、书、卡带。它们全是**静态物件**：光（灯池 / 屏光 / 热气）
 * 是 T9，DOM 重排（把头像搬进 CRT 屏、卡带变按钮）是 T10。本任务里 CRT 屏是一块
 * 熄灭的近黑玻璃，是预期的中间态。
 *
 * 与 window-room 的关系（2026-09-26 ADR-0027 后**解绑**）：
 * - 工位与窗**不同屏**：窗住首屏 `#window`（整扇窗），工位住第二章 `#hero`。
 *   旧的「桌右缘让开窗框 `GAP_WIN`」「桌沿 = 窗洞口底 `LIFT_FRAC`」两条派生
 *   随窗搬走而删除——工位自成一景，几何只从视口 w/h 派生；
 * - 工位住**右半屏**（`x0 = round(w × 0.52)`，作者从三个摆法里选的②）：
 *   文字在左栏、场景在右栏，与旧的「窗在右」同构图；
 * - 窄屏（`w ≤ WINDOW.NARROW_MAX`）整组工位退场（小屏没有地方摆桌子），
 *   hero 保持居中栈布局。
 *
 * 全部整数、纯函数、零 DOM。同 w/h 必得同几何（可单测、可复现）。
 * 单测：tests/unit/desk-room.spec.ts。
 */

import { WINDOW } from './window-room';

/** 整数矩形（视口绝对坐标） */
export interface DeskRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DeskSpec {
  /** 地板线 y（地板带 = floorY..h，比墙暗一档） */
  floorY: number;
  /** 踢脚线 y（floorY 上方 1px 受光亮线；墙与地的分界） */
  baseboard: number;
  /** 桌 */
  desk: {
    /** 桌左缘（右半屏起点；clamp 后恒 ≥ 0） */
    x0: number;
    /** 桌右缘（≤ 视口宽 − RIGHT_MIN） */
    x1: number;
    /** 桌沿 y（= clamp(round(h × TOP_FRAC), …)；2px accent 受光带从这里起） */
    top: number;
    /** 桌面板厚（top..top+surface） */
    surface: number;
    /** 桌前立面（围板）底边 y；front..floorY 之间是两条腿，腿间露墙/地 */
    front: number;
    /** 腿宽 */
    legW: number;
  };
  /** CRT 显示器（含底座） */
  crt: {
    x: number;
    y: number;
    w: number;
    h: number;
    /** 屏幕内矩形（4:3 系整数矩形；T10 把头像搬进来，T9 点亮） */
    screen: DeskRect;
    /** 底座：颈 + 脚（两小矩形） */
    stand: { neck: DeskRect; foot: DeskRect };
  };
  /** 台灯（立在桌面右段、近窗一侧） */
  lamp: {
    /** 灯中心 x */
    x: number;
    /** 灯座底 y（= 桌沿 top） */
    base: number;
    /** 灯罩顶 y */
    head: number;
    /** 灯罩底 y（罩内下缘 2px 亮缝从这里起，T9 的光源位） */
    arm: number;
    /** 灯座宽（底） */
    baseW: number;
    /** 灯罩下缘宽 */
    shadeW: number;
    /** 立杆宽 */
    poleW: number;
  };
  /** 茶杯 */
  mug: { x: number; y: number; w: number; h: number };
  /** 热气起点（T9 用；本任务只出几何） */
  steam: { x0: number; x1: number; y: number };
  /** 一摞书（三本叠矩形，高度差 2–3px 错落） */
  books: { x: number; y: number; w: number; h: number[] };
  /**
   * 三盘卡带在桌面的 x 锚点（DOM 按钮 T10 对齐到这里）。
   * 锚点落在 crt / books / mug / lamp 之间的**空位**上（见下方 `gap` 分配），
   * 等间距、总跨度 = 2·cartStep + cartW，不与被占区间相交。
   */
  cartXs: number[];
  /**
   * 墙面置物板（2026-10-01 作者「hero 用画面不用文字」裁决：拆 INDEX 后，
   * 标题铭牌上方的空墙用场景元素回答）。住**左半屏**，**左缘对齐内容列左缘**
   * （2026-10-30 S4：旧「镜像锚定到桌」把板钉在桌旁、和文字列毫无关系，
   * 1x 下读作墙上一根细线）；右缘仍钳在桌左缘左侧。
   * 底部 = CRT 顶上方预留带之下——预留量盖住铭牌高度（≈190px + 余量），
   * 板与物件永不压铭牌。窄屏随工位退场。
   */
  shelf: {
    /** 板左缘（视口绝对坐标） */
    x: number;
    /** 板面顶 y（物件底边 = 此线） */
    y: number;
    /** 板宽 */
    w: number;
    /** 板厚 */
    board: number;
    /** 板上三件小物（x = 物件左缘；w/h = 外形；底边都 = y） */
    plant: { x: number; w: number; h: number };
    books: { x: number; w: number; h: number };
    radio: { x: number; w: number; h: number };
  };
}

/**
 * 工位几何的唯一数据源。两类数值：
 * - **固定件**（BASE_W / CRT_* / …）：是「这套工位」的材质与比例基准（1440×900 实测）。
 * - **比例 + 上下限**（*_FRAC / *_MIN / *_MAX）：随视口走，钳在合理区间。
 */
export const DESK = {
  /** 桌面 / 窄屏分界（与 window-room 同值，保持单一事实源） */
  NARROW_MAX: WINDOW.NARROW_MAX,
  /** 地板带高 = clamp(round(h*FLOOR_FRAC), MIN, MAX) */
  FLOOR_FRAC: 0.072,
  FLOOR_MIN: 48,
  FLOOR_MAX: 92,
  /** 踢脚线宽（受光亮线） */
  BASEBOARD: 1,
  /** 桌右缘与视口右缘的最小净空（工位不再受窗约束，只防贴边） */
  RIGHT_MIN: 24,
  /**
   * 桌沿高度 = `clamp(round(h * TOP_FRAC), TOP_MIN, TOP_MAX)`。
   * 旧口径从窗洞底派生（`win.y + win.h − win.h×LIFT_FRAC`）——工位当时与窗同屏；
   * ADR-0027 把窗搬到首屏后工位自成一景，改为从视口高派生：
   * 1440×900 下 0.80×900 = 720（旧值 722，逐像素不变）。
   */
  TOP_FRAC: 0.8,
  TOP_MIN: 240,
  TOP_MAX: 1600,
  /**
   * 桌左缘 = clamp(round(w*LEFT_FRAC), 0, w − BASE_W − RIGHT_MIN)。
   * 0.52 = 工位住**右半屏**（作者 2026-09-26 从三个摆法里定的第②个）：
   * 文字在左、场景在右——与旧的「窗在右」对称，站点老构图一根手指没动。
   */
  LEFT_FRAC: 0.52,
  MIN_VISIBLE_W: 330,
  /** 缩放基准桌宽（1440×900 下可见桌宽 = 485 → 缩放 k = 1） */
  BASE_W: 485,
  SCALE_MIN: 0.7,
  /** 桌面板厚 = clamp(round(h*0.011), 8, 12) */
  TABLE_FRAC: 0.011,
  TABLE_MIN: 8,
  TABLE_MAX: 12,
  /** 桌前立面（围板）高 = clamp(round(h*0.045), 28, 46) */
  APRON_FRAC: 0.045,
  APRON_MIN: 28,
  APRON_MAX: 46,
  /** 腿宽（缩放后仍 ≥2px） */
  LEG_W: 4,
  /** 左右内缩（桌沿内缘到第一件物品 / 最后一件物品到桌右缘） */
  INSET_L: 13,
  MARGIN_R: 9,

  // —— CRT（基准值，随 k 缩放）——
  CRT_W: 200,
  CRT_BODY_H: 184,
  CRT_STAND_H: 16,
  CRT_BEZEL_X: 12,
  CRT_BEZEL_TOP: 14,
  CRT_BEZEL_CHIN: 14,
  CRT_NECK_W: 28,
  CRT_NECK_H: 10,
  CRT_FOOT_W: 96,
  CRT_FOOT_H: 6,

  // —— 台灯 ——
  LAMP_H: 100,
  LAMP_BASE_W: 46,
  LAMP_BASE_H: 7,
  LAMP_SHADE_W: 52,
  LAMP_SHADE_H: 26,
  LAMP_POLE_W: 2,

  // —— 茶杯 / 书 / 卡带 ——
  MUG_W: 22,
  MUG_H: 20,
  BOOK_W: 56,
  BOOK_H: [9, 7, 8] as const,
  CART_W: 26,
  CART_STEP: 30,

  // —— 墙面置物板（左半屏空墙的场景回答，见 DeskSpec.shelf）——
  /** 板宽上限（随 k 缩放） */
  SHELF_W: 420,
  /** 板宽下限：再窄就不成板，退回贴桌左侧 */
  SHELF_MIN_W: 240,
  /** 内容列宽上限 = CSS `--w-wide`（56rem）；板左缘对齐它的 content box 左缘 */
  CONTENT_MAX: 896,
  /**
   * 内容列左缘相对容器 border-box 的偏移 = 0。
   * 实测：hero 的 `.hero-text` 起点 = 容器 border-box 左缘（264 @1440），
   * 而各 section 的 `.section-title` 在容器 padding 内（276）——两者差 12px，
   * 置物板跟 **hero 文本列**（264），因为它在工位那一屏。
   */
  CONTENT_PAD: 0,
  /** 板厚 */
  SHELF_BOARD: 5,
  /** 板右缘与桌左缘的净空 */
  SHELF_GAP_DESK: 44,
  /**
   * 板底 = CRT 顶 − 此预留量。预留量盖住铭牌 DOM 高度（tagline+intro+读数
   * ≈190px）+ 板与铭牌的呼吸隙——铭牌底边锚在 `crt.y − 8`，板底在其上 308px，
   * 两者永不相遇（e2e 用 DOM 铭牌 rect 与 canvas 板 rect 求交验证）。
   * 2026-10-29：260 → 308。实测 260 时板底离 h1 顶只有约 40px，全屏读作
   * 「标题上方一根滚动条」（三方评审一致点名）。上移 48px 后是 88px 的呼吸。
   */
  SHELF_RESERVE: 308,
  /** 板上物件外形（随 k 缩放；h = 板面以上的总高） */
  SHELF_PLANT: { w: 12, h: 22 },
  SHELF_BOOKS: { w: 34, h: 12 },
  SHELF_RADIO: { w: 26, h: 15 },
  /** 物件与板端的内缩 */
  SHELF_INSET: 12,
} as const;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * 由视口尺寸解出工位几何。窄屏（w ≤ 900）返回 null —— 工位整组退场。
 *
 * 布局从左到右：CRT → 书 → 卡带（三锚点）→ 茶杯 → 台灯（近窗）。
 * 五段宽度 + 四个等宽间隙刚好铺满 `[x0+INSET_L, x1−MARGIN_R]`——
 * 间隙由剩余空间算出（不是写死的），所以桌面变窄时物件整体收缩、间距自适应，
 * 卡带锚点因此永远落在空位上（见 `cartXs` 的注释）。
 */
export function deskSpec(w: number, h: number): DeskSpec | null {
  if (w <= DESK.NARROW_MAX) return null;
  const K = DESK;

  // —— 地板 / 踢脚线 ——
  const floorY = h - clamp(Math.round(h * K.FLOOR_FRAC), K.FLOOR_MIN, K.FLOOR_MAX);
  const baseboard = floorY - K.BASEBOARD;

  // —— 桌（工位自成一景：宽 = BASE_W，住右半屏；不再让开窗——ADR-0027）——
  const x0 = clamp(Math.round(w * K.LEFT_FRAC), 0, Math.max(0, w - K.BASE_W - K.RIGHT_MIN));
  const x1 = Math.min(w - K.RIGHT_MIN, x0 + K.BASE_W);
  const top = clamp(Math.round(h * K.TOP_FRAC), K.TOP_MIN, K.TOP_MAX);
  const surface = clamp(Math.round(h * K.TABLE_FRAC), K.TABLE_MIN, K.TABLE_MAX);
  const apron = clamp(Math.round(h * K.APRON_FRAC), K.APRON_MIN, K.APRON_MAX);
  const front = top + surface + apron;
  const legW = Math.max(2, Math.round(K.LEG_W * clamp((x1 - Math.max(0, x0)) / K.BASE_W, K.SCALE_MIN, 1)));

  // —— 缩放：物件随可见桌宽收缩（1440×900 → k = 1，实测值即基准值）——
  const availW = x1 - Math.max(0, x0);
  const k = clamp(availW / K.BASE_W, K.SCALE_MIN, 1);
  const s = (v: number): number => Math.max(1, Math.round(v * k));

  // —— CRT ——
  const crtW = s(K.CRT_W);
  const crtBodyH = s(K.CRT_BODY_H);
  const crtStandH = s(K.CRT_STAND_H);
  const bezX = s(K.CRT_BEZEL_X);
  const bezTop = s(K.CRT_BEZEL_TOP);
  const bezChin = s(K.CRT_BEZEL_CHIN);
  const crtH = crtBodyH + crtStandH;
  const crtX = x0 + s(K.INSET_L);
  const crtY = top - crtH;
  const screen: DeskRect = {
    x: crtX + bezX,
    y: crtY + bezTop,
    w: crtW - 2 * bezX,
    h: crtBodyH - bezTop - bezChin,
  };
  const neckW = s(K.CRT_NECK_W);
  const neckH = s(K.CRT_NECK_H);
  const footW = s(K.CRT_FOOT_W);
  const footH = s(K.CRT_FOOT_H);
  const stand = {
    neck: {
      x: crtX + Math.round((crtW - neckW) / 2),
      y: crtY + crtBodyH,
      w: neckW,
      h: neckH,
    },
    foot: {
      x: crtX + Math.round((crtW - footW) / 2),
      y: crtY + crtBodyH + neckH,
      w: footW,
      h: footH,
    },
  };

  // —— 横向排布：五段宽度 + 四个等宽间隙 ——
  const booksW = s(K.BOOK_W);
  const mugW = s(K.MUG_W);
  const cartW = s(K.CART_W);
  const cartStep = s(K.CART_STEP);
  const lampBaseW = s(K.LAMP_BASE_W);
  const lampShadeW = s(K.LAMP_SHADE_W);
  const cartsSpan = 2 * cartStep + cartW;
  const spanL = x0 + s(K.INSET_L);
  const spanR = x1 - s(K.MARGIN_R);
  const gap = Math.round((spanR - spanL - (crtW + booksW + cartsSpan + mugW + lampShadeW)) / 4);

  const booksH = K.BOOK_H.map((v) => s(v));
  const booksTotal = booksH.reduce((a, b) => a + b, 0);
  const booksX = crtX + crtW + gap;
  const booksY = top - booksTotal;
  const cartsStart = booksX + booksW + gap;
  const cartXs = [0, 1, 2].map((i) => cartsStart + i * cartStep);
  const mugX = cartsStart + cartsSpan + gap;
  const mugY = top - s(K.MUG_H);
  const lampX = mugX + mugW + gap + Math.round(lampShadeW / 2);

  // —— 台灯 ——
  const lampH = s(K.LAMP_H);
  const lampHead = top - lampH;
  const lampArm = lampHead + s(K.LAMP_SHADE_H);

  // —— 墙面置物板（内容列锚定；见 DeskSpec.shelf 注释）——
  // 2026-10-30 S4：旧写法「板右缘 = 桌左缘 − 44」把板钉在桌旁，1x 下读作
  // 「墙上一条细线」——它和文字列没有任何关系。改成**左缘对齐内容列左缘**
  // （= .container 的 content box 左缘），右缘仍钳在桌左缘左侧。
  const shelfBoard = s(K.SHELF_BOARD);
  const contentLeft =
    Math.round((w - Math.min(w, K.CONTENT_MAX)) / 2) + s(K.CONTENT_PAD);
  const maxRight = x0 - s(K.SHELF_GAP_DESK);
  let shelfX = Math.max(0, contentLeft);
  let shelfW = Math.min(s(K.SHELF_W), maxRight - shelfX);
  if (shelfW < s(K.SHELF_MIN_W)) {
    // 桌面把可用宽挤没了：退回贴桌左侧（旧行为），保证板还站得住
    shelfW = Math.min(s(K.SHELF_W), Math.max(s(K.SHELF_MIN_W), maxRight));
    shelfX = Math.max(0, maxRight - shelfW);
  }
  const shelfRight = shelfX + shelfW;
  // 板底（板厚之下缘）= CRT 顶 − 预留带；板面顶 = 板底 − 板厚
  const shelfBottom = crtY - s(K.SHELF_RESERVE);
  const shelfY = shelfBottom - shelfBoard;
  const shelfPlantW = s(K.SHELF_PLANT.w);
  const shelfPlantH = s(K.SHELF_PLANT.h);
  const shelfBooksW = s(K.SHELF_BOOKS.w);
  const shelfBooksH = s(K.SHELF_BOOKS.h);
  const shelfRadioW = s(K.SHELF_RADIO.w);
  const shelfRadioH = s(K.SHELF_RADIO.h);
  const shelfInset = s(K.SHELF_INSET);

  return {
    floorY,
    baseboard,
    desk: { x0, x1, top, surface, front, legW },
    crt: { x: crtX, y: crtY, w: crtW, h: crtH, screen, stand },
    lamp: {
      x: lampX,
      base: top,
      head: lampHead,
      arm: lampArm,
      baseW: lampBaseW,
      shadeW: lampShadeW,
      poleW: Math.max(1, s(K.LAMP_POLE_W)),
    },
    mug: { x: mugX, y: mugY, w: mugW, h: s(K.MUG_H) },
    steam: { x0: mugX + Math.round(mugW * 0.18), x1: mugX + mugW - Math.round(mugW * 0.18), y: mugY - 2 },
    books: { x: booksX, y: booksY, w: booksW, h: booksH },
    cartXs,
    shelf: {
      x: shelfX,
      y: shelfY,
      w: shelfRight - shelfX,
      board: shelfBoard,
      plant: { x: shelfX + shelfInset, w: shelfPlantW, h: shelfPlantH },
      books: { x: shelfX + Math.round((shelfRight - shelfX) * 0.45), w: shelfBooksW, h: shelfBooksH },
      radio: { x: shelfRight - shelfInset - shelfRadioW, w: shelfRadioW, h: shelfRadioH },
    },
  };
}
