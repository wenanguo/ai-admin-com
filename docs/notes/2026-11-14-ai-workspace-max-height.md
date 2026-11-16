# 最大化的工作台顶到视口最上面（2026-11-14）

> 交接文档 —— 让下一棒（可能是另一个会话的 agent）接得上。

## 目标

- **关联**：issue #57 · PR #58
- **一句话**：最大化的 AI 工作台被**工作区**的高度压着（顶上永远空着一条 56px 的顶栏），
  改成**顶到视口最上面**（盖住顶栏），左侧菜单留着。

## 状态

**已完成**（代码已实现、e2e 已钉住；等开 issue + 提 PR + 合并）。

## 已完成

| 提交 | 做了什么 |
| ---- | -------- |
| `8d6e605` | 宽版浮层 `top: 0` + 高度到内容区底；`z-index` 抬到 101；补顶栏左侧那一小块补丁；改 e2e 守卫 |

**下一步（具体到文件与命令）**：

```
1. **PR #58 已提**（mergeable，CI 在跑）
2. 等 CI 绿 + 人 review ⇒ 合并：
   node scripts/agent/merge-pr.cjs 58            # 只检查（不动任何东西）
   node scripts/agent/merge-pr.cjs 58 --yes      # 真合并 + 删分支
   ⚠️ `gh` 不在 PATH 里 ⇒ 合并前先 export PATH=/tmp/ghbin/gh_2.104.0_macOS_arm64/bin:$PATH
   ⚠️ /tmp 会被系统清理 ⇒ 要长期用就正式 `brew install gh`
```

## 决策记录（★ 最值钱的部分）

| 决定 | 为什么 | 错了的代价 |
| ---- | ------ | ---------- |
| 浮层 `top: 0`、高度 = `contentBox.top + contentBox.height` | 用户要「直接顶到最上面」；高度从视口顶到内容区底（= 视口底）⇒ 满屏 | 若改成 `bottom: 0`，将来 ProLayout 若出现 fixed footer 会被浮层盖住 |
| 浮层 `z-index` 100 ⇒ **101** | ProLayout 的顶栏自己也是 `position: fixed; z-index: 100` ⇒ 同层时谁在上面取决于 DOM 顺序，不可靠 | 不抬 z-index ⇒ 顶栏时隐时现（看构建顺序） |
| 补一块 `ai-workspace-header-patch`（0..菜单列宽 × 0..顶栏高） | logo 横跨菜单列与浮层的交界 ⇒ 不补会露出**半截 logo**（看着像渲染坏了）。菜单（sider）是 fixed 且**从 y=顶栏高才开始** ⇒ 盖顶上那条碰不到菜单 | 不补 ⇒ 左上角半截 logo，用户以为渲染坏了 |
| 路由页 `/ai/workspace` **不动** | 它是「一个页面」，脱离 ProLayout 内容流反而奇怪（页脚也没了）；用户选的是「最大化浮层顶到最上面」 | 若用户其实要的是路由页 ⇒ 还要再做一次（把路由页也变成整屏浮层） |
| 左侧菜单**留着** | 用户只提了「高度」；菜单是导航，用户还要用 | 想全屏 ⇒ 浮层 `left:0; width:100vw`，菜单被盖住 |

## 怎么验

```bash
cd frontend && npm run build
cd frontend && npx vitest run --config vitest.local.config.ts
cd frontend && npx playwright test e2e/ai-workspace.spec.ts
```

人眼要看的：

1. 任意页面点右下角机器人 ⇒ 点「最大化」⇒ **浮层顶到屏幕最上面**（顶栏被盖住）
2. 左侧菜单**还在**，且点得到
3. 左上角**没有半截 logo**
4. 点「返回」⇒ 收回 400px 小浮层；**原页面**（URL / 筛选 / 滚动位置）不动

## 坑与提醒

- ⚠️ **e2e 跑的是 `frontend/dist/`（生产构建，8010 端口）**，不是 dev server
  ⇒ 改完源码必须先 `npm run build`，否则测的是旧代码（踩过）。
- ⚠️ `gh` 原本没装 ⇒ 这次下的是官方二进制（`/tmp/ghbin/gh_2.104.0_macOS_arm64/bin/gh`），
  **没装进 PATH、也没动 brew** ⇒ 下次要记得把它加进 PATH，或正式 `brew install gh`。
