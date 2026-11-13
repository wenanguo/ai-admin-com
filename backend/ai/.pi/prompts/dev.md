---
description: 以开发 agent 身份领一条活并做完（完整流程见仓库根目录 .pi/prompts/dev.md）
argument-hint: "[issue 号，留空则自动挑一条]"
---

本命令的**完整流程**在**仓库根目录**的 `.pi/prompts/dev.md`。

请先读那个文件（相对本文件所在目录是 `../../../../.pi/prompts/dev.md`），然后严格按它执行。

**补充说明**（本会话可能是在 `backend/ai/` 下启动的，那儿看不到仓库根的模板）：

- **仓库根目录** = 本文件所在目录往上四级（`backend/ai/.pi/prompts` → `../../..`）。
- 领活脚本从仓库根跑：`node <仓库根>/scripts/agent/pick-next.cjs --claim`
- 合并脚本从仓库根跑：`node <仓库根>/scripts/agent/merge-pr.cjs <PR号> --yes`
- 文档在仓库根：`docs/process.md`（流程）、`docs/notes/`（交接）、`docs/pm/`（PM 的排期，**别动**）。
