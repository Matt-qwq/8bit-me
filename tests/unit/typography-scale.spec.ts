import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 像素排版可读性层契约（typography scale）
 *
 * 来源：docs/research/pixel-typography-readability.md（A2.3 行距 / A2.4 列表与代码块 /
 * A2.5 加粗 / A2.6 小字与字距 / B3 逐条对照 / C2 映射）。
 *
 * 分工：
 *   单测（本文件）守「源码不变量」——字号档位、行高取整、3px 边框清零，
 *   不开浏览器就能拦住下一次「顺手写个 0.85rem」；
 *   e2e（tests/e2e/typography.spec.ts）守「浏览器里真的级联成那样」。
 *
 * 注意：Zpix 是 12px 像素网格字体，<14px 笔画并死——所以「小字归整」不是审美偏好，
 * 是本站自定的硬下限（global.css 注释即由此而来）。
 */

const ROOT = process.cwd();

/** 工作区行尾混杂（多数 LF、AvatarSprite.astro 为 CRLF），统一成 LF 再解析，免得行号/正则假红 */
function readText(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf-8').replace(/\r\n/g, '\n');
}

/** 扫描范围内所有 CSS 载体：src 下的 .css 与 .astro */
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(astro|css)$/.test(entry.name)) {
      out.push(relative(ROOT, full).split(sep).join('/'));
    }
  }
  return out;
}

const FILES = walk(join(ROOT, 'src')).sort();

interface Decl {
  file: string;
  /** 1-based 行号（.astro 已折算回源文件行号） */
  line: number;
  /** 规则唯一标识（同选择器出现在多个文件时不串味） */
  ruleId: string;
  selector: string;
  prop: string;
  value: string;
}

/** .astro 只取 <style> 块（模板/脚本里的花括号会污染选择器栈）；.css 整文件即一段 */
function cssRegions(file: string, src: string): { text: string; offset: number }[] {
  if (file.endsWith('.css')) return [{ text: src, offset: 0 }];
  const regions: { text: string; offset: number }[] = [];
  const re = /<style[^>]*>([\s\S]*?)<\/style>/g;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    const head = src.slice(0, m.index + m[0].indexOf('>') + 1);
    regions.push({ text: m[1] ?? '', offset: head.split('\n').length - 1 });
  }
  return regions;
}

/** 极简 CSS 声明扫描：维护选择器栈，逐条产出 prop/value（够用即可，不引依赖） */
function scan(file: string, text: string, offset: number): Decl[] {
  // 块注释换成等量空白（保留换行）：注释里的花括号不进栈，行号也不漂
  const src = text.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
  const out: Decl[] = [];
  const stack: { selector: string; id: string }[] = [];
  let buf = '';
  let line = 1;
  let seq = 0;

  const flush = () => {
    const decl = buf.trim();
    buf = '';
    if (!decl) return;
    const m = /^([\w-]+)\s*:\s*([\s\S]+)$/.exec(decl);
    if (!m) return;
    const top = stack[stack.length - 1];
    out.push({
      file,
      line: offset + line,
      ruleId: top?.id ?? `${file}#root`,
      selector: top?.selector ?? '',
      prop: (m[1] ?? '').toLowerCase(),
      value: (m[2] ?? '').trim().replace(/\s+/g, ' '),
    });
  };

  for (const ch of src) {
    if (ch === '\n') {
      line += 1;
      buf += ch;
    } else if (ch === '{') {
      stack.push({
        selector: buf.trim().replace(/\s+/g, ' '),
        id: `${file}#${seq++}`,
      });
      buf = '';
    } else if (ch === '}') {
      stack.pop();
      buf = '';
    } else if (ch === ';') {
      flush();
    } else {
      buf += ch;
    }
  }
  return out;
}

const DECLS: Decl[] = FILES.flatMap((f) =>
  cssRegions(f, readText(f)).flatMap((r) => scan(f, r.text, r.offset))
);

