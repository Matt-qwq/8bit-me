import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import * as fontkit from 'fontkit';
import { describe, expect, it } from 'vitest';

/**
 * 文章字符逻辑图（```flow 围栏）的源码契约
 *
 * 背景（2026-09-11）：文章插图从「构建期内联 SVG」（`diagram-art.ts` + `ArticleFigure.astro`）
 * 改为 **markdown 里直接写的字符图** —— 图就是文本，靠 `<pre>` 渲染，
 * 零 JS、零新依赖、随 13 套主题变色（配置见 `astro.config.mjs` 的 `excludeLangs: ['flow']`，
 * 样式见 `src/pages/blog/[slug].astro` 的 `pre:has(> code.language-flow)`）。
 *
 * 字符图能不能看清，全押在两件物理事实上，故必须由源码契约守住（人眼验不出来）：
 *   ① **Zpix 的字形覆盖**：制表符（─│┌┐└┘├┤┼▼▲→）与汉字在 Zpix 里同为 13/12 em 全角格，
 *      所以图的对齐由「全角格」保证；一旦某个字符 Zpix 没有，浏览器会**静默回退系统字体**，
 *      那一格的宽度变了而没人报错（历史事故：▚ ◨ ✓ 三个字符）。
 *   ② **缩进只能用全角空格 U+3000**：半角空格是 500/1200 em（≈5px），
 *      拿它当缩进会让「导轨列」逐行错位——这正是字符图最常见的坏法。
 *
 * 另外守一条工程约束：图必须能塞进正文列（≤40 全角格），否则桌面端也要横向滚动。
 */
const BLOG_DIR = join(process.cwd(), 'src/content/blog');
const opened = fontkit.openSync(join(process.cwd(), 'public/fonts/zpix.ttf'));
// openSync 的返回类型是 Font | FontCollection（.ttc/.otc 才是集合），这里收窄成单字体
if (!('glyphForCodePoint' in opened)) throw new Error('zpix.ttf 应为单个字体文件，而非字体集合');
const font = opened;

/** Zpix 全角格 = 1300/1200 em（汉字、制表符、U+3000）；ASCII 是 700/1200 em */
const FULL_CELL = 1300;
/** 正文列可容纳的全角格数：pre 实测内宽 544px ÷ 13px（12px 字号下的全角格）= 41.8 → 取 40 */
const MAX_CELLS = 40;

/** 绘制符（制表 / 箭头 / 几何块）——它们不是「字」，不参与字间墨隙度量 */
const isDrawing = (cp: number): boolean =>
  (cp >= 0x2500 && cp <= 0x257f) || (cp >= 0x2190 && cp <= 0x21ff) || (cp >= 0x25a0 && cp <= 0x25ff);

/**
 * 侦赖「纵向连续」的绘制符：它们的墨高是满格（1.0000 em）。
 * 要让它们连成一条不断开的竖线，行高就必须 ≤ 墨高（否则每行之间就是缝隙）；
 * 而 12px 字号的汉字墨高只有 0.9167 em，行高 = 墨高时行间墨隙只剩 1px → 「字粘在一起」。
 * 两个要求数学上互斥（详见下方可读度量组的注释），故字符图里只能用不侦赖连续性的符号（↓ → ↑ ← ▼ ▲ ■）。
 */
const VERTICAL_RAIL = /[\u2502\u250c\u2510\u2514\u2518\u251c\u2524\u252c\u2534\u253c]/;

/** 从 `[slug].astro` 读 flow 图块的 font-size / line-height（声明是唯一事实源） */
function flowTypography(): { size: number; lineHeight: number } {
  const css = readFileSync(join(process.cwd(), 'src/pages/blog/[slug].astro'), 'utf-8');
  const i = css.indexOf("pre:has(> code.language-flow)");
  if (i < 0) throw new Error('找不到 pre:has(> code.language-flow) 规则');
  const block = css.slice(i, css.indexOf('}', i));
  const sizeRem = /font-size:\s*([\d.]+)rem/.exec(block);
  const lh = /line-height:\s*(\d+)px/.exec(block);
  if (!sizeRem || !lh) throw new Error('flow 图块应显式声明 font-size(rem) 与 line-height(px)');
  return { size: Number(sizeRem[1]) * 16, lineHeight: Number(lh[1]) };
}

