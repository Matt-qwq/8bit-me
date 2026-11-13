import { beforeEach, describe, expect, it, vi } from 'vitest';

// astro:content 是 Astro 构建期虚拟模块，vitest node 环境需 mock
vi.mock('astro:content', () => ({
  getCollection: vi.fn(),
}));

import { getCollection } from 'astro:content';
import {
  formatDate,
  getPublishedPosts,
  getTagCounts,
  getTagRoutes,
  tagSlug,
} from '../../src/lib/posts';

const asPost = (id: string, date: string, draft: boolean) => ({
  id,
  data: { draft, date: new Date(date) },
});

describe('formatDate UTC 渲染（防 UTC- 时区读者看到前一天）', () => {
  it('固定 Z 时间串 → 按 UTC 取日，与本地时区无关', () => {
    expect(formatDate(new Date('2026-08-27T00:00:00Z'))).toBe('2026-08-27');
    // UTC 已是 8/31 晚、东八区已是 9/1 —— 必须仍渲染 8/31
    expect(formatDate(new Date('2026-08-31T16:00:00Z'))).toBe('2026-08-31');
    expect(formatDate(new Date('2026-01-05T01:00:00Z'))).toBe('2026-01-05');
  });
  it('月份/日期前导补零', () => {
    expect(formatDate(new Date('2026-03-07T12:34:00Z'))).toBe('2026-03-07');
    expect(formatDate(new Date('2026-12-31T23:59:59Z'))).toBe('2026-12-31');
  });
});

describe('getPublishedPosts（draft 过滤 + 日期倒序）', () => {
  beforeEach(() => {
    vi.mocked(getCollection).mockResolvedValue([
      asPost('old', '2026-08-01', false),
      asPost('draft', '2026-09-01', true),
      asPost('mid', '2026-08-15', false),
      asPost('new', '2026-08-27', false),
    ] as never);
  });

  it('draft 文章不上公开列表（User Story 16）', async () => {
    const posts = await getPublishedPosts();
    expect(posts.map((p) => p.id)).not.toContain('draft');
  });
  it('按 date 倒序（新的在前）', async () => {
    const posts = await getPublishedPosts();
    expect(posts.map((p) => p.id)).toEqual(['new', 'mid', 'old']);
  });
});
/**
 * 标签索引（roadmap P2-3 第二种内容视图的数据层）
 *
 * 这层是索引页与详情页的**唯一数据源**：两页都调 getTagRoutes，
 * 所以「索引页列出的链接」与「真实生成的路由」在结构上不可能分叉。
 * 本组守三件事：门槛（不铺单篇标签）、顺序确定（同输入同输出）、slug 可用且不撞。
 */
const tagged = (id: string, tags: string[]) => ({
  id,
  data: { draft: false, date: new Date('2026-09-01'), tags },
});

describe('getTagCounts（门槛 + 确定性排序）', () => {
  const posts = [
    tagged('a', ['方法论', 'Python']),
    tagged('b', ['方法论', 'RPA']),
    tagged('c', ['方法论', 'Python', 'RPA']),
    tagged('d', ['只出现一次']),
  ] as never;

  it('默认只收录 ≥2 篇的标签（单篇标签不铺：P2-3 前提的实质）', () => {
    const tags = getTagCounts(posts);
    expect(tags.map((t) => t.tag)).not.toContain('只出现一次');
    expect(tags.map((t) => t.tag).sort()).toEqual(['Python', 'RPA', '方法论']);
  });

  it('先按篇数降序，同数按标签名（结果确定：同输入同顺序）', () => {
    const once = getTagCounts(posts).map((t) => `${t.tag}:${t.count}`);
    const twice = getTagCounts(posts).map((t) => `${t.tag}:${t.count}`);
    expect(once).toEqual(['方法论:3', 'Python:2', 'RPA:2']);
    expect(twice).toEqual(once);
  });

  it('min 可调（=1 时单篇标签也收录）', () => {
    expect(getTagCounts(posts, 1)).toHaveLength(4);
  });
});

describe('tagSlug / getTagRoutes（URL 可用且不撞）', () => {
  it('slug 规则：小写、空格转连字符、去标点，中日韩与拉丁字母数字保留', () => {
    expect(tagSlug('design tokens')).toBe('design-tokens');
    expect(tagSlug('Web Audio API')).toBe('web-audio-api');
    expect(tagSlug('方法论')).toBe('方法论');
    expect(tagSlug('  C++  ')).toBe('c');
  });

  it('所有 slug 非空、不含空格与需转义的 ASCII 标点', () => {
    const posts = [
      tagged('a', ['design tokens', '方法论', 'C++', 'Web Audio API']),
      tagged('b', ['design tokens', '方法论', 'C++', 'Web Audio API']),
    ] as never;
    for (const r of getTagRoutes(posts)) {
      expect(r.slug, `${r.tag} 的 slug 不应为空`).not.toBe('');
      expect(r.slug).not.toMatch(/[\s!"#$%&'()*+,/:;<=>?@[\]^`{|}~]/);
    }
  });

  it('slug 冲突时按先到先得加 -2 / -3（顺序确定，同一内容永远同一组 URL）', () => {
    // 'C++' 与 'C#' 都会 slug 成 'c'；顺序由 getTagCounts 决定，故结果可预期
    const posts = [
      tagged('a', ['C++', 'C#']),
      tagged('b', ['C++', 'C#']),
    ] as never;
    const routes = getTagRoutes(posts);
    const slugs = routes.map((r) => r.slug);
    expect(new Set(slugs).size, `slug 撞了：${slugs.join(', ')}`).toBe(slugs.length);
    expect(slugs).toContain('c');
    expect(slugs.some((x) => x === 'c-2')).toBe(true);
  });

  it('路由项与计数一致、且携带展示名（索引页要显示原始标签名）', () => {
    const posts = [tagged('a', ['方法论']), tagged('b', ['方法论'])] as never;
    const [route] = getTagRoutes(posts);
    expect(route).toMatchObject({ tag: '方法论', slug: '方法论', count: 2 });
  });
});