/** 允许的字号档（rem）：12 / 14 / 16 / 18 / 20 / 24 / 32 / 48px */
const ALLOWED_REM = [
  '0.75rem',
  '0.875rem',
  '1rem',
  '1.125rem',
  '1.25rem',
  '1.5rem',
  '2rem',
  '3rem',
];

const isAllowedSize = (v: string): boolean =>
  ALLOWED_REM.includes(v) ||
  /^[\d.]+em$/.test(v) ||
  v.startsWith('clamp(') ||
  // 正文离散两档（像素字下不用流体 clamp，见字距修正 describe）
  v === '16px' ||
  v === '14px';

/**
 * 字号豁免（必须写明理由；只对「该文件 + 该选择器 + 该值」生效，不放行同类值）。
 * 当前为空：封面角标字形（.cover-glyph）已随封面像素图改造删除（2026-09），
 * 全站字号一律走 12px 格档位。机制保留——将来若确有装饰字形需要破格，
 * 在此登记「文件 + 选择器 + 值 + 理由」，而不是放宽整条断言。
 */
const SIZE_EXEMPT: {
  file: string;
  selector: string;
  value: string;
  why: string;
}[] = [];

describe('字号档位（12px 像素格）', () => {
  it('全部 font-size ∈ {0.75/0.875/1/1.125/1.25/1.5/2/3rem} ∪ em ∪ clamp()', () => {
    const bad = DECLS.filter((d) => d.prop === 'font-size')
      .filter((d) => !isAllowedSize(d.value))
      .filter(
        (d) =>
          !SIZE_EXEMPT.some(
            (e) =>
              e.file === d.file && e.selector === d.selector && e.value === d.value
          )
      )
      .map((d) => `${d.file}:${d.line} ${d.selector} → ${d.value}`);

    expect(
      bad,
      `碎片档字号（不在允许档位、也不是 em / clamp）：\n${bad.join('\n')}`
    ).toEqual([]);
  });

  it('凡声明了 rem 字号的规则，必须同规则显式声明行高', () => {
    const rules = new Map<string, Decl[]>();
    for (const d of DECLS) {
      const list = rules.get(d.ruleId) ?? [];
      list.push(d);
      rules.set(d.ruleId, list);
    }

    const bad: string[] = [];
    // 同一文件内同选择器的其他规则已声明行高时，本规则（如媒体查询里只改字号）可继承
    const pairedElsewhere = (file: string, selector: string): boolean =>
      DECLS.some(
        (d) => d.file === file && d.selector === selector && d.prop === 'line-height'
      );
    for (const decls of rules.values()) {
      const fs = decls.find((d) => d.prop === 'font-size');
      if (!fs || !/^[\d.]+rem$/.test(fs.value)) continue;
      // 按钮是作者既定度量：.pixel-btn 的 line-height: 1.4 由全局件提供，
      // 组件内只调字号（见 T1「按钮已有显式 line-height: 1.4，保持不动」）
      if (fs.selector.includes('pixel-btn')) continue;
      if (decls.some((d) => d.prop === 'line-height')) continue;
      if (pairedElsewhere(fs.file, fs.selector)) continue;
      bad.push(
        `${fs.file}:${fs.line} ${fs.selector} font-size: ${fs.value} 缺显式 line-height`
      );
    }

    expect(
      bad,
      `改了字号却没配行高（会继承 body 的 28px 把小件撑开）：\n${bad.join('\n')}`
    ).toEqual([]);
  });
});

