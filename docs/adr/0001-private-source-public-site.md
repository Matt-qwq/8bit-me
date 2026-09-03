# Source code private, site public (superseded by ADR-0009)

> **状态：已被 [0009-open-source-public-repo](0009-open-source-public-repo.md) 取代（2026-09）**
> 本站源码现已以「公共快照·精选镜像」形式开源（MIT），以下为早期决策及其理由的历史记录。

早期决策：仓库在 GitHub 保持 **private**，站点渲染产物对全网**公开**，托管在 **Netlify 免费档**（连接私有仓构建），框架维持 **Astro 静态站**。动机：作者希望站点对访客公开作为作品集展示，但当时不接受源码被直接复制复用。

**Considered Options**
- Cloudflare Pages（初选）：实测 `*.workers.dev` / `*.pages.dev` 国内直连被墙，弃用（部署经 Netlify 验证可达）。
- Vercel：`*.vercel.app` 国内直连被墙，弃用。
- GitHub Pages：免费档强制仓库 public，与「源码私有」冲突，弃用。
- 换框架（Next 16 / SvelteKit 2 / Nuxt 4 / Fresh / SolidStart 2）：调研否决——各有硬伤（Next 静态导出限制、SvelteKit/Nuxt 无内置 markdown 内容管线、Fresh 需 Deno 运行时与免费静态托管冲突、SolidStart 2 上市仅 3 周且要求 node ≥24）。

**Consequences**
- 站点由 Netlify 免费档托管；部署经本地 CLI（构建连接私有 GitHub 仓库）。
- GitHub Actions 弃用（CI 未知失败不阻塞上线；站点由 Netlify 云端构建）。
- 2026-09 起被 ADR-0009 逆转：源码以精选快照公开，私有工作仓继续承担日常开发与部署。