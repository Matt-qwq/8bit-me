import { beforeEach, describe, expect, it, vi } from 'vitest';

// astro:content 是 Astro 构建期虚拟模块，vitest node 环境需 mock
vi.mock('astro:content', () => ({
  getCollection: vi.fn(),
}));

import { getCollection } from 'astro:content';
import { formatDate, getPublishedPosts } from '../../src/lib/posts';

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