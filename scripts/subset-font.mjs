/**
 * Zpix 子集化：扫本站源码用字 → 自写 sfnt 子集 + 自写 woff2 容器 → public/fonts/zpix.subset.woff2
 *
 * 全量 ttf 仍是 @font-face 的第二 src，但它**不兜缺字**（2026-09-10 独立评审实测推翻了
 * 这里的旧说法）：`src` 列表不是逐字回退，只是同一个 face 的多个来源；woff2 一旦加载成功，
 * face 里没有的字会落到 `font-family` 栈的**下一个字体**（本站 = 系统黑体），
 * **不会去下 zpix.ttf**。第二 src 真正兜的是「子集不可解析 / 404」——
 * 评审实测：4 个结构坏掉的变体正是靠它兜成「页面看着一样，只是每页多下 7 MB」。
 * 真代价是：子集缺字时标识层里会冒出一个系统黑体字，肉眼几乎看不出、测试也不红。
 * 两道防线：① 本脚本的字集口径（源码全量 + HTML 实体解码，见 collectChars）；
 * ② `tests/e2e/font.spec.ts` 的「Zpix 层逐字 canvas 与回退字体比对」（缺字直接判红）。
 *
 * 接入：package.json "build" 前置 `node scripts/subset-font.mjs && astro build`。
 * 依赖：**零新增**——sfnt/woff2 读写都在 scripts/font-subset/（纯 node，内置 zlib brotli）。
 * fontkit 仍留在 devDependencies，但只服务 tests/unit/font-coverage.spec.ts。
 *
 * 为什么不再用 fontkit（2026-09-10 作者发现的静默回归）：
 *   fontkit 2.0.4 的 `subset.encode()` 返回的是**裸 sfnt**（首 4 字节 `true`）而不是
 *   woff2，且 `glyf` 表长 0。文件被命名为 `.woff2` 后浏览器 `NetworkError`，
 *   @font-face 静默回退到 7.18 MB 的 zpix.ttf —— **每页多下 7 MB**，
 *   而当时 43 条测试全绿。产物自检闸（下面 verifySubsetArtifact）就是为此设的：
 *   写出后回读产物、解压、验 cmap，任一条不过 exit(1)，不再产出「静默坏件」。
 *
 * 字集口径：**src 全量扫描（渲染文本的超集）**，不从 dist 反推。
 *   理由：本脚本在 `astro build` **之前**跑，此刻 dist 是上一次的产物（陈旧）——
 *   用 dist 反推会让「新写的博文用字」漏进不了子集，正是我们要消灭的那类静默回退。
 *   代价是多收一批只出现在注释里的字（实测 +5.8 KB / woff2 63.5 KB vs 57.7 KB，
 *   均为全量 TTF 的 0.9% 以内）。另注：dist 里根本没有 CSS `content:` 画的字形，
 *   而 font-coverage 的 icon 正则只兜住一部分，所以 src 口径不仅更稳，也更全。
 */
import { existsSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { subsetSfnt, auditSfntStructure } from './font-subset/sfnt.mjs';
import { buildWoff2, parseWoff2, reconstructSfnt, checkSumAdjustmentOf } from './font-subset/woff2.mjs';
import { parseCmap } from './font-subset/cmap.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url)) + '/..';
const SRC_FONT = join(ROOT, 'public/fonts/zpix.ttf');
const OUT_FONT = join(ROOT, 'public/fonts/zpix.subset.woff2');

/**
 * 产物体积上限（自检闸用），两条并用（评审 M8：单条硬编码上限将来收 CJK 扩展集时会误杀）：
 *   ① 相对全量 TTF 的比例 —— 这条是「子集」定义的本身（实测 63.6 KB / 7.18 MB = 0.89%）；
 *   ② 绝对上限 —— 兜底，防止将来源字体变小 / 口径口子开了之后比例判定失效。
 * 上限不是性能预算，是**坏件探测器**：正常子集离 150 KB 还有一个量级。
 */
const MAX_ARTIFACT_BYTES = 150_000;
const MAX_ARTIFACT_RATIO = 0.05;

const SCAN_EXTS = /\.(astro|ts|md|mdx|css|json)$/;

/** 递归收集目录下所有文件 */
export function walk(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}

/**
 * HTML 命名实体表（本站可能用到的那些；表外的名字就不展开，宁可多收字不可漏）。
 * 实体解码是必须的：源码里写的是 ASCII 的 `&larr;`，**渲染出来的是 `←`** ——
 * 评审 M3：本站 3 处 `text-pixel` 元素（blog/tags/index.astro:29、
 * blog/tags/[tag].astro:50、blog/index.astro:34）用的就是实体，当时只是因为别处
 * 有字面箭头而侥幸被覆盖；换一个没被字面用过的实体（`&darr;` / `&#x2713;`）
 * 就是**静默缺字**。
 */
const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', copy: '\u00a9',
  reg: '\u00ae', trade: '\u2122', sect: '\u00a7', para: '\u00b6', deg: '\u00b0',
  plusmn: '\u00b1', times: '\u00d7', divide: '\u00f7', middot: '\u00b7', laquo: '\u00ab',
  raquo: '\u00bb', lsquo: '\u2018', rsquo: '\u2019', ldquo: '\u201c', rdquo: '\u201d',
  ndash: '\u2013', mdash: '\u2014', hellip: '\u2026', bull: '\u2022', dagger: '\u2020',
  prime: '\u2032', Prime: '\u2033', permil: '\u2030', larr: '\u2190', uarr: '\u2191',
  rarr: '\u2192', darr: '\u2193', harr: '\u2194', minus: '\u2212', infin: '\u221e',
  radic: '\u221a', ne: '\u2260', le: '\u2264', ge: '\u2265', check: '\u2713',
  cross: '\u2717', star: '\u2605', starf: '\u2606', spades: '\u2660', clubs: '\u2663',
  hearts: '\u2665', diams: '\u2666',
};

