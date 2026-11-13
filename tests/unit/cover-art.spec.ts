import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  COVER_SIZE,
  MAX_REV,
  coverPaths,
  coverSpec,
  glyphCover,
  jumperRow,
  type CoverSpec,
} from '../../src/lib/cover-art';
import {
  FALLBACK_GLYPH,
  GLYPH_BY_EMOJI,
  GLYPH_BY_ID,
  GLYPH_IDS,
  GLYPH_H,
  GLYPH_W,
  GLYPHS,
  glyphForCover,
} from '../../src/lib/cover-glyphs';
import { MODES, type ModeDef } from '../../src/lib/themes';

/**
 * 封面构图契约（cover art）—— 候选①「轮廓 / 剪影型」
 *
 * 分工：
 *   单测（本文件）守「纯函数不变量」——确定性 / 反噪点签名 / 结构指数 / 覆盖率 /
 *   留白 / 跨 13 套主题的可辨性 / emoji → 符号表覆盖 / 源码不变量；
 *   e2e（tests/e2e/cover.spec.ts）守「浏览器里真的那样」——列表拇指图与单篇头图
 *   逐格一致（path d 全等）、切主题 fill 真的变、path 数量。
 *
 * 为什么这一层必须存在（2026-09 调研的实测缺陷，本文件的每条硬断言都对得上一个数字）：
 *   旧 identicon 算法（FNV-1a + xorshift32 + 水平镜像）在 18 篇上实测
 *   **孤立单点 312 个（单片最多 30 个）、结构指数 0.17** —— 这就是作者说的「二维码墙」。
 *   差异大不是问题（旧图两两差异是全场最大），**差异大 + 无形状**才是。
 *   故断言不写「两两必须差多少」，而写「孤立单点 = 0」「最大连通块 ÷ 墨迹 ≥ 下限」，
 *   再补一条「最像的一对仍要可辨」（防有人用配色去救可辨性——那在 7/13 主题里会退化）。
 */

const ROOT = process.cwd();
const BLOG_DIR = join(ROOT, 'src/content/blog');

/** 已发布文章（draft 不计）：id + cover emoji（从 frontmatter 原文解析，不走 astro:content） */
function posts(): { id: string; cover: string }[] {
  return readdirSync(BLOG_DIR)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const txt = readFileSync(join(BLOG_DIR, f), 'utf-8');
      return {
        id: f.replace(/\.md$/, ''),
        cover: (txt.match(/^cover:\s*'([^']*)'/m) ?? [])[1] ?? '',
        draft: /^draft:\s*true/m.test(txt),
      };
    })
    .filter((p) => !p.draft)
    .sort((a, b) => (a.id < b.id ? 1 : -1));
}

const INK = new Set(['l', 'a']);

interface Metrics {
  ink: number;
  comps: number;
  isolated: number;
  largest: number;
  structure: number;
}

/** 4-连通块 / 孤立单点 / 最大块 / 结构指数（= 最大块 ÷ 墨迹格） */
function metrics(rows: string[]): Metrics {
  const n = rows.length;
  const cells = rows.join('');
  const inkCells = [...cells].filter((c) => INK.has(c)).length;
  const seen = new Array(n * n).fill(false);
  let comps = 0;
  let isolated = 0;
  let largest = 0;
  for (let i = 0; i < n * n; i++) {
    if (seen[i] || !INK.has(cells[i])) continue;
    comps++;
    let size = 0;
    const stack = [i];
    seen[i] = true;
    while (stack.length) {
      const p = stack.pop()!;
      size++;
      const x = p % n;
      const y = (p / n) | 0;
      const nb: number[] = [];
      if (x > 0) nb.push(p - 1);
      if (x < n - 1) nb.push(p + 1);
      if (y > 0) nb.push(p - n);
      if (y < n - 1) nb.push(p + n);
      for (const q of nb) {
        if (!seen[q] && INK.has(cells[q])) {
          seen[q] = true;
          stack.push(q);
        }
      }
    }
    if (size === 1) isolated++;
    if (size > largest) largest = size;
  }
  return {
    ink: inkCells / (n * n),
    comps,
    isolated,
    largest,
    structure: inkCells ? largest / inkCells : 0,
  };
}

