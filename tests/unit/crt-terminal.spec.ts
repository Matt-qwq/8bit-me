import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * CRT 终端（hero 工位屏内容物）源码契约
 *
 * 2026-10-02 作者终局裁决：屏里是电脑，内容必须是**代码生成的终端**（光标在
 * 打字）——ComfyUI 生成图片路线（v3/v4 屏内画）封存，AvatarSprite 组件与
 * avatar-crt.png 资产已删除。本轮（round 05）：**四个命令剧本随机轮播**
 * （放完一个随机挑下一个，不连续重复），带终端窗口 chrome（标题栏/状态栏）。
 * 这里拦六类静默失效：
 *   1. 旧件复活（AvatarSprite / avatar-crt.png 被引用回来）
 *   2. 字面量颜色（必须全走 --c-* token，随 themes.ts 单档走）
 *   3. 无 JS 兜底丢失（服务端渲染剧本 A 转写没了 = 无 JS 白屏）
 *   4. 轮播机制丢失（剧本数 ≠ 4 / 起播与续播的随机性没了 / 连续重复）
 *   5. 动效惯例漂移（光标 1s steps(2, start) + 敲键常亮类；章节门控）
 *   6. 命令行超宽（Zpix 半宽 6px × 26 字符 = 156px 屏内容宽，超宽换行破相）
 * 观感（节奏/文案）留作者本地预览；真渲染守卫 → tests/e2e/crt-terminal.spec.ts
 */

const ROOT = process.cwd();
const SRC = readFileSync(
  join(ROOT, 'src/components/CrtTerminal.astro'),
  'utf-8'
).replace(/\r\n/g, '\n');
const HERO = readFileSync(
  join(ROOT, 'src/components/sections/Hero.astro'),
  'utf-8'
).replace(/\r\n/g, '\n');

/** 递归收集 src/ 下源码文件（拦「旧件复活」用） */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(astro|ts|css)$/.test(name)) out.push(p);
  }
  return out;
}

