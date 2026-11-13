import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  TYPE,
  planSequence,
  planTyping,
  revealPolygon,
  revealPolygonPoints,
  splitGraphemes,
} from '../../src/lib/typewriter';
import type { GlyphBox, RowBand } from '../../src/lib/typewriter';

/**
 * 首屏打字机（hero typewriter）—— 纯逻辑契约（ADR-0017）
 *
 * 为什么节奏要单测：打字机是**首屏唯一会动的内容**，它的三个不变量一旦破了，
 * 症状都是「观感变怪」而不是「报错」——
 *   ① offsets 必须单调不减（打字不能倒退）；
 *   ② total 必须 ≤ BUDGET_MS（否则 hero-contrast / density 在导航后 2200ms
 *      采样首屏时，文字可能还在裁切中间态 —— 那是既有时序契约，不是观感问题）；
 *   ③ 同一个 rng 必须给同一条时间线（确定性；否则 e2e 与本地看到的不一样）。
 * 另外把「只打 h1 + tagline」这条**作者决策**变成源码契约，防它悄悄漂移。
 */

/** 可复现 rng（mulberry32）——不用 Math.random，否则本文件自身不可复现 */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 与 Hero.astro 同源的测试文本：站名 + 副标 + intro（2026-09-11 起三行都打） */
const H1 = '8bit-me';
const TAGLINE = '自动化与数据工程的实践记录';
const INTRO = 'Matt 的工程复盘站：做过的项目、踩过的坑、 沉淀下来的做法，都在这里。';
const ALL = [H1, TAGLINE, INTRO];

describe('splitGraphemes：字素簇切分（Range 的 offset 口径）', () => {
  it('中文逐字切开，index 是 UTF-16 码元起点', () => {
    const segs = splitGraphemes(TAGLINE);
    expect(segs).toHaveLength(TAGLINE.length);
    for (const s of segs) expect(TAGLINE.slice(s.index, s.index + s.text.length)).toBe(s.text);
  });

  it('拼接回来与原文逐字相等（不吞字、不重字）', () => {
    for (const text of ['', '8bit-me', TAGLINE, 'a\nb', ' 前后空格 ']) {
      const segs = splitGraphemes(text);
      expect(segs.map((s) => s.text).join('')).toBe(text);
    }
  });

  it('代理对（emoji）不被按码元拆成两半', () => {
    const emoji = '🎮';
    expect(splitGraphemes(emoji)).toEqual([{ text: emoji, index: 0 }]);
    // 组合序列：Intl.Segmenter 可用时必须当**一个字**（否则 Range 会取到半个字）
    if (typeof Intl.Segmenter === 'function') {
      const family = '👨‍👩‍👧';
      const segs = splitGraphemes(`a${family}b`);
      expect(segs.map((s) => s.text)).toEqual(['a', family, 'b']);
      expect(segs[1]!.index).toBe(1);
      expect(segs[2]!.index).toBe(1 + family.length);
    }
  });
});

