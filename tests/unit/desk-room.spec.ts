import { describe, expect, it } from 'vitest';
import { DESK, deskSpec, type DeskSpec } from '../../src/lib/desk-room';

/**
 * 工位几何守卫（T8：一张桌子 + 静物；ADR-0027 后工位自成一景）。
 *
 * 判据与被守者同源：所有几何量从 `deskSpec` 输出直接量，比例常量取自 `DESK`，
 * 不在用例里写死像素。三条硬契约：
 *  ① 桌住右半屏、宽 = BASE_W（与窗解绑后不再让开窗洞）；
 *  ② 器物全部坐在桌沿上（crt/mug/books 底 == lamp.base == desk.top）；
 *  ③ 卡带锚点落在 crt/books/mug/lamp 之间的空位上（T10 的 DOM 按钮要对齐它）。
 *
 * 窄屏整组退场（返回 null）——480×800 上 hero 是居中文字栈，没地方摆桌子。
 */

const DESKTOP = [1440, 900] as const;
/** 桌面档的若干宽度（含紧贴分界 901 的极窄桌面，缩放最狠的一档） */
const DESKTOPS = [
  DESKTOP,
  [1024, 768],
  [1280, 800],
  [1920, 1080],
  [901, 700],
] as const;
const NARROW = [
  [900, 700],
  [800, 600],
  [480, 800],
] as const;

interface Iv {
  x0: number;
  x1: number;
}

/** 半开区间相交（端点相接不算相交——器物可以挨着，但不可压过去） */
function overlap(a: Iv, b: Iv): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1;
}

/** 器物在 x 轴上的占位区间（卡带用「首锚点 .. 末锚点 + 一步」= 保守占位） */
function intervals(d: DeskSpec) {
  const step = d.cartXs[1]! - d.cartXs[0]!;
  return {
    crt: { x0: d.crt.x, x1: d.crt.x + d.crt.w },
    books: { x0: d.books.x, x1: d.books.x + d.books.w },
    carts: { x0: d.cartXs[0]!, x1: d.cartXs[d.cartXs.length - 1]! + step },
    mug: { x0: d.mug.x, x1: d.mug.x + d.mug.w },
    lamp: { x0: d.lamp.x - (d.lamp.shadeW >> 1), x1: d.lamp.x + (d.lamp.shadeW >> 1) },
  };
}

/** 全字段整数（含嵌套矩形与数组） */
function integers(d: DeskSpec): number[] {
  return [
    d.floorY,
    d.baseboard,
    d.desk.x0,
    d.desk.x1,
    d.desk.top,
    d.desk.surface,
    d.desk.front,
    d.desk.legW,
    d.crt.x,
    d.crt.y,
    d.crt.w,
    d.crt.h,
    d.crt.screen.x,
    d.crt.screen.y,
    d.crt.screen.w,
    d.crt.screen.h,
    d.crt.stand.neck.x,
    d.crt.stand.neck.y,
    d.crt.stand.neck.w,
    d.crt.stand.neck.h,
    d.crt.stand.foot.x,
    d.crt.stand.foot.y,
    d.crt.stand.foot.w,
    d.crt.stand.foot.h,
    d.lamp.x,
    d.lamp.base,
    d.lamp.head,
    d.lamp.arm,
    d.lamp.baseW,
    d.lamp.shadeW,
    d.lamp.poleW,
    d.mug.x,
    d.mug.y,
    d.mug.w,
    d.mug.h,
    d.steam.x0,
    d.steam.x1,
    d.steam.y,
    d.books.x,
    d.books.y,
    d.books.w,
    ...d.books.h,
    ...d.cartXs,
  ];
}

