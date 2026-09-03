import { describe, expect, it } from 'vitest';
import {
  PARALLAX_STRENGTH,
  CAMERA,
  SECTION_IDS,
  cameraFor,
  chipPins,
  dustSpawn,
  easeSilk,
  genMachineLayout,
  genManhattanTrace,
  genRoute,
  genSectionTargets,
  genTracesFor,
  ledPhase,
  mix,
  packetPos,
  parallaxShift,
  rainColumns,
  rainLengthRange,
  scanTailAlpha,
  scanThickness,
  segHitsRect,
  snap8,
  starCount,
  starViewY,
  waveAmplitude,
} from '../../src/lib/bgfx-motion';

describe('starCount —— 星尘密度随视口面积线性钳制', () => {
  it('小视口压低密度（≥70 下限）', () => {
    expect(starCount(320 * 480)).toBe(70);
  });
  it('常规全屏密度落在区间内', () => {
    const n = starCount(1440 * 900);
    expect(n).toBeGreaterThanOrEqual(70);
    expect(n).toBeLessThanOrEqual(170);
  });
  it('超大屏触发 170 上限', () => {
    expect(starCount(3840 * 2160)).toBe(170);
  });
  it('单调不减', () => {
    expect(starCount(800 * 600)).toBeLessThanOrEqual(starCount(1600 * 900));
  });
});

describe('rainColumns —— 像素雨列数随宽度线性钳制', () => {
  it('窄屏 20 列下限', () => {
    expect(rainColumns(50)).toBe(20);
  });
  it('宽屏按 w/4 且 ≤90', () => {
    expect(rainColumns(1440)).toBe(90);
    expect(rainColumns(768)).toBe(90); // 192 → 钳 90
  });
});

describe('rainLengthRange —— 长度区间固定且最大值 > 最小值', () => {
  it('区间有效', () => {
    const [lo, hi] = rainLengthRange();
    expect(lo).toBeLessThan(hi);
    expect(lo).toBe(7);
  });
});

describe('waveAmplitude —— 振幅随屏高线性、主次比例固定', () => {
  it('a1/a2 与 h 成正比（a1 = 0.1h, a2 = 0.07h）', () => {
    const flat = waveAmplitude(900);
    expect(flat.a1).toBeCloseTo(90);
    expect(flat.a2).toBeCloseTo(63);
    const tall = waveAmplitude(1800);
    expect(tall.a1).toBeCloseTo(180);
    expect(tall.a2).toBeCloseTo(126);
  });
});

describe('scanThickness —— 细带（2..6px）随相位脉动，恒在界内', () => {
  it('相位 0 → 2；π/2 → 6；π 以后回落', () => {
    expect(scanThickness(0)).toBe(2);
    expect(scanThickness(Math.PI / 2)).toBe(6);
    expect(scanThickness(Math.PI)).toBe(2);
  });
});

describe('scanTailAlpha —— 淡尾逐步衰减、末步仍可见', () => {
  it('单调递减且末步 > 0', () => {
    const n = 4;
    let prev = 1;
    for (let i = 0; i < n; i++) {
      const a = scanTailAlpha(i, n);
      expect(a).toBeLessThan(prev);
      expect(a).toBeGreaterThan(0);
      prev = a;
    }
  });
  it('首步与末步数值（0.55 衰减曲线）', () => {
    expect(scanTailAlpha(0, 4)).toBeCloseTo(0.44); // 0.55*(1-1/5)
    expect(scanTailAlpha(3, 4)).toBeCloseTo(0.11); // 0.55*(1-4/5)
  });
});

