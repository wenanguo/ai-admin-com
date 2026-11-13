# 任务页三视图统一高度（issue #9）

## 目标

任务页（`/pm/task`）的**列表 / 看板 / 甘特**三个视图：

1. 高度统一、吃满内容区可用高度（页面本身不滚，滚动在视图内部）
2. 列表视图载入时显示 loading（不要「空列表突变为有数据」）

## 实测（视口 1600×900，内容区 844px）

| 视图 | 视图高度 | 占比 |
| ---- | -------- | ---- |
| 列表 | ProTable 自然高（10 行/页）≈ 600px | ~70% |
| 看板 | 列高 **276px** | **33%** ← 最矮 |
| 甘特 | 容器 690px | 82% |

## 方案

### ① 共享高度 hook：`useContentHeight`

甘特里**已有**一套测量逻辑（`findScrollParent` + `measurePageHeight` + `spaceBelow`）
⇒ **抽成共享 hook** 给三个视图用，不要各写一套。

```ts
const { ref, height } = useContentHeight<HTMLDivElement>();
```

- 高度 = 从**视图容器顶部**到**滚动祖先底部**的可用高度（减去页脚等下方占用）
- `ResizeObserver` 跟着滚动祖先走 ⇒ 窗口缩放 / AI 工作台收放都会重算
- 下限 `min`（甘特原来 320 太小 ⇒ 提到 420）

### ② 三个视图各自怎么用

| 视图 | 做法 |
| ---- | ---- |
| 列表 | ProTable `scroll={{ x:'max-content', y: 表格体高 }}` ⇒ 表格体内部滚动、表头固定 |
| 看板 | 容器 `height` = 可用高度；列 `h-full`；卡片区 `flex-1 overflow-y-auto` |
| 甘特 | 直接用 hook（替换原有测量逻辑） |

### ③ 列表的 loading

`requestLocal` 是**同步本地切片** ⇒ 数据集没就绪就 resolve 空数组 ⇒ ProTable 不显示 loading。

⇒ 给 ProTable 传 `loading={dataset.loading}`（`useTaskDataset` 已暴露）。

## 关键取舍

- **表格体高度怎么算**：不用「猜一个数」，而是量 `thead.offsetTop`（含搜索表单+工具栏）
  与分页高度 ⇒ `y = 可用高度 - thead.offsetTop - 分页占用`。
  ⚠️ 用 `scroll.y` 而不是 CSS `max-height` ⇒ 表头才会固定。
- **甘特的 e2e 断言**（「页面自己不滚」「图表高度 > 300」）不能破 ⇒ 换 hook 后要复跑。

## 验收

- 三个视图高度一致、吃满内容区
- 列表载入时有 loading
- e2e：`pm-task-gantt` / `pm-task-board` / `pm-task` / `task-workspace` 全绿

---

## ✅ 已完成（PR #18 → 合并 `6f2b012e`）

- **状态**：实现完成 · 已合并进 main · issue #9 已自动关闭
- **分支**：`feat/9-task-view-height`（本地与远端都已删）
- **怎么验**：
  ```bash
  cd frontend
  npx vitest run                 # 584 passed
  npx tsc --noEmit               # 干净
  npx playwright test e2e/pm-task.spec.ts e2e/pm-task-board.spec.ts \
    e2e/pm-task-gantt.spec.ts e2e/task-workspace.spec.ts   # 33 passed
  ```
  人眼：`/pm/task` ⇒ 切三个视图，高度一致、下面不留大片空白；看板列内可滚；进列表页有载入转圈。

## 决策记录（为什么这么改）

| 决策 | 理由 |
| ---- | ---- |
| **把甘特的测量逻辑抽成 `useContentHeight`**，三个视图共用 | 三个视图各算各的 ⇒ 高度对不上。共用一套口径才有一致性 |
| **用 callback ref + state，不用 `useRef`** | `useRef.current` 首帧是 `null`，而 effect 只在挂载后跑一次 ⇒ 元素后挂上就永远量不到高度（第一版就栽在这） |
| **`spaceBelow` 要算「内容区直接子级的后续兄弟」（页脚）** | 漏了这段 ⇒ 页面比可用高度高 ⇒ 内容区多一条滚动条（甘特的既有 e2e 断言当场抓到） |
| **列表的 loading 自己画覆盖层** | antd Table 自带的 loading 遮罩挂在**表格体**上，表格体没数据时高度为 0 ⇒ 看不见 |
| **不用 `loading={dataset.loading}`** | ProTable 的**内部请求状态会覆盖**它（外部 loading 只在 useFetchData 里当初值用）⇒ 传了也没用 |
| **不用 `ensureQueryData` 的 promise 等数据集** | 那个 promise 被 memo 复用 ⇒ 可能早就 resolved ⇒ `await` 它等于没等 ⇒ 改成轮询 `loading` |
| **`request` 里轮询等数据集** | `request` 是同步本地切片 ⇒ 数据集没回来就 resolve 空数组 ⇒ ProTable 以为「加载完了」⇒ 「空列表突变为有数据」 |

## 遗留（Minor）

- 列表 `scroll.y` 是**量出来**的（表格上方占用 + 分页占用）⇒ 搜索表单展开/收起时重算 ⇒ 极端情况有一帧跳动
- e2e 里 Playwright 的 `toBeVisible` 在 route handler 内**误报 hidden**（元素确实在、box 也是 1500×690）⇒ 改用「在接口拦截处量 box」断言
- `.ant-table-tbody tr` 的第一个是 antd 的**隐藏测量行** ⇒ 断言数据行要用 `tr.ant-table-row`
