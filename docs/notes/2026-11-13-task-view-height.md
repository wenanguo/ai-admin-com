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
