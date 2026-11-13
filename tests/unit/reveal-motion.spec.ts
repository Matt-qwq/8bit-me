import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  REVEAL,
  REVEAL_PLAN,
  revealDelay,
  sweepKeyframes,
  sweepTeeth,
} from '../../src/lib/reveal-motion';
import { TRANS } from '../../src/lib/trans-math';

/**
 * reveal-motion —— 首页「一镜到底」章节进场编排的纯函数契约
 * 方案：docs/plans/home-scroll-reveal-redesign-2026-09.md（候选 A）。
 * 守三类东西：
 *  ① 编排表确定性（各章选择器清单 + 选择器指向的 id/class 真实存在 = 跨文件契约）
 *  ② 参数边界（幅度 ≤12px、stagger ≤60ms、阈值 = 0.2、时长 380ms）
 *  ③ 标题扫入：齿数 = 宽度/16 向上取整且 ≥1；keyframes 两段 steps() 守恒（0.65/0.35）
 *  ④ 翻页骨架退役契约：index.astro / Projects.astro 不再引用劫持与子屏机制
 */

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf-8').replace(/\r\n/g, '\n');

describe('编排表（REVEAL_PLAN）确定性', () => {
  it('各章选择器清单逐条钉死（标题先行；projects 卡片回到统一编排）', () => {
    expect(REVEAL_PLAN.map((p) => p.sec)).toEqual([
      '#hero',
      '#about',
      '#projects',
      '#skills',
      '#contact',
      'footer.footer',
    ]);
    expect(REVEAL_PLAN.map((p) => [...p.mods])).toEqual([
      [], // hero：无 reveal 子元素（首屏一根手指不碰）
      ['.section-title', '.pixel-panel p', '.meta li', '.featured li'], // 丝印元数据行随段落一起浮入（featured = 精选文章行）
      ['.section-title', '.pixel-panel.card'], // A6：6 卡网格随统一编排揭示
      ['.section-title', 'li.row'],
      ['.section-title', 'li'],
      ['.foot-line', '.foot-credit'], // A7：footer 沿用同一词汇，不加仪式
    ]);
  });

  it('每章 mods[0] 是标题位（delay 0 + 触发受光带扫入）；非标题章为空', () => {
    for (const p of REVEAL_PLAN) {
      if (p.mods.length === 0) continue;
      expect(p.mods[0], `${p.sec} 的首位应是标题位`).toMatch(/section-title|foot-/);
    }
  });

  it('选择器跨文件闭合：#id 在 src 的 .astro 里真的存在（引用不指向不存在的东西）', () => {
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.name.endsWith('.astro')) files.push(full);
      }
    };
    walk(join(ROOT, 'src'));
    const sources = files.map((f) => ({
      rel: relative(ROOT, f).split(sep).join('/'),
      text: readFileSync(f, 'utf-8'),
    }));
    for (const p of REVEAL_PLAN) {
      if (!p.sec.startsWith('#')) continue;
      const id = p.sec.slice(1);
      expect(
        sources.some((s) => new RegExp(`id="${id}"`).test(s.text)),
        `编排表指向 ${p.sec}，但 src 里没有 id="${id}"`
      ).toBe(true);
    }
    // footer 同理（class 形式）
    expect(sources.some((s) => s.text.includes('class="footer"'))).toBe(true);
  });
});

describe('参数边界（A4：幅度/stagger/阈值/时长）', () => {
  it('幅度 ≤12px、stagger ≤60ms、阈值 = 0.2、时长 = 380ms', () => {
    expect(REVEAL.DIST).toBeLessThanOrEqual(12);
    expect(REVEAL.STAGGER).toBeLessThanOrEqual(60);
    expect(REVEAL.THRESHOLD).toBe(0.2);
    expect(REVEAL.DUR).toBe(380);
  });
  it('easing = Silk 单一运动种子（与打字机/hero-rise 同族）', () => {
    expect(REVEAL.EASING).toBe('cubic-bezier(0.22, 0.9, 0.24, 1)');
  });
  it('hero 视差系数 = 0.3（Q5）', () => {
    expect(REVEAL.HERO_PARALLAX).toBe(0.3);
  });
  it('revealDelay：下标 0 = 0ms、线性 +STAGGER、负下标钳 0', () => {
    expect(revealDelay(0)).toBe(0);
    expect(revealDelay(1)).toBe(REVEAL.STAGGER);
    expect(revealDelay(5)).toBe(5 * REVEAL.STAGGER);
    expect(revealDelay(-1)).toBe(0);
    for (let i = 1; i < 8; i++) {
      expect(revealDelay(i)).toBeGreaterThan(revealDelay(i - 1));
    }
  });
});

