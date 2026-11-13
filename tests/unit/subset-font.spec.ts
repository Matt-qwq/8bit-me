import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as fontkit from 'fontkit';
import { describe, expect, it } from 'vitest';
import {
  collectChars,
  decodeHtmlEntities,
  publishArtifact,
  verifySubsetArtifact,
} from '../../scripts/subset-font.mjs';
import { buildCmap4, parseCmap } from '../../scripts/font-subset/cmap.mjs';
import {
  isComposite,
  parseCompositeRefs,
  parseLoca,
  rebuildGlyf,
} from '../../scripts/font-subset/glyf.mjs';
import { assembleSfnt, parseSfnt, subsetSfnt } from '../../scripts/font-subset/sfnt.mjs';
import {
  buildWoff2,
  checkSumAdjustmentOf,
  parseWoff2,
  woff2ToSfnt,
} from '../../scripts/font-subset/woff2.mjs';

/**
 * 自写字体子集器（scripts/font-subset/）与它的产物契约。
 *
 * 为什么值得一整个 spec：2026-09-10 作者发现的全站静默回归里，`fontkit` 的
 * `subset.encode()` 产出了**首 4 字节 `true` 的裸 sfnt**（不是 woff2）且 `glyf`
 * 表长 0，被命名为 `.woff2` 后浏览器 `NetworkError` → @font-face 静默回退到
 * 7.18 MB 的 zpix.ttf，**每页多下 7 MB，而当时 43 条测试全绿**。
 * 这类坏件的共性是：文件存在、字节数不为 0、构建不报错，只有**真的去解压它**
 * 才发现。所以本文件每一层都直接解析产物字节，不看写出时的内存变量。
 *
 * 三层防线：
 *   ① 容器层：wOF2 魔数 / header.length 4 字节对齐 / brotli 解压长度 == Σ表长
 *   ② 覆盖层：产物 cmap ⊇ 当前源码用字（防「提交了陈旧产物」）
 *   ③ 字形层：逐码点用 fontkit 取 path/bbox/advanceWidth，与全量 Zpix 比对
 *      （复合字形另用系统 calibri.ttf 与合成字形覆盖）
 *
 * **2026-09-10 独立评审后的加固（四道新防线，都冲着「最后一环没人验」这个缺口）**：
 *   - 字形层不再比「内存里新算的 TTF」，而是比**磁盘产物解码回来的字形**
 *     （`woff2ToSfnt(artifactBuf)`）—— 容器层由此进入比对范围。
 *   - 闸门不再只认容器：`verifySubsetArtifact` 追加 5 条结构自检，下面用评审
 *     实测「原来全部放行」的变体逐个复现。
 *   - hmtx 的 (advance, lsb) **显式读**（fontkit 的 path/bbox 不含 lsb，拿它比对会假绿）。
 *   - 字集口径解开 HTML 实体（源码里是 `&larr;`，渲染出来是 `←`）。
 */

const ROOT = process.cwd();
const FULL_TTF = join(ROOT, 'public/fonts/zpix.ttf');
const ARTIFACT = join(ROOT, 'public/fonts/zpix.subset.woff2');

// 本机 Windows 字体：跑不在 / 文件不在就 skip（不假绿）
const CALIBRI = 'C:/Windows/Fonts/calibri.ttf';
const CONSOLA = 'C:/Windows/Fonts/consola.ttf';
const hasCalibri = existsSync(CALIBRI);
const hasConsola = existsSync(CONSOLA);

/**
 * 显式读 hmtx 的逐字形 (advanceWidth, lsb)。
 * gid ≥ numberOfHMetrics 时 advanceWidth 沿用最后一条，但 **lsb 在表尾的数组里**
 * （`numHMetrics*4 + (gid-numHMetrics)*2`）—— 改前的子集器把 lsb 也当成「沿用最后一条」，
 * 对 consola.ttf 读错 353 个字形（评审 M1 实测）。
 */
