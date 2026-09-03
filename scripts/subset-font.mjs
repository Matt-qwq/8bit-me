/**
 * Zpix 子集化：扫本站实际用字 → 产出 zpix.subset.woff2（体积砍 90%+，消 layout shift）。
 * 全量 ttf 仍保留作 fallback（global.css @font-face 第二 src），新博文漏字时退 ttf。
 *
 * 接入：package.json "build" 前置 `node scripts/subset-font.mjs && astro build`。
 * 依赖：fontkit（devDependency）。本机无 fonttools，走纯 node 路径。
 *
 * 注：脚本为构建期产物生成器，非日常调试工具（与 cdn-*.mjs 历史探针区分）。
 */
import { readFileSync, readdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as fontkit from 'fontkit';

const ROOT = dirname(fileURLToPath(import.meta.url)) + '/..';
const SRC_FONT = join(ROOT, 'public/fonts/zpix.ttf');
const OUT_FONT = join(ROOT, 'public/fonts/zpix.subset.woff2');

/** 递归收集目录下所有文件 */
function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}

/** 扫描源文件文本，抽取去重字符集 */
function collectChars() {
  const dirs = [
    join(ROOT, 'src/content/blog'),
    join(ROOT, 'src/pages'),
    join(ROOT, 'src/components'),
    join(ROOT, 'src/layouts'),
  ];
  const files = [];
  for (const d of dirs) if (existsSync(d)) files.push(...walk(d));
  // 单独加配置（非 .astro 扩展名，walk 不会漏但显式列）
  const configFile = join(ROOT, 'src/lib/config.ts');
  if (existsSync(configFile)) files.push(configFile);

  const set = new Set();
  for (const f of files) {
    let text;
    try {
      text = readFileSync(f, 'utf8');
    } catch {
      continue;
    }
    for (const ch of text) set.add(ch);
  }
  // 补基础 ASCII 可见字符 + 常用 CJK 标点（防模板动态拼接漏字）
  for (let c = 0x20; c <= 0x7e; c++) set.add(String.fromCharCode(c));
  const extra = '，。、；：？！“”‘’（）《》【】〈〉—…·「」『』　-—–•·×÷';
  for (const ch of extra) set.add(ch);
  return set;
}

function main() {
  if (!existsSync(SRC_FONT)) {
    console.error('[subset-font] 源字体缺失：', SRC_FONT);
    process.exit(1);
  }
  const chars = collectChars();
  const font = fontkit.openSync(SRC_FONT);
  const subset = font.createSubset();

  // fontkit 2.x：subset 接受 glyph 对象数组（subset.glyphs），按 code point 取字形。
  const glyphs = [];
  let missing = 0;
  for (const ch of chars) {
    const code = ch.codePointAt(0);
    if (code === undefined) continue;
    const glyph = font.glyphForCodePoint(code);
    if (glyph && glyph.id !== 0) {
      glyphs.push(glyph);
    } else {
      missing++;
    }
  }
  subset.glyphs = glyphs;

  const buf = subset.encode({ glyphs: true }); // Uint8Array (woff2)
  writeFileSync(OUT_FONT, buf);

  const before = statSync(SRC_FONT).size;
  const after = buf.length;
  console.log(
    `[subset-font] 字表 ${chars.size} 字 / 含 ${glyphs.length} / 缺 ${missing} → ` +
      `${OUT_FONT} (${(after / 1024).toFixed(1)}KB, 原 ttf ${(before / 1024 / 1024).toFixed(2)}MB)`
  );
}

main();
