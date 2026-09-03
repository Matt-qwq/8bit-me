import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createTogglePref,
  cursorPref,
  themePref,
  bgfxPref,
} from '../../src/lib/prefs';
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

describe('既有偏好装置（crt/cursor/sfx/theme/bgfx 同一基准）', () => {
  beforeEach(() => installMemoryStorage());
  afterEach(() => removeMemoryStorage());

  it('cursorPref / themePref / bgfxPref 存取往返', () => {
    cursorPref.set('reticle');
    expect(cursorPref.get()).toBe('reticle');
    themePref.set('pico8-dusk');
    expect(themePref.get()).toBe('pico8-dusk');
    bgfxPref.set('rain');
    expect(bgfxPref.get()).toBe('rain');
  });
  it('无记录 → null', () => {
    expect(cursorPref.get()).toBeNull();
    expect(themePref.get()).toBeNull();
    expect(bgfxPref.get()).toBeNull();
  });
});