describe('行高取整（4px 阶）', () => {
  const globalDecl = (selector: string, prop: string): string | undefined =>
    DECLS.find(
      (d) =>
        d.file === 'src/styles/global.css' &&
        d.selector === selector &&
        d.prop === prop
    )?.value;

  it('body 行高 28px、字距 normal（正文字体已是系统黑体，不再需要 Zpix 修正）', () => {
    expect(globalDecl('body', 'line-height')).toBe('28px');
    // 2026-09-10（作者决策 U1）：正文换系统黑体后 CJK 前进量 = 1.0 em，
    // Zpix 的 13/12 em 修正（--ls-16）反而会制造抖动，故改 normal。
    // Zpix 元素（h1~h4 / 导航 / 按钮 / 标签）仍用 --ls-*。
    expect(globalDecl('body', 'letter-spacing')).toBe('normal');
    expect(globalDecl('body', 'font-size')).toBe('16px');
  });

  it('h1~h4 行高分别 56 / 28 / 28 / 20px（不再统一 1.1）', () => {
    expect(globalDecl('h1', 'line-height')).toBe('56px');
    expect(globalDecl('h2', 'line-height')).toBe('28px');
    expect(globalDecl('h3', 'line-height')).toBe('28px');
    expect(globalDecl('h4', 'line-height')).toBe('20px');
    expect(
      DECLS.some(
        (d) =>
          d.file === 'src/styles/global.css' &&
          d.prop === 'line-height' &&
          d.value === '1.1'
      ),
      'global.css 不应再有统一的 line-height: 1.1'
    ).toBe(false);
  });
});

describe('像素边框语言（border 简写不得出现 3px）', () => {
  // 注：本断言只覆盖 `border:` 一种写法（历史遗留）。**完整的线宽白名单**
  // （border / outline / box-shadow 线条 / height / width / 背景齿宽）已迁到
  // tests/unit/line-hierarchy.spec.ts 的几何断言——那里才发现旧契约漏抓了
  // 5 处真实 3px（outline / height / inset shadow / 梯度齿）。
  it('src 下不再出现 border: 3px', () => {
    const bad = FILES.flatMap((f) =>
      readText(f)
        .split('\n')
        .map((l, i) => ({ f, i: i + 1, l }))
        .filter((x) => /border(-[a-z]+)?\s*:\s*3px/.test(x.l))
        .map((x) => `${x.f}:${x.i}`)
    );
    expect(bad, `残留 3px 边框：\n${bad.join('\n')}`).toEqual([]);
  });
});

describe('断行策略（末行孤字治理）', () => {
  // 2026-10-29：impeccable 检测器在 #skills 尾注命中 straggler —— 末行只剩「GitHub。」
  // （占行宽 8%）。判据不是「属性写了没有」，而是「去掉它之后末行孤字会不会回来」，
  // 所以这里只守源码不变量，真正的观感由 tests/e2e/typography.spec.ts 量末行宽度。
  const css = readText('src/styles/global.css');
  const P_RULE = /(?:^|\n)p\s*\{([^}]*)\}/;
  const H_RULE = /(?:^|\n)h1,\s*h2,\s*h3,\s*h4\s*\{([^}]*)\}/;

  const declsOf = (text: string, re: RegExp): string => {
    const m = re.exec(text);
    expect(m, `global.css 应存在匹配 ${re} 的规则`).not.toBeNull();
    return (m?.[1] ?? '').replace(/\s+/g, ' ');
  };
  const wrapOf = (text: string, re: RegExp): string | null =>
    /text-wrap:\s*([a-z-]+)/.exec(declsOf(text, re))?.[1] ?? null;

  it('正文段落 p 声明 text-wrap: pretty', () => {
    expect(wrapOf(css, P_RULE)).toBe('pretty');
  });

  it('标题组 h1/h2/h3/h4 声明 text-wrap: balance', () => {
    expect(wrapOf(css, H_RULE)).toBe('balance');
  });

  it('反例自检：抹掉 text-wrap 后两条判据必须变红', () => {
    const stripped = css.replace(/text-wrap:\s*(pretty|balance);/g, '');
    expect(wrapOf(stripped, P_RULE)).toBeNull();
    expect(wrapOf(stripped, H_RULE)).toBeNull();
  });

  it('skills 尾注用 balance（Chrome 里 pretty 对本段无效，实测）', () => {
    const skills = readText('src/components/sections/Skills.astro');
    const note = /\.note\s*\{([^}]*)\}/.exec(skills);
    expect(note, 'Skills.astro 应有 .note 规则').not.toBeNull();
    expect((note?.[1] ?? '').replace(/\s+/g, ' ')).toMatch(/text-wrap:\s*balance/);
  });
});