/** 把 HTML 实体解成真字符（`&name;` / `&#123;` / `&#x1F;`）；认不出的保持原样 */
export function decodeHtmlEntities(text) {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, body) => {
    if (body[0] === '#') {
      const hex = body[1] === 'x' || body[1] === 'X';
      const cp = parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
      if (!Number.isInteger(cp) || cp <= 0 || cp > 0x10ffff) return whole;
      return String.fromCodePoint(cp);
    }
    return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, body)
      ? NAMED_ENTITIES[body]
      : whole;
  });
}

/**
 * 扫描 src/ 全量源码用字（渲染文本的超集）。
 * 剥掉 frontmatter 的 `cover:` 行（封面 seed 的 emoji 不作文本渲染，与
 * tests/unit/font-coverage.spec.ts 同口径），解开 HTML 实体（渲染口径），
 * 再补基础 ASCII + 常用 CJK 标点（防运行期拼接的字符漏网）。
 */
export function collectChars(root = ROOT) {
  const set = new Set();
  for (const file of walk(join(root, 'src'))) {
    if (!SCAN_EXTS.test(file)) continue;
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const stripped = text.replace(/^\s*cover:.*$/gm, ' ');
    for (const ch of stripped) set.add(ch);
    for (const ch of decodeHtmlEntities(stripped)) set.add(ch);
  }
  for (let c = 0x20; c <= 0x7e; c++) set.add(String.fromCharCode(c));
  const extra = '，。、；：？！“”‘’（）《》【】〈〉—…·「」『』　-—–•·×÷';
  for (const ch of extra) set.add(ch);
  return set;
}

/**
 * 产物自检闸：**回读磁盘上的产物**再解析一遍，不信任写出时的内存变量。
 * 这层是 2026-09-10 那次静默坏件的直接对策：假 woff2 能过 build、能过单测、
 * 能过截图，只有真去解压它才发现得了。
 *
 * 2026-09-10 独立评审又把这道闸往前推了一层：**原来它只认容器、不认字形**。
 * 实测 6 个「容器合法、内部结构坏」的变体里 5 个被放行，浏览器端 4 个 NetworkError
 * 后静默回退 7,179,288 B 全量 TTF，1 个（loca 全 0）被接受但**字全是空白**，
 * 而 `Zpix:loaded` / 体积护栏 / e2e 宽度断言全部绿。现在三条防线：
 *   ① 容器（魔数 / header.length / 解压长度 == Σ表长 / 补 4 字节）
 *   ② 结构（解码回 sfnt 后跑 `auditSfntStructure`：numGlyphs ↔ loca ↔ hmtx、
 *      loca 单调且末项 == glyf 表长、cmap gid 不越界、映射字形里空字形 ≤ 20）
 *   ③ 覆盖（cmap ⊇ `targetCodepoints`）+ csa 对重建布局成立
 * 异常安全（评审 M5）：任何一层抛栈都被收成 problems，不再让 `RangeError` 冲穿整个
 * 构建（旧写法下 `parseCmap` 在 try 之外，一遇到坏 cmap 就抛栈，连带 tmp 残留）。
 *
 * @param {Buffer} woff2Buf 产物字节
 * @param {Iterable<number>} targetCodepoints 必须被 cmap 覆盖的码点。
 *   传「字集 ∩ 源字体有字形」（`subset.wantedMapped`），**不要传 `subset.mapped`**：
 *   后者就是写出去的那一份，用它当目标集是自证式断言（评审 M6）。
 * @returns {{ok:boolean, problems:string[], details:Record<string,unknown>}}
 */
