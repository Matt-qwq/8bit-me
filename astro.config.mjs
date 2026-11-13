// @ts-check
import { defineConfig } from 'astro/config';

// 部署目标：Netlify 根路径静态托管（见 docs/adr/0001 + docs/research/netlify-deploy-notes.md）。
//
// 环境变量约定：
//   ASTRO_BASE —— 部署子路径（默认 '/'，任意写法如 '8bit-me/' 会被规范化，空串 = 根路径）。
//   ASTRO_SITE —— 完整 site URL（Netlify 上应注入 https://<站点名>.netlify.app，用于 canonical/og:url）。
//                 若与 ASTRO_BASE 同时设置且 base 非根路径，需保证 ASTRO_SITE 以 ASTRO_BASE 结尾，否则告警。
const rawBase = process.env.ASTRO_BASE ?? '/';
// 归一化：去首尾斜杠；空串（ASTRO_BASE=/ 即根路径）归一为 '/'，避免拼出 '//'
const trimmed = rawBase.replace(/^\/+|\/+$/g, '');
const base = trimmed === '' ? '/' : `/${trimmed}/`;

// 不再内置任何部署域名为默认值：未设 ASTRO_SITE 时 site 为 undefined，
// canonical / og:url 渲染分支（Astro.site && …）自动跳过，不会指向错误域名。
const site = process.env.ASTRO_SITE ?? undefined;

// 错位告警：仅对非根 base 有意义（根路径下无后缀约束，site 任意合法）
if (base !== '/' && site && !site.endsWith(base.replace(/\/$/, ''))) {
  console.warn(
    `[astro.config] ASTRO_SITE (${site}) 未以 ASTRO_BASE (${base}) 结尾，` +
      '内链与 canonical 可能和产物路径错位，请校正二者之一。'
  );
}

// https://astro.build/config
export default defineConfig({
  site,
  base,
  output: 'static',
  markdown: {
    // ```flow 围栏 = 文章里的字符逻辑图 / 流程图（见 src/pages/blog/[slug].astro 的 pre.flow）。
    // 必须把它从 Shiki 里排除掉，两个原因（实测）：
    //   ① Shiki 会把主题色写成 <pre> 的 inline style（background-color:#24292e），站点 CSS 压不过；
    //   ② 未登记的语言会被静默归一成 plaintext（data-language="plaintext"），
    //      于是「按围栏语言区分图与代码」根本不可能（试过 remark 插件，Astro 7 需装 @astrojs/markdown-remark，不加依赖）。
    // 排除后图作为原始围栏输出，颜色/字体完全由站点 CSS 决定（随 13 套主题走）。
    syntaxHighlight: { type: 'shiki', excludeLangs: ['flow'] },
  },
  server: {
    // 钉死 IPv4 回环：不设 host 时 Astro 默认 localhost，Windows 上 Node ≥17 优先解析出 ::1，
    // 与残留的 dev 实例（同样绑 ::1）或 IPv4/IPv6 双栈冲突时会抛 EACCES 而非 EADDRINUSE，
    // Vite 只对 EADDRINUSE 做“换端口重试”，EACCES 直接重抛 → astro dev 硬崩（曾见 async.c UV_HANDLE_CLOSING 断言）。
    // 绑 127.0.0.1 后端口冲突走 EADDRINUSE 正常回退到 4322 并打印提示，不再崩。
    host: '127.0.0.1',
    port: 4321,
  },
});