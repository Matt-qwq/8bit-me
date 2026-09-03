import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  SOUND_ROLES,
  playRole,
  sfxEnabled,
  setSfxEnabled,
  type SfxRole,
} from '../../src/lib/sfx';
import { installMemoryStorage, removeMemoryStorage } from './helpers/local-storage';

const ROLES: SfxRole[] = ['click', 'game', 'hover', 'nav', 'select', 'toggle'];

/* ---------- sfx 开关偏好（委托 sfxPref） ---------- */
describe('sfx 开关偏好（委托 sfxPref）', () => {
  beforeEach(() => installMemoryStorage());
  afterEach(() => removeMemoryStorage());

  it('默认开', () => {
    expect(sfxEnabled()).toBe(true);
  });
  it('setSfxEnabled(false) 后关闭，再开恢复', () => {
    setSfxEnabled(false);
    expect(sfxEnabled()).toBe(false);
    setSfxEnabled(true);
    expect(sfxEnabled()).toBe(true);
  });
});

/* ---------- SOUND_ROLES 映射表完备性（ADR-0007 的数据契约） ---------- */
describe('SOUND_ROLES 映射表完备', () => {
  it('六个角色全部有定义，无多余', () => {
    expect(Object.keys(SOUND_ROLES).sort()).toEqual([...ROLES].sort());
  });

  it('每个角色的节点参数合法（波形/频率/时长/音量/视觉联动 kind）', () => {
    for (const [role, spec] of Object.entries(SOUND_ROLES)) {
      expect(spec.nodes.length, `${role} 至少一个合成节点`).toBeGreaterThan(0);
      for (const n of spec.nodes) {
        expect(n.wave, `${role} 波形合法`).toMatch(
          /^(square|triangle|sawtooth|sine|noise)$/
        );
        if (n.wave !== 'noise') {
          expect(n.freq, `${role} 频率为正`).toBeGreaterThan(0);
        }
        expect(n.dur, `${role} 时长为正`).toBeGreaterThan(0);
        expect(n.vol, `${role} 音量为正`).toBeGreaterThan(0);
        expect(n.vol, `${role} 音量 ≤ 1`).toBeLessThanOrEqual(1);
        if (n.delay !== undefined) expect(n.delay, `${role} 延迟非负`).toBeGreaterThanOrEqual(0);
      }
      expect(spec.fx, `${role} 视觉联动 kind 合法`).toMatch(/^(click|nav|hover)$/);
    }
  });

  it('六角色的音效互不相同（防"同一个音效"回潮：任一角色参数组不与他人完全重合）', () => {
    const keysOf = (spec: (typeof SOUND_ROLES)[SfxRole]) =>
      spec.nodes.map((n) => `${n.wave}:${n.freq}:${n.dur}:${n.vol}:${n.delay ?? 0}`).join('|');
    const seen = new Set<string>();
    for (const role of ROLES) {
      const k = keysOf(SOUND_ROLES[role]);
      expect(seen.has(k), `${role} 与其他角色参数重合`).toBe(false);
      seen.add(k);
    }
  });
});

/* ---------- 全站 data-sfx-role 属性契约（跨文件快测，开发流程文档「引用契约优先单测」） ---------- */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else if (/\.(astro|ts)$/.test(name)) out.push(p);
  }
  return out;
}

describe('全站 data-sfx-role / data-sfx-hover 属性契约', () => {
  const files = walk(join(process.cwd(), 'src'));
  let allText = '';
  beforeAll(() => {
    for (const f of files) allText += readFileSync(f, 'utf8') + '\n';
  });

  it('所有 data-sfx-role 属性值 ⊆ SOUND_ROLES keys', () => {
    const used = new Set<string>();
    const re = /data-sfx-role="([^"]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(allText))) used.add(m[1]);
    const keys = new Set(Object.keys(SOUND_ROLES));
    expect(used.size).toBeGreaterThan(0);
    for (const v of used) {
      expect(keys.has(v), `属性值不在映射表：${v}`).toBe(true);
    }
  });

  it('五类操作角色（nav/click/toggle/select/game）全站均有落地元素（防映射表写了但没接）', () => {
    for (const role of ['nav', 'click', 'toggle', 'select', 'game']) {
      expect(
        allText.includes(`data-sfx-role="${role}"`),
        `data-sfx-role="${role}" 应至少出现在一个元素上`
      ).toBe(true);
    }
  });

  it('data-sfx-hover 主控件标记存在（hover 角色有触发源）', () => {
    expect(allText).toContain('data-sfx-hover');
  });
});

/* ---------- 无 window 环境（SSR/node）安全 ---------- */
describe('无 window 环境（SSR/node）安全', () => {
  it('playRole 在无 AudioContext 时不抛', () => {
    for (const role of ROLES) {
      expect(() => playRole(role)).not.toThrow();
    }
  });
});