describe('parallaxShift —— 滚动视差数学（像素踏阶）', () => {
  it('scrollY=0 → 0（首屏无位移）', () => {
    expect(parallaxShift(0, 0.5)).toBe(0);
  });
  it('位移随 scrollY 与 depth 单调不减', () => {
    expect(parallaxShift(100, 0.3)).toBeGreaterThanOrEqual(parallaxShift(50, 0.3));
    expect(parallaxShift(100, 1)).toBeGreaterThan(parallaxShift(100, 0.1));
  });
  it('近景最多 22% 页速、输出整数（像素对齐）', () => {
    expect(parallaxShift(1000, 1)).toBe(220);
    expect(parallaxShift(1000, 0.5)).toBe(110);
    expect(Number.isInteger(parallaxShift(123, 0.77))).toBe(true);
  });
  it('深度 0（远景）位移恒 0', () => {
    expect(parallaxShift(5000, 0)).toBe(0);
  });
  it('PARALLAX_STRENGTH 与默认值一致（单一数据源）', () => {
    expect(parallaxShift(1000, 1)).toBe(Math.round(1000 * PARALLAX_STRENGTH));
  });
});

describe('starViewY —— 含视差偏移后的卷绕，恒落 [0, h)', () => {
  const H = 900;
  it('任意 y/scrollY 输入都卷回 [0, h)', () => {
    for (const y of [-7, 0, 3, H, H + 3, 1000, -500]) {
      const v = starViewY(y, H, 1234, 0.6);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(H);
    }
  });
  it('scrollY=0 时与原始 y 等价（mod 卷绕）', () => {
    expect(starViewY(250, H, 0, 0.8)).toBe(250);
    expect(starViewY(-3, H, 0, 0.8)).toBe(H - 3);
  });
  it('滚动使近景星尘上移（sy 减小），远景不动', () => {
    const near = starViewY(500, H, 300, 1);
    const far = starViewY(500, H, 300, 0);
    expect(near).toBeLessThan(500);
    expect(far).toBe(500);
  });
});

describe('genManhattanTrace —— L 形曼哈顿走线（90° 直角，结构层非空）', () => {
  const rng = () => 0.5;
  it('全段曼哈顿（轴对齐）、总长 >0', () => {
    const tr = genManhattanTrace(300, 400, 800, 600, rng);
    expect(tr.total).toBeGreaterThan(0);
    for (const s of tr.segs) {
      expect(s.x1 === s.x2 || s.y1 === s.y2, '每段轴对齐').toBe(true);
      expect(s.len).toBe(Math.abs(s.x2 - s.x1) + Math.abs(s.y2 - s.y1));
    }
  });
  it('段数 2-3 段、端点落在边界内', () => {
    for (let i = 0; i < 30; i++) {
      const tr = genManhattanTrace(300, 400, 800, 600, () => Math.random());
      expect(tr.segs.length).toBeGreaterThanOrEqual(2);
      for (const s of tr.segs) {
        expect(Math.min(s.x1, s.x2)).toBeGreaterThanOrEqual(0);
        expect(Math.max(s.x1, s.x2)).toBeLessThanOrEqual(800);
        expect(Math.min(s.y1, s.y2)).toBeGreaterThanOrEqual(0);
        expect(Math.max(s.y1, s.y2)).toBeLessThanOrEqual(600);
      }
    }
  });
});

describe('packetPos —— 信号包沿折线定位（含所在段）', () => {
  const segs = [
    { x1: 0, y1: 100, x2: 100, y2: 100, len: 100 },
    { x1: 100, y1: 100, x2: 100, y2: 0, len: 100 },
  ];
  const total = 200;
  it('u=0 起点；u=1 终点', () => {
    expect(packetPos(segs, total, 0)).toEqual({ x: 0, y: 100, seg: 0 });
    expect(packetPos(segs, total, 1)).toEqual({ x: 100, y: 0, seg: 1 });
  });
  it('中途按曼哈顿进度对位', () => {
    expect(packetPos(segs, total, 0.25)).toEqual({ x: 50, y: 100, seg: 0 });
    expect(packetPos(segs, total, 0.75)).toEqual({ x: 100, y: 50, seg: 1 });
  });
  it('越界 u 被钳制到 [0,1]', () => {
    expect(packetPos(segs, total, -1)).toEqual({ x: 0, y: 100, seg: 0 });
    expect(packetPos(segs, total, 5)).toEqual({ x: 100, y: 0, seg: 1 });
  });
});

