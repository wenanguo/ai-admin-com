# 修合并脚本（收尾不崩 + 不删工作区）（2026-11-14）

> 交接文档 —— 让下一棒（可能是另一个会话的 agent）接得上。

## 目标

- **关联**：issue 无（PM 流程维护类 —— 修 `scripts/agent/merge-pr.cjs` 这个**工具**）
  · PR #（待填）
- **一句话**：`merge-pr.cjs` 连续三棒（#38 / #39 / #41）都在「**合并成功之后**」崩掉，
  而且它会把 agent 的**工作区文件删光** ⇒ 这次把两件事一起修掉，并**加测试 + CI**。

## 状态

**进行中**（CI 全绿后合并；合并后本条应标记「已完成」）。

## 为什么现在做（不是自己加需求）

- `docs/notes/2026-11-13-web-container.md`（#38 那棒）就写了：
  「**这不在 issue #38 的范围内**（没在本 PR 里改）⇒ **留给下一棒**或 PM 单独开单修」⇒ 下一棒就是我。
- 之后每棒都踩同一个坑 ⇒ 合并后每次都要**人手工收尾**（切回 main / 删本地分支 / `fetch --prune`）。
- 本次 `ready` 队列为空（#42 由另一个会话在做）⇒ 修工具是这个队列空档里**最该做**的事。

## 短设计

两处改动，都很小：

1. **null 兜底**：`execFileSync` 在 `stdio: 'inherit'` 时返回 **null**（不是 `''`）
   ⇒ 旧的 `}).trim()` 直接炸。⇒ 输出统一走新文件 `scripts/agent/lib/exec.cjs`
   （`run` / `tryRun` / `branchCheckedOutInWorktree`），`worktree.cjs` 里同样的坑也顺手补上。
2. **不再用 `gh pr merge --delete-branch`**：它会删**本地分支**，而 agent 的分支常常**正被一个工作区签出**
   ⇒ 实测它把那个工作区的**源码删光了**（只剩两个 `node_modules` 软链）。
   ⇒ 现在：合并不带 `--delete-branch`；远端分支用 `git push origin --delete`；
     本地分支**先问**「有没有被工作区签出」（`git worktree list --porcelain`），签出了就**只提示不删**。

## 已完成

| 提交 | 做了什么 |
| ---- | -------- |
| （本 PR） | `scripts/agent/lib/exec.cjs`（新）+ `merge-pr.cjs` 改用 lib + 不删工作区 + `worktree.cjs` 补 null 兜底 |
| （本 PR） | `scripts/agent/merge-pr.test.cjs`（10 条，node:test，零依赖）+ CI job（`agent-scripts`）+ `npm run test:agent` |

## 决策记录

| 决定 | 为什么 | 错了的代价 |
| ---- | ------ | ---------- |
| **不用 `--delete-branch`，自己删分支** | 它会连带删掉工作区里的文件（实测三次） | agent 工作区被清空 ⇒ 要重建（node_modules 2.5GB 重接） |
| **本地分支被工作区签出时只提示、不删** | 删了就把那个工作区的文件带走 | 同上 |
| **`pull` / `fetch` 失败只警告不崩** | 合并**已经成功**了 ⇒ 崩掉只会让后半段清理没跑（这正是老 bug 的伤害） | 又要人手工收尾 |
| **输出统一走 `lib/exec.cjs`** | 一处修好 + 有测试；`worktree.cjs` 也用同一套 | 同样的坑在别的脚本里再炸一次 |
| **测试用 `node:test`（零依赖）** | 仓里没有能跑 `scripts/**` 的测试框架；`node --test` 自带 | 脚本的 bug 只能靠「真的合并一次」才暴露 |

## 怎么验

```bash
# 单元测试（10 条；不需要网络、不需要 docker）
node --test "scripts/agent/*.test.cjs"
# 或
npm run test:agent

# 合并脚本的「只检查」模式（不动任何东西）
node scripts/agent/merge-pr.cjs <PR号>
```

## 坑与提醒

- ⚠️ **合并时不要把 agent 的分支签出在工作区里**再让脚本删它 ⇒ 现在脚本会挡住（只提示），
  但最好还是**合并前先把工作区切到别的分支**。
- ⚠️ `node --test "scripts/agent/*.test.cjs"` 依赖 **node ≥ 18**（`--test` 与 glob）⇒ 本仓要求 node ≥ 22 ✔。
- ⚠️ 改 `scripts/agent/**` 的脚本要**手测一遍**「只检查」模式（它不联网、不改任何东西，很便宜）。
