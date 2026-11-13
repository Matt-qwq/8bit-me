/**
 * 封面像素图组装（cover art）—— 纯函数，确定性，零环境依赖。
 *
 * 语法（候选①「轮廓 / 剪影型」，见 `%TEMP%\8bitme-roadmap3\cover-research.md`）：
 *   16×16 矩阵 = 符号芯（`src/lib/cover-glyphs.ts`，14×13，落在 1..14 列 / 1..13 行）
 *              + 1 行空白
 *              + 第 15 行「版本跳线」（同符号的两篇文章靠它区分，**结构位**而非颜色）
 *
 * 为什么同族区分走结构位而不是配色：`--c-accent` vs `--c-text` 在 7/13 套主题里 ΔRGB < 60
 * （ADR-0014 §五已记录的已知上限）。调研期实测过「用强调色焊盘区分同族」→ 12 张里出现
 * 两张完全相同的图（最像一对 ΔRGB>60 = 0.000）。改成焊盘**有/无**后与主题无关。
 * 由此得到一条硬约束：**强调色只做焦点点缀，永不承载身份信息**。
 *
 * 为什么禁 Math.random / Date / 环境输入：
 *   封面在**构建期 SSR** 渲染成静态 HTML。同一篇文章的列表拇指图与单篇头图必须逐格一致
 *   （开发流程文档 测试触发表里的跨文件契约），且每次重建、每台机器构建都必须同图——
 *   否则每次部署封面都在跳，diff 里全是噪声。
 *
 * 字符集四个：'.' 空 / 'd' 暗场（--c-line，本方案不用，契约留位）/ 'l' 浅墨（--c-text）/ 'a' 强调（--c-accent）。
 * 组件（src/components/CoverBlock.astro）把矩阵拼成 SVG path，本文件不碰 DOM。
 */

import { FALLBACK_GLYPH, GLYPHS, glyphForCover, type GlyphId } from './cover-glyphs';

/** 单元格取值：'.' 空 / 'd' 暗场 / 'l' 浅墨 / 'a' 强调 */
export type CoverInk = '.' | 'd' | 'l' | 'a';

/** 网格边长（16×16 = 256 格；列表拇指图与单篇头图共用同一矩阵） */
export const COVER_SIZE = 16;

/** 一条封面的完整规格：符号 + 同族版本号 */
export interface CoverSpec {
  readonly glyph: GlyphId;
  readonly rev: number;
}

/** 版本跳线的取值个数（4 个焊盘位 = 4 bit；rev ∈ [1, 15]，rev ≥ 1 保证至少有 1 个焊盘） */
export const MAX_REV = 15;

/** 焊盘位（每 2 格一个焊盘：3-4 / 6-7 / 9-10 / 12-13，整体居中且不贴左右边框） */
const JUMPER_SLOTS = [3, 6, 9, 12] as const;

/** FNV-1a 32 位字符串哈希（UTF-16 code unit 逐个混入，含 emoji 代理对） */
function fnv1a(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    // 0x01000193 = FNV prime；Math.imul 保证 32 位整数乘法不丢精度（仍是确定性运算）
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * 文章 → 封面规格。
 *
 * rev（同族版本号）必须**只从文章自身派生**：列表页与单篇页各算一次，取「它在列表里的序号」
 * 会让两处拿到不同的图（e2e 断言两条 path d 全等）。故 rev = 1 + hash(slug) % 15。
 *
 * @param source.id 文章 slug（= post.id）
 * @param source.cover frontmatter 的 cover emoji
 */
export function coverSpec(source: { id?: string; cover?: string }): CoverSpec {
  const glyph = glyphForCover(source);
  const rev = 1 + (fnv1a(`${source.id ?? ''}:rev`) % MAX_REV);
  return { glyph, rev };
}

/**
 * 版本跳线行（第 15 行）：把 rev 写成 4 个焊盘位的二进制（低位在左）。
 * 强调色一格都不用——这是「跨主题可辨」的前提。
 */
export function jumperRow(rev: number): string {
  const bits = Math.max(1, Math.min(MAX_REV, Math.trunc(rev)));
  const row: CoverInk[] = new Array(COVER_SIZE).fill('.');
  JUMPER_SLOTS.forEach((x, i) => {
    if ((bits >> i) & 1) {
      row[x] = 'l';
      row[x + 1] = 'l';
    }
  });
  return row.join('');
}

/**
 * 生成 16×16 的封面矩阵。
 *
 * @param spec `coverSpec()` 的产物（也可手工构造，见单测的合成同族用例）
 * @returns `COVER_SIZE` 行、每行 `COVER_SIZE` 个字符，字符集 ⊆ {'.', 'd', 'l', 'a'}
 */
export function glyphCover(spec: CoverSpec): string[] {
  const glyph = GLYPHS[spec.glyph] ?? GLYPHS[FALLBACK_GLYPH];
  const grid: string[] = Array.from({ length: COVER_SIZE }, () =>
    '.'.repeat(COVER_SIZE)
  );

  const put = (x: number, y: number, ch: string) => {
    if (x < 0 || x >= COVER_SIZE || y < 0 || y >= COVER_SIZE) return;
    grid[y] = grid[y].slice(0, x) + ch + grid[y].slice(x + 1);
  };

  // 符号芯：整体 +1 偏移 → 上 / 左各留 1 格白边（右 / 下由 14×13 的芯尺寸保证）
  glyph.rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch === '#') put(x + 1, y + 1, 'l');
      else if (ch === '+') put(x + 1, y + 1, 'a');
    }
  });

  // 第 15 行：版本跳线（第 14 行留空，把符号与跳线分开）
  grid[COVER_SIZE - 1] = jumperRow(spec.rev);
  return grid;
}

/** 把矩阵拼成 SVG path 的 `d`（每格一个 `M x y h1 v1 h-1 z` 方块，每色一条 path）。 */
export function coverPaths(rows: string[]): {
  accent: string;
  light: string;
  dark: string;
} {
  const accent: string[] = [];
  const light: string[] = [];
  const dark: string[] = [];
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch === 'a') accent.push(`M${x} ${y}h1v1h-1z`);
      else if (ch === 'l') light.push(`M${x} ${y}h1v1h-1z`);
      else if (ch === 'd') dark.push(`M${x} ${y}h1v1h-1z`);
    }
  });
  return { accent: accent.join(''), light: light.join(''), dark: dark.join('') };
}
