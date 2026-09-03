import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 静态契约守卫（不开浏览器）
 *
 * 背景（2026-08-29 作者发现的 bug）：siteConfig.nav 是纯锚点（#hero …），
 * 而 Nav.astro 由 BaseLayout 全站挂载 —— /blog 与 /404 页没有这些 id，
 * 点击静默失效。e2e 只测渲染所以漏掉，而这条契约在 vitest 里就能拦住：
 * 「引用是否指向真实存在的东西」不需要真实 DOM。
 *
 * 分工（与 e2e 的边界）：
 *   单测守「引用指向存在的东西」——配置/内容/链接的数据一致性
 *   e2e  守「点击之后浏览器里真的发生」——滚动落位、hash、canvas、控制台
 */

const ROOT = process.cwd();
const SECTIONS_DIR = join(ROOT, 'src/components/sections');
const BLOG_DIR = join(ROOT, 'src/content/blog');

/** 首页 section 的真实 id 集合（从 sections/*.astro 的 <section id="…"> 解析） */
function homeSectionIds(): Set<string> {
  const ids = new Set<string>();
  for (const file of readdirSync(SECTIONS_DIR).filter((f) =>
    f.endsWith('.astro')
  )) {
    const src = readFileSync(join(SECTIONS_DIR, file), 'utf-8');
    for (const m of src.matchAll(/<section[^>]*\bid="([^"]+)"/g)) {
      ids.add(m[1]);
    }
  }
  return ids;
}

/** 博客文章的 slug 集合（文件名去扩展名） */
function postSlugs(): Set<string> {
  return new Set(
    readdirSync(BLOG_DIR)
      .filter((f) => f.endsWith('.md'))
      .map((f) => f.replace(/\.md$/, ''))
  );
}

/** 读取某篇 frontmatter 的 draft 值（默认 false） */
function isDraft(slug: string): boolean {
  const src = readFileSync(join(BLOG_DIR, `${slug}.md`), 'utf-8');
  const m = src.match(/^draft:\s*(true|false)\s*$/m);
  return m?.[1] === 'true';
}

describe('nav 锚点契约', () => {
  const ids = homeSectionIds();

  it('解析到首页 section id（守卫本身有效）', () => {
    expect(ids.size).toBeGreaterThanOrEqual(5);
    for (const id of ['hero', 'about', 'projects', 'skills', 'contact']) {
      expect(ids, `首页缺少 section #${id}`).toContain(id);
    }
  });

  it('siteConfig.nav 的每个锚点都指向真实存在的首页 section', async () => {
    const { siteConfig } = await import('../../src/lib/config');
    for (const item of siteConfig.nav) {
      expect(item.href, `nav "${item.label}" 应是锚点`).toMatch(/^#/);
      expect(
        ids,
        `nav "${item.label}" 指向 ${item.href}，但首页没有这个 section id`
      ).toContain(item.href.slice(1));
    }
  });

  it('nav 顺序与首页 section 组件渲染顺序一致', async () => {
    const { siteConfig } = await import('../../src/lib/config');
    const index = readFileSync(join(ROOT, 'src/pages/index.astro'), 'utf-8');
    // index.astro 里 section 组件的挂载顺序
    const order = [...index.matchAll(/<(\w+)\s*\/>/g)]
      .map((m) => m[1].toLowerCase())
      .filter((name) => ids.has(name));
    const navOrder = siteConfig.nav.map((i) => i.href.slice(1));
    // hero 由 Hero.astro 提供；index 里若首项为 Hero 则对齐
    expect(
      order.filter((n) => navOrder.includes(n)),
      'nav 顺序应与 index.astro 的 section 挂载顺序一致'
    ).toEqual(navOrder.filter((n) => order.includes(n)));
  });
});

describe('projects 链接契约', () => {
  it('projects[].url 指向真实且非 draft 的文章', async () => {
    const { siteConfig } = await import('../../src/lib/config');
    const slugs = postSlugs();
    for (const p of siteConfig.projects) {
      if (!p.url) continue; // 未发布的项目允许空链接
      const slug = p.url.replace(/^\/blog\//, '').replace(/\/$/, '');
      expect(slugs, `项目「${p.name}」指向不存在的文章 ${p.url}`).toContain(
        slug
      );
      expect(
        isDraft(slug),
        `项目「${p.name}」指向 draft 文章 ${p.url}（线上不会生成路由）`
      ).toBe(false);
    }
  });
});