/** 某个字符的墨高 / 字间墨隙（em 与 px） */
function glyphInk(ch: string, size: number) {
  const g = font.glyphForCodePoint(ch.codePointAt(0)!);
  const b = g.bbox;
  const upem = font.unitsPerEm;
  return {
    inkH: ((b.maxY - b.minY) / upem) * size,
    gap: ((g.advanceWidth - (b.maxX - b.minX)) / upem) * size,
  };
}

/** 一行折算成多少「全角格」（不足一格按比例算，故 ASCII 也能加进来） */
function cellWidth(line: string): number {
  let sum = 0;
  for (const ch of line) {
    const cp = ch.codePointAt(0)!;
    const g = font.glyphForCodePoint(cp);
    sum += (g?.advanceWidth ?? FULL_CELL) / FULL_CELL;
  }
  return sum;
}

interface FlowBlock {
  file: string;
  /** 围栏内的原始行（不含围栏本身） */
  lines: string[];
}

/** 收集全部文章里的 ```flow 块 */
function collectFlowBlocks(): FlowBlock[] {
  const out: FlowBlock[] = [];
  for (const f of readdirSync(BLOG_DIR).filter((n) => n.endsWith('.md'))) {
    const raw = readFileSync(join(BLOG_DIR, f), 'utf-8');
    const lines = raw.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      if (!/^```flow\s*$/.test(lines[i]!)) continue;
      const body: string[] = [];
      for (let j = i + 1; j < lines.length && !/^```\s*$/.test(lines[j]!); j += 1) body.push(lines[j]!);
      out.push({ file: f, lines: body });
    }
  }
  return out;
}

const BLOCKS = collectFlowBlocks();

describe('文章字符逻辑图（```flow 围栏）', () => {
  it('图块存在且非空（机制在位：至少一篇用 ```flow）', () => {
    expect(BLOCKS.length, '没有任何 ```flow 图块').toBeGreaterThan(0);
    for (const b of BLOCKS) {
      expect(b.lines.filter((l) => l.trim() !== '').length, `${b.file} 的图块只有 ${b.lines.length} 行`).toBeGreaterThanOrEqual(3);
    }
  });

  it('图内每个字符 Zpix 都有字形（防静默回退系统字体）', () => {
    const bad: string[] = [];
    for (const b of BLOCKS) {
      for (const line of b.lines) {
        for (const ch of line) {
          const cp = ch.codePointAt(0)!;
          if (ch === '\t') continue; // 制表符另由缩进契约拦
          if (!font.hasGlyphForCodePoint(cp)) {
            bad.push(`${b.file}: ${JSON.stringify(ch)} U+${cp.toString(16).toUpperCase().padStart(4, '0')}`);
          }
        }
      }
    }
    expect([...new Set(bad)], `图内字符 Zpix 无字形（会回退系统字体）：\n${bad.join('\n')}`).toEqual([]);
  });

  it('缩进只用全角空格 U+3000（半角空格当缩进会让导轨列错位）', () => {
    const bad: string[] = [];
    for (const b of BLOCKS) {
      for (const line of b.lines) {
        const indent = /^[\s\u3000]*/.exec(line)![0];
        if (/[ \t]/.test(indent)) {
          bad.push(`${b.file}: ${JSON.stringify(line.slice(0, 12))}… 用了半角空格/制表符缩进`);
        }
      }
    }
    expect(bad, `缩进必须是 U+3000：\n${bad.join('\n')}`).toEqual([]);
  });

  it(`每行 ≤ ${MAX_CELLS} 全角格（否则正文列里要横向滚动）`, () => {
    const bad: string[] = [];
    for (const b of BLOCKS) {
      for (const line of b.lines) {
        const w = cellWidth(line);
        if (w > MAX_CELLS) bad.push(`${b.file}: ${w.toFixed(1)} 格 — ${JSON.stringify(line.slice(0, 24))}…`);
      }
    }
    expect(bad, `图比正文列还宽：\n${bad.join('\n')}`).toEqual([]);
  });

  it('配置契约：```flow 仍被排除出 Shiki（否则图会被染上 github-dark 的 inline 样式）', () => {
    const cfg = readFileSync(join(process.cwd(), 'astro.config.mjs'), 'utf-8');
    expect(cfg, 'astro.config.mjs 不再把 flow 排除出 Shiki').toMatch(/excludeLangs:\s*\[\s*'flow'\s*\]/);
  });
});