- ⚠️ issue 号是 **#57**（不是我一开始猜的 55）⇒ 分支已改名成 `fix/57-ai-workspace-max-height`。
- ⚠️ `main` 有**保护分支钩子** ⇒ 直落 main 会被拒（`protected branch hook declined`）⇒ 必须走分支 + PR。

---

# 追加：窄版也顶到视口最上沿（2026-11-16）

> 接上一节 —— 同一个诉求的**另一半**：宽版（最大化）顶到 y=0 了，**窄版（右侧 400px）还压在顶栏下面**（y=56）。

## 目标

- **关联**：issue #59 · PR _（待填）_
- **一句话**：窄版浮层也改成 `top: 0` + `z-index: 101` ⇒ **两种形态顶边一致**（都与最大化对齐）。

## 状态

进行中（代码 + 单测 + e2e 已改完，待 PR / 合并）

## 已完成

| 提交 | 做了什么 |
| ---- | -------- |
| `（本次）` | `AiWorkspaceShell.tsx`：窄版 `top: 0` + `zIndex: 101`（原来 `top: headerHeight` / `zIndex: 100`） |
| `（本次）` | `AiWorkspaceShell.test.tsx`：新增单测（窄版 `style.top === '0px'`、`style.zIndex === '101'`） |
| `（本次）` | `e2e/ai-workspace.spec.ts`：改两条与新需求冲突的断言（`toBeGreaterThan(0)` ⇒ `toBeCloseTo(0, 0)`）+ 新增 2 条用例（窄版 y=0 + 顶栏右上角被盖住 + logo 不露半截；窄屏全宽 100vw 时同样 y=0） |

## 决策记录

| 决定 | 为什么 | 错了的代价 |
| ---- | ------ | ---------- |
| 窄版 `top: 0`（不是 `top: headerHeight`） | 人要的是「两种形态顶边一致」；而且**将来这个面板要能拖动** ⇒ 先让它能占满上沿 | 保持 y=56 ⇒ 宽窄两种形态看起来不是一回事 |
| 窄版 `z-index` 也抬到 **101** | ProLayout 顶栏自己是 `position: fixed; z-index: 100` ⇒ 同层时谁在上面取决于 DOM 顺序，不可靠 | 不抬 ⇒ 顶栏时隐时现（看构建顺序） |
| ⚠️ **顶栏右上角（头像 / 账号菜单）被盖住、点不到 —— 有意为之** | 人 2026-11-14 定的：先把面板做成能占满上沿，将来「界面可拖动」才有地基 | 有人当成 bug 报回来 ⇒ 又要在代码里写注释解释「这是有意的」 |
| 窄屏全宽（`width: 100vw`）**不用**再补 header patch | 全宽时面板左边缘 ≤ 0 ⇒ logo **整块**被面板盖住（不是半截）⇒ 不存在「半截 logo」 | 宽版那条 patch 只对「面板从 contentBox.left 起」的情况有意义 |
| 路由页 `/ai/workspace` **不动** | 沿用上一节的决策（它是独立页面） | —— |

## 怎么验

```bash
cd frontend && npm run build          # ⚠️ e2e 跑的是 dist/（生产构建）⇒ 改完源码必须先 build
cd frontend && npx vitest run src/components/ai-workspace/AiWorkspaceShell.test.tsx
cd frontend && npx playwright test e2e/ai-workspace.spec.ts
```

人眼要看的：

1. 任意页面点右下角机器人 ⇒ **小浮层顶到屏幕最上面**（顶栏右上角被盖住 —— 有意为之）
2. 点「最大化」⇒ 仍是满屏（PR #58 的效果没被破坏），左侧菜单还在
3. 左上角**没有半截 logo**
4. 点「返回」⇒ 收回窄版，仍贴着视口上沿

## 坑与提醒

- ⚠️ **e2e 跑的是 `frontend/dist/`** ⇒ 改完源码不 `npm run build` ⇒ 测的是旧代码（这次踩了一次：断言 `Received: 56`）。
- ⚠️ 窄版那条 `top: headerHeight` 一改，`headerHeight` 这个 state 只剩**宽版的 header patch** 在用 ⇒ 别顺手把它删了。