/* ---------- 颜色：把矩阵映射到某主题下的实际像素，再量两两差异 ---------- */

const hex2rgb = (hex: string): number[] =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

const mix = (a: number[], b: number[], p: number): number[] =>
  a.map((v, i) => v * p + b[i] * (1 - p));

type Theme = ModeDef;

/** 封面盒底色 = global.css 的 color-mix(in srgb, --c-line 22%, --c-panel) */
const plateOf = (t: Theme) => mix(hex2rgb(t.colors.line), hex2rgb(t.colors.panel), 0.22);

function rgbOf(ch: string, t: Theme): number[] {
  if (ch === 'l') return hex2rgb(t.colors.text);
  if (ch === 'a') return hex2rgb(t.colors.accent);
  if (ch === 'd') return hex2rgb(t.colors.line);
  return plateOf(t);
}

/** 一对封面在某主题下「ΔRGB>60 的像素占比」与「逐格差异率」 */
function diffPair(a: string[], b: string[], t: Theme): { rgb: number; cell: number } {
  const ac = a.join('');
  const bc = b.join('');
  let cell = 0;
  let rgb = 0;
  for (let k = 0; k < ac.length; k++) {
    if (ac[k] === bc[k]) continue;
    cell++;
    const ca = rgbOf(ac[k], t);
    const cb = rgbOf(bc[k], t);
    if (Math.hypot(ca[0] - cb[0], ca[1] - cb[1], ca[2] - cb[2]) > 60) rgb++;
  }
  return { rgb: rgb / ac.length, cell: cell / ac.length };
}

/** 一组封面里「最像的一对」（全部主题里最差的那一对） */
function closestPair(rowsList: string[][], themes: readonly Theme[]) {
  let worst = { rgb: Infinity, cell: Infinity, theme: '', i: 0, j: 0 };
  themes.forEach((t) => {
    for (let i = 0; i < rowsList.length; i++) {
      for (let j = i + 1; j < rowsList.length; j++) {
        const d = diffPair(rowsList[i], rowsList[j], t);
        if (d.rgb < worst.rgb) worst = { rgb: d.rgb, cell: d.cell, theme: t.key, i, j };
      }
    }
  });
  return worst;
}

/* ---------- 实测下限（每个数字都来自 _scratch/cover-impl/metrics.mjs，向下留余量） ----------
   新方案实测（全部符号 × 全部 rev）：孤立单点 0 / 连通块 ≤ 7 / 结构指数 0.47–0.97 /
   墨迹 [0.133, 0.328] / 强调格 最多 12 / 最像一对 格差 0.074、ΔRGB>60 0.063
   旧基线实测（18 篇）：孤立单点 312（单片最多 30）/ 连通块 ≤ 41 / 结构指数 0.17（最低 0.10）/
   墨迹 [0.266, 0.383] / 强调格 最多 42 / 贴边（M0 0、M15 0 都出现过） */
const MIN_STRUCTURE = 0.4;
const MAX_COMPS = 8;
const INK_MIN = 0.12;
const INK_MAX = 0.35;
const MIN_PAIR_CELL = 0.05;
const MIN_PAIR_RGB = 0.04;

describe('确定性（同 spec 永远同图）', () => {
  it('同 spec 调两次，矩阵全等（覆盖全部符号 × 全部 rev）', () => {
    for (const glyph of GLYPH_IDS) {
      for (const rev of [1, 2, 7, MAX_REV]) {
        const spec: CoverSpec = { glyph, rev };
        expect(glyphCover(spec), `${glyph}#${rev}`).toEqual(glyphCover(spec));
      }
    }
  });

  it('coverSpec 只从文章自身派生（同 post 恒同 spec，不同 slug 至少一处不同）', () => {
    for (const p of posts()) {
      expect(coverSpec(p)).toEqual(coverSpec(p));
    }
    const revs = new Set(posts().map((p) => coverSpec(p).rev));
    expect(revs.size, 'rev 全部撞在一起说明哈希没参与').toBeGreaterThan(1);
  });

  it('同 slug 不同 emoji 会换符号；同 emoji 不同 slug 只可能换 rev', () => {
    const a = coverSpec({ id: 'x', cover: '🕵️' });
    const b = coverSpec({ id: 'x', cover: '🗃️' });
    expect(a.glyph).not.toBe(b.glyph);
    const c = coverSpec({ id: 'y', cover: '🕵️' });
    expect(c.glyph).toBe(a.glyph);
  });
});

