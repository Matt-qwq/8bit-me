import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 线语言契约 —— 「天光房间」版（ADR-0021）
 *
 * 旧「四档白名单」（结构线 2/4px、通电 3px、PCB 语言）随机箱叙事一并退役。
 * 新线语言只有两条：
 *   ① 结构线 = 1px 地平线（--c-line），面板顶缘 2px 受光带（--c-accent）
 *   ② 焦点环 = 2px accent（无障碍）
 * 4px 及以上的实线只允许出现在「插画内部」（CrtTerminal 的终端插画壳——
 * 那是画面，不是 UI 线）。
 */

const ROOT = process.cwd();

function readText(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf-8').replace(/\r\n/g, '\n');
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(astro|css)$/.test(entry.name)) out.push(relative(ROOT, full).split(sep).join('/'));
  }
  return out;
}

const FILES = walk(join(ROOT, 'src')).sort();

/** 声明 = {file, line, prop, value, selector}，.astro 只取 <style> 块 */
interface Decl {
  file: string;
  line: number;
  prop: string;
  value: string;
  selector: string;
}

function collect(): Decl[] {
  const out: Decl[] = [];
  for (const file of FILES) {
    const src = readText(file);
    const regions: { text: string; offset: number }[] = [];
    if (file.endsWith('.css')) regions.push({ text: src, offset: 0 });
    else {
      const re = /<style[^>]*>([\s\S]*?)<\/style>/g;
      for (let m = re.exec(src); m; m = re.exec(src)) {
        const head = src.slice(0, m.index + m[0].indexOf('>') + 1);
        regions.push({ text: m[1] ?? '', offset: head.split('\n').length - 1 });
      }
    }
    for (const { text, offset } of regions) {
      const re = /([a-z-]+)\s*:\s*([^;{}]+);/gi;
      for (let m = re.exec(text); m; m = re.exec(text)) {
        const before = text.slice(0, m.index);
        // 选择器 = 最近一个 `}`（或开头）到最近一个 `{` 之间的文本——
        // 取「最近 { 之后」会把同块内前一条声明算进 selector（旧版实踩）。
        const close = before.lastIndexOf('}');
        const open = before.lastIndexOf('{');
        const sel = (open > close ? before.slice(close + 1, open) : '')
          .replace(/[\r\n]+/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        out.push({
          file,
          line: before.split('\n').length + offset,
          prop: m[1]!.toLowerCase(),
          value: m[2]!.trim(),
          selector: sel.slice(-160),
        });
      }
    }
  }
  return out;
}

const DECLS = collect();

/** 插画白名单：这些文件里的粗边框是画面的一部分，不受 UI 线语言约束 */
const ILLUSTRATION_FILES = ['src/components/CrtTerminal.astro'];

describe('线语言：宽度', () => {
  it('UI 边框宽度 ∈ {1, 2}px；更粗的线只允许出现在插画白名单内', () => {
    const bad = DECLS.filter((d) =>
      /^border(-(top|right|bottom|left))?(-width)?$/.test(d.prop)
    )
      .filter((d) => !ILLUSTRATION_FILES.some((f) => d.file.startsWith(f)))
      .map((d) => ({ ...d, w: /(\d+(?:\.\d+)?)px/.exec(d.value)?.[1] }))
      .filter((d) => d.w && Number(d.w) > 2)
      .map((d) => `${d.file}:${d.line} ${d.prop}: ${d.value}`);
    expect(bad, `UI 边框超过 2px：\n${bad.join('\n')}`).toEqual([]);
  });

  it('焦点环（outline）= 2px，无障碍不可降级', () => {
    const outlines = DECLS.filter((d) => d.prop === 'outline');
    expect(outlines.length, '全站应有显式焦点环声明').toBeGreaterThan(0);
    for (const d of outlines) {
      const w = /(\d+(?:\.\d+)?)px/.exec(d.value)?.[1];
      if (w) expect(Number(w), `${d.file}:${d.line} outline: ${d.value}`).toBe(2);
    }
  });

  it('面板顶缘受光带：.pixel-panel 的 border-top 必须是 2px accent（地平线受光）', () => {
    const tops = DECLS.filter(
      (d) => d.prop === 'border-top' && d.selector.includes('.pixel-panel')
    );
    expect(tops.length, '.pixel-panel 应有显式 border-top').toBeGreaterThan(0);
    for (const d of tops) {
      expect(d.value, `${d.file}:${d.line} 面板顶缘不是 2px accent`).toMatch(
        /2px solid var\(--c-accent\)/
      );
    }
  });
});

describe('线语言：颜色（不引第五色）', () => {
  it('border / outline 声明只用语义槽 token（--c-*），零字面量颜色', () => {
    const bad = DECLS.filter((d) => /^border(-(top|right|bottom|left))?(-width)?$|^outline$/.test(d.prop))
      .map((d) => ({ ...d, literal: /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/.exec(d.value)?.[0] }))
      .filter((d) => d.literal)
      .map((d) => `${d.file}:${d.line} ${d.prop}: ${d.value}`);
    expect(bad, `边框/焦点环引了字面量颜色：\n${bad.join('\n')}`).toEqual([]);
  });
});