describe('标题扫入齿数（A5）= 宽度/TOOTH 向上取整且 ≥1', () => {
  it('常规宽度：896 → 56、17 → 2、16 → 1、1 → 1', () => {
    expect(TRANS.TOOTH).toBe(16);
    expect(sweepTeeth(896)).toBe(56);
    expect(sweepTeeth(17)).toBe(2);
    expect(sweepTeeth(16)).toBe(1);
    expect(sweepTeeth(1)).toBe(1);
  });
  it('边界：0 / 负数 / NaN / Infinity 一律兜 1 齿（绝不产出 steps(0)）', () => {
    expect(sweepTeeth(0)).toBe(1);
    expect(sweepTeeth(-120)).toBe(1);
    expect(sweepTeeth(Number.NaN)).toBe(1);
    expect(sweepTeeth(Number.POSITIVE_INFINITY)).toBe(1);
  });
  it('向上取整恒成立：任意宽度 w>0 → teeth = ceil(w/16) ≥ 1', () => {
    for (const w of [1, 15, 16.5, 100, 333, 896, 1440, 2560.1]) {
      expect(sweepTeeth(w)).toBe(Math.max(1, Math.ceil(w / TRANS.TOOTH)));
      expect(sweepTeeth(w)).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('扫入 keyframes：两段 steps() 守恒（同 curtainKeyframes("in") 0.65/0.35）', () => {
  it('首帧 0%、末帧 100%、两段步数守恒且前段 = round(steps×0.65)', () => {
    for (const teeth of [2, 5, 25, 56, 100]) {
      const kf = sweepKeyframes(teeth);
      expect(kf[0]!.width).toBe('0%');
      expect(kf[kf.length - 1]!.width).toBe('100%');
      if (kf.length === 3) {
        const segA = Number((kf[0]!.easing as string).match(/\d+/)?.[0] ?? 0);
        const segB = Number((kf[1]!.easing as string).match(/\d+/)?.[0] ?? 0);
        expect(segA + segB).toBe(teeth);
        expect(segA).toBe(Math.max(1, Math.round(teeth * 0.65)));
        // 中间帧 = nA/teeth 的百分比（快起：前段已扫过 65% 宽）
        expect(Number((kf[1]!.width as string).replace('%', ''))).toBeCloseTo(
          (segA / teeth) * 100,
          3
        );
      }
    }
  });
  it('steps=1（nB<1）回退单段整齿；非法入参兜 1 齿', () => {
    expect(sweepKeyframes(1)).toHaveLength(2);
    expect(sweepKeyframes(1)[0]!.easing).toBe('steps(1)');
    expect(sweepKeyframes(0)).toHaveLength(2);
    expect(sweepKeyframes(Number.NaN)).toHaveLength(2);
  });
  it('宽度单调不减（每一段都朝 100% 走，不来回）', () => {
    for (const teeth of [1, 2, 10, 56]) {
      const widths = sweepKeyframes(teeth).map((k) =>
        Number(String(k.width).replace('%', ''))
      );
      for (let i = 1; i < widths.length; i++) {
        expect(widths[i]!).toBeGreaterThanOrEqual(widths[i - 1]!);
      }
      expect(widths[widths.length - 1]).toBe(100);
    }
  });
});

describe('翻页骨架退役契约（源码级）', () => {
  const index = read('src/pages/index.astro');
  const projects = read('src/components/sections/Projects.astro');

  it('index.astro 不再有劫持/锁/子屏/内滚/scroll 同步（验证清单第 1 条）', () => {
    for (const banned of ['renderSub', 'proj-pager', 'busy', 'preventDefault', 'scrollTo']) {
      expect(index.includes(banned), `index.astro 仍含 "${banned}"`).toBe(false);
    }
    expect(index).not.toMatch(/addEventListener\(\s*'wheel'/);
    expect(index).not.toMatch(/addEventListener\(\s*'touch/);
  });

  it('index.astro 接线 reveal-motion（编排住在纯模块，DOM 只做接线）', () => {
    expect(index).toMatch(/from '\.\.\/lib\/reveal-motion'/);
    expect(index).toContain('REVEAL_PLAN');
    expect(index).toContain('IntersectionObserver');
    // 一次性揭示（Q2）：触发后 unobserve，不重放
    expect(index).toContain('io.unobserve');
  });

  it('Projects.astro：子屏/分页器机制与 is-paged CSS 全部移除，只剩 6 卡网格', () => {
    for (const banned of ['proj-page', 'proj-pager', 'subpages', 'is-paged', 'role="tab"']) {
      expect(projects.includes(banned), `Projects.astro 仍含 "${banned}"`).toBe(false);
    }
    expect(projects).toContain('proj-grid');
    expect(projects).toContain('siteConfig.projects.map');
  });

  it('global.css：标题扫入受光带存在（2px + accent token + 首页章节作用域）', () => {
    const css = read('src/styles/global.css');
    const m =
      /main#main > section\[id\] > \.container \.section-title::after\s*\{([^}]*)\}/.exec(css);
    expect(m, '标题受光带规则缺失').toBeTruthy();
    expect(m![1]).toMatch(/height:\s*2px/);
    expect(m![1]).toMatch(/background-color:\s*var\(--c-accent\)/);
    // 旧整屏翻页骨架的容器内滚 hack 不得复活
    expect(css).not.toMatch(/max-height:\s*100dvh;\s*\n\s*overflow-y:\s*auto/);
  });
});

describe('源码契约：hero 离场视差的 transform 载体（fixed 工位层不可被劫持）', () => {
  it('index.astro：视差不写 .hero-inner 的 transform，载体 = 铭牌内容元素', () => {
    const src = read('src/pages/index.astro');
    // 2026-10-01 散架事故：transform 挂 .hero-inner（铭牌）——祖先带 transform 时
    // fixed 后代（.hero-scene/.hero-cta）的包含块被劫持成铭牌盒，
    // 卡带从桌沿飞到右上角（x = plate.left + cartX）。这条契约防旧写法回流。
    expect(src, '离场视差不得写 heroInner.style.transform').not.toMatch(
      /heroInner\.style\.transform/
    );
    expect(src, '视差载体必须是铭牌内容元素（.hero-text/.hero-status/.hero-live）').toMatch(
      /\.hero-text, \.hero-status, \.hero-live/
    );
  });
  it('Hero.astro：hero-rise 不用 forwards/both 填充（否则 transform:none 永远压住视差的 inline transform）', () => {
    const css = read('src/components/sections/Hero.astro');
    expect(css).toMatch(/animation:\s*hero-rise 0\.32s steps\(3\) backwards;/);
    expect(css, 'hero-rise 的 forwards/both 填充会让最后一帧 transform:none 锁死视差').not.toMatch(
      /hero-rise 0\.32s steps\(3\)\s*(both|forwards)/
    );
  });
});
