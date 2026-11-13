# GitHub Pages as primary zero-cost deploy channel

2026-09 决策：零成本主发布通道从 Netlify 免费档切到 GitHub Pages（公开仓 `Matt-qwq/8bit-me` 的 gh-pages 分支）。Netlify 仍保留（站点在线、不删），但新发布走 `scripts/deploy-pages.sh`。

**动机**：Netlify 免费档（Credit-based）300 credits/月 —— 生产 deploy 15 credits/次，约 20 次/月。2026-09 发布额度耗尽（`deploy --prod` 返回 403 `Account credit usage exceeded - new deploys are blocked until credits are added`），本地验收已过、内容就绪却发不出去。GitHub Pages 对 public 仓免费、无发布次数上限（免费档 100GB 带宽/月），且 `matt-qwq.github.io` 国内实测可直连（0.3s）。Vercel/Cloudflare Pages 的 `*.vercel.app` / `*.pages.dev` 国内被墙（本轮实测 000）出局。

**发布模式（关键取舍）**：本地构建 → force-push 产物到公开仓 `gh-pages` 分支（GitHub Pages 官方「单分支产物仓」模式）。
- **不云端构建**：云端自动构建曾两次在 Netlify 上丢 Konami 内联脚本（见 `内部部署文档`）；本地构建 + 显式推送是唯一验证过的零丢失路径，且符合「发布须人显式触发」铁律。
- **公开仓 CI 不动**：`.github/workflows/ci.yml` 仍只跑 main 的 typecheck/单测/build 质量门，**不碰 gh-pages**，发布不被自动触发。
- **gh-pages 与 main 解耦**：main 是 sync-public.sh 管理的源码快照，gh-pages 只装产物、force-push 不保留历史。

**Considered Options**
- **等 Netlify 09-26 周期重置**：否决为主通道——重置后仍受 300 credits/月（≈20 次发布）额度约束，治标不治本；作为备份通道保留。
- **GitHub Actions 云端构建部署**：否决——与「发布须人显式触发」及「避开云端构建丢脚本」两条既有铁律冲突。
- **Cloudflare Pages / Vercel**：否决——`*.pages.dev` / `*.vercel.app` 国内直连被墙。
- **自购 VPS / 国内 OSS+CDN**：否决——静态站杀鸡用牛刀，且国内要 ICP 备案（数周）。

**Consequences**
- 新部署脚本 `scripts/deploy-pages.sh`：构建（注入 `ASTRO_BASE=/8bit-me/`、`ASTRO_SITE=https://matt-qwq.github.io/8bit-me`）→ 校验产物路径（字体/猫图/canonical）→ dist 独立 git 仓 force-push 到 gh-pages → curl 验证线上。
- 线上地址：`https://matt-qwq.github.io/8bit-me/`。
- **必须的路径修复**（子路径部署）：`global.css` 的 `@font-face` 字体 URL、Nav 睡猫图、canonical/og 均改为 base 感知（CSS 字体经 BaseLayout 注入 `--font-zpix-*` 变量）——否则 `/8bit-me/` 子路径下 404。**Windows 本地构建必须 `MSYS_NO_PATHCONV=1`**，否则 `ASTRO_BASE=/8bit-me/` 被 Git Bash 转成 `C:/Program Files/Git/...` 导致 base 解析爆炸。
- **发布节奏建议**：GH Pages 无额度焦虑，但发布仍应「攒批 → 本地验收 → 发一次」；Netlify 免费档额度保留给备用发布（如需回退或双通道）。
- 部署后需清理 `dist/.git`（脚本已内置：build 前删旧 .git、push 后 cd 回根再删）。
- `docs/adr/0001` 的「部署到 Netlify」及 CONTEXT.md 部署段随之更新为「Netlify 主通道的历史 + GH Pages 现行主通道」。

---

## 补记：部署后验证缺环（2026-09-11 实测暴露，已补 `scripts/verify-live.mjs`）

**问题**：`deploy-pages.sh` 结尾的验证只有一句 `HTTP 200` —— 而**旧构建同样返回 200**。
2026-09-11 部署前实测线上状态：

| 项 | 线上（09-08 构建，落后 40+ 提交） | 本应如此 |
|---|---|---|
| `Last-Modified` | `Tue, 08 Sep 2026 10:04:17 GMT` | 当次构建时间 |
| HTML 内 `@font-face` | **0 处**（全站压根不是像素字） | ≥1 |
| 文章数 | 13 | 18 |
| `/blog/tags/` | 404 | 200 |
| `/lab/` | 404 | 200 |
| 字体传输 | 7,179,588 B（坏子集回退全量 TTF） | 63,448 B |

**六条全是坏的，而 `curl -I` 一路 200。** 部署通道本身没问题，缺的是「部署完到底变没变」这一步。

**补法**：`scripts/verify-live.mjs`（**不进 `npm test`**，要联网）。
期望值**从本地源码读**（文章数数 `src/content/blog/*.md` 的 frontmatter `draft`，
图册数读 `LAB_DIAGRAMS`），不硬编码 —— 否则作者发第 19 篇后脚本会假红。

为什么用 Playwright 而不是 curl：`curl | grep font-face` 只能证明 HTML 里**写了** `@font-face`，
证明不了字体**加载成功** —— 2026-09-08 那个坏子集正是「声明在、加载 NetworkError、
静默回退 7 MB 全量 TTF」。浏览器能同时验「声明了 / 加载了 / 真的用于排版了 / 传输量正常」。

**首跑就抓到自己一个假红**：iframe 产物路径断言写成拿带域名的完整 URL 去匹配，
而 HTML 里是相对路径 `data-artifact="/8bit-me/lab/…"` —— 线上是对的，断言是错的。
（开发流程文档 那条「新增守卫必须立刻跑一次反例」再次生效。）

**反例已跑**：`LIVE_BASE=https://8bit-me.netlify.app npx vite-node scripts/verify-live.mjs`
→ Netlify 备用站（真实旧构建）被逐条抓到：
无 `@font-face` / 只有 **5 篇** / `/blog/tags/` 404 / `/lab/` 404 / 字体 `status=null`（没加载）/
标题仍用**已弃用的 Press Start 2P**。脚本确实能分辨「新构建」与「旧构建」，不是恒绿。

**顺带记一个事实**：Netlify 备用站比 GH Pages 旧得多（5 篇，还在用 Press Start 2P 那代字体栈）。
它作为「回退通道」的价值已很低 —— 真要回退，实际是回退到几个月前的站点。回退前须知。

**本次部署结果（2026-09-11）**：`verify-live.mjs` 全绿 —— 18 篇 / `/blog/tags/` 与 `/lab/` 200 /
Zpix `loaded` 且用于标题 / 字体 62.3 KB / 零控制台报错 / 零站外请求 /
图册首访配色与站点一致（`#0e1526`）/ 视觉风格菜单在线上也是隐藏的。
