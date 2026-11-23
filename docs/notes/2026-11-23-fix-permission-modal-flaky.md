# 修 PermissionModal.test.tsx 的随机失败（#154）

> 交接文档 —— 让下一棒（可能是另一个会话的 agent）接得上。

## 目标

- **关联**：issue #154
- **一句话**：`frontend/src/pages/module_system/role/PermissionModal.test.tsx`
  里的「打开后立刻提交」那条用例**随机红**（CI 约 1/5 概率）⇒ 定位真因、修掉、
  并证明连跑 ≥ 20 次全绿。

## 状态

**进行中**（真因已复现，正在定位到具体机制）。

## 怎么验（当前）

```bash
cd frontend
# 单文件连跑 20 次（任一次挂就停 ⇒ 直接看到那次失败的现场）
node scripts/repeat-vitest.mjs src/pages/module_system/role/PermissionModal.test.tsx 20

# ⚠️ 本地**单跑这个文件几乎不复现**（0/45）⇒
#    复现要**整仓一起跑**（浏览器被别的测试文件占着 ⇒ 慢）：
npx vitest run
```

## 已完成

| 位置 | 做了什么 |
| ---- | -------- |
| `frontend/scripts/repeat-vitest.mjs` | 「连跑 N 次」的抗 flaky 复现脚本（任一次挂就停） |
| `docs/notes/2026-11-23-fix-permission-modal-flaky.md` | 本文件 |

## 复现条件（已实测）

- **单跑该文件**：0/45 全绿（本地不红）。
- **整仓一起跑**（`npx vitest run`，74 个测试文件并行）：**必红**（已连中 2 次）。
- ⇒ 触发条件是**浏览器被抢**（CI 的 2 核 runner 上更严重 ⇒ 约 1/5 概率）。

## 决策记录

| 决定 | 为什么 | 错了的代价 |
| ---- | ------ | ---------- |
| 用「整仓一起跑」当复现手段，而不是「单文件加 sleep」 | flake 的前提是**机器慢**；单跑永远不红 ⇒ 证明不了 | 以为修好了 ⇒ CI 还是随机红 |
| 复现脚本**入库**（`frontend/scripts/repeat-vitest.mjs`） | PM 要自己复跑验收 ⇒ 得有一条现成的命令 | 每次验收都要手搓一串命令 |

## 下一步

- 定位「点确定」到底卡在哪一步（点击没落地？还是提交被吞？）。
- 定修法（测试侧 or 组件侧）⇒ 补测试 ⇒ 连跑 20 次全绿。
- 同类排查：扫 `frontend/src/**/*.test.tsx` 里同类的「等窗口」写法。