describe('prose 型阶（src/pages/blog/[slug].astro）', () => {
  const SLUG = readText('src/pages/blog/[slug].astro');
  const rule = (sel: string): string => {
    const escaped = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(SLUG);
    expect(m, `应存在 ${sel} 规则`).not.toBeNull();
    return (m?.[1] ?? '').replace(/\s+/g, ' ');
  };

  it('标题层级：文章 h1 20px > prose h2 18px > h3 16px（原 h1 18 < h2 20 倒挂）', () => {
    expect(rule('.head h1')).toMatch(/font-size: 1\.25rem/);
    expect(rule('.head h1')).toMatch(/line-height: 28px/);
    expect(rule('.prose :global(h2)')).toMatch(/font-size: 1\.125rem/);
    expect(rule('.prose :global(h2)')).toMatch(/line-height: 24px/);
    expect(rule('.prose :global(h3)')).toMatch(/font-size: 1rem/);
    expect(rule('.prose :global(h3)')).toMatch(/line-height: 24px/);
    expect(rule('.prose :global(h3)')).toMatch(/font-weight: 700/);
  });

  it('小字归整：.meta / .back 到 0.75rem + 16px 行高', () => {
    for (const sel of ['.meta', '.back']) {
      expect(rule(sel)).toMatch(/font-size: 0\.75rem/);
      expect(rule(sel)).toMatch(/line-height: 16px/);
    }
  });

  it('代码块：pre 边框 1px、pre code 0.875rem/20px、行内 code 0.875em', () => {
    expect(rule('.prose :global(pre)')).toMatch(/border: 1px solid/);
    expect(rule('.prose :global(pre code)')).toMatch(/font-size: 0\.875rem/);
    expect(rule('.prose :global(pre code)')).toMatch(/line-height: 20px/);
    expect(rule('.prose :global(code)')).toMatch(/font-size: 0\.875em/);
  });

  it('列表项间距 + 加粗显式声明（A2.4 / A2.5 选项 1）', () => {
    expect(rule('.prose :global(li + li)')).toMatch(/margin-top: 0\.5em/);
    expect(rule('.prose :global(strong)')).toMatch(/font-weight: 700/);
  });
});

describe('Zpix 字距修正（CJK 前进量 13/12 em → 整数像素）', () => {
  const g = (selector: string, prop: string): string[] =>
    DECLS.filter(
      (d) =>
        d.file === 'src/styles/global.css' &&
        d.selector === selector &&
        d.prop === prop
    ).map((d) => d.value);

  it(':root 声明 --ls-12/14/16/18/20/24/32/48 八档，且修正值精确', () => {
    const expectMap: Record<string, string> = {
      '--ls-12': '0px',
      '--ls-14': '-0.166667px',
      '--ls-16': '-0.333333px',
      '--ls-18': '-0.5px',
      '--ls-20': '-0.666667px',
      '--ls-24': '0px',
      '--ls-32': '-0.666667px',
      '--ls-48': '0px',
    };
    for (const [name, val] of Object.entries(expectMap)) {
      expect(g(':root', name), `${name} 应为 ${val}`).toContain(val);
    }
  });

  it('body 离散两档：16px / ≤560px 14px（字距均为 normal）', () => {
    // 不再用 clamp：流体尺寸会让任何字距修正只能在一个尺寸上精确
    expect(g('body', 'font-size')).not.toContain(
      'clamp(14px, 1vw + 0.5rem, 16px)'
    );
    expect(g('body', 'font-size')).toContain('16px');
    expect(g('body', 'font-size')).toContain('14px');
    expect(g('body', 'letter-spacing')).toContain('normal');
  });

  it('不再用 -0.02em 做标题字距（会让前进量带小数）', () => {
    const bad = DECLS.filter(
      (d) => d.prop === 'letter-spacing' && d.value.includes('-0.02em')
    ).map((d) => `${d.file}:${d.line}`);
    expect(bad, `残留 -0.02em 字距：${bad.join(', ')}`).toEqual([]);
  });

  it('标题档位字距走 token（h1/h2/h3/h4）', () => {
    expect(g('h1', 'letter-spacing')).toContain('var(--ls-48)');
    expect(g('h2', 'letter-spacing')).toContain('var(--ls-24)');
    expect(g('h3', 'letter-spacing')).toContain('var(--ls-20)');
    expect(g('h4', 'letter-spacing')).toContain('var(--ls-16)');
  });

  it('h2 降到 24px（与首页 h1 32px 拉开层级，且落在 12 的整数倍上）', () => {
    expect(g('h2', 'font-size')).toContain('1.5rem');
    expect(g('h3', 'font-size')).toContain('1.25rem');
  });
});