describe('CRT 终端源码契约', () => {
  it('旧件已死：AvatarSprite 组件与 avatar-crt.png 资产不存在，且全仓零引用', () => {
    expect(statSync(join(ROOT, 'src/components/AvatarSprite.astro'), { throwIfNoEntry: false })?.isFile() ?? false).toBe(false);
    expect(statSync(join(ROOT, 'public/img/avatar-crt.png'), { throwIfNoEntry: false })?.isFile() ?? false).toBe(false);
    const stale = walk(join(ROOT, 'src')).filter((f) => /AvatarSprite|avatar-crt/.test(readFileSync(f, 'utf-8')));
    expect(stale, `旧头像引用残留：${stale.join(', ')}`).toEqual([]);
  });

  it('Hero 挂载的是 CrtTerminal，不再是任何图片头像', () => {
    expect(HERO).toContain("import CrtTerminal from '../CrtTerminal.astro'");
    expect(HERO).toContain('<CrtTerminal />');
    expect(HERO).not.toMatch(/AvatarSprite|<img/);
  });

  it('零字面量颜色：只走 --c-* token（themes.ts 单档唯一数据源）', () => {
    const literals = SRC.match(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/g) ?? [];
    expect(literals, `发现字面量颜色：${literals.join(', ')}`).toEqual([]);
    for (const token of ['var(--c-bg)', 'var(--c-text)', 'var(--c-accent)', 'var(--c-line)', 'var(--c-panel)']) {
      expect(SRC, `缺少 ${token}`).toContain(token);
    }
  });

  it('无 JS 兜底：服务端渲染剧本 A 转写（<pre> + data-scripts 同源数据）', () => {
    expect(SRC).toMatch(/<pre class="term-fallback">\{fallback\}/);
    expect(SRC).toMatch(/data-scripts=\{JSON\.stringify\(SCRIPTS\)\}/);
    expect(SRC).toContain("'$ '");
  });

  it('数据同源：文章列表/篇数/更新日期来自 getPublishedPosts', () => {
    expect(SRC).toContain("import { getPublishedPosts, formatDate } from '../lib/posts'");
    expect(SRC).toContain('posts.length');
    expect(SRC).toContain('p.id}.md');
  });

  it('四个剧本随机轮播：起播随机 + 续播随机且不连续重复', () => {
    const scriptCount = (SRC.match(/\{ cmd: '/g) ?? []).length;
    expect(scriptCount, '四个剧本至少各含一条命令（≥8 条 cmd）').toBeGreaterThanOrEqual(8);
    expect(SRC).toContain('let current = Math.floor(Math.random() * scripts.length)');
    expect(SRC).toContain('(scripts.length - 1)');
    expect(SRC).toContain('4200');
  });

  it('终端窗口 chrome：标题栏 matt@8bit-me + 状态栏 zsh · 80×19 在位', () => {
    expect(SRC).toContain('matt@8bit-me: ~');
    expect(SRC).toContain('zsh · 80×19');
    expect(SRC).toContain('term-titlebar');
    expect(SRC).toContain('term-status');
  });

  it('动效惯例：光标 1s steps(2, start) 默认闪烁 + 敲键 .solid 常亮；章节门控；裁剪滚动', () => {
    expect(SRC).toContain('term-blink 1s steps(2, start) infinite');
    expect(SRC).toContain('.term-caret.solid');
    expect(SRC).toContain('IntersectionObserver');
    expect(SRC).toMatch(/scrollHeight > body\.clientHeight/);
    expect(SRC).toContain("setTimeout(typeKey, 55)");
  });

  it('命令行 ≤26 字符（156px 屏内容宽 ÷ Zpix 半宽 6px，超宽换行破相）', () => {
    const cmds = [...SRC.matchAll(/\{ cmd: '([^']+)' \}/g)].map((m) => m[1]!);
    expect(cmds.length, '应解析到全部命令').toBeGreaterThanOrEqual(8);
    for (const cmd of cmds) {
      expect(cmd.length, `命令超宽：'${cmd}'（${cmd.length} > 26）`).toBeLessThanOrEqual(26);
    }
  });

  it('输出行静态文本不超宽（显示宽 CJK=2；模板字面量按「静态段 ≤20」预留 6 半宽插值预算）', () => {
    // 2026-10-03 P0② 实锤：`night · GUANGZHOU · 19 posts`（28 半宽）把守卫漏穿——
    // 旧守卫只查 cmd 行。out 行是折行破相的真正发生地，这里按显示宽补守。
    const dw = (s: string) => [...s].reduce((n, ch) => n + (ch.codePointAt(0)! > 0xff ? 2 : 1), 0);
    const outs = [...SRC.matchAll(/\{ out: \[([\s\S]*?)\] \}/g)].map((m) => m[1]!);
    expect(outs.length, '应解析到全部输出数组').toBeGreaterThanOrEqual(4);
    for (const entry of outs) {
      for (const q of [...entry.matchAll(/'([^']*)'/g)]) {
        expect(dw(q[1]!), `输出行超宽：'${q[1]}'（显示宽 ${dw(q[1]!)} > 26）`).toBeLessThanOrEqual(26);
      }
      for (const tpl of [...entry.matchAll(/`([^`]*)`/g)]) {
        for (const chunk of tpl[1]!.split(/\$\{[^}]*\}/)) {
          expect(
            dw(chunk),
            `模板输出行静态段超宽：'${chunk}'（显示宽 ${dw(chunk)} > 20，插值预算 6 半宽）`
          ).toBeLessThanOrEqual(20);
        }
      }
    }
  });

  it('运行时元素样式全局可达：轮播行/光标是 JS 创建的，拿不到 scoped cid', () => {
    // 2026-10-03 P0② 实锤：.line / .term-caret 写在 scoped <style> 里，JS 创建的
    // 元素没有 data-astro-cid → 样式全丢（输出行换行破相、光标裸奔）。这类样式
    // 必须住 <style is:global> 且以 [data-term] 后代选择器限定。
    expect(SRC).toContain('<style is:global>');
    expect(SRC).toMatch(/\[data-term\] \.line\s*\{[^}]*white-space:\s*pre/);
    expect(SRC).toMatch(/\[data-term\] \.term-caret\s*\{[^}]*animation:\s*term-blink/);
    expect(SRC).toMatch(/\[data-term\] \.line-prompt\s*\{[^}]*var\(--c-accent\)/);
  });

  it('布局零位移：敲键区 overflow hidden 锁死；只改文本/节点不改容器结构', () => {
    expect(SRC).toMatch(/\.term-body\s*\{[^}]*overflow:\s*hidden/);
    expect(SRC).toMatch(/white-space:\s*pre/);
    expect(SRC).not.toContain('innerHTML');
  });

  it('无障碍：装饰层 aria-hidden（数据已由 hero 读数承载）；标识语言为 Zpix', () => {
    expect(SRC).toMatch(/aria-hidden="true"/);
    expect(SRC).toContain('var(--font-pixel)');
  });

  it('插画壳：窄屏居中栈保留 4px accent 边框（桌面档由 Hero 覆盖退场）', () => {
    expect(SRC).toMatch(/border:\s*4px\s+solid\s+var\(--c-accent\)/);
  });
});
