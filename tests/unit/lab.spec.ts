import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * /lab 交互式图册 —— 静态契约守卫（不开浏览器）
 *
 * 为什么这层必须存在（开发流程文档「两条硬经验」第二条）：
 * 「引用指向不存在的东西」这类跨文件契约不需要浏览器 —— 产物缺失、主题漂移、
 * 外链溜进来，全部能在 vitest 里用 node:fs 守住，比 e2e 快 100 倍。
 *
 * 三条守线：
 *   1. 每个 LAB_DIAGRAMS.id 都有真实产物（构建期外生成，不跑 archify 就没产物）
 *   2. 产物里的主题块逐字等于 themes.ts 的派生结果（作者改主题 → 图册会漂移）
 *   3. 产物零外部请求（archify 模板自带一个 Google Fonts 的 <noscript>）
 */
const ROOT = process.cwd();
const LAB_PUBLIC = join(ROOT, 'public', 'lab');

const { LAB_DIAGRAMS, artifactPath, findLabDiagram } = await import(
  '../../src/lib/lab'
);
const { MODES: THEMES } = await import('../../src/lib/themes');
const { buildSkinCss, buildBootScript, themeModes, themeBlock, HIDDEN_ALLOWLIST, OVERRIDES, zpixTracking, contrastRatio, TRACE } =
  await import('../../scripts/atlas/skin.mjs');
const { analyzeSvgGeometry, extractMainSvg, assertParsed } = await import(
  '../../scripts/atlas/geometry.mjs'
);

const readArtifact = (id: string) =>
  readFileSync(join(LAB_PUBLIC, `${id}.html`), 'utf-8');