function hmtxRecords(buf: Buffer): {
  numGlyphs: number;
  numberOfHMetrics: number;
  records: { advance: number; lsb: number }[];
} {
  const sf = parseSfnt(buf);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const numGlyphs = dv.getUint16(sf.tables.get('maxp')!.offset + 4);
  const numberOfHMetrics = dv.getUint16(sf.tables.get('hhea')!.offset + 34);
  const h = sf.tables.get('hmtx')!.data;
  const d = new DataView(h.buffer, h.byteOffset, h.byteLength);
  const records: { advance: number; lsb: number }[] = [];
  for (let g = 0; g < numGlyphs; g++) {
    records.push(
      g < numberOfHMetrics
        ? { advance: d.getUint16(g * 4), lsb: d.getInt16(g * 4 + 2) }
        : {
            advance: d.getUint16((numberOfHMetrics - 1) * 4),
            lsb: d.getInt16(numberOfHMetrics * 4 + (g - numberOfHMetrics) * 2),
          }
    );
  }
  return { numGlyphs, numberOfHMetrics, records };
}

/**
 * 从一份（好的）子集 ttf 造一个「容器合法、内部结构坏」的 woff2。
 * 评审就是拿这类变体实测出「闸门只认容器、不认字形」的：6 个里 5 个放行，
 * 浏览器端 4 个 NetworkError → 静默回退 7,179,288 B 全量 TTF，
 * 1 个（loca 全 0）被接受但字全画空白。
 */
function mutateArtifact(ttfBuf: Buffer, fn: (tables: Map<string, Buffer>) => void): Buffer {
  const sf = parseSfnt(ttfBuf);
  const map = new Map<string, Buffer>(
    sf.order.map((t) => [t, Buffer.from(sf.tables.get(t)!.data)])
  );
  fn(map);
  // 质量降到 4：这些变体只用来验「闸门拦不拦」，压缩率无关（q11 每个要 1s+）
  return buildWoff2(assembleSfnt(sf.flavor, map), { quality: 4 });
}

const fullTtfBuf = readFileSync(FULL_TTF);
const artifactBuf = readFileSync(ARTIFACT);

/** 产物必须覆盖的码点：源码用字里源字体真正有字形的那些（缺字由 font-coverage 守） */
function asFont(file: fontkit.Font | fontkit.FontCollection, label: string): fontkit.Font {
  if (!('glyphForCodePoint' in file)) throw new Error(`${label} 应为单个字体文件，而非字体集合`);
  return file;
}
const fullFont = asFont(fontkit.create(fullTtfBuf), 'public/fonts/zpix.ttf');
const charsetCodepoints = [...collectChars()]
  .map((ch) => ch.codePointAt(0)!)
  .filter((cp) => cp > 0x1f);
const renderableCodepoints = charsetCodepoints.filter((cp) => {
  const g = fullFont.glyphForCodePoint(cp);
  return !!(g && g.id !== 0);
});

/** 分解后的轮廓命令串（复合字形经 fontkit 已展开为坐标，不会记组件名 → 无假阳性） */
const pathOf = (g: { path: { commands: { command: string; args: number[] }[] } }): string =>
  g.path.commands.map((c) => `${c.command}:${c.args.join(',')}`).join('|');
const bboxOf = (g: { bbox: { minX: number; minY: number; maxX: number; maxY: number } }): string =>
  [g.bbox.minX, g.bbox.minY, g.bbox.maxX, g.bbox.maxY].join(',');

/** 用全量字体为参照，逐码点比对子集：返回不一致的码点（含原因） */
function glyphDiffs(
  full: fontkit.Font,
  sub: fontkit.Font,
  codepoints: Iterable<number>
): string[] {
  const bad: string[] = [];
  for (const cp of codepoints) {
    const a = full.glyphForCodePoint(cp);
    const b = sub.glyphForCodePoint(cp);
    const label = `U+${cp.toString(16).toUpperCase()}`;
    if (!a || !b) {
      bad.push(`${label} 缺失`);
      continue;
    }
    if (bboxOf(a) !== bboxOf(b)) bad.push(`${label} bbox ${bboxOf(a)} ≠ ${bboxOf(b)}`);
    if (pathOf(a) !== pathOf(b)) bad.push(`${label} 轮廓不一致`);
    if (a.advanceWidth !== b.advanceWidth) {
      bad.push(`${label} advance ${a.advanceWidth} ≠ ${b.advanceWidth}`);
    }
  }
  return bad;
}