/**
 * 图的可读度量（防「字粘在一起」）—— 2026-09-11 作者回报「字都粘一起了」后补的守卫。
 *
 * 为何必须有它：字符图的对齐靠「全角格」，可读性靠「墨隙」，但**这两件事都能靠眼睛放过**——
 * 第一版为了导轨（│）连成不断开的竖线，把行高压成了 1em（12px）；而 Zpix 汉字墨高
 * 0.9167 em（11px）→ 行间墨隙只剩 **1px**，于是图能对齐、导轨也连，却扇了「字粘一起」。
 * 当时全部守线都绿（字形覆盖 / 缩进 / 行宽 / 图块非空 —— 都是几何与字符集断言，没有一条量行距）。
 *
 * 度量口径（全部来自字体文件，不靠看图）：
 *   · 行间墨隙 = 行高 − 文字最大墨高，要求 ≥ 8px（≈ 0.67 em @12px）——
 *     下限不是「不粘」（3px）而是「不紧」：16px 行高（5px 墨隙）曾被作者复判「行间距近乎贴一起」
 *   · 字间墨隙 = advance − 墨宽，要求 ≥ 1.5px（仅文字字符，绘制符不算）
 *   · 行高必须落在 4px 阶（与全局排版契约一致）
 */
describe('字符图的可读度量（行距 / 字距，防「字粘在一起」）', () => {
  const { size, lineHeight } = flowTypography();
  const textChars = [...new Set(BLOCKS.flatMap((b) => b.lines.join('').split('')).filter((ch) => !/\s/.test(ch) && !isDrawing(ch.codePointAt(0)!)))];
  const maxInkH = Math.max(...textChars.map((ch) => glyphInk(ch, size).inkH));
  const minGap = Math.min(...textChars.map((ch) => glyphInk(ch, size).gap));

  it('行高落在 4px 阶（与全局排版契约一致）', () => {
    expect(lineHeight % 4, `行高 ${lineHeight}px 不是 4px 阶`).toBe(0);
  });

  it(`行间墨隙 ≥ 8px（当时 ${lineHeight}px − 墨高 ${maxInkH.toFixed(2)}px = ${(lineHeight - maxInkH).toFixed(2)}px）`, () => {
    expect(
      lineHeight - maxInkH,
      `行高 ${lineHeight}px 减去文字墨高 ${maxInkH.toFixed(2)}px 只剩 ${(lineHeight - maxInkH).toFixed(2)}px → 行距过紧（「字粘在一起」/「近乎贴一起」）`,
    ).toBeGreaterThanOrEqual(8);
  });

  it(`字间墨隙 ≥ 1.5px（当前最小 ${minGap.toFixed(2)}px，来自 ${textChars.filter((c) => glyphInk(c, size).gap === minGap).join('')}）`, () => {
    expect(minGap, `图内最小字间墨隙 ${minGap.toFixed(2)}px → 字与字贴住`).toBeGreaterThanOrEqual(1.5);
  });

  it('不得使用侦赖纵向连续的绘制符（│┌└├…：它们要求行高 ≤ 墨高，与上面的行距要求互斥）', () => {
    const bad: string[] = [];
    for (const b of BLOCKS) {
      for (const line of b.lines) {
        const hit = line.match(new RegExp(VERTICAL_RAIL, 'g'));
        if (hit) bad.push(`${b.file}: ${JSON.stringify(line.slice(0, 16))}… 用了 ${[...new Set(hit)].join(' ')}`);
      }
    }
    expect(bad, `图中出现纵向导轨符（它会把行高逼回 1em）：\n${bad.join('\n')}`).toEqual([]);
  });

  /**
   * 反例自检（常驻）：把行高取成 1em（= 字号）时，上面那条行间墨隙度量必须判为「粘」。
   * 没有这一条，读者无法判断上面是真的在量还是恒绿 —— 2026-09-10 那次
   * 「箭头不被挖空板切掉」的守卫就是因为属性取错而恒绿了一整天。
   */
  it('反例自检：行高 1em 时必须判为「紧」（否则本条度量是恒绿的）', () => {
    expect(size - maxInkH, `字号 ${size}px − 墨高 ${maxInkH.toFixed(2)}px = ${(size - maxInkH).toFixed(2)}px 应 < 8`).toBeLessThan(8);
  });
});