export function verifySubsetArtifact(woff2Buf, targetCodepoints) {
  const problems = [];
  const details = {};
  if (woff2Buf.length > MAX_ARTIFACT_BYTES) {
    problems.push(`产物 ${woff2Buf.length} B 超过上限 ${MAX_ARTIFACT_BYTES} B（容器或子集错了）`);
  }
  if (existsSync(SRC_FONT)) {
    const fullBytes = statSync(SRC_FONT).size;
    const ratio = woff2Buf.length / fullBytes;
    details.ratioToFullTtf = Number(ratio.toFixed(5));
    if (ratio > MAX_ARTIFACT_RATIO) {
      problems.push(
        `产物 ${woff2Buf.length} B = 全量 TTF 的 ${(ratio * 100).toFixed(2)}%（上限 ` +
          `${(MAX_ARTIFACT_RATIO * 100).toFixed(0)}%）——这已经不是子集了`
      );
    }
  }
  let parsed = null;
  try {
    parsed = parseWoff2(woff2Buf); // 内含：魔数 / header.length 一致 / UIntBase128 / 解压长度 == Σ表长
  } catch (err) {
    problems.push(`产物不是可解析的 woff2：${err.message}`);
  }
  if (parsed) {
    details.length = parsed.length;
    details.numTables = parsed.numTables;
    details.streamLength = parsed.streamLength;
    details.totalCompressedSize = parsed.totalCompressedSize;
    details.paddingBytes = parsed.paddingBytes;
    if (parsed.length % 4 !== 0) {
      // spike ④-2：文件不补 4 字节 / header.length 不记补齐 → Chrome 与
      // google/woff2 参考解码器直接拒（而 fonttools 照样解得开，是假绿）
      problems.push(`header.length=${parsed.length} 不是 4 的倍数`);
    }
    for (const tag of ['cmap', 'glyf', 'loca', 'hmtx', 'head', 'hhea', 'maxp']) {
      if (!parsed.tables.has(tag)) problems.push(`产物缺表 ${tag}`);
    }
    const cmapRec = parsed.tables.get('cmap');
    if (cmapRec) {
      // ⚠ 必须包 try：坏 cmap 会让 parseCmap 抛 RangeError（评审 M5 实测）
      try {
        const cmap = parseCmap(cmapRec.data, { offset: 0 });
        details.cmapSize = cmap.size;
        const missing = [...targetCodepoints].filter((cp) => !cmap.has(cp));
        details.missingInArtifact = missing.length;
        if (missing.length) {
          const head = missing
            .slice(0, 10)
            .map((cp) => `U+${cp.toString(16).toUpperCase()}`)
            .join(' ');
          problems.push(`产物 cmap 缺 ${missing.length} 个目标码点（前几个：${head}）`);
        }
      } catch (err) {
        problems.push(`产物 cmap 解析失败：${err.message}`);
      }
    }
    // 结构自检：解码回 sfnt 后逐条查内部一致性（评审 M2 第 2 步）
    try {
      const audit = auditSfntStructure(reconstructSfnt(parsed), {
        mappedCodepoints: targetCodepoints,
      });
      Object.assign(details, audit.details);
      problems.push(...audit.problems);
    } catch (err) {
      problems.push(`产物结构自检抛异常（解码/解析失败）：${err.message}`);
    }
    // csa：存进 head 的那份必须对「解码器按 woff2 目录序重建的布局」成立（评审 M7）
    if (parsed.tables.has('head')) {
      try {
        const csa = checkSumAdjustmentOf(parsed);
        details.checkSumAdjustment = csa;
        if (!csa.ok) {
          problems.push(
            `head.checkSumAdjustment=0x${(csa.stored >>> 0).toString(16).toUpperCase()} ` +
              `对重建布局不成立（应为 0x${(csa.expected >>> 0).toString(16).toUpperCase()}）`
          );
        }
      } catch (err) {
        problems.push(`checkSumAdjustment 校验抛异常：${err.message}`);
      }
    }
  }
  return { ok: problems.length === 0, problems, details };
}