describe('woff2 容器', () => {
  it('产物以 wOF2 开头、header.length 4 字节对齐、解压长度 == Σ表长', () => {
    // ① 魔数：现状坏件的首 4 字节是 `true`（裸 sfnt），这条先拦住它
    expect(artifactBuf.toString('latin1', 0, 4)).toBe('wOF2');
    // ② 4 字节对齐：spike ④-2 的坑 —— 不补齐时 Chrome 与 google/woff2 参考
    //    解码器都拒收，而 fonttools 照样解得开（只信它就会假绿）
    const headerLength = artifactBuf.readUInt32BE(8);
    expect(headerLength % 4, `header.length=${headerLength}`).toBe(0);
    expect(headerLength).toBe(artifactBuf.length);
    // ③ 解压长度 == Σ表长（parseWoff2 内部断言，这里再显式对一遍）
    const parsed = parseWoff2(artifactBuf);
    const sumTables = parsed.order.reduce((a, t) => a + parsed.tables.get(t)!.origLength, 0);
    expect(parsed.streamLength).toBe(sumTables);
    expect(parsed.stream.length).toBe(sumTables);
    // ④ 目录里必须认得出这几张表（缺一张就说明子集器漏了步骤）
    for (const tag of ['cmap', 'glyf', 'loca', 'hmtx', 'head', 'hhea', 'maxp', 'post']) {
      expect(parsed.tables.has(tag), `产物缺表 ${tag}`).toBe(true);
    }
    // ⑤ loca 必须紧跟 glyf（woff2 规范要求）
    expect(parsed.order.indexOf('loca')).toBe(parsed.order.indexOf('glyf') + 1);
  });

  it('产物远小于全量 TTF（现网每页 7 MB 的回归来自这个比值崩掉）', () => {
    expect(artifactBuf.length).toBeLessThan(100_000);
    expect(artifactBuf.length / fullTtfBuf.length).toBeLessThan(0.02);
  });

  it('自检闸 verifySubsetArtifact 对真产物放行、对坏产物拦截', () => {
    const ok = verifySubsetArtifact(artifactBuf, renderableCodepoints);
    expect(ok.problems, `自检闸报错：${ok.problems.join(' / ')}`).toEqual([]);
    expect(ok.ok).toBe(true);
    expect(ok.details.emptyMappedGlyphs, '真产物只该有 U+20 / U+3000 两个空字形').toBeLessThanOrEqual(
      20
    );

    // 坏件形态 1：现状那种「裸 sfnt 改名 .woff2」
    const bareSfnt = subsetSfnt(fullTtfBuf, renderableCodepoints).ttf;
    const asWoff2Name = verifySubsetArtifact(bareSfnt, renderableCodepoints);
    expect(asWoff2Name.ok).toBe(false);
    expect(asWoff2Name.problems.join()).toContain('不是可解析的 woff2');

    // 坏件形态 2：cmap 缺目标码点 → 浏览器静默回退，必须拦
    const missingHalf = verifySubsetArtifact(artifactBuf, [
      ...renderableCodepoints,
      0x10ffff,
    ]);
    expect(missingHalf.ok).toBe(false);
    expect(missingHalf.problems.join()).toContain('缺');

    // 坏件形态 3：字节被截断（写盘失败 / 被别的进程覆盖）
    expect(verifySubsetArtifact(artifactBuf.subarray(0, 64), renderableCodepoints).ok).toBe(false);
  });

  // 这条是 CPU 密集型：子集化一次 + 6 个坏件变体各自跑一轮 brotli q11 压缩。
  // 机器空闲时 ~3s，但有其它 node 进程压着就会顶穿 vitest 默认的 5s——
  // 2026-09-10 本站实测：空载过、7 个 node 进程在跑时稳定超时。
  // 给显式超时而不是缩测试：缩掉就守不住「6 类坏件全被拦」这个真实缺陷面。
  it('自检闸拦住「容器合法、内部结构坏」的一整类产物（评审实测这 6 个原来全放行）', { timeout: 30_000 }, () => {
    const { ttf } = subsetSfnt(fullTtfBuf, renderableCodepoints);
    const variants: [string, Buffer][] = [
      [
        'maxp.numGlyphs +100（loca / hmtx 数量对不上）',
        mutateArtifact(ttf, (m) => {
          const b = m.get('maxp')!;
          b.writeUInt16BE(b.readUInt16BE(4) + 100, 4);
        }),
      ],
      ['loca 全 0（字全画空白）', mutateArtifact(ttf, (m) => m.get('loca')!.fill(0))],
      [
        'glyf 截断到一半',
        mutateArtifact(ttf, (m) => {
          const g = m.get('glyf')!;
          m.set('glyf', g.subarray(0, g.length >> 1));
        }),
      ],
      [
        'hhea.numberOfHMetrics +500（hmtx 不够长）',
        mutateArtifact(ttf, (m) => {
          const b = m.get('hhea')!;
          b.writeUInt16BE(b.readUInt16BE(34) + 500, 34);
        }),
      ],
      [
        'head.indexToLocFormat 改回 0（loca 变短读）',
        mutateArtifact(ttf, (m) => m.get('head')!.writeInt16BE(0, 50)),
      ],
      [
        'cmap 段增量改坏（gid 越界）',
        mutateArtifact(ttf, (m) => {
          const b = m.get('cmap')!;
          const segX2 = b.readUInt16BE(8 + 6);
          const deltaO = 8 + 14 + segX2 + 2 + segX2;
          for (let s = 0; s < segX2 / 2; s++) b.writeUInt16BE(0x7fff, deltaO + s * 2);
        }),
      ],
    ];
    for (const [name, buf] of variants) {
      const r = verifySubsetArtifact(buf, renderableCodepoints);
      expect(r.ok, `变体【${name}】被放行了（details=${JSON.stringify(r.details)}）`).toBe(false);
      expect(r.problems.length, `变体【${name}】被拦但没给出理由`).toBeGreaterThan(0);
    }
  });

  it('产物 head.checkSumAdjustment 对「解码器重建布局」成立（M7）', () => {
    // 规范：整个 sfnt 的 32 位累加应为 0xB1B0AFBA。assembleSfnt 默认按 tag 字母序摆表，
    // 而 woff2 解码器按 woff2 表目录序重建（loca 紧跟 glyf）——存入的 csa 必须对后者成立。
    const parsed = parseWoff2(artifactBuf);
    expect(parsed.order.indexOf('loca')).toBe(parsed.order.indexOf('glyf') + 1);
    expect(checkSumAdjustmentOf(parsed)).toMatchObject({ ok: true });
    // 把产物里的 csa 抹成 0：校验必须红（改前的产物就是这种状态：字母序 csa 对重建布局不成立）
    parsed.tables.get('head')!.data.writeUInt32BE(0, 8);
    expect(checkSumAdjustmentOf(parsed).ok).toBe(false);
  });
});

