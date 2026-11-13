import { describe, expect, it } from 'vitest';
import { buildToc } from '../../src/lib/toc';

/**
 * 文章目录（D3）：只守**抽取口径**与**锚点一致性**。
 * 锚点真的能跳由 e2e 守（refine-2026-10.spec.ts）——那里比对的是构建后
 * 正文 h2 的真实 id，比这里猜 slug 更可信。
 */
describe('buildToc：文章目录抽取', () => {
  it('只收 h2，按原文顺序，id 来自 github-slugger（与 Astro 同源）', () => {
    const md = ['# 标题', '', '## 一、开头', '正文', '### 小节', '## 二、结尾'].join('\n');
    const toc = buildToc(md, 2);
    expect(toc.map((t) => t.text)).toEqual(['一、开头', '二、结尾']);
    expect(toc[0]!.id).toBe('一开头');
    expect(toc[1]!.id).toBe('二结尾');
  });

  it('代码围栏里的 ## 不算标题（示例代码不是结构）', () => {
    const md = ['## A', '```md', '## 这不是标题', '```', '## B', '## C'].join('\n');
    const toc = buildToc(md, 3);
    expect(toc.map((t) => t.text)).toEqual(['A', 'B', 'C']);
  });

  it('重名标题拿到 -1 后缀（与 Astro 的编号顺序一致）', () => {
    const md = ['## 复盘', '## 复盘', '## 复盘'].join('\n');
    expect(buildToc(md, 3).map((t) => t.id)).toEqual(['复盘', '复盘-1', '复盘-2']);
  });

  it('少于 minCount 条返回空数组（短文加目录是噪声）', () => {
    expect(buildToc('## A\n## B', 3)).toEqual([]);
    expect(buildToc('## A\n## B\n## C', 3)).toHaveLength(3);
  });

  it('去掉行内标记（**粗体** / `代码` 不进入 id 与文案）', () => {
    const md = ['## **重点**与`code`', '## B', '## C'].join('\n');
    const toc = buildToc(md, 3);
    expect(toc[0]!.text).toBe('重点与code');
  });
});
