---
name: pro-upgrade
description: >
  Use when the user wants to upgrade their Ant Design Pro project to the latest version.
  Triggers on: upgrade pro, pro upgrade, migrate pro, update pro, 升级, 迁移项目,
  "how to upgrade", "update to latest", "keep project up to date".
allowed-tools:
  - Bash(git clone *)
  - Bash(diff *)
  - Bash(npm install)
  - Bash(npm run lint*)
  - Bash(npm run build*)
  - Bash(npm run tsc*)
  - Bash(npx antd *)
  - Bash(rm -rf /tmp/ant-design-pro-upgrade*)
  - Read
  - Edit
  - Write
  - Glob
  - Grep
---

# ⚠️ 指路存根 —— **正文只有一份**，在 [`.agents/skills/pro-upgrade/SKILL.md`](../../../.agents/skills/pro-upgrade/SKILL.md)

本仓的技能正文**只存一份**：`.agents/skills/pro-upgrade/SKILL.md`
（Agent Skills 标准位置 ⇒ pi / Claude Code / Codex 等宿主都认它）。

看到本文件，说明宿主**只扫 `.claude/skills/`** ⇒ 请**打开上面那个文件**，按里面的步骤做。

- ⚠️ **别在这里改正文**（改了会被 `.agents/` 那份覆盖、也会让两份再次漂移）。
- 升级技能定义：`npx skills add ant-design/ant-design-pro`（工具产物，别手改）。