describe('子集器产物覆盖与字形一致性', () => {
  it('产物 cmap ⊇ 当前源码用字（防「提交了陈旧产物」）', () => {
    const parsed = parseWoff2(artifactBuf);
    const cmap = parseCmap(parsed.tables.get('cmap')!.data, { offset: 0 });
    const missing = renderableCodepoints.filter((cp) => !cmap.has(cp));
    expect(
      missing.map((cp) => `U+${cp.toString(16).toUpperCase()}`),
      '产物 cmap 缺字 → 那些字会静默回退系统字体；重跑 node scripts/subset-font.mjs'
    ).toEqual([]);
  });

  it('产品字形与全量 Zpix 逐码点一致 —— 比的是**磁盘产物解码回来的字形**（M2 第一步）', () => {
    // 改前：这里比的是 `subsetSfnt(...)` 在内存里新算的 TTF —— 验的是「子集器算得对」，
    // 而不是「磁盘上那份 woff2 解出来的字形对」。woff2ToSfnt 当时全仓零调用，
    // 正是这个缺口的具体形状（评审 §②-M2）。
    expect(renderableCodepoints.length, '渲染用字集至少上千，否则本用例会空跑').toBeGreaterThan(
      1000
    );
    const sub = asFont(fontkit.create(woff2ToSfnt(artifactBuf)), '产物解码后的 sfnt');
    expect(glyphDiffs(fullFont, sub, renderableCodepoints)).toEqual([]);
  });

  it('全字表子集化后仍逐码点一致（覆盖各种 cmap 段形状，且绕一圈 woff2 容器）', () => {
    const srcCmap = parseCmap(fullTtfBuf, parseSfnt(fullTtfBuf).tables.get('cmap')!);
    const all = [...srcCmap.keys()];
    const { ttf, glyphCount } = subsetSfnt(fullTtfBuf, all);
    expect(glyphCount).toBeGreaterThan(srcCmap.size); // 含 .notdef
    // 全字表有 2 万+ 字形，brotli q11 太慢：容器往返只需验证「路径通」，质量降到 4
    const big = buildWoff2(ttf, { quality: 4 });
    const sub = asFont(fontkit.create(woff2ToSfnt(big)), '子集产物');
    expect(glyphDiffs(fullFont, sub, all)).toEqual([]);
    // 体积护栏第二条（M8）：相对全量 TTF 的比例 —— 全字表产物当然过不了，
    // 这是「闸门把自证式断言换成单侧断言」的又一个面。
    expect(big.length / fullTtfBuf.length).toBeGreaterThan(0.05);
    const gate = verifySubsetArtifact(big, renderableCodepoints);
    expect(gate.ok).toBe(false);
    expect(gate.problems.join()).toContain('已经不是子集了');
  });

  it.skipIf(!hasConsola)(
    'hmtx 的 (advance, lsb) 逐字形一致 —— 含 gid ≥ numberOfHMetrics 的尾部 lsb 数组（M1）',
    () => {
      // 为什么单独写一条：fontkit 的 path/bbox **不含 lsb**，改前那套字形比对
      // 拿 lsb 错了 353 个的 consola 子集跑也全绿（评审实测）。必须显式读 hmtx。
      const buf = readFileSync(CONSOLA);
      const src = hmtxRecords(buf);
      // 先证明这份输入真的走得到尾部 lsb 分支，否则本用例是空跑
      expect(src.numberOfHMetrics, 'consola 必须 numberOfHMetrics < numGlyphs').toBeLessThan(
        src.numGlyphs
      );
      expect(
        src.records[src.numberOfHMetrics]!.lsb,
        '尾部 lsb 必须与最后一条记录不同 —— 否则本用例测不出 M1'
      ).not.toBe(src.records[src.numberOfHMetrics - 1]!.lsb);

      const cmap = parseCmap(buf, parseSfnt(buf).tables.get('cmap')!);
      const { ttf, oldGids } = subsetSfnt(buf, [...cmap.keys()]);
      const out = hmtxRecords(ttf);
      const bad: string[] = [];
      oldGids.forEach((oldGid, newGid) => {
        const a = src.records[oldGid]!;
        const b = out.records[newGid]!;
        if (a.advance !== b.advance || a.lsb !== b.lsb) {
          bad.push(`gid ${oldGid}→${newGid} (${a.advance},${a.lsb}) ≠ (${b.advance},${b.lsb})`);
        }
      });
      expect(bad.slice(0, 5)).toEqual([]);
      expect(bad.length).toBe(0);
    }
  );

  it('复合字形：闭包收进组件、组件索引被重映射（合成字形，不依赖系统字体）', () => {
    // 手搓 glyf：0 空 / 1 简单 / 2 复合(引用 1,3) / 3 简单 / 4 复合(引用 2)
    const simple = (n: number) => {
      const b = Buffer.alloc(10 + 8);
      b.writeInt16BE(1, 0);
      b.writeInt16BE(n, 6); // xMax 顺带当标记，便于断言搬对了字形
      return b;
    };
    const composite = (refs: [number, number][]) => {
      const parts = [Buffer.alloc(10)];
      parts[0].writeInt16BE(-1, 0);
      refs.forEach(([gid, mark], i) => {
        const ref = Buffer.alloc(8);
        const last = i === refs.length - 1;
        ref.writeUInt16BE(0x0001 | (last ? 0 : 0x0020), 0); // ARG_1_AND_2_ARE_WORDS (+MORE)
        ref.writeUInt16BE(gid, 2);
        ref.writeInt16BE(mark, 4);
        ref.writeInt16BE(mark, 6);
        parts.push(ref);
      });
      return Buffer.concat(parts);
    };
    const glyphs = [
      Buffer.alloc(0),
      simple(101),
      composite([
        [1, 7],
        [3, 9],
      ]),
      simple(103),
      composite([[2, 5]]), // 嵌套：复合引用复合
    ];
    const glyf = Buffer.concat(glyphs);
    const loca: number[] = [0];
    let cursor = 0;
    for (const g of glyphs) {
      cursor += g.length;
      loca.push(cursor);
    }

    const r = rebuildGlyf({ glyf, loca, numGlyphs: 5, wantedGids: [4] });
    // 闭包：4 引用 2，2 引用 1 和 3 → 全都要进来（顺序按旧 gid 升序，确定性）
    expect(r.oldGids).toEqual([0, 1, 2, 3, 4]);
    expect(r.glyphCount).toBe(5);
    expect([...r.remap.entries()]).toEqual([
      [0, 0],
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 4],
    ]);

    // 只取 gid 2 时，组件 1/3 也必须被收进来，且索引按新表改写
    const only2 = rebuildGlyf({ glyf, loca, numGlyphs: 5, wantedGids: [2] });
    expect(only2.oldGids).toEqual([0, 1, 2, 3]);
    expect(only2.remap.get(1)).toBe(1);
    expect(only2.remap.get(3)).toBe(3);
    const comp2 = only2.glyf.subarray(only2.offsets[2], only2.offsets[3]);
    expect(isComposite(comp2)).toBe(true);
    expect(parseCompositeRefs(only2.glyf, only2.offsets[2], comp2.length).map((c) => c.gid)).toEqual([
      1, 3,
    ]);

    // 反过来：只取 gid 4 时，2 是嵌套中间层，1/3 也要收进来
    const only4 = rebuildGlyf({ glyf, loca, numGlyphs: 5, wantedGids: [4] });
    const outer = parseCompositeRefs(only4.glyf, only4.offsets[4], only4.offsets[5] - only4.offsets[4]);
    expect(outer.map((c) => c.gid)).toEqual([2]);
    const inner = parseCompositeRefs(only4.glyf, only4.offsets[2], only4.offsets[3] - only4.offsets[2]);
    expect(inner.map((c) => c.gid)).toEqual([1, 3]);

    // loca 一律写 long 格式（4 字节/项，numGlyphs + 1 项）
    expect(only4.loca.length).toBe((only4.glyphCount + 1) * 4);
    expect(only4.offsets.length).toBe(only4.glyphCount + 1);
    expect(only4.offsets[0]).toBe(0);
    expect(only4.offsets[only4.offsets.length - 1]).toBe(only4.glyf.length);

    // 请求越界 gid 必须炸，而不是悄悄产出坏字体
    expect(() => rebuildGlyf({ glyf, loca, numGlyphs: 5, wantedGids: [9] })).toThrow(/越界/);
  });
});

