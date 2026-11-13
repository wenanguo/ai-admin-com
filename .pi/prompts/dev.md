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

> **做完一条后不用等人催**：接着做下一条的条件见 §⑨。

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
- [ ] **在 issue 上留一条 comment**：做了什么 · 怎么验 · PR 号 · 下一条领了哪个（跨会话的 PM 靠它看进度）

## ⑨ 自动续做（做完一条，接着做下一条）

> **不用每次都问人。** 做完一条、收尾干净后，只要满足下面全部条件，就**直接领下一条**继续干。

### 可以自动续做的条件（全部满足）

1. `ready` 队列里**还有** issue（`node scripts/agent/pick-next.cjs --list` 看得到）
2. 下一条的**依赖已合并**（脚本会自动检查；依赖没合的不算）
3. 这一条**不是高风险四类**（AI 闸门 / 权限 / 数据模型 / 动 AiAdmin 那个仓）
4. 这一条**没卡住**（没报错、没缺信息、没超出范围）

⇒ 满足就：`node scripts/agent/pick-next.cjs --claim` → 回到 ② 重新走一遍。

### 必须停下来问人的情况（任一命中就停）

| 情况 | 为什么 |
| ---- | ------ |
| **高风险四类**（AI 闸门 / 权限 / 数据模型 / 动 AiAdmin 那个仓） | PM 要亲自看 PR 内容才能确认；这类**不准自动合并** |
| **队列空了** | 没活了 ⇒ 汇报并等 PM 放行新的 |
| **要改需求 / 超出了 issue 的范围** | 「不做」栏是硬边界；扩范围要人拍板 |
| **卡住了**（缺信息、报错、依赖不对、环境问题） | 硬做只会越走越远 |
| **这个 milestone 的活全部做完了** | 块的边界 = 汇报点（PM 要看结果、决定下一块） |
| **要动 AiAdmin 那个仓** | 跨仓改动要单独提 PR，得让人知道 |

### 刹车（可选，人可调）

默认：**不在中途强制停**，只在上表的汇报点停。
想更保守 ⇒ 每做完 **N 条**（默认 3）停一次汇报；由 PM 在 issue 上写明。

### 汇报的格式（停下来时）

```
✅ 做了：#38 <标题>（PR #41，已合并，CI 绿）
✅ 做了：#39 <标题>（PR #44，已合并，CI 绿）
⏸ 停了：<原因>（下一步等你放行）
```

## 边界

- ❌ 不合并**别人**的 PR
- ❌ 不自己排期、不自己加需求（要加 ⇒ 找 PM）
- ❌ 一条 issue 一个分支一个 PR；不把「重构 + 新功能」混进一个 PR
- ❌ 不写凭据（`.env` / `.ai/auth.json`）
- ❌ **不领 `ready` 以外的 issue**（那是 PM 的授权范围）
- ❌ **高风险四类不自动合并**（等 PM 抽查）

${1:-用户没有指定 issue 号时，用 pick-next.cjs --claim 自动领一条；做完后按 ⑨ 自动续做。}