describe('反噪点签名：孤立单点必须为 0', () => {
  it('全部符号 × 全部 rev：4-连通孤立单点合计 0（旧算法同口径 = 312 个）', () => {
    let total = 0;
    const worst: { id: string; n: number }[] = [];
    for (const glyph of GLYPH_IDS) {
      for (const rev of [1, 2, 3, 5, 8, 13, MAX_REV]) {
        const m = metrics(glyphCover({ glyph, rev }));
        total += m.isolated;
        if (m.isolated > 0) worst.push({ id: `${glyph}#${rev}`, n: m.isolated });
      }
    }
    expect(total, `出现孤立单点：${JSON.stringify(worst)}`).toBe(0);
  });

  it('18 篇真封面：孤立单点 0、连通块 ≤ 8（符号 + 版本跳线都是成块的）', () => {
    for (const p of posts()) {
      const m = metrics(glyphCover(coverSpec(p)));
      expect(m.isolated, `${p.id} 有孤立单点`).toBe(0);
      expect(m.comps, `${p.id} 碎成 ${m.comps} 块`).toBeLessThanOrEqual(MAX_COMPS);
    }
  });
});

describe('结构指数（最大连通块 ÷ 墨迹）—— 「有形状」的直接读数', () => {
  it('每条符号 ≥ 0.40（实测最低 0.47；旧算法均值 0.17、最低 0.10），且最大块 ≥ 20 格', () => {
    const bad: { id: string; v: number }[] = [];
    for (const glyph of GLYPH_IDS) {
      for (const rev of [1, 2, 11, MAX_REV]) {
        const m = metrics(glyphCover({ glyph, rev }));
        if (m.structure < MIN_STRUCTURE) bad.push({ id: `${glyph}#${rev}`, v: m.structure });
        expect(m.largest, `${glyph}#${rev} 最大连通块只有 ${m.largest} 格`).toBeGreaterThanOrEqual(20);
      }
    }
    expect(bad, `结构指数低于 ${MIN_STRUCTURE}：${JSON.stringify(bad)}`).toEqual([]);
  });

  it('18 篇真封面全部达标', () => {
    const bad = posts()
      .map((p) => ({ id: p.id, m: metrics(glyphCover(coverSpec(p))) }))
      .filter(({ m }) => m.structure < MIN_STRUCTURE || m.isolated > 0)
      .map(({ id, m }) => ({ id, structure: m.structure, isolated: m.isolated }));
    expect(bad).toEqual([]);
  });
});