describe('ledPhase —— 待机灯呼吸 1.6s 周期', () => {
  it('输出恒在 [0,1] 且随 t 变化', () => {
    expect(ledPhase(0)).toBeCloseTo(0.5);
    const v1 = ledPhase(26);
    expect(v1).toBeGreaterThanOrEqual(0);
    expect(v1).toBeLessThanOrEqual(1);
    expect(ledPhase(26)).not.toBeCloseTo(ledPhase(0));
  });
  it('半周后回到起点（约 52 帧）', () => {
    expect(ledPhase(52)).toBeCloseTo(0.5, 1);
  });
});

describe('dustSpawn —— 尘埃出生在中部 1/3 带', () => {
  it('y 落在 0.25h..0.75h', () => {
    for (let i = 0; i < 30; i++) {
      const d = dustSpawn(800, 600, () => Math.random());
      expect(d.y).toBeGreaterThanOrEqual(600 * 0.25);
      expect(d.y).toBeLessThanOrEqual(600 * 0.75);
      expect(d.x).toBeGreaterThanOrEqual(0);
      expect(d.x).toBeLessThan(800);
    }
  });
});

describe('genTracesFor —— 走线簇：每芯片 1-2 条，非空', () => {
  it('两芯片生成 2-4 条', () => {
    const ts = genTracesFor(800, 600, () => Math.random(), [
      { x: 100, y: 100 },
      { x: 600, y: 400 },
    ]);
    expect(ts.length).toBeGreaterThanOrEqual(2);
    expect(ts.length).toBeLessThanOrEqual(4);
    for (const t of ts) expect(t.total).toBeGreaterThan(0);
  });
});

describe('snap8 —— 8px 网格对齐（评审 R2）', () => {
  it('任意输入 → 8 的倍数且 ≥8', () => {
    for (const n of [0, 3, 7, 8, 9, 16, 23, 100]) {
      expect(snap8(n) % 8).toBe(0);
      expect(snap8(n)).toBeGreaterThanOrEqual(8);
    }
  });
});

describe('segHitsRect —— 净空碰撞检测（评审 R5）', () => {
  const r = { x1: 100, y1: 100, x2: 300, y2: 300 };
  it('穿过 / 避开正确判定', () => {
    expect(segHitsRect({ x1: 0, y1: 150, x2: 400, y2: 150, len: 400 }, r)).toBe(true);
    expect(segHitsRect({ x1: 0, y1: 40, x2: 90, y2: 40, len: 90 }, r)).toBe(false);
    expect(segHitsRect({ x1: 130, y1: 0, x2: 130, y2: 90, len: 90 }, r)).toBe(false);
  });
});

describe('chipPins —— 引脚生成（评审 R3/R6）', () => {
  it('主芯 20 个、辅芯 12 个，全部落在器件轮廓上（8px 网格）', () => {
    const main = chipPins({ x: 64, y: 64, w: 40, h: 40 }, true);
    const aux = chipPins({ x: 16, y: 96, w: 16, h: 16 }, false);
    expect(main).toHaveLength(20);
    expect(aux).toHaveLength(12);
    for (const p of [...main, ...aux]) {
      expect(p.x % 8).toBe(0);
      expect(p.y % 8).toBe(0);
    }
  });
});

describe('genRoute —— Z 形路由恒达终点、轴对齐、网格对齐', () => {
  it('起点/终点精确命中；全段 0°/90°；坐标 %8', () => {
    for (let i = 0; i < 40; i++) {
      const g = genRoute(64, 64, 600, 400, Math.random);
      const head = g.segs[0];
      const tail = g.segs[g.segs.length - 1];
      expect({ x: head.x1, y: head.y1 }).toEqual({ x: 64, y: 64 });
      expect({ x: tail.x2, y: tail.y2 }).toEqual({ x: 600, y: 400 });
      for (const s of g.segs) {
        expect(s.x1 === s.x2 || s.y1 === s.y2, '轴对齐').toBe(true);
        expect(s.x1 % 8 === 0 && s.y1 % 8 === 0, '网格对齐').toBe(true);
      }
    }
  });
});