describe('deskSpec：工位自成一景（窄屏退场、住右半屏、器物坐桌沿）', () => {
  it('确定性：同尺寸两次调用深度相等', () => {
    expect(deskSpec(1440, 900)).toEqual(deskSpec(1440, 900));
  });

  it('窄屏（≤900）整组退场：返回 null；901 起才有工位', () => {
    for (const [w, h] of NARROW) expect(deskSpec(w, h), `${w}×${h} 不该画桌`).toBeNull();
    expect(deskSpec(901, 700)).not.toBeNull();
  });

  it('全字段整数输出（缩放后的小数被四舍五入，不留半像素）', () => {
    for (const [w, h] of DESKTOPS) {
      for (const n of integers(deskSpec(w, h)!)) {
        expect(Number.isInteger(n), `${w}×${h} 的字段 ${n} 不是整数`).toBe(true);
      }
    }
  });

  it('桌住右半屏：左缘 ≥ min(视口中线, 放得下的最右位置)，右缘深入右半屏', () => {
    for (const [w, h] of DESKTOPS) {
      const d = deskSpec(w, h)!;
      // 窄桌面（如 901）放不下「左缘在中线右侧 + 右缘留 RIGHT_MIN」时，
      // 只退到刚好留出净空的位置；其余尺寸左缘必须真的在中线右侧。
      // 旧 ADR-0024 几何工位贴窗左侧（x0 ≈ 0.06w）——那条口径已随窗搬走而消失。
      const fitRightX0 = w - DESK.BASE_W - DESK.RIGHT_MIN;
      expect(d.desk.x0, `${w}×${h} 的桌跑回左半屏了`).toBeGreaterThanOrEqual(
        Math.min(w * 0.5, fitRightX0)
      );
      expect(d.desk.x1, `${w}×${h} 的桌右缘没进右半屏`).toBeGreaterThan(w * 0.5);
    }
  });

  it('桌宽 = BASE_W（x1 未被 RIGHT_MIN 夹住时），且整桌在视口内', () => {
    for (const [w, h] of DESKTOPS) {
      const d = deskSpec(w, h)!;
      const fitsBase = d.desk.x0 + DESK.BASE_W <= w - DESK.RIGHT_MIN;
      if (fitsBase) {
        expect(d.desk.x1 - d.desk.x0, `${w}×${h} 的桌宽不是 BASE_W`).toBe(DESK.BASE_W);
      } else {
        // 夹住时右缘恰好停在净空线上（只裁右边，不缩左边）
        expect(d.desk.x1, `${w}×${h} 的桌右缘没停在 RIGHT_MIN 净空线`).toBe(
          w - DESK.RIGHT_MIN
        );
      }
      expect(d.desk.x0, `${w}×${h} 的桌左缘出画`).toBeGreaterThanOrEqual(0);
      expect(d.desk.x1, `${w}×${h} 的桌右缘越过 RIGHT_MIN 净空`).toBeLessThanOrEqual(
        w - DESK.RIGHT_MIN
      );
    }
  });

  it('桌沿高 = clamp(round(h*TOP_FRAC), TOP_MIN, TOP_MAX)：多尺寸 + 两端钳制', () => {
    const sizes = [...DESKTOPS, [1440, 250] as const, [1440, 2100] as const];
    for (const [w, h] of sizes) {
      const d = deskSpec(w, h)!;
      const expected = Math.min(
        DESK.TOP_MAX,
        Math.max(DESK.TOP_MIN, Math.round(h * DESK.TOP_FRAC))
      );
      expect(d.desk.top, `${w}×${h} 的桌沿高没按 TOP_FRAC 走`).toBe(expected);
    }
    // 两端真的会被钳住（不是恒等于比例值）
    expect(deskSpec(1440, 250)!.desk.top).toBe(DESK.TOP_MIN);
    expect(deskSpec(1440, 2100)!.desk.top).toBe(DESK.TOP_MAX);
  });

  it('器物全部坐在桌沿上：crt/mug/books 底与 lamp.base 都 == desk.top', () => {
    for (const [w, h] of DESKTOPS) {
      const d = deskSpec(w, h)!;
      const t = d.desk.top;
      expect(d.crt.y + d.crt.h, `${w}×${h} 的 CRT 没坐在桌沿`).toBe(t);
      expect(d.crt.stand.foot.y + d.crt.stand.foot.h, `${w}×${h} 的 CRT 底座没落在桌沿`).toBe(t);
      expect(d.mug.y + d.mug.h, `${w}×${h} 的茶杯没坐在桌沿`).toBe(t);
      expect(d.books.y + d.books.h.reduce((a, b) => a + b, 0), `${w}×${h} 的书没坐在桌沿`).toBe(t);
      expect(d.lamp.base, `${w}×${h} 的灯座没落在桌沿`).toBe(t);
      expect(d.steam.y, `${w}×${h} 的热气起点没在杯口上方`).toBeLessThan(t);
      expect(d.steam.x0).toBeLessThan(d.steam.x1);
    }
  });

  it('桌的纵向账目自洽：地板在桌下、围板在桌沿下、腿到地板', () => {
    for (const [w, h] of DESKTOPS) {
      const d = deskSpec(w, h)!;
      expect(d.baseboard).toBe(d.floorY - DESK.BASEBOARD);
      expect(d.floorY).toBeLessThan(h);
      expect(d.desk.top).toBeLessThan(d.desk.front);
      expect(d.desk.front).toBeLessThan(d.floorY);
      expect(d.desk.legW).toBeGreaterThanOrEqual(2);
      // 腿不越出桌宽
      expect(d.desk.x0 + d.desk.legW).toBeLessThanOrEqual(d.desk.x1 - d.desk.legW);
    }
  });

  it('桌面横向排布：crt → 书 → 卡带 → 茶杯 → 台灯 从左到右且互不相交', () => {
    for (const [w, h] of DESKTOPS) {
      const d = deskSpec(w, h)!;
      const iv = intervals(d);
      const order = ['crt', 'books', 'carts', 'mug', 'lamp'] as const;
      for (let i = 0; i + 1 < order.length; i++) {
        const a = iv[order[i]!]!;
        const b = iv[order[i + 1]!]!;
        expect(a.x0, `${w}×${h}：${order[i]} 不在 ${order[i + 1]} 左边`).toBeLessThan(b.x0);
        expect(overlap(a, b), `${w}×${h}：${order[i]} 与 ${order[i + 1]} 在 x 上压住了`).toBe(false);
      }
      // 全部落在桌面上
      for (const [name, a] of Object.entries(iv)) {
        expect(a.x0, `${w}×${h}：${name} 越出桌左缘`).toBeGreaterThanOrEqual(d.desk.x0);
        expect(a.x1, `${w}×${h}：${name} 越出桌右缘`).toBeLessThanOrEqual(d.desk.x1);
      }
    }
  });

  it('卡带锚点：三个、等间距、落在书与茶杯之间的空位', () => {
    for (const [w, h] of DESKTOPS) {
      const d = deskSpec(w, h)!;
      expect(d.cartXs).toHaveLength(3);
      const [a, b, c] = d.cartXs as [number, number, number];
      expect(b - a, `${w}×${h} 的卡带锚点不等距`).toBe(c - b);
      expect(a, `${w}×${h} 的首锚点在书里`).toBeGreaterThanOrEqual(d.books.x + d.books.w);
      // 末锚点 + 一步仍不碰茶杯（保守占位）
      expect(c + (b - a), `${w}×${h} 的末锚点压到茶杯`).toBeLessThanOrEqual(d.mug.x);
    }
  });

  it('CRT：屏在机身内、四周 bezel ≥ 8px（1440×900 基准），且装得下屏内画 176×156 基准', () => {
    const d = deskSpec(1440, 900)!;
    const s = d.crt.screen;
    expect(s.x - d.crt.x, '左边 bezel 不足 8px').toBeGreaterThanOrEqual(8);
    expect(d.crt.x + d.crt.w - (s.x + s.w), '右边 bezel 不足 8px').toBeGreaterThanOrEqual(8);
    expect(s.y - d.crt.y, '顶边 bezel 不足 8px').toBeGreaterThanOrEqual(8);
    expect(d.crt.y + d.crt.h - (s.y + s.h), '下边 bezel 不足 8px').toBeGreaterThanOrEqual(8);
    // T10 把屏内画搬进屏里（2026-10-02 改版后 = 44×39 像素画满幅填屏，img 随屏缩放）：
    // 「装得下」守的是可读性下限——屏小于 172×156 时 4px/格 分解不成立，画面糊成一团
    expect(s.w, '屏宽装不下屏内画基准（172）').toBeGreaterThanOrEqual(172);
    expect(s.h, '屏高装不下屏内画基准（156）').toBeGreaterThanOrEqual(156);
    // 屏是近 4:3 的整数矩形（不瘦成一条）
    expect(s.w / s.h).toBeGreaterThan(0.9);
    expect(s.w / s.h).toBeLessThan(1.4);
  });

  it('台灯：罩在杆上、杆在座上，罩口宽于杆且不越出桌面', () => {
    for (const [w, h] of DESKTOPS) {
      const d = deskSpec(w, h)!;
      expect(d.lamp.head, `${w}×${h}：灯罩顶不低于罩底`).toBeLessThan(d.lamp.arm);
      expect(d.lamp.arm, `${w}×${h}：罩底不低于灯座`).toBeLessThan(d.lamp.base);
      expect(d.lamp.shadeW).toBeGreaterThan(d.lamp.poleW * 4);
      expect(d.lamp.poleW).toBeGreaterThanOrEqual(1);
    }
  });

  it('一摞书：三本、高度错落（至少两档不同，不许三块一样）', () => {
    for (const [w, h] of DESKTOPS) {
      const d = deskSpec(w, h)!;
      expect(d.books.h).toHaveLength(3);
      expect(new Set(d.books.h).size, `${w}×${h} 的书三块一样高`).toBeGreaterThanOrEqual(2);
      for (const bh of d.books.h) expect(bh).toBeGreaterThan(0);
    }
  });

  /**
   * 反例自检（常驻）：`overlap()` 必须**红得起来**——把卡带占位平移到 CRT 身上，
   * 它必须判为相交。没有这一条，上面「互不相交」那组断言可能在 predicate 恒 false
   * 时全绿（2026-09-10 的教训：只跑绿的一次 = 以为守住了）。
   */
  it('反例自检：把卡带占位挪到 CRT 区间上时 overlap() 必须为 true', () => {
    const d = deskSpec(1440, 900)!;
    const iv = intervals(d);
    // 真值：不相交
    expect(overlap(iv.carts, iv.crt)).toBe(false);
    // 反例：整段左移到 CRT 中心
    const shifted = { x0: d.crt.x + 10, x1: d.crt.x + 10 + (iv.carts.x1 - iv.carts.x0) };
    expect(overlap(shifted, iv.crt), 'overlap() 恒 false → 上面那组守卫是假绿').toBe(true);
  });

  it('反例自检：把桌左缘挪回左半屏时「住右半屏」判据必须为 false', () => {
    const [w, h] = DESKTOP;
    const d = deskSpec(w, h)!;
    expect(d.desk.x0 >= w * 0.5).toBe(true);
    // 旧 ADR-0024 几何：工位贴窗左侧，x0 ≈ 0.06w——同一条判据必须红
    const oldStyleX0 = Math.round(w * 0.06);
    expect(oldStyleX0 >= w * 0.5, '「住右半屏」判据恒真 → 上面那组守卫是假绿').toBe(false);
  });

  it('DESK 常量是唯一数据源：分界与 window-room 同值', () => {
    expect(DESK.NARROW_MAX).toBe(900);
    expect(deskSpec(DESK.NARROW_MAX, 700)).toBeNull();
    expect(deskSpec(DESK.NARROW_MAX + 1, 700)).not.toBeNull();
  });
});

