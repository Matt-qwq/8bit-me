import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MODES, relativeLuminance } from '../../src/lib/themes';

/**
 * 装饰层预算（texture budget）—— ADR-0021 版
 *
 * 「天光房间」后全站只剩**一层**常驻装饰：墙面水平色带（body::before，
 * echo 窗外天空的色带语法）。旧 PCB 斜网格与 CRT 扫描线已随 ADR-0021 退役。
 *
 * 预算四条（阈值沿 ADR-0015）：
 * ① 对底对比度 ≤1.55:1 —— 本文件守
 * ② 层数 ≤2 —— 现在实际是 1（本文件顺带守：global.css 里 body::before 只声明一次）
 * ③ 无语义承载 / ④ 遮罩后结构不变 —— tests/e2e/texture-mask.spec.ts 守
 */

const ROOT = process.cwd();
const CSS = readFileSync(join(ROOT, 'src/styles/global.css'), 'utf-8').replace(/\r\n/g, '\n');

/** 从 :root 取墙面色带 token 的 color-mix 百分比 */
function wallAlpha(): number {
  const m = /--wall-band:\s*color-mix\(in srgb, var\(--c-text\)\s+(\d+(?:\.\d+)?)%/.exec(CSS);
  if (!m) throw new Error('未找到 --wall-band 的 color-mix 定义（契约失效）');
  return Number(m[1]) / 100;
}

/** sRGB 合成：over(前景, 底色, alpha) —— 与 CSS color-mix 同口径 */
function over(fg: string, bg: string, alpha: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const f = p(fg);
  const b = p(bg);
  return (
    '#' +
    f.map((v, i) => Math.round(v * alpha + b[i]! * (1 - alpha)).toString(16).padStart(2, '0')).join('')
  );
}

function ratio(a: string, b: string): number {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/** 预算阈值（与 docs/specs/line-hierarchy.md 一致） */
const MAX_LAYER_RATIO = 1.55;

describe('墙面色带：装饰层预算（ADR-0021）', () => {
  it('对底对比度 ≤1.55:1（两档模式全过）', () => {
    const a = wallAlpha();
    for (const m of MODES) {
      const band = over(m.colors.text, m.colors.bg, a);
      const r = ratio(band, m.colors.bg);
      expect(r, `${m.key} 墙面色带过重（${r.toFixed(2)}）`).toBeLessThanOrEqual(MAX_LAYER_RATIO);
      expect(r, `${m.key} 墙面色带完全不可见`).toBeGreaterThan(1.0);
    }
  });

  it('极性契约：取 --c-text（与底色对比的槽），不许改用 --c-bg（会与底同色而不可见）', () => {
    expect(CSS).toMatch(/--wall-band:\s*color-mix\(in srgb, var\(--c-text\)/);
    expect(CSS).not.toMatch(/--wall-band:\s*color-mix\(in srgb, var\(--c-bg\)/);
  });

  it('全站常驻装饰层 = 1 层（body::before 只声明一次；CRT 扫描线已退役不得复活）', () => {
    const decls = CSS.match(/^body::before/gm) ?? [];
    expect(decls.length).toBe(1);
    expect(CSS).not.toMatch(/--crt-scan|--crt-vignette/);
  });

  it('无 color-mix 回退块里墙面退化为 transparent（老浏览器宁可素底也不超预算）', () => {
    const block = /@supports not \(color: color-mix[\s\S]*?\n\}/.exec(CSS)?.[0];
    expect(block).toBeTruthy();
    expect(block).toMatch(/--wall-band:\s*transparent/);
  });

  it('旧机制退役：PCB 斜网格 / 冲压铭牌角点不再出现', () => {
    expect(CSS).not.toMatch(/repeating-linear-gradient\(45deg/);
    expect(CSS).not.toMatch(/\.pp-pad/);
  });
});
