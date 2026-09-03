import { describe, expect, it } from 'vitest';
import { url, siteConfig } from '../../src/lib/config';

describe('url 基路径拼接（BASE_URL 钉为根路径 "/"）', () => {
  it('剥离多余前导斜杠', () => {
    expect(url('/blog/x')).toBe('/blog/x');
    expect(url('blog/x')).toBe('/blog/x');
    expect(url('//blog')).toBe('/blog');
  });
});

describe('siteConfig 完整性', () => {
  it('标题/导航/社交链接形状正确', () => {
    expect(siteConfig.title).toBeTruthy();
    expect(siteConfig.nav.length).toBeGreaterThanOrEqual(5);
    for (const s of siteConfig.social) {
      expect(['email', 'url']).toContain(s.type);
      expect(typeof s.label).toBe('string');
    }
  });

  it('已配置社交链接（value 非空）的值按 type 校验格式', () => {
    const active = siteConfig.social.filter((s) => s.value !== '');
    expect(active.length).toBeGreaterThan(0);
    for (const s of active) {
      if (s.type === 'email') {
        expect(s.value).toMatch(/^[^@\s]+@[^@\s]+\.[^@\s]+$/);
      } else {
        expect(s.value).toMatch(/^https?:\/\//);
      }
    }
  });
  it('skills level 在 0–5 档内', () => {
    for (const s of siteConfig.skills) {
      expect(s.level).toBeGreaterThanOrEqual(0);
      expect(s.level).toBeLessThanOrEqual(5);
    }
  });
});