describe('deskSpec.shelf：墙面置物板（左半屏空墙的场景回答，2026-10-01）', () => {
  it('镜像锚定：板右缘在桌左缘左侧（留隙），整板在视口内且全整数', () => {
    for (const [w, h] of DESKTOPS) {
      const d = deskSpec(w, h)!;
      const S = d.shelf;
      expect(S.x + S.w, `${w}×${h}：板右缘应 ≤ 桌左缘（不越到工位侧）`).toBeLessThanOrEqual(
        d.desk.x0
      );
      expect(S.x).toBeGreaterThanOrEqual(0);
      expect(S.y).toBeGreaterThan(0);
      expect(S.y + S.board).toBeLessThan(h);
      for (const v of [S.x, S.y, S.w, S.board, S.plant.x, S.books.x, S.radio.x]) {
        expect(Number.isInteger(v), `shelf 字段必须整数（实际 ${v}）`).toBe(true);
      }
    }
  });

  it('板底 = CRT 顶 − 预留带：板与 CRT 不相交，预留量足盖铭牌（≥200px）', () => {
    for (const [w, h] of DESKTOPS) {
      const d = deskSpec(w, h)!;
      const S = d.shelf;
      const shelfBottom = S.y + S.board;
      expect(shelfBottom).toBeLessThanOrEqual(d.crt.y);
      expect(
        d.crt.y - shelfBottom,
        `${w}×${h}：板与 CRT 顶的净空应 ≈ SHELF_RESERVE（盖住铭牌）`
      ).toBeGreaterThanOrEqual(200);
    }
  });

  it('三件小物都站在板面宽度内且互不相交（plant < books < radio）', () => {
    const d = deskSpec(...DESKTOP)!;
    const S = d.shelf;
    for (const o of [S.plant, S.books, S.radio]) {
      expect(o.w, '物件宽 > 0').toBeGreaterThan(0);
      expect(o.h, '物件高 > 0').toBeGreaterThan(0);
      expect(o.x).toBeGreaterThanOrEqual(S.x);
      expect(o.x + o.w).toBeLessThanOrEqual(S.x + S.w);
    }
    expect(S.plant.x + S.plant.w).toBeLessThanOrEqual(S.books.x);
    expect(S.books.x + S.books.w).toBeLessThanOrEqual(S.radio.x);
  });

  it('反例自检：把板挪到桌右缘时「不越到工位侧」判据必须为 false', () => {
    const d = deskSpec(...DESKTOP)!;
    const hacked = { ...d, shelf: { ...d.shelf, x: d.desk.x1 - d.shelf.w } };
    expect(hacked.shelf.x + hacked.shelf.w <= hacked.desk.x0).toBe(false);
  });
});