/**
 * B3：letter-spacing 只能用 token 或显式登记的设计 tracking
 *
 * 起因（2026-09-09 指标审计）：实测 6 处 em tracking 绕过了 `--ls-*`，
 * 其中 `.tag` 含中文、前进量带 0.72px 小数（已改为 token）。
 * 本测试要求：**每一条 letter-spacing 要么是 var(--ls-*)，要么在下面的清单里。**
 * 新增 tracking 必须在此登记并写理由，不能默默写个 0.05em。
 */
const TRACKING_ALLOWLIST: { selector: string; value: string; why: string }[] = [
  { selector: '.pixel-btn', value: '0.08em', why: '大写拉丁标签 tracking（按钮文字短）' },
  { selector: '.kicker', value: '0.15em', why: 'Press START（纯 ASCII）' },
  { selector: '.tagline', value: '0.1em', why: '副标题设计 tracking（单行、已登记）' },
  { selector: '.tl-year', value: '0.16em', why: '年份丝印（数字）' },
  { selector: '.tl-date', value: '0.08em', why: '日期丝印（数字）' },
  { selector: '.section-title .num', value: '0.14em', why: '章节编号丝印（01/B）' },
  { selector: '.cover-tag', value: '0.1em', why: 'COVER 丝印（ASCII）' },
  { selector: '.arcade-title', value: '0.1em', why: '404 街机标题（已登记）' },
  { selector: '.logo', value: '0.05em', why: '站点 logo 8bit.me（ASCII）' },
  {
    selector: '.side-dock__trigger-label',
    value: '0.1em',
    why: '侧边仓竖排 SET 标签（ASCII）',
  },
  { selector: '.konami-toast', value: '0.08em', why: 'Konami 提示（ASCII）' },
  {
    selector: '.hero--desk .hero-cta .cart',
    value: '0',
    why: 'T10 卡带竖排标签：清零 .pixel-btn 的 0.08em tracking，让 Zpix 12px 档 CJK 前进量回到整数 13px（竖排对格）',
  },
];