describe('cmap 写出', () => {
  it('非线性段必须走 glyphIdArray：端点为等差但中间乱序', () => {
    // 回归用例（2026-09-10 实施期发现）：原实现只比「段首 gid 与段尾 gid 的差」
    // 是否等于码点差，于是 [10, 14, 12] 这种「首尾对得上、中间乱序」的段被误判为
    // 线性段，整段用 idDelta 写出 → 码点全部指到错字形。
    // 真实反例：calibri 的 U+1F50..U+1F57。
    const entries: [number, number][] = [
      [0x100, 10],
      [0x101, 14],
      [0x102, 12],
    ];
    const parsed = parseCmap(buildCmap4(entries), { offset: 0 });
    expect([...parsed.entries()]).toEqual(entries);
  });

  it('线性段仍写 idDelta（rangeOffset === 0），连续段不外溢', () => {
    const entries: [number, number][] = [
      [0x41, 5],
      [0x42, 6],
      [0x43, 7],
      [0x200, 9],
    ];
    const sub = buildCmap4(entries);
    const parsed = parseCmap(sub, { offset: 0 });
    expect([...parsed.entries()]).toEqual(entries);
    // 表头：format 4、条目数 2、两个平台记录都指向同一子表
    const dv = new DataView(sub.buffer, sub.byteOffset, sub.byteLength);
    expect(dv.getUint16(2)).toBe(2);
    expect(dv.getUint16(4 + 8)).toBe(3); // Windows 平台记录存在
    const subtableOffset = dv.getUint32(8);
    expect(dv.getUint16(subtableOffset)).toBe(4);
    // 段数 = 2 段 + 终结段
    const segCount = dv.getUint16(subtableOffset + 6) / 2;
    expect(segCount).toBe(3);
    // 线性段的 idRangeOffset 全 0
    const rangeO = subtableOffset + 14 + segCount * 2 + 2 + segCount * 2 + segCount * 2;
    expect(dv.getUint16(rangeO)).toBe(0);
    expect(dv.getUint16(rangeO + 2)).toBe(0);
    // 终结段固定 0xFFFF → gid 0（delta = 1）
    expect(dv.getUint16(subtableOffset + 14 + (segCount - 1) * 2)).toBe(0xffff);
    expect(dv.getUint16(subtableOffset + 14 + segCount * 2 + 2 + (segCount - 1) * 2)).toBe(0xffff);
  });

  it('真码点 U+FFFF 不与终结段重叠（M8）', () => {
    // U+FFFF 是规范留给终结段的码点。改前实测：传入真实 U+FFFF 时，段表里会出现
    // 两条以 0xFFFF 结尾的段（[0xFFFE..0xFFFF] + 终结段），解析器读到哪条看运气。
    const sub = buildCmap4([
      [0x41, 5],
      [0xfffe, 7],
      [0xffff, 9],
    ]);
    expect(
      [...parseCmap(sub, { offset: 0 }).entries()],
      'U+FFFF 应被剔除，而不是写进段表'
    ).toEqual([
      [0x41, 5],
      [0xfffe, 7],
    ]);
    const dv = new DataView(sub.buffer, sub.byteOffset, sub.byteLength);
    const subO = dv.getUint32(8);
    const segCount = dv.getUint16(subO + 6) / 2;
    const starts: number[] = [];
    const ends: number[] = [];
    for (let i = 0; i < segCount; i++) {
      ends.push(dv.getUint16(subO + 14 + i * 2));
      starts.push(dv.getUint16(subO + 14 + segCount * 2 + 2 + i * 2));
    }
    expect(starts.filter((v) => v === 0xffff), '0xFFFF 只能作为终结段出现一次').toEqual([0xffff]);
    expect(ends.filter((v) => v === 0xffff), '0xFFFF 只能作为终结段出现一次').toEqual([0xffff]);
  });
});