describe('planTyping / planSequence：时间线不变量', () => {
  it('offsets 单调不减，首项 = LEAD_IN', () => {
    const plan = planTyping(TAGLINE, { rng: seeded(1) });
    expect(plan.offsets[0]).toBe(TYPE.LEAD_IN);
    for (let i = 1; i < plan.offsets.length; i++) {
      expect(plan.offsets[i]!).toBeGreaterThanOrEqual(plan.offsets[i - 1]!);
    }
  });

  it('同一 rng 两次调用逐字相同（确定性）', () => {
    const a = planSequence([H1, TAGLINE], { rng: seeded(42) });
    const b = planSequence([H1, TAGLINE], { rng: seeded(42) });
    expect(b.lines.map((l) => l.offsets)).toEqual(a.lines.map((l) => l.offsets));
    expect(b.total).toBe(a.total);
    // 换种子必须真的不一样（否则「确定性」是空断言）
    const c = planSequence([H1, TAGLINE], { rng: seeded(43) });
    expect(c.lines[1]!.offsets).not.toEqual(a.lines[1]!.offsets);
  });

  it('total 恒 ≤ BUDGET_MS（含抖动最坏情形）', () => {
    // 造一个「每字都取抖动上界」的 rng，逼出最坏时长
    const worst = () => 1;
    for (const texts of [ALL, [H1, TAGLINE], [TAGLINE], ['短'], ['', '']]) {
      const plan = planSequence(texts, { rng: worst });
      expect(plan.total, `最坏抖动下超预算：${JSON.stringify(texts)}`).toBeLessThanOrEqual(
        TYPE.BUDGET_MS
      );
    }
  });

  it('三行（真实 hero 文案）不压缩：名义时长就是设计值', () => {
    // 预算不是目标值而是安全网：名义时长必须明显短于预算，否则抖动天天撞顶被压平、
    // 「机械感」就没了（2026-09-11 扩到三行时差点踩这个坑）。
    const plan = planSequence(ALL, { rng: seeded(11) });
    expect(plan.compressed).toBe(false);
    expect(plan.total).toBeGreaterThan(2000); // 三行不能短到“一闪而过”
    expect(plan.total).toBeLessThan(TYPE.BUDGET_MS);
  });

  it('超长文案被等比压缩（不是靠钳每字间隔，故长文案也不破预算）', () => {
    const long = TAGLINE.repeat(50); // 700 字
    const seq = planSequence([long], { rng: seeded(7) });
    const plan = seq.lines[0]!;
    expect(seq.compressed).toBe(true);
    expect(seq.total).toBeLessThanOrEqual(TYPE.BUDGET_MS);
    expect(seq.total).toBeCloseTo(TYPE.BUDGET_MS, 5); // 顶到上限，不早退
    expect(plan.offsets).toHaveLength(long.length);
    for (let i = 1; i < plan.offsets.length; i++) {
      expect(plan.offsets[i]!).toBeGreaterThanOrEqual(plan.offsets[i - 1]!);
    }
  });

  it('正常文案不压缩（节奏就是 TYPE 里那几个数）', () => {
    const plan = planSequence([H1, TAGLINE], { rng: seeded(3) });
    expect(plan.compressed).toBe(false);
    expect(plan.total).toBeLessThan(TYPE.BUDGET_MS);
  });

  it('三行依次起打，每行都在上一行打完之后', () => {
    const plan = planSequence(ALL, { rng: seeded(9) });
    expect(plan.lines).toHaveLength(3);
    for (let i = 1; i < plan.lines.length; i++) {
      expect(plan.starts[i]!, `第 ${i + 1} 行起打早于上一行结束`).toBeGreaterThanOrEqual(
        plan.lines[i - 1]!.end
      );
    }
  });

  it('第二行在第一行打完之后才起打，且留出行间停顿', () => {
    const plan = planSequence([H1, TAGLINE], { rng: seeded(5) });
    const [l1, l2] = plan.lines;
    expect(l2!.offsets[0]!).toBeGreaterThanOrEqual(l1!.end);
    expect(plan.starts[1]!).toBe(l2!.offsets[0]!);
  });

  it('空文本 / 空数组不炸：total = LEAD_IN、无 offsets', () => {
    expect(planTyping('').offsets).toEqual([]);
    const empty = planSequence([], { rng: seeded(0) });
    expect(empty.lines).toEqual([]);
    expect(empty.total).toBe(TYPE.LEAD_IN);
  });
});

describe('节奏常量契约（防有人把首屏动画调成 5 秒）', () => {
  it('MS_PER_CHAR 在人能读的档位内', () => {
    expect(TYPE.MS_PER_CHAR).toBeGreaterThanOrEqual(25);
    expect(TYPE.MS_PER_CHAR).toBeLessThanOrEqual(120);
  });

  it('BUDGET_MS 落在「能看完但不会等到不耐烦」的窗口', () => {
    // 上界：三行文案（57 字素）全串不能超过 3 秒（回访者每次都要等）
    expect(TYPE.BUDGET_MS).toBeLessThanOrEqual(3000);
    // 下界：不能短到「一闪而过」，否则不叫打字机
    expect(TYPE.BUDGET_MS).toBeGreaterThanOrEqual(1500);
    expect(TYPE.LEAD_IN).toBeGreaterThanOrEqual(0);
  });
});

describe('打字范围契约（作者决策：h1 + tagline + intro）', () => {
  const src = readFileSync(join(process.cwd(), 'src/components/sections/Hero.astro'), 'utf8')
    .replace(/\r\n/g, '\n');

  it('恰好三个元素带 data-tw-line，且是 h1 / .tagline / .intro', () => {
    const tagged = [...src.matchAll(/<([a-z0-9]+)([^>]*\bdata-tw-line[^>]*)>/g)].map((m) => ({
      tag: m[1]!,
      attrs: m[2]!,
    }));
    expect(tagged.map((t) => t.tag), '带 data-tw-line 的元素数量/标签变了').toEqual([
      'h1',
      'p',
      'p',
    ]);
    expect(tagged[1]!.attrs, '第二个必须是 .tagline').toContain('tagline');
    expect(tagged[2]!.attrs, '第三个必须是 .intro').toContain('intro');
  });

  it('kicker / CTA / 站况读数都不打字（读数是要紧数据，不许延迟）', () => {
    const tags = [...src.matchAll(/<([a-z0-9]+)([^>]*)>/g)].map((m) => ({ tag: m[1]!, attrs: m[2]! }));
    for (const sel of ['kicker', 'hero-cta', 'hero-status']) {
      // 按 class 属性找元素（不能 indexOf 子串：上面的注释里也写着这些词）
      const hits = tags.filter((t) =>
        new RegExp(`class="[^"]*\\b${sel}\\b[^"]*"`).test(t.attrs)
      );
      expect(hits.length, `Hero.astro 里找不到 .${sel}`).toBeGreaterThan(0);
      for (const t of hits) {
        expect(t.attrs, `.${sel} 被打字机接管了`).not.toContain('data-tw-line');
      }
    }
  });
});