describe('墨迹覆盖 / 强调焦点 / 留白（统一家具）', () => {
  it(`墨迹覆盖率 ∈ [${INK_MIN}, ${INK_MAX}]（新旧区间不重叠：旧算法最高 0.383 越上界）`, () => {
    const bad: { id: string; ink: number }[] = [];
    for (const glyph of GLYPH_IDS) {
      for (const rev of [1, MAX_REV]) {
        const m = metrics(glyphCover({ glyph, rev }));
        if (m.ink < INK_MIN || m.ink > INK_MAX) bad.push({ id: `${glyph}#${rev}`, ink: m.ink });
      }
    }
    for (const p of posts()) {
      const m = metrics(glyphCover(coverSpec(p)));
      if (m.ink < INK_MIN || m.ink > INK_MAX) bad.push({ id: p.id, ink: m.ink });
    }
    expect(bad, `越界墨迹：${JSON.stringify(bad)}`).toEqual([]);
  });

  it('强调色只做焦点：每条 ≥1 且 ≤14 格（实测 [2, 12]），且不承载身份信息', () => {
    for (const glyph of GLYPH_IDS) {
      const cells = glyphCover({ glyph, rev: 1 }).join('');
      const accent = [...cells].filter((c) => c === 'a').length;
      expect(accent, `${glyph} 没有强调焦点`).toBeGreaterThanOrEqual(1);
      expect(accent, `${glyph} 强调色铺得太多（焦点变主角）`).toBeLessThanOrEqual(14);
    }
  });

  it('统一家具：上 / 左 / 右各 1 格留白，第 14 行留空，第 15 行是版本跳线', () => {
    for (const glyph of GLYPH_IDS) {
      for (const rev of [1, 6, MAX_REV]) {
        const rows = glyphCover({ glyph, rev });
        expect(rows.length, `${glyph} 行数`).toBe(COVER_SIZE);
        rows.forEach((row, y) => expect(row.length, `${glyph} 第 ${y} 行长度`).toBe(COVER_SIZE));
        expect(rows[0], `${glyph} 顶边有墨`).toBe('.'.repeat(COVER_SIZE));
        rows.forEach((row, y) => {
          expect(row[0], `${glyph} 第 ${y} 行左边界有墨`).toBe('.');
          expect(row[COVER_SIZE - 1], `${glyph} 第 ${y} 行右边界有墨`).toBe('.');
        });
        expect(rows[COVER_SIZE - 2], `${glyph} 第 14 行应留空（符号与跳线之间的分隔）`).toBe(
          '.'.repeat(COVER_SIZE)
        );
        expect(rows[COVER_SIZE - 1], `${glyph} 第 15 行应是版本跳线`).toBe(jumperRow(rev));
      }
    }
  });

  it('字符集 ⊆ {., d, l, a}（d 是契约留位，本方案不用）', () => {
    for (const p of posts()) {
      const rows = glyphCover(coverSpec(p));
      const cells = rows.join('');
      expect(cells, p.id).toMatch(/^[.dla]+$/);
      expect(cells.includes('d'), `${p.id} 不该出现暗场层`).toBe(false);
    }
  });

  it('coverPaths 只把出现的字符拼成 path（每色一条，不是每格一个 <rect>）', () => {
    const rows = glyphCover({ glyph: 'gear', rev: 3 });
    const { accent, light, dark } = coverPaths(rows);
    const accentCells = [...rows.join('')].filter((c) => c === 'a').length;
    const lightCells = [...rows.join('')].filter((c) => c === 'l').length;
    expect(accent.match(/M/g) ?? []).toHaveLength(accentCells);
    expect(light.match(/M/g) ?? []).toHaveLength(lightCells);
    expect(dark).toBe('');
  });
});

describe('版本跳线（同族区分走结构位，不走颜色）', () => {
  it('rev 1..15 两两不同，且每位都是 2 格焊盘（不会退化成孤立单点）', () => {
    const seen = new Set<string>();
    for (let rev = 1; rev <= MAX_REV; rev++) {
      const row = jumperRow(rev);
      seen.add(row);
      expect([...row].filter((c) => c === 'l').length % 2, `rev=${rev} 焊盘宽应为 2 格`).toBe(0);
    }
    expect(seen.size).toBe(MAX_REV);
    // rev 越界钳制而不是抛错（脏数据不崩构建）
    expect(jumperRow(0)).toBe(jumperRow(1));
    expect(jumperRow(99)).toBe(jumperRow(MAX_REV));
  });

  it('同符号不同 rev：跨两档模式都不相同（差异是「有墨/无墨」，与配色无关）', () => {
    for (const glyph of GLYPH_IDS) {
      const a = glyphCover({ glyph, rev: 1 });
      const b = glyphCover({ glyph, rev: 2 });
      for (const t of MODES) {
        const d = diffPair(a, b, t);
        expect(d.cell, `${glyph} rev1 vs rev2 在 ${t.key} 下逐格相同`).toBeGreaterThan(0);
        expect(d.rgb, `${glyph} rev1 vs rev2 在 ${t.key} 下 ΔRGB>60 像素为 0`).toBeGreaterThan(0);
      }
    }
  });
});