describe('genMachineLayout —— 板级设计硬规则（评审 R2/R3/R5/R6/R7）', () => {
  it('40 次随机种子全部满足：芯片分级/网格/净空/引脚锚定/线宽分级/密度', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const rng = () => {
        seed = (seed * 16807) % 2147483647;
        return (seed & 0x7fffffff) / 2147483647;
      };
      const w = 1280;
      const h = 800;
      const { chips, traces } = genMachineLayout(w, h, rng);
      const clear = { x1: w * 0.2, y1: h * 0.28, x2: w * 0.8, y2: h * 0.68 };

      // R6：一主+辅，封装两级
      const mains = chips.filter((c) => c.main);
      expect(mains).toHaveLength(1);
      expect(mains[0].w).toBe(40);
      expect(mains[0].h).toBe(40);
      expect(chips.filter((c) => !c.main).every((c) => c.w === 16 && c.h === 16)).toBe(true);
      expect(chips.length).toBeLessThanOrEqual(4);

      // R2：全部坐标 8px 网格
      for (const c of chips) {
        expect(c.x % 8).toBe(0);
        expect(c.y % 8).toBe(0);
      }

      // R5：无芯片/无走线穿过中央净空
      for (const c of chips) {
        expect(c.x < clear.x1 || c.x > clear.x2 || c.y < clear.y1 || c.y > clear.y2, '芯片不在净空').toBe(true);
      }

      // R3：走线起点=某引脚（或缘），终点=引脚/边缘；R7 线宽 1/2 并存
      const allPins = chips.flatMap((c) => c.pins);
      const nearPin = (x: number, y: number) =>
        allPins.some((p) => Math.abs(p.x - x) <= 4 && Math.abs(p.y - y) <= 4);
      expect(traces.length).toBeGreaterThanOrEqual(4);
      for (const t of traces) {
        const head = t.segs[0];
        const tail = t.segs[t.segs.length - 1];
        expect(t.px === 1 || t.px === 2).toBe(true);
        expect(nearPin(head.x1, head.y1) || head.y1 <= 8 || head.x1 <= 8 || head.x1 >= w - 8 || head.y1 >= h - 8, '起点锚定').toBe(true);
        expect(
          nearPin(tail.x2, tail.y2) || tail.x2 <= 8 || tail.y2 <= 8 || tail.x2 >= w - 8 || tail.y2 >= h - 8,
          '终点锚定'
        ).toBe(true);
        for (const s of t.segs) {
          expect(segHitsRect(s, clear), '走线不穿净空').toBe(false);
          expect(s.x1 % 8 === 0 && s.y1 % 8 === 0 && s.x2 % 8 === 0 && s.y2 % 8 === 0).toBe(true);
        }
      }
      expect(traces.some((t) => t.px === 2), '存在电源轨 2px').toBe(true);
      expect(traces.some((t) => t.px === 1), '存在信号线 1px').toBe(true);
    }
  });
});

describe('easeSilk —— 本站唯一运动种子（cubic-bezier(0.22,0.9,0.24,1)）', () => {
  it('端点精确：easeSilk(0)=0、easeSilk(1)=1', () => {
    expect(easeSilk(0)).toBeCloseTo(0, 5);
    expect(easeSilk(1)).toBeCloseTo(1, 5);
  });
  it('越界输入被钳制到 [0,1]', () => {
    expect(easeSilk(-1)).toBeCloseTo(0, 5);
    expect(easeSilk(2)).toBeCloseTo(1, 5);
  });
  it('单调不减（减速感：Silk）', () => {
    let prev = -1;
    for (let x = 0; x <= 1.0001; x += 0.05) {
      const v = easeSilk(x);
      expect(v).toBeGreaterThanOrEqual(prev);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      prev = v;
    }
  });
});

describe('mix —— 线性插值基元', () => {
  it('端点与中点', () => {
    expect(mix(0, 10, 0)).toBe(0);
    expect(mix(0, 10, 1)).toBe(10);
    expect(mix(0, 10, 0.5)).toBe(5);
  });
  it('e=0.5 对负区间也成立', () => {
    expect(mix(-20, -10, 0.5)).toBe(-15);
  });
});