describe('/lab 数据契约', () => {
  it('LAB_DIAGRAMS 非空且 id 唯一', () => {
    expect(LAB_DIAGRAMS.length).toBeGreaterThan(0);
    const ids = LAB_DIAGRAMS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('每个 id 都有真实产物文件（缺了就说明忘了跑 scripts/atlas/build.mjs）', () => {
    for (const d of LAB_DIAGRAMS) {
      expect(
        existsSync(join(LAB_PUBLIC, `${d.id}.html`)),
        `${d.id} 没有产物 —— 跑 npx vite-node scripts/atlas/build.mjs`
      ).toBe(true);
    }
  });

  it('artifactPath 只产相对路径（调用方负责套 url() 拿 base）', () => {
    for (const d of LAB_DIAGRAMS) {
      expect(artifactPath(d.id)).toBe(`lab/${d.id}.html`);
    }
  });

  it('findLabDiagram 命中/未命中都不抛', () => {
    expect(findLabDiagram(LAB_DIAGRAMS[0].id)?.id).toBe(LAB_DIAGRAMS[0].id);
    expect(findLabDiagram('nope')).toBeUndefined();
  });

  it('post 字段指向真实文章（有值时）', () => {
    const blogDir = join(ROOT, 'src', 'content', 'blog');
    for (const d of LAB_DIAGRAMS) {
      if (!d.post) continue;
      expect(
        existsSync(join(blogDir, `${d.post}.md`)),
        `${d.id} 的 post 指向不存在的文章 ${d.post}`
      ).toBe(true);
    }
  });
});

describe('/lab 产物与 themes.ts 不漂移', () => {
  it('产物内的皮肤 CSS 逐字等于 buildSkinCss(themes.ts)', () => {
    const expected = `<style>${buildSkinCss(THEMES)}</style>`;
    for (const d of LAB_DIAGRAMS) {
      expect(
        readArtifact(d.id).includes(expected),
        `${d.id} 的皮肤与当前 themes.ts 不一致 —— 改过主题后要重跑 scripts/atlas/build.mjs`
      ).toBe(true);
    }
  });

  it('产物内的主题引导脚本逐字等于 buildBootScript(themes.ts)', () => {
    const expected = `<script>${buildBootScript(THEMES)}</script>`;
    for (const d of LAB_DIAGRAMS) {
      expect(readArtifact(d.id).includes(expected)).toBe(true);
    }
  });

  it('皮肤覆盖全部主题（单档后只有暗档一套），且不遗漏', () => {
    const css = buildSkinCss(THEMES);
    for (const t of THEMES) {
      expect(css, `皮肤缺少主题 ${t.key}`).toContain(`html:root[data-gb="${t.key}"]`);
    }
    expect((css.match(/html:root\[data-gb="/g) ?? []).length).toBe(THEMES.length);
  });

  it('主题块的选择器特异性压得住 archify 的预设色板块', () => {
    /**
     * 背景（2026-09-10 审计实测）：工具栏的视觉风格菜单（Classic / Signal Flow /
     * Blueprint / Editorial）在 archify 模板里写作 `[data-preset="…"][data-theme="…"]`，
     * 特异性 (0,2,0)；而皮肤原来的主题块是 `html[data-gb="…"]`（(0,1,1)）——
     * 于是切换预设会把 --bg 直接换掉（实测 signal-flow → #030711、blueprint → #06131f、
     * editorial → #181611），图册当场变成第 14/15/16 套观感。
     * 这条守线把「谁赢」变成可计算的：主题块必须严格高于预设块。
     *
     * 注意：**这只是安全网，不是让预设菜单变得无害** —— 预设还会改容器背景、
     * 悬停软阴影等非 token 样式（见 ADR-0016 §十二）。
     */
    const spec = (sel: string): [number, number, number] => {
      const s = sel.replace(/\([^)]*\)/g, '');
      const id = (s.match(/#[\w-]+/g) ?? []).length;
      const cls = (s.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) ?? []).length;
      const type = (s.match(/(^|[\s>+~,])([a-z][\w-]*)/g) ?? []).length;
      return [id, cls, type];
    };
    const cmp = (a: [number, number, number], b: [number, number, number]) => {
      for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] - b[i];
      return 0;
    };
    const ours = spec(`html:root[data-gb="${THEMES[0].key}"]`);
    for (const preset of ['signal-flow', 'blueprint', 'editorial']) {
      for (const mode of ['dark', 'light']) {
        const theirs = spec(`[data-preset="${preset}"][data-theme="${mode}"]`);
        expect(cmp(ours, theirs), `预设 ${preset}/${mode} 压过了主题块`).toBeGreaterThan(0);
      }
    }
  });

  it('单档：皮肤只有暗档，亮度判定恒 dark（LIGHT 已退役）', () => {
    const modes = themeModes(THEMES);
    expect(THEMES.map((t) => t.key)).toEqual(['dark']);
    for (const m of modes) {
      expect(m.mode).toBe('dark');
    }
  });
});

describe('/lab 产物零外部请求', () => {
  it('不含任何会发起请求的外部引用（导航用 <a href> 不在此列）', () => {
    // 口径（2026-10-29 校准）：拦「会拉资源」的引用——`src` / `poster` / `<link href>` /
    // `xlink:href`；纯导航的 `<a href="http…">` 不产生请求，允许（archify 新版独立 Viewer
    // 自带一条署名链接，旧守卫把 href 一刀切了，会把合法署名当违规）。
    const RESOURCE_REF = /(?:src|poster)="https?:\/\/[^"]+"|<link[^>]*href="https?:\/\/[^"]+"|xlink:href="https?:\/\/[^"]+"/g;
    for (const d of LAB_DIAGRAMS) {
      const foreign = (readArtifact(d.id).match(RESOURCE_REF) ?? []).filter(
        (u) => !u.includes('w3.org')
      );
      expect(foreign, `${d.id} 夹带了外部资源引用`).toEqual([]);
    }
  });

  it('不含 Google Fonts 残留（archify 模板自带，必须被 build.mjs 剥掉）', () => {
    for (const d of LAB_DIAGRAMS) {
      const html = readArtifact(d.id);
      expect(html).not.toContain('fonts.googleapis.com');
      expect(html).not.toContain('fonts.gstatic.com');
    }
  });

  it('产物是纯 LF（与 .gitattributes 的 eol=lf 一致，避免每次重建产生无谓 diff）', () => {
    const CR = String.fromCharCode(13);
    for (const d of LAB_DIAGRAMS) {
      expect(
        readArtifact(d.id).includes(CR),
        `${d.id} 含 CRLF —— archify 模板带 CRLF，build.mjs 需归一为 LF`
      ).toBe(false);
    }
  });

  it('字体走站内自托管（相对路径，不是 data: base64 内联）', () => {
    for (const d of LAB_DIAGRAMS) {
      expect(readArtifact(d.id)).toContain('../fonts/zpix.subset.woff2');
    }
  });
});

describe('/lab 像素媒介约束', () => {
  it('圆角归零、线宽归一（像素语言里没有抗锯齿圆角）', () => {
    const css = buildSkinCss(THEMES);
    expect(css).toContain('border-radius:0!important');
    // 图内线条统一 2px（line-hierarchy 白名单的「结构线 2·4px」档）
    expect(css).toMatch(/svg rect,html\[data-gb\] svg path[\s\S]*?\{stroke-width:2!important\}/);
  });

  it('文字先于构图：SVG 有最小宽度下限，不随视口缩到看不清', () => {
    // 下限 = 图形原生画布宽（archify 3.2 产物 1085）。写大于原生宽会在桌面上凭空造横向滚动，
    // 把最右一条泳道虚线裁出视口（2026-10-29 换 3.2 产物时实测）；写小于原生宽则窄屏过早开始缩放。
    // 换图后若原生宽变了，改这里与 skin.mjs 的同值，并重跑 §三 的帧内截图核对。
    expect(buildSkinCss(THEMES)).toContain('min-width:1085px!important');
  });

  it('只留一套主题开关：archify 自带 Light/Dark 按钮在站内 iframe 里被隐藏', () => {
    expect(buildSkinCss(THEMES)).toContain(
      'html[data-gb-chrome="min"] #btn-theme{display:none!important}'
    );
  });

  it('嵌入模式参数不与 archify 自带 embed 撞名', () => {
    const boot = buildBootScript(THEMES);
    expect(boot).toContain("P.get('gb-chrome')");
    // archify 自己会读 ?embed=1 进画廊模式（连工具栏一起藏），传它会静默抢走控制权
    expect(boot).not.toContain("P.get('embed')");
  });

  it('不许静默关掉第三方元素：每条 display:none 都必须在白名单里', () => {
    /**
     * 背景（2026-09-10 作者发现）：悬停节点时，走线标签被箭头线穿过、读不出来。
     * 根因是皮肤里把 `.c-mask` 跟 `.c-grid` 归成「装饰层」一起关了，
     * 而 `.c-mask` 其实是 archify 的**挖空层**（模板原话：
     * `opaque mask rect (.c-mask) to hide arrows underneath`），
     * 专门用来遮掉压在标签下面的箭头线。
     *
     * 这条守线的意义：**关掉第三方 class 之前必须查它干什么**。
     * buildSkinCss 已经在生成期抛错，这里再守一道（防绕开生成器直接改产物）。
     */
    const css = buildSkinCss(THEMES);
    const selectors = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)]
      .filter((m) => /display\s*:\s*none/.test(m[2]))
      .map((m) => (m[1].split('*/').pop() ?? '').trim().replace(/\s+/g, ' '));

    const allowed = new Set(HIDDEN_ALLOWLIST.map((a) => a.selector));
    const unregistered = selectors.filter((s) => !allowed.has(s));
    expect(
      unregistered,
      '关掉第三方元素前先查它干什么 —— .c-mask 就是被误关后让箭头线穿过标签文字的'
    ).toEqual([]);
    // 白名单也得真在用（防僵尸条目）
    for (const a of HIDDEN_ALLOWLIST) expect(selectors).toContain(a.selector);
  });

  it('视觉风格菜单被压掉：入口与能力各一道（藏按钮 + 压 background-image）', () => {
    /**
     * 背景（2026-09-11 实测）：archify 的「视觉风格」菜单里，signal-flow 会给
     * `.diagram-container` 挂一条**写死的**渐变 `linear-gradient(rgba(8,20,38,.82), rgba(3,8,18,.94))`
     * （浅色主题则是近白）—— 不是 --gb-* 派生的颜色。gb-green 的 #0f380f 底被压成
     * (9,26,34)→(4,11,18) 的藏青，实测 61.3% 像素改变、平均通道差 11.6。
     *
     * 为什么上一轮的特异性守线抓不到：那条只比 --bg/--lane-stroke/--text 谁赢 ——
     * 皮肤确实赢了这些 token，但 background-image **皮肤从未写过**，既没被覆写也没人看。
     * 教训与「关掉 .c-mask」同类：**token 白名单不等于「非 token 样式已看守」**。
     *
     * 两道都要守，因为它们是两件事：
     *   ① 入口：.preset-wrap 藏掉（且必须**两种打开方式都藏** —— standalone 下同样会发生，
     *      而页面自己就在推「在新标签页打开 ↗」，只藏 iframe 等于留后门）
     *   ② 能力：即使有东西把 data-preset 改成 signal-flow（archify 升级 / URL 参数 /
     *      devtools），background-image 也得被压住 —— 藏入口只是「没人会按到」
     */
    const css = buildSkinCss(THEMES);
    expect(css).toContain('html[data-gb] .preset-wrap{display:none!important}');
    // 不能带 gb-chrome 作用域（那会漏掉 standalone 打开）
    expect(css).not.toMatch(/gb-chrome="min"\]\)?\s*\.preset-wrap/);
    expect(css).toContain('html[data-gb] .diagram-container{background-image:none!important}');
  });

  it('引导脚本吞掉 S（预设）与 T（主题），且 T 只在 iframe 里吞', () => {
    /**
     * 「隐藏按钮 ≠ 关掉开关」—— 上一轮 T 已立此案，2026-09-11 实测 S 完全同构：
     * 把 .preset-wrap 藏了，但焦点在 iframe 内时按 S 仍会在
     * classic→signal-flow→blueprint→editorial 之间循环（实测已复现）。
     *
     * 为什么 T 与 S 的吞法不同（这条最容易写错）：
     *   #btn-theme 只在 gb-chrome=min 下藏（standalone 下它是可见可用的，
     *   而 standalone 下用户可能真想切 light/dark），所以 T 也只能在 min 下吞；
     *   .preset-wrap 两种打开方式都藏，所以 S 一律吞。
     *   写反的后果：standalone 下 T 被吞 → 可见的按钮配一个死快捷键。
     */
    const boot = buildBootScript(THEMES);
    expect(boot).toMatch(/k==='s'\|\|k==='S'/);
    expect(boot).toMatch(/MIN&&\(k==='t'\|\|k==='T'\)/);
    // S 不能挂在 MIN 门里
    expect(boot).not.toMatch(/MIN&&\(k==='s'/);
  });

  it('挖空层 .c-mask 必须开着（关掉它 = 箭头线穿过标签文字）', () => {
    const css = buildSkinCss(THEMES);
    expect(HIDDEN_ALLOWLIST.map((a) => a.selector)).not.toContain('html[data-gb] .c-mask');
    expect(css).not.toMatch(/\.c-mask\{[^}]*display\s*:\s*none/);
    // 它要填成底色（--mask 已探成 --bg），才叫「背景挖空」
    expect(css).toContain('html[data-gb] .c-mask{fill:var(--mask)!important;stroke:none!important}');
  });

  it('皮肤生成器会把未登记的 display:none 当场拒掉（而不是等作者看出来）', async () => {
    const src = readFileSync(join(ROOT, 'scripts', 'atlas', 'skin.mjs'), 'utf-8');
    expect(src).toContain('assertNoUnregisteredHiding(css)');
    // 不能写成 `return \`...\`;` —— 那样自检是永远跑不到的死代码（本轮真实踩过）
    expect(src).toContain('const css = `@font-face');
  });

  it('泳道框的选择器必须命中 <rect> 自己（`.c-lane rect` 是后代选择器，从来匹配不到）', () => {
    /**
     * 2026-09-10 审计实测：archify 把 class 挂在 `<rect class="c-lane">` **自己**身上，
     * 而皮肤写的是 `html[data-gb] .c-lane rect` —— 后代选择器，一条也没命中。
     * 后果：泳道一直在用 archify 的 6,6 虚线与默认填充，且默认在浏览器里看不到异常，
     * 只有量 computed style 才看得出（stroke-dasharray 实测 `6px, 6px`）。
     */
    const css = buildSkinCss(THEMES);
    expect(css).toContain('html[data-gb] .c-lane{');
    expect(css, '`.c-lane rect` 匹配不到任何元素').not.toMatch(/\.c-lane rect\{/);
  });

  it('图内 font-size 档位全部被皮肤接管（漏一档 = 那档文字回到 7–9 用户单位）', () => {
    const css = buildSkinCss(THEMES);
    const covered = new Set(
      [...css.matchAll(/svg \[font-size="(\d+)"\]/g)].map((m) => m[1])
    );
    expect(covered.size).toBeGreaterThanOrEqual(3);
    for (const d of LAB_DIAGRAMS) {
      const used = new Set(
        [...readArtifact(d.id).matchAll(/<text[^>]*font-size="(\d+)"/g)].map((m) => m[1])
      );
      const missing = [...used].filter((v) => !covered.has(v));
      expect(
        missing,
        `${d.id} 里有未被皮肤覆盖的字号档：${missing.join(',')}（会把字缩回 7–9px）`
      ).toEqual([]);
    }
  });

  it('皮肤施加的每个字号都带 Zpix 字距修正，前进量落在整数像素', () => {
    /**
     * Zpix 的 CJK 前进量是 13/12 em（global.css 实测 12px→13.00、16px→17.33），
     * 不整除时空半个像素，像素字就糊。
     * 2026-09-10 审计实测（浏览器 getComputedTextLength）：
     *   11px → 11.9151（✗） · 12px → 13.00（✓） · 14px → 15.1686（✗）
     * 修正后：11px +0.083333、14px -0.166667、12px 不需修正。
     */
    const css = buildSkinCss(THEMES);
    const groups = [
      ...css.matchAll(/svg \[font-size="[^"]+"\](?:,html\[data-gb\] svg \[font-size="[^"]+"\])*\{([^}]*)\}/g),
    ];
    expect(groups.length).toBeGreaterThanOrEqual(3);
    for (const [, body] of groups) {
      const fs = Number(/font-size:([\d.]+)px/.exec(body)?.[1]);
      const ls = Number(/letter-spacing:(-?[\d.]+)px/.exec(body)?.[1] ?? 0);
      const advance = (fs * 13) / 12 + ls;
      expect(Math.abs(advance - Math.round(advance)), `${fs}px 前进量 ${advance} 非整数`).toBeLessThan(1e-6);
    }
    // 与站内 global.css 的 --ls-* 同源（同一条 13/12 em 公式，不许各算各的）
    const globalCss = readFileSync(join(ROOT, 'src', 'styles', 'global.css'), 'utf-8');
    for (const size of [12, 14]) {
      const siteVal = Number(new RegExp(`--ls-${size}: (-?[\\d.]+)px`).exec(globalCss)?.[1]);
      expect(siteVal, `global.css 的 --ls-${size} 与 skin 的 zpixTracking(${size}) 不一致`).toBeCloseTo(
        zpixTracking(size),
        5
      );
    }
  });

  it('结构线 ≥3:1、文字 token ≥4.5:1（全主题抬底，审计实测项）', () => {
    /**
     * 2026-09-10 审计实测（改前）：泳道结构线 vs 底色最低 **1.88:1**（midnight-arcade），
     * 13 套里 12 套低于 WCAG 1.4.11 的 3:1（非文本图形/构件边界）；
     * 文字 token 最低 2.72:1（dawnbringer-ember 的 --text-dim）。
     * inkpaper 上“泳道虚线几乎看不见”就是这条指标的肉眼版。
     *
     * 机制是**抬底**而不是归一：`max(原设计比例, 达标所需比例)` ——
     * 本来对比就高的主题不会被压平（避免为了守线把所有主题拉成同一个观感）。
     */
    for (const t of THEMES) {
      const block = themeBlock(t);
      const tok = (name: string) =>
        new RegExp(`--${name}:(#[0-9a-fA-F]{6})`).exec(block)?.[1] ?? '';
      const bg = tok('bg');
      expect(bg).toMatch(/^#/);
      for (const [name, min] of [
        ['lane-stroke', 3],
        ['external-stroke', 3],
      ] as const) {
        expect(
          contrastRatio(tok(name), bg),
          `${t.key} 的 --${name} 低于 ${min}:1`
        ).toBeGreaterThanOrEqual(min);
      }
      for (const name of ['text-muted', 'text-dim', 'text-faint']) {
        expect(contrastRatio(tok(name), bg), `${t.key} 的 --${name} 低于 4.5:1`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

describe('/lab 覆写登记表（别靠 class 名猜职责）', () => {
  /**
   * 背景：上一轮三个 bug（图内大空白、看不见的 data-detail="fine"、被关掉的挖空层）
   * 的共同点都是「覆写第三方产物时靠 class 名猜职责」。`.c-mask` 那个已经立了
   * HIDDEN_ALLOWLIST 机制，但那只治了 display:none 一种药 —— 皮肤里还有十几条别的覆写，
   * 一条都没被同等审过（且有两条是死选择器，从落地起就没生效）。
   *
   * 这里把审计变成机制：**每一条选择器都要登记「原本职责 / 改成什么 / 证据」**，
   * 未登记的直接在生成期抛错。守线的两份证据都在 scripts/atlas/skin.mjs 里。
   */
  const SKIN_SRC = readFileSync(join(ROOT, 'scripts', 'atlas', 'skin.mjs'), 'utf-8');

  it('生成器会在写盘前校验整份皮肤（不只 display:none）', () => {
    expect(SKIN_SRC).toContain('validateSkinCss(css)');
    expect(SKIN_SRC).toContain('assertEveryOverrideRegistered(css)');
  });

  it('每条登记都写了实质理由，且不在 CSS 里当僵尸条目', () => {
    expect(OVERRIDES.length).toBeGreaterThanOrEqual(15);
    const css = buildSkinCss(THEMES);
    for (const o of OVERRIDES) {
      expect(o.why.length, `${o.selector} 的理由太短，等于没写`).toBeGreaterThan(30);
      expect(css.includes(`${o.selector}{`), `${o.selector} 已不在 CSS 里，请从 OVERRIDES 删除`).toBe(
        true
      );
    }
  });

  it('HIDDEN_ALLOWLIST 是 OVERRIDES 的子集（两张表不许各说各话）', () => {
    const registered = new Set(OVERRIDES.map((o) => o.selector));
    for (const a of HIDDEN_ALLOWLIST) {
      expect(registered.has(a.selector), `${a.selector} 在白名单里却没在登记表里`).toBe(true);
    }
  });

  it('改坏三类变体都必须被拦（闸门结构自检，不靠人记得跑）', async () => {
    const { validateSkinCss } = await import('../../scripts/atlas/skin.mjs');
    const good = buildSkinCss(THEMES);
    expect(() => validateSkinCss(good)).not.toThrow();

    // ① 未登记的 display:none（.c-mask 那个坑的形态）
    expect(() => validateSkinCss(`${good}\nhtml[data-gb] .c-really-not-a-decoration{display:none!important}`)).toThrow(
      /未登记的 display:none/
    );
    // ② 未登记的普通覆写（死选择器/脑补 class 的形态）
    expect(() => validateSkinCss(`${good}\nhtml[data-gb] .c-lane rect{fill:none!important}`)).toThrow(
      /未登记的覆写/
    );
    // ③ 主题块选择器被写回低特异性（预设能抢走配色的形态）
    expect(() => validateSkinCss(good.replace(/html:root\[data-gb=/g, 'html[data-gb='))).toThrow(
      /未登记的覆写/
    );
  });

  it('隐藏第三方控件不等于关掉它的旁路：主题快捷键 T 必须被吞掉', () => {
    /**
     * 2026-09-10 审计实测：`#btn-theme` 被 display:none 之后，archify 的 T 快捷键
     * （doc 级 keydown）仍然生效 —— 实测按一下 data-theme 翻成 light，
     * 并且往**同源 localStorage** 写了 `archify-theme=light`（全站键名约定是 8bitme:*）。
     * 隐藏按钮只关掉了入口，没关掉开关。
     *
     * 2026-09-11 重构：keydown 处理器里 T 与 S 合并成一个，T 挂在 MIN 门下（standalone
     * 下 #btn-theme 是可见可用的，吞了会把它弄坏）。断言随之改成查 MIN 门与 key 判断，
     * 而不是钉死旧字符串——同一条意图，但不再依赖写法的细节。详见
     * 「引导脚本吞掉 S（预设）与 T（主题），且 T 只在 iframe 里吞」那条。
     */
    const boot = buildBootScript(THEMES);
    expect(boot).toMatch(/k==='t'\|\|k==='T'/);
    expect(boot).toMatch(/MIN&&\(k==='t'/);
    expect(boot).toContain("data-gb-chrome')==='min'");
  });

  it('触摸拖拽不许与容器横滚打架（放大后一次滑动位移两次）', () => {
    /**
     * 2026-09-10 审计实测（CDP 真触摸事件，390px 窄屏 + 150% 缩放）：
     * 一次横滑之后 `scrollLeft 0 → 147` **且** `translateX -420.5 → -440.5` ——
     * archify 的 pan 处理与容器原生滚动同时生效。100% 时不会（它的 pan 在 scale<=1 直接 return）。
     */
    const boot = buildBootScript(THEMES);
    expect(boot).toContain("e.pointerType==='mouse'");
    expect(boot).toContain('scrollWidth>c.clientWidth');
    // 节点/按钮这类交互元素必须放行，否则触摸点不到节点
    expect(boot).toContain('[data-node-id],button,a,input');
  });
});

describe('/lab 图内几何（防空带守卫）', () => {
  /**
   * 背景（2026-09-10 作者在成品上发现）：
   * `svg/text[1]`（泳道阶段标签）与 `svg/g[2]/rect[2]`（节点框）之间空了一大片。
   *
   * 根因是 archify 渲染器内部的不同步（不是我们把图写歪了）：
   *   rowYs: [128, 242, 356, 470, 584]                 // 写死的行坐标表
   *   height: viewBox[1] - stageY - stageBottomPad     // 泳道高却线性跟 viewBox
   * 节点 y 恒由 rowYs[row] 定，泳道随 viewBox 长 —— 两段留白全靠人工算术对齐。
   *
   * **archify 自己的校验器不查这件事**（它只查“节点有没有超出可读区”与元素碰撞，
   * 不管“泳道内部有没有大片没用上的空白”）。所以必须本站自己守。
   *
   * 两条指标缺一不可，这是实测数据（同一张图三个版本）：
   *
   *   版本              泳道空白   框内空洞   覆盖
   *   v1（修复前）      57.75     120.65    71.3%   ← 两条都破
   *   v6（只把框填满）  33.75 ✓   126.65 ✗   79.8%   ← 只守泳道会被蒙混过关
   *   v8（当前）        33.75 ✓    33.25 ✓   63.9%
   *
   * 注意覆盖率的反直觉之处：v6 覆盖率（79.8%）**高于** v8（63.9%），因为覆盖率
   * 把“框”当内容——框越大越显得“填满”，而里面是空的。所以覆盖率只能当辅助信号，
   * 真正的判据是上面两条“最长无内容带”。
   */
  const geometryOf = (id: string) =>
    assertParsed(analyzeSvgGeometry(extractMainSvg(readArtifact(id))));

  /**
   * 泳道内最长连续空白的上限。
   *
   * 为何是 36 而不是更小：archify 校验器强制 `node.y >= stageY + stageH + 22`
   * （= 46 + 36 + 22 = 104），而阶段标签基线固定在 y=68，
   * 因此“标签底 → 节点顶”的理论下限就是 **33.75 单位**（实测把 yOffset 再往下
   * 推 1 个单位，validate 直接失败）。36 = 下限 + 2.25 余量。
   * **不要再把这个阀值调低** —— 它不是审美选择，是上游的硬墙。
   */
  const MAX_LANE_GAP = 36;

  /**
   * 单个节点框内“未被文字覆盖的最长连续空白”上限。
   * 卡片高 72 时当前是 33.25；48 意味着一个框最多只能空掉 2/3。
   * 这条拦的是“大而空的框”：把框拉高去填泳道，泳道指标会好看，但框里就空了。
   */
  const MAX_NODE_INTERNAL_GAP = 48;

  /** 内容带占泳道总面积的比例下限（辅助信号，只管“整片泳道空着”） */
  const MIN_COVERAGE = 0.6;

  for (const d of LAB_DIAGRAMS) {
    it(`${d.id}：泳道内不得出现超过 ${MAX_LANE_GAP} 单位的连续空白`, () => {
      const g = geometryOf(d.id);
      expect(
        g.maxGap,
        `最大空白在 lane${g.worstGap.lane} 的 ${g.worstGap.top}..${g.worstGap.bottom}`
      ).toBeLessThanOrEqual(MAX_LANE_GAP);
    });

    it(`${d.id}：节点框内不得出现超过 ${MAX_NODE_INTERNAL_GAP} 单位的空洞`, () => {
      const g = geometryOf(d.id);
      expect(
        g.nodeInteriorMaxGap,
        '框被拉高去填泳道了 —— 泳道指标会好看，但框里是空的'
      ).toBeLessThanOrEqual(MAX_NODE_INTERNAL_GAP);
    });

    it(`${d.id}：内容覆盖率不低于 ${MIN_COVERAGE * 100}%`, () => {
      expect(geometryOf(d.id).coverage).toBeGreaterThanOrEqual(MIN_COVERAGE);
    });
  }

  it('几何体检本身有效（解析到泳道 / 节点框 / 文字，而不是全员归零）', () => {
    const g = geometryOf(LAB_DIAGRAMS[0].id);
    expect(g.lanes.length).toBeGreaterThanOrEqual(1);
    expect(g.nodeInteriors.length).toBeGreaterThanOrEqual(1);
    expect(g.bands.filter((b) => b.kind === 'text').length).toBeGreaterThan(0);
  });
});

describe('/lab 入场通电（trace 动效）', () => {
  /**
   * 背景（2026-09-17，动画线第二块）：`/lab/<id>` 的 4 条图内走线在进入时一次性上电 ——
   * 虚线沿走线扫过一遍（每条 2.4s，错峰 160ms），扫完**定格为原本的 2px 实线**，之后完全静止。
   *
   * 为什么这里必须逐条守：皮肤原来那条宽规则
   * `html[data-gb] *,…{animation-duration:0s!important}` 把 archify 全套动效（含 archify 的
   * 节点脉冲）一次带过。拆豁免的时候有三处极易写成静默失效（页面上看不出来）：
   *   ① 规格忘了开 `meta.animation="trace"` → 产物里根本没有 `data-animate`，皮肤白写；
   *   ② 归零规则写成 `:not([data-animate="node"])` → 走线归零、节点反而在跑（症状反向）；
   *   ③ 豁免规则带了 `!important` → 反杀 archify 的 reduced-motion 无障碍规则（e2e 守）。
   * 详细决策与实测数字见 docs/adr/0016-lab-interactive-atlas.md §十五、
   * docs/specs/line-hierarchy.md §七。
   */
  const SPEC_DIR = join(ROOT, 'scripts', 'atlas', 'specs');
  const specOf = (id: string) =>
    JSON.parse(readFileSync(join(SPEC_DIR, `${id}.dataflow.json`), 'utf-8'));

  /** 与 skin.mjs 的生成期闸门同一套拆法（选择器 → 声明体） */
  const cssRules = (css: string) =>
    [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({
      selector: (m[1].split('*/').pop() ?? '').trim().replace(/\s+/g, ' '),
      body: m[2],
    }));

  const EDGE_RULE_SELECTOR = 'html[data-gb] svg[data-animation="trace"] [data-animate="edge"]';
  // 2026-10-29：archify 3.2 删掉了 archify-edge-flow，动画名与 keyframes 改由皮肤自带
  // （gb-edge-flow），本条断言因此从「只改时长」变成「整条简写 + 归属本站」。
  const EDGE_RULE_DECL =
    `animation:gb-edge-flow ${TRACE.DURATION_MS}ms steps(${TRACE.STEPS},end) 1!important` +
    `;animation-delay:calc(var(--step,0) * 160ms)!important`;

  it('规格真的开了 trace 开关（改了皮肤却没开开关 = 静默无效果）', () => {
    for (const d of LAB_DIAGRAMS) {
      expect(
        specOf(d.id).meta.animation,
        `${d.id} 的 meta 少了 "animation":"trace" —— archify 只有这个字段才产出 data-animate`
      ).toBe('trace');
    }
  });

  it('产物内联 SVG 带 data-animation=trace，且走线/节点条数与规格逐条对得上', () => {
    for (const d of LAB_DIAGRAMS) {
      const svg = extractMainSvg(readArtifact(d.id));
      const spec = specOf(d.id);
      expect(
        /<svg[^>]* data-animation="trace"/.test(svg),
        `${d.id} 的内联 SVG 根没有 data-animation="trace"`
      ).toBe(true);
      expect((svg.match(/data-animate="edge"/g) ?? []).length, '走线条数 ≠ flows 数').toBe(
        spec.flows.length
      );
      expect((svg.match(/data-animate="node"/g) ?? []).length, '节点条数 ≠ nodes 数').toBe(
        spec.nodes.length
      );
      // 防「两边同时归零」的假绿：条数不能是 0
      expect(spec.flows.length).toBeGreaterThan(0);
      expect(spec.nodes.length).toBeGreaterThan(0);
    }
  });

  it('归零规则没被削弱：拆出来的那条只豁免走线，节点脉冲照旧归零', () => {
    /**
     * 反面写法是最危险的那种：把 `:not([data-animate="edge"])` 误写成
     * `:not([data-animate="node"])` —— 于是走线被归零（看不到通电）、
     * 节点脉冲反而复活（drop-shadow 糊化辉光），两个方向都反了。
     */
    const css = buildSkinCss(THEMES);
    const all = cssRules(css);

    const wide = all.find(
      (r) => r.selector === 'html[data-gb] *,html[data-gb] *::before,html[data-gb] *::after'
    )!;
    expect(wide, '那条宽规则不见了').toBeTruthy();
    expect(
      wide.body,
      '宽规则里还留着 animation-duration —— 豁免会在同档特异性下被它压掉（源码顺序在后才赢）'
    ).not.toContain('animation-duration');
    expect(wide.body).not.toContain('transition-duration');

    const scoped = all.filter((r) => r.selector.includes(':not([data-animate="edge"])'));
    expect(scoped.length, '归零规则应恰好一条（拆分出来那条）').toBe(1);
    expect(scoped[0]!.selector).toContain('[data-animate="edge"]');
    expect(scoped[0]!.body).toContain('animation-duration:0s!important');
    expect(scoped[0]!.body).toContain('transition-duration:0s!important');

    // 顺序：豁免规则必须在归零规则之后（同特异性下后者胜）
    expect(
      css.indexOf(scoped[0]!.selector),
      '归零规则排在豁免规则之后 —— 走线会被归零压死'
    ).toBeLessThan(css.indexOf(EDGE_RULE_SELECTOR));
  });

  it('豁免规则：选择器与声明体精确，且**不带 !important**（带了反杀无障碍）', () => {
    /**
     * 这是本轮最关键的一条守卫。archify 自带
     * `@media (prefers-reduced-motion:reduce){ svg[data-animation="trace"] [data-animate]{animation:none!important} }`
     * （模板 template.html:4703-4711，特异性 0,2,1 **但带 !important**）。
     * 本站豁免一旦也带 `!important`，同样的 important 下比特异性（我们的 0,3,2 更高）——
     * **本站规则会赢**，于是「开了 reduced-motion 的读者看到走线在扫」——
     * 那是反杀无障碍，不是风格取舍（e2e「reduced-motion 完全不动」是同一条的另一半）。
     */
    const css = buildSkinCss(THEMES);
    // 规则现在住在 @media 里，简化的 cssRules() 会把 @media 整段吞掉 —— 这里按选择器定位声明体
    const idx = css.indexOf(EDGE_RULE_SELECTOR);
    expect(idx, `豁免规则缺失或选择器被改动：${EDGE_RULE_SELECTOR}`).toBeGreaterThan(-1);
    const open = css.indexOf('{', idx);
    const close = css.indexOf('}', open);
    const body = css.slice(open + 1, close);
    expect(body).toBe(EDGE_RULE_DECL);
    // fill 不得是 both：写了会把 100% 的 dasharray 永久留在走线上，稳态从实线变虚线
    expect(body, '豁免规则带 fill both —— 稳态会停在虚线段').not.toMatch(/both/);
    // !important 本身是允许的（要压 3.2 的 data-motion-capable 兜底 kill），
    // 但**必须整条被 no-preference 门住**：门是那层 !important 的合法性来源，reduced 下根本不进层叠。
    const gate = css.indexOf('@media (prefers-reduced-motion:no-preference)');
    expect(gate, '豁免规则没有被 prefers-reduced-motion:no-preference 门控').toBeGreaterThan(-1);
    expect(gate, '豁免规则不在门控块内（门必须在选择器之前）').toBeLessThan(idx);
    // 门块闭合：选择器之后到下一个 } 之后才有其他规则，粗检「门块覆盖到本规则」
    expect(css.slice(gate, idx)).not.toContain('}');
    // keyframes 由本站提供（上游 3.2 已无此动画）
    expect(css, '缺少本站的 gb-edge-flow keyframes').toContain('@keyframes gb-edge-flow{');
    expect(css).toContain('stroke-dashoffset:54');
  });

  it('节奏常量同源：CSS 里的时长/阶跃就是 TRACE 的插值结果', () => {
    const css = buildSkinCss(THEMES);
    expect(css).toContain(`${TRACE.DURATION_MS}ms`);
    expect(css).toContain(`steps(${TRACE.STEPS},end)`);
    // 常量必须与上游 archify 的 2.4s 一致（改这里等于改观感，得先看 line-hierarchy §七）
    expect(TRACE.DURATION_MS).toBe(2400);
    // 产物（会一起提交的那份）也必须带上
    for (const d of LAB_DIAGRAMS) expect(readArtifact(d.id)).toContain(EDGE_RULE_DECL);
  });

  it('#btn-motion 被藏掉且登记在册；boot script 清掉历史遗留的 archify-motion', () => {
    /**
     * 「隐藏按钮 ≠ 关掉开关」的第三次应用（前两次是 T 与 S）。
     * 这个按钮是 archify 的「暂停动效」开关：一次性入场跑完它就没有对象了，
     * 而它会把 `archify-motion=still` 写进**同源 localStorage**（第二套偏好键，
     * 非本站 `8bitme:*` 约定）—— 且历史遗留的 `still` 会让图册**永久不播入场**，
     * 页面上毫无异常。故 boot script（注入在 </head>，早于上游 governor）负责清掉它。
     */
    const selector = 'html[data-gb] #btn-motion';
    const css = buildSkinCss(THEMES);
    expect(css).toContain(`${selector}{display:none!important}`);
    expect(HIDDEN_ALLOWLIST.map((a) => a.selector)).toContain(selector);
    expect(OVERRIDES.map((o) => o.selector), 'OVERRIDES 与 HIDDEN_ALLOWLIST 必须都登记').toContain(
      selector
    );
    expect(buildBootScript(THEMES)).toContain("removeItem('archify-motion')");
    for (const d of LAB_DIAGRAMS) expect(readArtifact(d.id)).toContain("removeItem('archify-motion')");
  });
});

describe('/lab 路由契约', () => {
  it('每条 LAB_DIAGRAMS 都有对应的动态路由页面', () => {
    expect(existsSync(join(ROOT, 'src', 'pages', 'lab', 'index.astro'))).toBe(true);
    expect(existsSync(join(ROOT, 'src', 'pages', 'lab', '[id].astro'))).toBe(true);
  });

  it('Nav 有「实验场」入口且指向 /lab', () => {
    const nav = readFileSync(join(ROOT, 'src', 'components', 'Nav.astro'), 'utf-8');
    expect(nav).toContain('实验场');
    expect(nav).toContain("url('lab')");
  });
});