describe('互异性（最像的一对也必须可辨，且跨两档模式成立）', () => {
  it(`18 篇两两：最像的一对 格差 ≥ ${MIN_PAIR_CELL}、ΔRGB>60 ≥ ${MIN_PAIR_RGB}（旧算法靠噪点取得 0.375 / 0.336，但孤立单点 312）`, () => {
    const all = posts();
    const rowsList = all.map((p) => glyphCover(coverSpec(p)));
    const worst = closestPair(rowsList, MODES);
    expect(
      worst.cell,
      `最像的一对：${all[worst.i].id} ↔ ${all[worst.j].id}（${worst.theme}）格差 ${worst.cell}`
    ).toBeGreaterThanOrEqual(MIN_PAIR_CELL);
    expect(
      worst.rgb,
      `最像的一对：${all[worst.i].id} ↔ ${all[worst.j].id}（${worst.theme}）ΔRGB>60 ${worst.rgb}`
    ).toBeGreaterThanOrEqual(MIN_PAIR_RGB);
  });

  it('18 篇逐格矩阵两两不同（同图 = 构建期复制粘贴级缺陷）', () => {
    const arts = posts().map((p) => glyphCover(coverSpec(p)).join('\n'));
    expect(new Set(arts).size).toBe(arts.length);
  });
});

describe('emoji → 符号（数据源契约）', () => {
  it('每篇已发布文章的 cover emoji 都在表里（漏配 → 静默退兜底，这里判红）', () => {
    const missing: { id: string; cover: string }[] = [];
    for (const p of posts()) {
      const key = p.cover.replace(/\uFE0F/g, '');
      expect(p.cover, `${p.id} 缺 cover emoji`).not.toBe('');
      if (!Object.prototype.hasOwnProperty.call(GLYPH_BY_EMOJI, key)) {
        missing.push({ id: p.id, cover: p.cover });
      }
    }
    expect(missing, `未登记 emoji：${JSON.stringify(missing)}`).toEqual([]);
  });

  it('每篇都能取到一个真符号，且 GLYPH_BY_ID 覆盖表优先于 emoji 表', () => {
    for (const p of posts()) {
      const spec = coverSpec(p);
      expect(GLYPH_IDS, p.id).toContain(spec.glyph);
      expect(spec.rev).toBeGreaterThanOrEqual(1);
      expect(spec.rev).toBeLessThanOrEqual(MAX_REV);
    }
    // 覆盖表（同 emoji 的两篇要不同形状）——写成行为断言，不是读表断言
    expect(glyphForCover({ id: '2026-09-08-element-capture-offset', cover: '🧭' })).toBe('offset');
    expect(glyphForCover({ id: '2026-09-08-rpa-runtime-selection', cover: '🧭' })).toBe('fork');
  });

  it('未知 / 缺失 emoji 落到兜底符号（不崩、不空白），且覆盖表未命中时不误伤', () => {
    expect(glyphForCover({ id: 'x', cover: '🦄' })).toBe(FALLBACK_GLYPH);
    expect(glyphForCover({ id: 'x' })).toBe(FALLBACK_GLYPH);
    expect(glyphForCover({})).toBe(FALLBACK_GLYPH);
    expect(glyphCover({ glyph: 'nope' as never, rev: 1 })).toEqual(
      glyphCover({ glyph: FALLBACK_GLYPH, rev: 1 })
    );
  });
});

