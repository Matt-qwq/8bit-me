# Open-source the public snapshot; keep private working repo

2026-09 决策：将本站源码以「公共快照·精选镜像」形式开源——GitHub 新建公开仓 `Matt-qwq/8bit-me`（MIT 执照），原始工作仓改名 `8bit-me-private` 保持私有，日常开发与 Netlify 部署链路不动。

**动机**：求职展示源码 + 把站点做成可被他人克隆复用的模板级仓库（`npm i && npm run dev` 即可跑通）。该决定显式逆转 ADR-0001 的「源码私有·站点公开」——站点内容早已公开（Netlify 产物 + 正文），本次只是把代码层也放行，并接受「代码可被他人复用」的代价。

**考虑过的选项（Considered Options）**
- **直接翻转现有仓 public**：否决——历史含个人/运营文件旧版本（AGENTS.md、handoff、学习记录等，git 可重建），且提交信息带工作流痕迹。
- **新公开仓携带过滤历史**（git-filter-repo 清洗 110 次提交）：否决——提交信息清洗不可靠（「作者/质询/评审」等在 message 层），存在漏网与误伤风险；采纳**全新根提交**（单次提交承载整树，工程叙事交给 README 与 docs/）。
- **新账号/组织托管公开仓**：否决——站点页脚已链 `github.com/Matt-qwq`，同账号保 provenance；模板复用靠内容不靠账号。
- **快照保鲜方式**：否决 CI 自动同步（不可逆发布须人显式触发，且自动搬运有夹带个人文件风险）；采纳 `scripts/sync-public.sh` 手动白名单整仓同步——staging 目录 → 作者 diff 过目 → commit + push，节奏由作者控制。
- **执照**：采纳 MIT（宽松，公开仓允许任何复用，含商用；与「帮助他人」目标一致）。Zpix 字体为第三方付费字体（个人/教育免费、商用须向作者付费），**不并入 MIT**，随仓分发并附 `Zpix-NOTICE.md` 声明。

**后果（Consequences）**
- 公开仓结构：`src/ tests/ public/` + 脱敏后 `docs/`（ADR + 2 份 specs + 像素排版研究）+ 构建必需 `scripts/` + 全部配置文件 + 站点文章（`src/content/blog/`，站点早已公开，源码进仓零新增暴露）。
- 个人/运营文件一律不进公开仓：AGENTS.md、docs/handoffs、learning-records、lessons/、MISSION/NOTES/RESOURCES、shots/、reference/、assets/、.pi/、deploy 脚本（含本机路径与 Netlify site id）等。
- 公开仓 CI（GitHub Actions）：push/PR 跑 `typecheck` + `test:unit` + `build` 并挂 README badge 作质量门；e2e 依赖系统 Chrome，留在本地人工验收。
- 外部 PR 合入公开仓后与私有仓分叉，sync 全量覆盖会盖掉外部改动——个人模板仓低概率，发生时逐个 cherry-pick 回私有仓。
- 部署链路不变：Netlify 仍连接私有工作仓；公开仓不连部署。
- ADR-0001 标记为**被本条取代**（superseded）；`docs/handoffs/` 与 `docs/research/` 等历史文档按旧约定停留在私有仓，公开仓只保留耐久工程记录。