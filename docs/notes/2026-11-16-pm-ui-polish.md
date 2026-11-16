# PM 页面三处打磨（2026-11-16）

> 交接文档 —— 关联 issue **#66**。

## 目标

- **关联**：issue #66 · PR _（待填）_
- **一句话**：任务页与项目详情页三处**载入与提示的表现统一**（甘特降级、任务列表一个圈、成员表有圈）。

## 状态

进行中（实现 + 测试已完，待 PR / 合并）

## 短设计（规模：中 ⇒ 按 `docs/process.md` §3 写短设计）

### ① 甘特「未排期」提示：Alert ⇒ 一行灰字（可点开看全部）

- **形态**：一行 `Typography.Text type="secondary"`（`12 个任务未排期，未在甘特中显示 ▸`），**放进工具栏那一行**（跟筛选框、缩放段控器并排）⇒ 不再自己占一整行、不再把甘特图往下挤。
- **展开**：点一下弹 antd `Popover`（`trigger="click"`）⇒ 里面是**全部**未排期任务的标题清单（可滚动，`maxHeight: 240`）。
- ⚠️ **要能看全** ⇒ `mapping.excludedTitles` 不能再只留 5 条 ⇒ 去掉 `EXCLUDED_TITLES_LIMIT`（**只影响「列举哪些标题」，不影响「哪些任务算未排期」的判定** ⇒ 不动 issue 的「不做」栏）。
- 措辞从「未显示」改成「未排期」—— 「没排计划日期」是**常态**，不是故障。

### ② 任务列表：两个圈 ⇒ 一个

- **保留 ProTable 自带的那个**（它已经看得见：antd 在「空表 + loading」时会在空区渲染 `Spin`），**删掉自绘覆盖层**（issue #9 的产物）。
- ⚠️ 但自绘覆盖层还顺手挡着 antd 的空状态文字「暂无数据」⇒ 删掉之后要确认**载入中不会露出「暂无数据」**（那正是 issue #9 的老症状）⇒ 载入期间把 `locale.emptyText` 置空。
- **表格体高度为 0 时也得看得见**：antd 的空区 `Spin` 挂在**表格体**里 ⇒ 表格体有高度才有圈 ⇒ `scroll.y` 已有下限 200（`useTableBodyHeight` 里 `Math.max(200, …)`）⇒ 载入期间表格体不会被压成 0。

### ③ 成员表：补载入指示

- `MembersTab` 现在**没有 loading 状态** ⇒ 请求期间一片空白，看着像「没有成员」。
- antd `Table` 有原生 `loading` prop ⇒ 直接用；接口返回的是**数组**（不是分页信封）⇒ 沿用 `res?.data ?? []`。
- 「加载中」与「确实没有成员」能区分：载入中 ⇒ 转圈；载入完且为空 ⇒ antd 的空状态。

## 已完成

| 提交 | 做了什么 |
| ---- | -------- |
| `5fc8131` | ① 甘特提示降级成一行灰字（Popover 看全部）+ `mapping.excludedTitles` 收全部标题 + e2e 改写 |
| `30817d7` | ② 任务列表删掉自绘覆盖层 + 修 `waitForDataset` 的竞态 + 载入期间空状态文字置空 + e2e 守卫改写 |
| `ac70b89` | ③ 成员表抽成 `MembersTab.tsx` + 补 `loading` + 新增单测（4 条） |

### ⚠️ ② 里踩到的一个真 bug（值得单独记住）

**ProTable 自带的 loading 遮罩其实一直「不一定出现」** ⇒ 以前是**自绘覆盖层在顶着**，
所以双圈的问题被掩盖了：

- `waitForDataset` 原来等的是「**现在不在 loading**」；
- 而 react-query 的 `isLoading` 在**首帧还是 false**（查询要等 effect 才真的发起）
  ⇒ ProTable 的 `request` 在首帧就 resolve 空数组 ⇒ **它自己的遮罩根本没机会出现**；
- ⇒ 删掉自绘覆盖层后，载入期间**既没有圈、又露出「暂无数据」**（issue #9 的老症状）。

⇒ 改成等「**第一次取数结束**」（`dataUpdatedAt > 0` 或 `error`）⇒ 遮罩稳定出现 ⇒
只留一个指示器。

### ⚠️ antd 的 `locale.emptyText` 怎么盖掉「暂无数据」

antd v6 的合并顺序是 `{...ConfigProvider 的 locale, ...props.locale}`
⇒ **props 里的 `locale` 能盖掉默认文案**；传 `emptyText: null` ⇒ 不渲染空状态
（`undefined` 则回落到默认的「暂无数据」）。


## 决策记录

| 决定 | 为什么 | 错了的代价 |
| ---- | ------ | ---------- |
| 任务列表**保留 ProTable 自带的圈**、删自绘覆盖层 | PM 指的「参考实现」就是里程碑页（只用 ProTable 自带的 loading）⇒ 两个页面表现一致 | 保留自绘覆盖层 ⇒ 两个圈一直在转（用户抱怨的正是这个） |
| ⚠️ **顺手把 `waitForDataset` 的竞态修了** | 不修的话，删掉自绘覆盖层后**载入期间一个圈都没有**（ProTable 自己的遮罩在首帧就错过了）⇒ 退回 issue #9 的老症状 | 不修 ⇒ 「空列表 → 数据突然冒出来」 |
| 载入期间把 `locale.emptyText` 置空 | antd 在「空表 + loading」时**仍会渲染「暂无数据」**（只是被遮罩盖住）⇒ 不置空就会露出老症状 | 不置空 ⇒ 用户又看到「空列表 → 数据突然冒出来」 |
| `mapping.excludedTitles` 去掉 5 条上限 | 验收要求「可点开看到**是哪些任务**、要能**看全**」⇒ 只留 5 条就做不到 | 保留上限 ⇒ 弹层里只有 5 条，其余无从得知 |
| 甘特提示**放进工具栏行** | 「不再占一整行」⇒ 单独一行哪怕是小字也还是一行 ⇒ 与筛选框并排才真正不占行 | 单独放一行 ⇒ 甘特图仍被往下挤一点 |
| 成员表用 antd `Table` 的 `loading` | 原生 prop ⇒ 最省事，且与「空状态」天然区分 | 自己画覆盖层 ⇒ 又多一处要维护的载入表现 |
| `MembersTab` 抽成独立文件 | 它住在 `detail.tsx` 里 ⇒ 单测得把整个详情页（连带甘特图）都拉进来 ⇒ 测试又重又脆 | 不抽 ⇒ 成员表只能靠 e2e 验（慢且脆） |

## 怎么验

```bash
cd frontend && npm run lint
cd frontend && npm run test
cd frontend && npm run build          # ⚠️ e2e 跑的是 dist/ ⇒ 改完源码必须先 build
cd frontend && npx playwright test e2e/pm-task-gantt.spec.ts e2e/task-workspace.spec.ts e2e/pm-project.spec.ts
```

**本地实跑（2026-11-16）**：lint ✅ · 单测 69 文件 / 589 用例 ✅ · e2e 三份共 32 条 ✅ · 构建 ✅。

## 坑与提醒

- ⚠️ **e2e 跑的是 `frontend/dist/`**（生产构建）⇒ 改完源码不 build ⇒ 测的是旧代码。
- ⚠️ 甘特那条 e2e 现在按 `.ant-alert-info` 找排除提示 ⇒ 提示降级后**必须一起改**，否则 e2e 会假红。
- ⚠️ 「载入中」的表现要用**命中测试**（`elementFromPoint`）判断，不能只看 DOM 里有没有那个节点。