describe('源码不变量', () => {
  it('cover-art.ts / cover-glyphs.ts 不含 Math.random / Date / process.env（构建期 SSR 必须可复现）', () => {
    for (const f of ['src/lib/cover-art.ts', 'src/lib/cover-glyphs.ts']) {
      const src = readFileSync(join(ROOT, f), 'utf-8');
      // 先剥注释：文件头注释里就写了「禁 Math.random」，不该被自己判红
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(code, f).not.toContain('Math.random');
      expect(code, f).not.toMatch(/\bDate\b/);
      expect(code, f).not.toContain('process.env');
    }
  });

  it('旧的 identicon 实现已删除（算法不作后备，避免两条语法同时存在）', () => {
    const code = readFileSync(join(ROOT, 'src/lib/cover-art.ts'), 'utf-8');
    expect(code).not.toContain('pixelCover');
    expect(code).not.toContain('xorshift32');
    expect(code).not.toMatch(/FILL_P|ACCENT_P|MIN_DENSITY/);
  });

  it('组件层传 seed：列表页与单篇页都带 seed（同图契约的前提）', () => {
    const list = readFileSync(join(ROOT, 'src/pages/blog/index.astro'), 'utf-8');
    const single = readFileSync(join(ROOT, 'src/pages/blog/[slug].astro'), 'utf-8');
    expect(list).toMatch(/<CoverBlock[\s\S]*?seed=\{it\.post\.id\}/);
    expect(single).toMatch(/<CoverBlock[\s\S]*?seed=\{post\.id\}/);
  });

  it('CoverBlock：仍是两条 <path>（不是每格一个 <rect>），props / 尺寸档 / aria-hidden 未变', () => {
    const src = readFileSync(join(ROOT, 'src/components/CoverBlock.astro'), 'utf-8');
    // 剥注释：组件注释里就写着「不是 256 个 <rect>」，别被自己的说明判红
    const markup = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');
    expect(markup).not.toContain('<rect');
    expect(markup).toContain('class="ink-accent"');
    expect(markup).toContain('class="ink-light"');
    expect(src).toMatch(/seed\?: string/);
    expect(src).toMatch(/size\?: 'md' \| 'lg'/);
    expect(src).toContain('aria-hidden="true"');
  });

  it('封面盒 class 名未改（组件与全局样式按 .cover-block 选择）', () => {
    const layout = readFileSync(join(ROOT, 'src/components/CoverBlock.astro'), 'utf-8');
    expect(layout).toContain('cover-block');
    const css = readFileSync(join(ROOT, 'src/styles/global.css'), 'utf-8');
    expect(css).toMatch(/\.cover-block\s*\{/);
    // 死样式已清：.cover-glyph 不应再出现（元素已被 SVG 取代）
    expect(css).not.toContain('.cover-glyph');
  });
});

describe('符号表结构契约（数据完整性）', () => {
  it(`每条符号 ${GLYPH_H} 行 × ${GLYPH_W} 字符，字符集 ∈ {., #, +}，且有语义标签`, () => {
    for (const id of GLYPH_IDS) {
      const g = GLYPHS[id];
      expect(g.rows.length, `${id} 行数`).toBe(GLYPH_H);
      g.rows.forEach((row, y) =>
        expect(row.length, `${id} 第 ${y} 行长度（应为 ${GLYPH_W}）`).toBe(GLYPH_W)
      );
      expect(g.rows.join(''), id).toMatch(/^[.#+]+$/);
      expect(g.rows.join('').includes('+'), `${id} 没有强调焦点`).toBe(true);
      expect(g.label.length, `${id} 缺语义标签`).toBeGreaterThan(0);
    }
  });

  it('符号 id 两两不同、表里没有多余键，且 emoji 表 / 逐篇覆盖表的值都指向真符号', () => {
    expect(new Set(GLYPH_IDS).size).toBe(GLYPH_IDS.length);
    expect(Object.keys(GLYPHS).sort()).toEqual([...GLYPH_IDS].sort());
    for (const [emoji, id] of Object.entries(GLYPH_BY_EMOJI)) {
      expect(GLYPH_IDS, `${emoji} → ${id}`).toContain(id);
    }
    for (const [slug, forced] of Object.entries(GLYPH_BY_ID)) {
      expect(GLYPH_IDS, `${slug} → ${forced}`).toContain(forced);
      // 覆盖必须压过 emoji 表：即使 cover 为空（查不到 emoji）也要拿到指定符号
      expect(glyphForCover({ id: slug, cover: '' }), `${slug} 的覆盖没生效`).toBe(forced);
    }
  });
});