// ===================== 多行裁切几何（reveal polygon） =====================
describe('revealPolygonPoints：L 形阶梯裁切（多行打字的地基）', () => {
  /** 单行：3 个字素宽 10px */
  const oneRow: RowBand[] = [{ top: 0, bottom: 20 }];
  const oneGlyphs: GlyphBox[] = [
    { left: 0, right: 10, row: 0 },
    { left: 10, right: 20, row: 0 },
    { left: 20, right: 30, row: 0 },
  ];

  /** 两行（intro 桌面就是这种）：第一行 2 字、第二行 2 字 */
  const twoRows: RowBand[] = [
    { top: 0, bottom: 28 },
    { top: 28, bottom: 56 },
  ];
  const twoGlyphs: GlyphBox[] = [
    { left: 0, right: 100, row: 0 },
    { left: 100, right: 200, row: 0 },
    { left: 0, right: 100, row: 1 },
    { left: 100, right: 200, row: 1 },
  ];

  it('n = 0：零面积（什么都不露）', () => {
    const area = (pts: { x: number; y: number }[]) => {
      let a = 0;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        a += (pts[j]!.x + pts[i]!.x) * (pts[j]!.y - pts[i]!.y);
      }
      return Math.abs(a / 2);
    };
    expect(area(revealPolygonPoints(200, oneRow, oneGlyphs, 0))).toBe(0);
    // 反例：打到 1 个字之后面积必须 > 0（否则「零面积」这条断言是空跑的）
    expect(area(revealPolygonPoints(200, oneRow, oneGlyphs, 1))).toBeGreaterThan(0);
  });

  it('单行：裁切边恰在最后一个已打印字素的右边界', () => {
    for (const n of [1, 2, 3]) {
      const pts = revealPolygonPoints(30, oneRow, oneGlyphs, n);
      expect(pts[3]!.x).toBe(oneGlyphs[n - 1]!.right);
      expect(pts[4]!.x).toBe(oneGlyphs[n - 1]!.right);
      // 单行时上下边就是行带（退化成矩形）
      expect([pts[2]!.y, pts[3]!.y]).toEqual([0, 0]);
      expect([pts[4]!.y, pts[5]!.y]).toEqual([20, 20]);
    }
  });

  it('多行：已打完的行整行露出（阶梯上边 = 当前行顶、满宽）', () => {
    // 打到第 3 个（第 2 行第 1 个）→ 第 1 行整行露出
    const pts = revealPolygonPoints(200, twoRows, twoGlyphs, 3);
    expect(pts[1]!.x, '满宽带必须到元素右缘').toBe(200);
    expect(pts[2]!.y, '阶梯上边 = 当前行顶').toBe(28);
    expect(pts[3]!.x, '当前行的裁切边').toBe(100);
    expect(pts[5]!.y, '下边 = 当前行底（后面的行被裁掉）').toBe(56);
  });

  it('多行：打到第 2 个（仍在第 1 行）时，第 2 行完全不可见', () => {
    const pts = revealPolygonPoints(200, twoRows, twoGlyphs, 2);
    expect(pts[2]!.y).toBe(0);
    expect(pts[5]!.y, '下边停在第一行底').toBe(28);
  });

  it('裁切边钳在元素宽度内（字素超出盒宽时不越界）', () => {
    const pts = revealPolygonPoints(15, oneRow, oneGlyphs, 3);
    expect(pts[3]!.x).toBe(15);
  });

  it('量不到行（隐藏 / 字体未就绪）→ 零面积，不露任何东西', () => {
    const pts = revealPolygonPoints(200, [], oneGlyphs, 2);
    expect(pts.every((p) => p.x === 0)).toBe(true);
  });

  it('revealPolygon 输出合法 CSS polygon，且与 points 一致', () => {
    const css = revealPolygon(200, twoRows, twoGlyphs, 3);
    expect(css.startsWith('polygon(')).toBe(true);
    expect(css.endsWith(')')).toBe(true);
    const nums = [...css.matchAll(/(-?\d+\.\d+)px (-?\d+\.\d+)px/g)].map((m) => [
      Number(m[1]),
      Number(m[2]),
    ]);
    expect(nums).toEqual(
      revealPolygonPoints(200, twoRows, twoGlyphs, 3).map((p) => [p.x, p.y])
    );
  });
});