/**
 * 写 tmp → 回读自检 → 过了才原子替换产物。
 *
 * 把这段独立出来是为了可测（评审 M5）：旧写法里 `unlinkSync(tmpPath)` 只在 `!ok`
 * 分支执行，自检抛栈的路径会留下 `public/fonts/zpix.subset.woff2.tmp` ——
 * `.gitignore` 没有 `*.tmp` 规则，而 `astro build` 会把 `public/` 原样拷进 `dist/`，
 * 残留的 tmp 会被一起部署出去。这里用 `finally` 保证任何失败路径都不留残留。
 * （注意：不能靠 `finally` 包 `process.exit()` —— 它不展开栈，finally 不执行。）
 *
 * @returns {{ok:boolean, problems:string[], details:Record<string,unknown>, bytes:number}}
 */
export function publishArtifact(
  woff2Buf,
  targetCodepoints,
  { outPath = OUT_FONT, verify = verifySubsetArtifact } = {}
) {
  const tmpPath = outPath + '.tmp';
  let result;
  try {
    writeFileSync(tmpPath, woff2Buf);
    const written = readFileSync(tmpPath);
    const check = verify(written, targetCodepoints);
    result = { ...check, bytes: written.length };
    if (check.ok) renameSync(tmpPath, outPath);
  } finally {
    if (existsSync(tmpPath)) unlinkSync(tmpPath);
  }
  return result;
}

/** emoji / 变体选择符等「本就不由字体渲染」的码点（Zpix 无字形属正常，不刷日志） */
export function isEmojiish(cp) {
  return (
    (cp >= 0x1f000 && cp <= 0x1faff) ||
    cp === 0xfe0f ||
    cp === 0x200d ||
    (cp >= 0x2600 && cp <= 0x27bf) ||
    (cp >= 0x2b00 && cp <= 0x2bff)
  );
}

function main() {
  if (!existsSync(SRC_FONT)) {
    console.error('[subset-font] 源字体缺失：', SRC_FONT);
    process.exit(1);
  }
  const t0 = Date.now();
  const srcBuf = readFileSync(SRC_FONT);
  const chars = collectChars();
  const codepoints = [...chars]
    .map((ch) => ch.codePointAt(0))
    .filter((cp) => cp !== undefined && cp > 0x1f);

  const subset = subsetSfnt(srcBuf, codepoints);
  const woff2 = buildWoff2(subset.ttf);
  // 先写临时文件 → 回读自检 → 过了才原子替换产物（详见 publishArtifact）。
  // 直接写目标再检查会把坏件留在被 git 跟踪的路径上（自检只在事后报错，
  // 文件已经被覆盖了）—— 那是「构建失败但产物已坏」的坏状态，这里避开它。
  // 目标集用 wantedMapped（字集 ∩ 源字体有字形），不是 mapped（写出去的那一份）。
  const check = publishArtifact(woff2, subset.wantedMapped);
  const written = { length: check.bytes };
  if (!check.ok) {
    console.error('[subset-font] 产物自检失败，拒绝产出坏件（原产物未动）：');
    for (const p of check.problems) console.error('  - ' + p);
    process.exit(1);
  }

  const before = statSync(SRC_FONT).size;
  const ms = Date.now() - t0;
  console.log(
    `[subset-font] 字集 ${chars.size} 字 / 码点 ${codepoints.length} / 字形 ${subset.glyphCount} / ` +
      `源字体无字形 ${subset.missing.length} → ` +
      `${(written.length / 1024).toFixed(1)}KB（全量 ttf ${(before / 1024 / 1024).toFixed(2)}MB，` +
      `压到 ${((written.length / before) * 100).toFixed(2)}%），${ms}ms，brotli 流 ${check.details.streamLength}B，` +
      `结构自检 glyphs=${check.details.numGlyphs} cmap=${check.details.cmapSize} ` +
      `空字形=${check.details.emptyMappedGlyphs}`
  );
  if (subset.missing.length) {
    // emoji 本来就该由系统 emoji 字体画，列出来只会淹没真正要看的缺字
    const actionable = subset.missing.filter((cp) => !isEmojiish(cp));
    const emoji = subset.missing.length - actionable.length;
    if (actionable.length) {
      console.log(
        `[subset-font] 源字体无字形的字符（浏览器会悄悄回退系统字体，见 ` +
          `tests/unit/font-coverage.spec.ts）：${actionable
            .map((cp) => `U+${cp.toString(16).toUpperCase()}`)
            .join(' ')}`
      );
    }
    if (emoji) console.log(`[subset-font] 另有 ${emoji} 个 emoji 码点无字形（预期内）`);
  }
}

// 直接执行才跑 main（tests/unit/subset-font.spec.ts 只 import 纯函数，不该触发写盘）
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
