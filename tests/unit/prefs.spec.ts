import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTogglePref, cursorPref, bgfxPref } from '../../src/lib/prefs';
import { installMemoryStorage, removeMemoryStorage } from './helpers/local-storage';

describe('createTogglePref（localStorage 持久化）', () => {
  beforeEach(() => installMemoryStorage());
  afterEach(() => removeMemoryStorage());

  it('无记录 → 默认值（默认 true；可传 false）', () => {
    expect(createTogglePref('k:toggle').get()).toBe(true);
    expect(createTogglePref('k:off-default', false).get()).toBe(false);
  });
  it('set/get 往返', () => {
    const p = createTogglePref('k:toggle');
    p.set(false);
    expect(p.get()).toBe(false);
    p.set(true);
    expect(p.get()).toBe(true);
  });
  it('脏值（非 on/off）按 off 解读', () => {
    localStorage.setItem('k:dirty', 'garbage');
    expect(createTogglePref('k:dirty').get()).toBe(false);
  });
  it('存储不可用 → get 回退默认、set 静默不抛', () => {
    removeMemoryStorage();
    const p = createTogglePref('k:fail');
    expect(p.get()).toBe(true);
    expect(() => p.set(false)).not.toThrow();
  });
});

describe('既有偏好装置（cursor/sfx/bgfx 同一基准）', () => {
  beforeEach(() => installMemoryStorage());
  afterEach(() => removeMemoryStorage());

  it('cursorPref / bgfxPref 存取往返', () => {
    cursorPref.set('reticle');
    expect(cursorPref.get()).toBe('reticle');
    bgfxPref.set('rain');
    expect(bgfxPref.get()).toBe('rain');
  });
  it('无记录 → null', () => {
    expect(cursorPref.get()).toBeNull();
    expect(bgfxPref.get()).toBeNull();
  });
});
/**
 * bgfx 双档退役契约（源码级，2026-09-25 作者：「core 退役换成 world 背景」+
 * 「不要把 dev 功能上线」）。跨文件契约不需要浏览器，故放单测层（快 100 倍）。
 */
describe('bgfx 退役契约：core 模式 + DEV 入口都不许回到生产', () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');

  it('BgFx 模式表只剩 off / world，且 normalize 明确把已退役的 core 归一到 world', () => {
    const bgfx = read('src/components/BgFx.astro');
    expect(bgfx).toContain("const MODES = ['off', 'world'] as const;");
    // 注释里会正当提及 core 的退役历史，所以只守**代码路径**不许复活
    expect(bgfx).not.toMatch(/MODES = \[[^\]]*'core'/);
    expect(bgfx).not.toMatch(/mode === 'core'/);
    expect(bgfx).not.toMatch(/v === 'core'/);
    // 归一必须显式覆盖 core 存档（老访客的 localStorage 里可能还躺着 'core'）
    expect(bgfx).toMatch(/function normalize[\s\S]{0,160}?return DEFAULT_MODE/);
  });

  it('SideDock 循环表只剩 off / world，且 core 存量归一', () => {
    const dock = read('src/components/SideDock.astro');
    expect(dock).toContain("const MODE_LIST = ['off', 'world'] as const;");
    expect(dock).not.toMatch(/LABELS[^\n]*core/);
  });

  it('DEV 调试台双门：模板与脚本都在 import.meta.env.DEV 门下', () => {
    const dock = read('src/components/SideDock.astro');
    expect(dock, '模板缺 DEV 门').toMatch(/\{import\.meta\.env\.DEV && \(<>/);
    expect(dock, '脚本缺 DEV 门').toMatch(/if \(import\.meta\.env\.DEV\) \{/);
  });

  it('机箱 core 的实现整块退役：BgFx 不再有 stepCore/drawCore，bgfx-motion 不再导出机器族', () => {
    const bgfx = read('src/components/BgFx.astro');
    expect(bgfx).not.toMatch(/stepCore|drawCore|coreGlow|MachineChip|SECTION_IDS/);
    const motion = read('src/lib/bgfx-motion.ts');
    expect(motion).not.toMatch(/export (function|const|type|interface) (coreGlow|GLOW|genMachineLayout|cameraFor|contentBox|genSectionTargets)/);
    // world 侧仍在消费的四个纯函数必须留着（用子串而非 \b：模板字符串里 \b 是退格符）
    for (const keep of ['easeSilk', 'mix', 'lightThemeLineFactor', 'scrimCoverage']) {
      expect(motion, `${keep} 被误删`).toContain(`export function ${keep}`);
    }
  });
});