describe('字集口径（M3）', () => {
  it('HTML 实体渲染出的字符也进字集（源码里写的是 &larr; 这串 ASCII）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'subset-chars-'));
    try {
      const src = join(dir, 'src');
      mkdirSync(src, { recursive: true });
      writeFileSync(
        join(src, 'page.astro'),
        '<a class="text-pixel">&darr; 下载 &hellip; &#x2713; &#8595; &nbsp;</a>\n'
      );
      const set = collectChars(dir);
      // 本站现网实际在用（评审 M3 实测）：&larr; / &rarr; 在 3 处 text-pixel 元素里
      for (const [name, ch] of [
        ['&darr;', '\u2193'],
        ['&hellip;', '\u2026'],
        ['&#x2713;', '\u2713'],
        ['&#8595;', '\u2193'],
        ['&nbsp;', '\u00a0'],
      ] as [string, string][]) {
        expect(set.has(ch), `${name} 渲染出的 ${ch} 没进字集`).toBe(true);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('认不出的 / 非法的实体保持原样（不误映射成别的字符）', () => {
    expect(decodeHtmlEntities('&nope; &#xZZ; &#0; &#1114112;')).toBe(
      '&nope; &#xZZ; &#0; &#1114112;'
    );
    expect(decodeHtmlEntities('&amp;&lt;&gt;')).toBe('&<>');
  });
});

describe('发布路径 publishArtifact（M5：tmp 不留残留）', () => {
  it('自检不过 / 自检抛异常 / 成功，三条路径都不留 .tmp', () => {
    const dir = mkdtempSync(join(tmpdir(), 'subset-publish-'));
    const out = join(dir, 'zpix.subset.woff2');
    try {
      // ① 自检不过：坏件被拦，既不产出产物也不留 tmp
      const bad = publishArtifact(artifactBuf.subarray(0, 64), renderableCodepoints, {
        outPath: out,
      });
      expect(bad.ok).toBe(false);
      expect(existsSync(out + '.tmp'), '自检不过后残留 .tmp').toBe(false);
      expect(existsSync(out)).toBe(false);

      // ② 自检抛异常（改前：parseCmap 的 RangeError 冲穿 main，unlinkSync 只在 !ok 分支 → tmp 残留。
      //    .gitignore 没有 *.tmp 规则，而 astro build 会把 public/ 原样拷进 dist/）
      expect(() =>
        publishArtifact(artifactBuf, renderableCodepoints, {
          outPath: out,
          verify: () => {
            throw new RangeError('模拟坏 cmap 抛栈');
          },
        })
      ).toThrow(/模拟坏 cmap 抛栈/);
      expect(existsSync(out + '.tmp'), '自检抛栈后残留 .tmp').toBe(false);

      // ③ 好件：tmp 被改名成产物，同样不留残留
      const good = publishArtifact(artifactBuf, renderableCodepoints, { outPath: out });
      expect(good.ok).toBe(true);
      expect(good.bytes).toBe(artifactBuf.length);
      expect(existsSync(out)).toBe(true);
      expect(existsSync(out + '.tmp')).toBe(false);
      expect(readFileSync(out).length).toBe(artifactBuf.length);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('复合字形的真实字体覆盖（系统 calibri.ttf）', () => {
  it.skipIf(!hasCalibri)('calibri（168 个复合字形）子集后逐码点一致', () => {
    const buf = readFileSync(CALIBRI);
    const parsed = parseSfnt(buf);
    const cmap = parseCmap(buf, parsed.tables.get('cmap')!);
    const codepoints = [...cmap.keys()].filter((cp) => cp >= 0x20 && cp < 0x2500);
    const { ttf } = subsetSfnt(buf, codepoints);

    // 先证明这份输入真的含复合字形，否则本用例会因「没走到复合路径」而假绿
    const numGlyphs = new DataView(buf.buffer, buf.byteOffset).getUint16(
      parsed.tables.get('maxp')!.offset + 4
    );
    const loca = parseLoca(buf, parsed.tables.get('loca')!, numGlyphs, true);
    const glyf = parsed.tables.get('glyf')!.data;
    let composites = 0;
    for (let gid = 1; gid < numGlyphs; gid++) {
      if (loca[gid + 1] > loca[gid] && isComposite(glyf.subarray(loca[gid], loca[gid + 1]))) {
        composites++;
      }
    }
    expect(composites, 'calibri 应含大量复合字形').toBeGreaterThan(100);

    const full = asFont(fontkit.create(buf), 'calibri');
    const sub = asFont(fontkit.create(ttf), 'calibri 子集');
    expect(glyphDiffs(full, sub, codepoints)).toEqual([]);
  });

  it.skipIf(!hasCalibri)('源字体有非 BMP 字形时直接失败，不静默剔除（M6）', () => {
    // 只写 format 4 cmap 的产物装不下非 BMP 码点。改前：字形被收进产物，码点却
    // 被排除出 cmap，只打一行日志；而闸门的目标集 == 写出去的那一份（自证式断言），
    // 于是这件事永远测不出来。现在必须炸。
    const buf = readFileSync(CALIBRI);
    const cmap = parseCmap(buf, parseSfnt(buf).tables.get('cmap')!);
    const nonBmp = [...cmap.keys()].filter((cp) => cp > 0xffff);
    expect(nonBmp.length, 'calibri 应含非 BMP 码点，否则本用例空跑').toBeGreaterThan(0);
    expect(() => subsetSfnt(buf, [0x41, nonBmp[0]!])).toThrow(/非 BMP/);
    // Zpix 现状（最大码点 U+FFE6）碰不到这条分支，所以它只是潜伏项
    const zpixDv = new DataView(fullTtfBuf.buffer, fullTtfBuf.byteOffset);
    const zpixSf = parseSfnt(fullTtfBuf);
    const zpixCmap = parseCmap(fullTtfBuf, zpixSf.tables.get('cmap')!);
    expect([...zpixCmap.keys()].filter((cp) => cp > 0xffff).length).toBe(0);
    expect(zpixDv.getUint16(zpixSf.tables.get('maxp')!.offset + 4)).toBeGreaterThan(0);
  });
});
