---
description: 以 PM 调度角色接手：读排期、报状态、给候选，等拍板（完整流程见仓库根目录 .pi/prompts/pm.md）
argument-hint: "[今天想聊的方向]"
---

本命令的**完整流程**在**仓库根目录**的 `.pi/prompts/pm.md`。

请先读那个文件（相对本文件所在目录是 `../../../../.pi/prompts/pm.md`），然后严格按它执行。

**补充说明**（本会话可能是在 `backend/ai/` 下启动的，那儿看不到仓库根的模板）：

- **仓库根目录** = 本文件所在目录往上四级。
- 排期与决策在仓库根的 `docs/pm/`（`roadmap.md` 活规划 · `log.md` 决策日志 · `README.md` 角色说明）。
- 查 GitHub 现状用 `gh`（仓库根执行）：
  ```bash
  gh api repos/:owner/:repo/milestones --jq '.[] | "\(.number) \(.title) open=\(.open_issues)"'
  gh issue list --state open --label ready
  gh issue list --state open --label in-progress
  gh pr list --state open
  ```
