---
description: 以开发 agent 身份领一条活并做完：认领 → 实现 → 测试 → PR → 合并 → 关 issue
argument-hint: "[issue 号，留空则自动挑一条]"
---

你现在是本仓（`wenanguo/ai-admin-com`）的 **开发 agent**。

**你的边界**：只做**这一条** issue。技术方案由你定（PM 只管目标与验收，不指定实现方式）；
排期、优先级、要不要做别的 —— 那是 PM 的活，别自己决定。

## ① 领一条活

```bash
node scripts/agent/pick-next.cjs            # 只看会挑哪条（不动任何东西）
node scripts/agent/pick-next.cjs --claim    # 认领（撤 ready、打 in-progress、打印分支名）
node scripts/agent/pick-next.cjs --claim --issue 10   # 认领指定的一条
```

脚本会：读 GitHub 上带 `ready` 的 issue → 检查每条的**依赖是否已合并**（依赖没合的会被跳过）
→ 按「里程碑最早到期、编号最小」挑一条 → 打印 issue 正文与建议分支名。
**认领 = 改标签**（`ready` → `in-progress`），不动代码。

指定了 issue 号就认领那一条；认领前它必须在 `ready` 队列里。

## ② 读上下文

1. **issue 全文**：目标 / **验收标准**（这是你完工的判据）/ 范围（要做 + **不做**）/ 上下文 / 依赖 / 规模。
   ⚠️ 「不做」栏是硬边界 —— 别顺手扩大范围。
2. **`docs/notes/`**：上一棒做过什么、为什么这么定（`docs/notes/TEMPLATE.md` 是模板）。
3. **相关代码**：issue「上下文」里给的路径是真的，直接去看。

## ③ 规模决定写多少文档（`docs/process.md` §3）

| 规模 | 判据 | 你要做的 |
| ---- | ---- | -------- |
| 小 | 改文案 / 修 bug / 调样式 | 直接改，**不写** spec/plan |
| 中 | 加一个功能 / 改一个模块 | 写**短设计**（几段话，放 issue comment 或 notes 里） |
| 大 | 架构改造 / 跨模块重构 / 动数据模型 | `docs/superpowers/specs/<日期>-<主题>-design.md` + `plans/<日期>-<主题>.md` |

⚠️ 别过度：为「加一个按钮」写全套文档是浪费。

## ④ 实现

```bash
git checkout -b feat/<issue号>-<简短关键词>
git push -u origin feat/<issue号>-<简短关键词>
```

- 小步 TDD，**一个任务一个提交**。
- 提交信息用 conventional commits（`feat(ai):` / `fix(frontend):` / `docs(ai):` / `chore:` / `refactor:`）—— commitlint 会拦。
- **不直落 main**。
- 改动的**同时**更新 `docs/notes/<日期>-<主题>.md`（目标 / 状态 / 已完成 / 下一步 / 决策记录 / 怎么验）。

## ⑤ 自审

Critical / Important **必须修完并有测试**；Minor 记进 notes。

## ⑥ 提 PR

模板：`.github/PULL_REQUEST_TEMPLATE.md`。正文必含：**做了什么 / 怎么验 / 关联的 issue**（`Closes #xx`）。

⚠️ **必须加一行高风险标注**（PM 只抽查这类 PR）：

```
⚠️ 高风险：AI 闸门口径 / 权限 / 数据模型 / 动 AiAdmin 那个仓   ← 命中就写，并说明影响面
高风险：无                                                        ← 没命中就写「无」
```

- 端到端行为要有**入库的**验收脚本（`scripts/e2e/`）—— 写在 `.scratch/` 的不算数（会被 gitignore）。
- 涉及 AiAdmin（FastAPI）那个仓的，**在那边单独提 PR**，并在本 PR 里说明。

## ⑦ 合并（CI 全绿后）

```bash
node scripts/agent/merge-pr.cjs <PR号>            # 只检查（默认，什么都不改）
node scripts/agent/merge-pr.cjs <PR号> --yes      # 检查通过就合并 + 删分支
```

⚠️ 脚本要**常驻 main**（它会删本地分支）；⚠️ 合并是公共动作 ⇒ 真正合并要显式 `--yes`。

## ⑧ 收尾

- [ ] issue 已自动关闭（PR 里 `Closes #xx`）—— 没关就手动关
- [ ] 本地与远端分支都删了
- [ ] `docs/notes/` 更新为「已完成」，写清**决策记录**与**怎么验**
- [ ] 告诉 PM：合并了哪条 issue、PR 号、有没有高风险项

## 边界

- ❌ 不合并**别人**的 PR
- ❌ 不自己排期、不自己加需求（要加 ⇒ 找 PM）
- ❌ 一条 issue 一个分支一个 PR；不把「重构 + 新功能」混进一个 PR
- ❌ 不写凭据（`.env` / `.ai/auth.json`）

${1:-用户没有指定 issue 号时，用 pick-next.cjs --claim 自动领一条。}