describe('letter-spacing 纪律（Zpix 元素用 token / 正文元素用 normal）', () => {
  /**
   * 2026-09-10（U1 换字体后）契约分两档：
   *  - 走 `--font-pixel` 的元素（标题 / 导航 / 按钮 / 标签 / 丝印）→ 必须用 `--ls-*`
   *    token 或登记在案的设计 tracking（Zpix CJK 前进量 13/12 em 需修正）。
   *  - 走 `--font-body` 的正文类元素 → 必须 `letter-spacing: normal`
   *    （系统黑体 CJK 前进量 1.0 em，任何负修正都会制造抖动）。
   */
  it('不存在未登记的 letter-spacing', () => {
    const bad = DECLS.filter((d) => d.prop === 'letter-spacing')
      .filter((d) => !d.value.startsWith('var(--ls-'))
      .filter((d) => {
        // normal 是正文类元素的合法值（下方专有一条断言守它）
        if (d.value === 'normal') return false;
        return !TRACKING_ALLOWLIST.some(
          (a) => a.selector === d.selector && a.value === d.value
        );
      })
      .map((d) => `${d.file}:${d.line} ${d.selector} → ${d.value}`);
    expect(bad, `未登记的 letter-spacing：\n${bad.join('\n')}`).toEqual([]);
  });

  /**
   * 2026-09-10 重写（U1 收尾时由它抓出一处真回归）
   *
   * 旧版断言「正文类元素的 letter-spacing 必须是 normal」，并手写一份
   * 「正文类选择器」名单。问题在名单是**我脑判的字体归属**，于是两处出错：
   *   ① 把 `text-pixel` 元素（`.back` / `.level` / `.foot-line` / `.arcade-hud`）
   *      当成正文类，逼它们丢掉 Zpix token；
   *   ② 真回归反而没抓到：导航链接没有 `text-pixel` 类、容器也没声明字体族，
   *      U1 换 `--font-body` 后它静默变成系统黑体，却仍带 `--ls-14`（Zpix 专用
   *      修正 -0.167px）——给比例字体做像素对格，正是这个 token 要避免的抖动。
   *
   * 新版按**风险**立规则，不猜字体归属：
   *   非零 token（--ls-14/16/18/20/32）是 Zpix 专有修正，只允许出现在
   *   「选择器里含 h1~h4」（标题走 --font-heading = Zpix）或显式白名单里。
   *   零值 token（--ls-12/24/48 = 0px）在任何地方都与 normal 等价，不设限。
   * 于是新增一处非零修正必须显式登记，且登记时要回答「它为什么是 Zpix」。
   */
  const ZERO_TOKENS = new Set(['var(--ls-12)', 'var(--ls-24)', 'var(--ls-48)']);
  const NONZERO_ALLOW: { file: string; selector: string; why: string }[] = [
    { file: 'src/components/Nav.astro', selector: 'a', why: '导航链接：.nav 容器声明 --font-pixel' },
    { file: 'src/components/sections/Projects.astro', selector: '.name', why: '作品卡标题（h3，Zpix）' },
    { file: 'src/pages/blog/tags/[tag].astro', selector: '.item-title', why: '标签页条目标题（h2，Zpix）' },
    {
      file: 'src/pages/lab/index.astro',
      selector: '.lab-card-title',
      why: '实验场图册卡片标题（h2，text-pixel）：标识语言，需 16px 档字距修正',
    },
  ];

  it('非零 Zpix 字距修正只允许出现在标题类选择器或登记在案的位置', () => {
    const bad = DECLS.filter((d) => d.prop === 'letter-spacing')
      .filter((d) => d.value.startsWith('var(--ls-') && !ZERO_TOKENS.has(d.value))
      .filter((d) => !/h[1-4]/.test(d.selector))
      .filter((d) => !NONZERO_ALLOW.some((a) => a.file === d.file && a.selector === d.selector))
      .map((d) => `${d.file}:${d.line} ${d.selector} → ${d.value}`);
    expect(
      bad,
      '非零 Zpix 字距修正用在了非标题选择器上（若该元素确实是 Zpix，请登记进 NONZERO_ALLOW 并写明理由）：\n' +
        bad.join('\n')
    ).toEqual([]);
  });

  it('登记项仍然存在（防白名单变成僵尸条目）', () => {
    for (const a of NONZERO_ALLOW) {
      const hit = DECLS.some(
        (d) => d.file === a.file && d.selector === a.selector && !ZERO_TOKENS.has(d.value)
      );
      expect(hit, `${a.file} 的 ${a.selector}（${a.why}）已不存在，请从白名单删除`).toBe(true);
    }
  });

  it('清单里的每条都仍存在（防登记残留成死配置）', () => {
    for (const a of TRACKING_ALLOWLIST) {
      expect(
        DECLS.some(
          (d) =>
            d.prop === 'letter-spacing' &&
            d.selector === a.selector &&
            d.value === a.value
        ),
        `清单里的 ${a.selector} → ${a.value} 已不存在，请删除该条`
      ).toBe(true);
    }
  });
});