describe('cameraFor —— 2D 相机（连续推拉 + 鼠标视差，RM 视差×0.5）', () => {
  it('滚动端点 scale=minScale、中段 scale=maxScale（sin 剖面推拉）', () => {
    expect(cameraFor(0, 0, 0, false).scale).toBeCloseTo(CAMERA.minScale);
    expect(cameraFor(1, 0, 0, false).scale).toBeCloseTo(CAMERA.minScale);
    expect(cameraFor(0.5, 0, 0, false).scale).toBeCloseTo(CAMERA.maxScale);
  });
  it('鼠标视差：ox/oy 与鼠标反向、振幅 = parallax', () => {
    const cam = cameraFor(0.5, 1, -1, false);
    expect(cam.ox).toBeCloseTo(-CAMERA.parallax);
    expect(cam.oy).toBeCloseTo(CAMERA.parallax);
  });
  it('reduced-motion：视差振幅 ×0.5，scale 不变', () => {
    const full = cameraFor(0.5, 1, 0, false);
    const reduced = cameraFor(0.5, 1, 0, true);
    expect(reduced.ox).toBeCloseTo(full.ox * 0.5);
    expect(reduced.scale).toBeCloseTo(full.scale);
  });
  it('鼠标居中（0,0）→ 无偏移', () => {
    const cam = cameraFor(0.3, 0, 0, false);
    expect(cam.ox).toBeCloseTo(0);
    expect(cam.oy).toBeCloseTo(0);
  });
});

describe('genSectionTargets —— 5 种机器态子图（ADR-0004）', () => {
  const W = 1280;
  const H = 800;
  it('每种 section 固定 4 芯片 + 7 走线，每走线恒 4 段（磷光索引稳定）', () => {
    for (const s of SECTION_IDS) {
      const { chips, traces } = genSectionTargets(s, W, H);
      expect(chips).toHaveLength(4);
      expect(traces).toHaveLength(7);
      for (const t of traces) expect(t.segs).toHaveLength(4);
    }
  });
  it('全部坐标 8px 网格对齐（含芯片与走线，含引脚锚定）', () => {
    for (const s of SECTION_IDS) {
      const { chips, traces } = genSectionTargets(s, W, H);
      for (const c of chips) {
        expect(c.x % 8).toBe(0);
        expect(c.y % 8).toBe(0);
        for (const p of c.pins) {
          expect(p.x % 8).toBe(0);
          expect(p.y % 8).toBe(0);
        }
      }
      for (const t of traces) {
        for (const seg of t.segs) {
          expect(seg.x1 % 8).toBe(0);
          expect(seg.y1 % 8).toBe(0);
          expect(seg.x2 % 8).toBe(0);
          expect(seg.y2 % 8).toBe(0);
        }
      }
    }
  });
  it('芯片分级：唯一主芯 40×40，辅芯 16×16', () => {
    for (const s of SECTION_IDS) {
      const { chips } = genSectionTargets(s, W, H);
      const mains = chips.filter((c) => c.main);
      expect(mains).toHaveLength(1);
      expect(mains[0].w).toBe(40);
      expect(chips.filter((c) => !c.main)).toHaveLength(3);
    }
  });
  it('section 间互异：任意两 section 至少有一芯片坐标不同（确为「重组」）', () => {
    for (let i = 0; i < SECTION_IDS.length; i++) {
      for (let j = i + 1; j < SECTION_IDS.length; j++) {
        const a = genSectionTargets(SECTION_IDS[i], W, H);
        const b = genSectionTargets(SECTION_IDS[j], W, H);
        const differs = a.chips.some(
          (c, k) => c.x !== b.chips[k].x || c.y !== b.chips[k].y
        );
        expect(differs, `${SECTION_IDS[i]} vs ${SECTION_IDS[j]}`).toBe(true);
      }
    }
  });
  it('确定性：同 section 同尺寸两次调用结果一致', () => {
    const a = genSectionTargets('about', W, H);
    const b = genSectionTargets('about', W, H);
    expect(a.chips.map((c) => [c.x, c.y])).toEqual(b.chips.map((c) => [c.x, c.y]));
    expect(a.traces[0].segs).toEqual(b.traces[0].segs);
  });
});