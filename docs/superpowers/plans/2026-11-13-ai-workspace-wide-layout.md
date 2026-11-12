# AI 工作台最大化：一屏铺满 —— 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 最大化后的 AI 工作台**一屏看完、不用滚**：对话区吃满剩余高度，「待确认/审计/规则」收进右侧 360px 窄栏，意图卡片墙折进输入框上方的抽屉。

**Architecture:** 只改**布局**，不动对话的发送/流式/会话逻辑。`AiWorkspaceWide`（最大化浮层与路由页 `/ai/workspace` 共用）的根容器改成 `flex` 列 + `overflow:hidden`；中间一行 = 左侧对话（`flex:1`）+ 右侧栏（360px，装原来的三个页签）；`WideChat` 的高度从固定 `min(560px,55vh)` 改成 `flex:1`；意图卡片墙改成浮在输入框上方的抽屉。

**Tech Stack:** React 19 · antd 6（Tabs / Drawer / Tooltip / Collapse）· Umi Max 4 · Vitest（browser）· Playwright（e2e）

**Spec:** `docs/superpowers/specs/2026-11-13-ai-workspace-wide-layout-design.md`

## Global Constraints

- **只改布局**：对话的发送、流式输出、会话（`useWorkspace`）、SSE 一个字都不改。
- **窄版 400px 浮层不动**（这次只针对最大化的界面）。
- **两个宿主都受益**：最大化浮层与路由页 `/ai/workspace` 共用 `AiWorkspaceWide` ⇒ 改一处两边都变。
- 「待确认/审计」**按需读**的规矩不变（页签没打开不读接口）。
- 「规则与 AI 的分工」在 360px 侧栏里**单栏堆叠**（原来是双栏）。
- 所有新代码 Biome 干净、`tsc --noEmit` 干净。
- e2e 命令：`cd frontend && npx playwright test`（dev server 在 `http://localhost:8001`）。
- 单测命令：`cd frontend && npx vitest run --config vitest.local.config.ts`（`NODE_ENV` 不能是 `production`）。
- 提交用 Conventional Commits（中文正文），走 husky 的 lint-staged。

## Review Focus

规格没写、但最可能咬人的五个输入/情形（各自的任务里要有对应的测试）：

1. **路由页 `/ai/workspace` 的高度链与浮层宿主不同**（实测：`pro-layout-content` 894 → 内容区 894 →
   宽版 788）⇒ 两条宿主都要验「不滚」，不能只验浮层。
2. **高度链塌掉**（某个宿主的高度不确定）⇒ 对话区不能缩成 0 高度（要留兜底 `minHeight`）。
3. **内容区窄（< 900px）** ⇒ 360px 侧栏会把对话挤没 ⇒ 必须变成抽屉，不能硬挤。
4. **意图卡片抽屉打开时** ⇒ 点完卡片要能**直接发送**（抽屉自动收起、输入框可见）。
5. **现有的最大化守卫必须继续绿**：「最大化与返回都不动原界面」「宽窄切换不新建会话」
   「宽版盖住内容区,顶栏与左侧菜单留着」—— 这次改的正是那个组件。

---

## 文件结构

```
frontend/src/components/ai-workspace/
  AiWorkspaceWide.tsx   # 改：两栏骨架、右侧栏、模型条减法、意图抽屉的内容来源
  WideChat.tsx          # 改：高度吃满、意图抽屉的按钮与浮层、待确认提示文案
  RuleSplit.tsx         # 改：加 stacked prop（侧栏里单栏堆叠）
frontend/e2e/ai-workspace.spec.ts   # 改：新增「最大化（一屏铺满）」的守卫
```

---

### Task 1: 两栏骨架 + 整页不滚

**Files:**
- Modify: `frontend/src/components/ai-workspace/AiWorkspaceWide.tsx`
- Modify: `frontend/src/components/ai-workspace/RuleSplit.tsx`
- Test: `frontend/e2e/ai-workspace.spec.ts`

**Interfaces:**
- Consumes: `useAiLists`（按需读）、`PendingPanel`、`AuditPanel`、`RuleSplit`、`DiscussionBar`、`WideChat`（既有）
- Produces:
  ```ts
  // RuleSplit.tsx 新增
  export interface RuleSplitProps {
    /** 侧栏窄 ⇒ 两栏并排放不下 ⇒ 改成上下堆叠 */
    stacked?: boolean;
  }
  export function RuleSplit(props?: RuleSplitProps): React.ReactElement;
  ```

- [ ] **Step 1: 写失败的 e2e**

在 `frontend/e2e/ai-workspace.spec.ts` 的 `test.describe('最大化（宽版浮层）')` 里加一条：

```ts
test('最大化后右侧栏出现,页面自己不出滚动条', async ({ page }) => {
  // 进一个有内容的页面,打开工作台,最大化
  // 断言:
  //   1. 右侧栏存在(带 data-role="ai-wide-sidebar"),里面能看到「待确认」页签
  //   2. 宽版内容盒 scrollHeight <= clientHeight(不滚)
  //   3. 对话区在左、侧栏在右(比较两者的 boundingBox.x)
});
```

⚠️ 复用该文件里已有的「打开工作台 → 点最大化」的写法（`data-testid="ai-workspace-launcher"` →
`data-role="ai-workspace-expand-button"`），**不要另起一套**。

- [ ] **Step 2: 跑 e2e，确认失败**

```bash
cd frontend && npx playwright test e2e/ai-workspace.spec.ts -g "右侧栏出现"
```
Expected: FAIL —— 侧栏不存在（`data-role="ai-wide-sidebar"` 找不到）。

- [ ] **Step 3: 改 `AiWorkspaceWide.tsx` 的骨架**

1. 根容器：`overflowY: 'auto'` ⇒ **`overflow: 'hidden'`**，并加 `flex: '1 1 0%'`、`minHeight: 0`
   （它是 `AiWorkspace` 根（flex 列）的子项 ⇒ 靠 flex 吃满，比只写 `height:'100%'` 更稳）。
   ⚠️ 保留 `height: '100%'`（路由页那条链靠它）。
2. 头部、模型条、连接错误 Alert **原样不动**（它们是 `flexShrink: 0` 的固定高块）。
3. 头部与模型条之后，插一个**中间行**：

```tsx
<div style={{ display: 'flex', gap: token.size, flex: '1 1 0%', minHeight: 0 }}>
  {/* 左：对话 */}
  <div style={{ flex: '1 1 0%', minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
    <DiscussionBar ... />
    <WideChat ... />
  </div>
  {/* 右：侧栏 */}
  <aside data-role="ai-wide-sidebar" style={{ width: 360, flexShrink: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
    <Tabs ... />
  </aside>
</div>
```

4. 把原来**在页面底部**的 `<Tabs>`（待确认/审计/规则与 AI 的分工）**搬进右侧栏**；
   三个页签的 children 容器从固定 `height: 360` 改成 `flex: '1 1 0%'; minHeight: 0; overflow: 'hidden'`
   （面板内部自己滚 —— `PendingPanel`/`AuditPanel` 已经能滚）。
5. `RuleSplit` 在侧栏里 ⇒ 传 `stacked`：
   - `RuleSplit.tsx` 加 `stacked?: boolean`；
   - `stacked` 为真时：外层 `flexDirection: 'column'`、两列 `flex: 'none'`、各自 `width: '100%'`。
6. **意图卡片墙这一步先留在原位**（页面底部）—— Task 3 再把它折进抽屉。
   ⇒ 本任务结束时页面**仍然会滚**（底部还有卡片墙）⇒
   **Step 1 的第 2 条断言（不滚）放到 Task 3 再加**，本任务只断言「侧栏出现 + 左右分栏」。

- [ ] **Step 4: 跑 e2e，确认通过**

```bash
cd frontend && npx playwright test e2e/ai-workspace.spec.ts -g "右侧栏出现"
```
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
cd /Users/ruanying/project/ai-admin-com
git add frontend/src/components/ai-workspace/ frontend/e2e/ai-workspace.spec.ts
git commit -m "feat(ai): 最大化的工作台改成两栏(对话 + 右侧栏),规则改单栏堆叠"
```

---

### Task 2: 对话区吃满剩余高度

**Files:**
- Modify: `frontend/src/components/ai-workspace/WideChat.tsx`
- Modify: `frontend/src/components/ai-workspace/AiWorkspaceWide.tsx`
- Test: `frontend/e2e/ai-workspace.spec.ts`

**Interfaces:**
- Consumes: Task 1 的两栏骨架
- Produces: 无新导出（只改样式与结构）

- [ ] **Step 1: 写失败的 e2e**

在同文件的「最大化（宽版浮层）」里加：

```ts
test('对话区吃满剩余高度:底边贴着内容区底边', async ({ page }) => {
  // 最大化 → 取对话区(带 data-role 的聊天容器)与宽版内容盒的 boundingBox
  // 断言: 对话区底边与内容盒底边的差 <= 8px
  //      对话区高度 > 视口高度的 55%(不再是固定 560/55vh)
});
```

⚠️ 对话区容器现在**没有** `data-role` ⇒ 给 `WideChat` 的那个盒子加一个
`data-role="ai-wide-chat"`（实现时加；e2e 依赖它）。

- [ ] **Step 2: 跑 e2e，确认失败**

```bash
cd frontend && npx playwright test e2e/ai-workspace.spec.ts -g "吃满剩余高度"
```
Expected: FAIL —— 对话区仍是固定高度，底边远高于内容区底边。

- [ ] **Step 3: 实现**

1. `WideChat.tsx`：那个盒子的 `height: 'min(560px, 55vh)'` ⇒
   **`flex: '1 1 0%'; minHeight: 0`**；并加 `data-role="ai-wide-chat"`。
   里面的消息列表已经是 `flex: '1 1 0%'; minHeight: 0; overflowY: 'auto'` ⇒ 不动。
2. `AiWorkspaceWide.tsx`：左列（对话）那个 `div` 要能把它撑满 ⇒
   `display: flex; flexDirection: column`（已有）+ 对话区是它的最后一个子项 ⇒ `flex:1` 生效。
   ⚠️ `DiscussionBar` 是对话区**上面**的一块 ⇒ 它不能被压扁 ⇒ 给它 `flexShrink: 0`。
3. 兜底：宽版根容器加 `minHeight: 320px`（高度链万一塌了，整页不至于变成一条）。
   ⚠️ **不要**给对话区加 `minHeight: 320px` —— 那会把头部顶出可视区。

- [ ] **Step 4: 跑 e2e + 现有的最大化守卫**

```bash
cd frontend && npx playwright test e2e/ai-workspace.spec.ts
```
Expected: 全过（Task 1 那个 + 本任务 + 既有的三条最大化守卫）。

- [ ] **Step 5: 提交**

```bash
cd /Users/ruanying/project/ai-admin-com
git add frontend/src/components/ai-workspace/ frontend/e2e/ai-workspace.spec.ts
git commit -m "feat(ai): 最大化的对话区吃满剩余高度,滚动只在消息区里"
```

---

### Task 3: 意图卡片折进输入框上方的抽屉

**Files:**
- Modify: `frontend/src/components/ai-workspace/WideChat.tsx`
- Modify: `frontend/src/components/ai-workspace/AiWorkspaceWide.tsx`
- Test: `frontend/e2e/ai-workspace.spec.ts`

**Interfaces:**
- Consumes: `IntentGallery`（既有，props 不变）
- Produces:
  ```ts
  // WideChat.tsx 新增 prop
  export interface WideChatProps {
    // ...既有
    /** 意图卡片抽屉的内容（由宿主给；不给就没有那个按钮） */
    intentSlot?: React.ReactNode;
  }
  ```

- [ ] **Step 1: 写失败的 e2e**

```ts
test('意图卡片折进输入框上方的抽屉:能开、点卡片填输入框并自动收起', async ({ page }) => {
  // 最大化 → 断言页面上**没有**直接铺开的意图卡片墙
  // 点「意图卡片」按钮 ⇒ 抽屉出现(带 data-role="ai-intent-drawer")
  // 点抽屉里的一张卡片 ⇒ 输入框被填上、抽屉收起
});
```

- [ ] **Step 2: 跑 e2e，确认失败**

```bash
cd frontend && npx playwright test e2e/ai-workspace.spec.ts -g "意图卡片"
```
Expected: FAIL —— 找不到「意图卡片」按钮。

- [ ] **Step 3: 实现**

1. `WideChat.tsx`：
   - 加 prop `intentSlot?: React.ReactNode`；
   - 在 **Composer 上面**加一行按钮：`意图卡片（10）`（带展开/收起箭头，
     `data-role="ai-intent-toggle"`）；
   - 点它 ⇒ 展开一块**绝对定位**的浮层（`data-role="ai-intent-drawer"`），
     `position: absolute; bottom: <按钮行上方>; left: 0; right: 0; maxHeight: 320; overflowY: auto`
     ⇒ **浮在对话区上方、不占高度**（对话区仍然吃满）；
   - 抽屉打开时，点**外面**或按 `Esc` ⇒ 收起。
2. `AiWorkspaceWide.tsx`：
   - 删掉页面底部那个 `<IntentGallery onPick={pickIntent} />`；
   - 改成把 `<IntentGallery onPick={handlePickIntent} />` 作为 `intentSlot` 传给 `<WideChat>`；
   - `handlePickIntent` = 填输入框 + **收起抽屉**
     ⇒ 抽屉的收起状态由 `WideChat` 持有 ⇒ 用一个「受控」的方式：
     `WideChat` 传 `onIntentPick?: () => void` 回来，或者
     `intentSlot` 用 render prop（`intentSlot: (close: () => void) => ReactNode`）。
     ⚠️ **选后者**（render prop）—— 收起动作只有 `WideChat` 知道怎么做。
   - `pickIntent` 里那个 `scrollIntoView` **删掉**（抽屉就在输入框上方，不用滚了）。
3. 抽屉打开时**不能挡住输入框** ⇒ 抽屉从下往上长，底部停在按钮行上方。

- [ ] **Step 4: 跑 e2e + 现有的守卫**

```bash
cd frontend && npx playwright test e2e/ai-workspace.spec.ts
```
Expected: 全过。

- [ ] **Step 5: 加「页面不滚」的守卫（Task 1 留下的）**

在 Task 1 那条 e2e 里补上第 2 条断言：宽版内容盒 `scrollHeight <= clientHeight`。
（此刻意图卡片墙已经折进抽屉 ⇒ 页面不该再滚了。）

⚠️ 若仍会滚：查是不是有块没进 flex 链（例如 `IntentGallery` 的外层 `section` 还在文档流里）。

- [ ] **Step 6: 提交**

```bash
cd /Users/ruanying/project/ai-admin-com
git add frontend/src/components/ai-workspace/ frontend/e2e/ai-workspace.spec.ts
git commit -m "feat(ai): 意图卡片折进输入框上方的抽屉,最大化的页面不用再滚"
```

---

### Task 4: 模型条做减法 + 待确认提示文案

**Files:**
- Modify: `frontend/src/components/ai-workspace/AiWorkspaceWide.tsx`
- Modify: `frontend/src/components/ai-workspace/WideChat.tsx`
- Test: `frontend/e2e/ai-workspace.spec.ts`

**Interfaces:**
- Consumes: 无新接口
- Produces: 无新导出

- [ ] **Step 1: 写失败的 e2e**

```ts
test('模型条只留一行,那句开发者解释收进 tooltip', async ({ page }) => {
  // 最大化 → 断言页面上**看不到**「没有数据源就不画配额条」
  // hover 模型那一行 ⇒ tooltip 里能看到那句话
});
```

- [ ] **Step 2: 跑 e2e，确认失败**

```bash
cd frontend && npx playwright test e2e/ai-workspace.spec.ts -g "模型条"
```
Expected: FAIL —— 那句话现在直接铺在页面上。

- [ ] **Step 3: 实现**

1. `AiWorkspaceWide.tsx` 的模型条：保留「当前模型：xxx」，
   把后面那整句解释挪进 antd `Tooltip`（`ⓘ` 图标，`mouseEnterDelay={0.1}`），
   tooltip 里放原文。⇒ 整条只剩一行。
2. `WideChat.tsx` 里待确认提示的「（去「待确认」页签点头）」⇒
   「（在右侧「待确认」里点头）」。
   ⚠️ 窄屏（侧栏变抽屉）时这句会不准 ⇒ 改成「（在「待确认」里点头）」——**不带方位**，
   两种形态都读得通。

- [ ] **Step 4: 跑 e2e**

```bash
cd frontend && npx playwright test e2e/ai-workspace.spec.ts
```
Expected: 全过。

- [ ] **Step 5: 提交**

```bash
cd /Users/ruanying/project/ai-admin-com
git add frontend/src/components/ai-workspace/ frontend/e2e/ai-workspace.spec.ts
git commit -m "style(ai): 模型条收成一行,开发者解释挪进 tooltip"
```

---

### Task 5: 窄内容区时右侧栏变抽屉

**Files:**
- Modify: `frontend/src/components/ai-workspace/AiWorkspaceWide.tsx`
- Test: `frontend/e2e/ai-workspace.spec.ts`

**Interfaces:**
- Consumes: 无新接口
- Produces: 无新导出

- [ ] **Step 1: 写失败的 e2e**

```ts
test('内容区窄时右侧栏变成抽屉,对话区不被挤扁', async ({ page }) => {
  // 把视口调窄(例如 760px)⇒ 最大化 ⇒ 断言:
  //   1. 对话区宽度 > 侧栏宽度(没被挤没)
  //   2. 侧栏默认收起,点「侧栏」按钮才滑出来
});
```

- [ ] **Step 2: 跑 e2e，确认失败**

```bash
cd frontend && npx playwright test e2e/ai-workspace.spec.ts -g "内容区窄"
```
Expected: FAIL —— 现在侧栏硬挤在右边。

- [ ] **Step 3: 实现**

1. `AiWorkspaceWide.tsx` **自己量宽度**（不要从宿主传 prop —— 路由页那个宿主没有这个值）：
   - 根容器 `ref` + `ResizeObserver` ⇒ `width` state；
   - `width < 900` ⇒ 走「抽屉」形态，否则走「并排」形态。
2. 抽屉形态：
   - 侧栏内容放进 antd `Drawer`（`placement="right"`, `width={360}`）；
   - 对话区**占满整个宽度**（不并排）；
   - 顶部（或对话区上方）放一个「侧栏」按钮（`data-role="ai-wide-sidebar-toggle"`）
     ⇒ 点它滑出抽屉。
3. 并排形态：保持 Task 1 的结构（360px 侧栏常驻）。
   ⇒ 用一个布尔 `const collapsed = width < 900` 切两套 JSX。

- [ ] **Step 4: 跑 e2e + 全套**

```bash
cd frontend && npx playwright test e2e/ai-workspace.spec.ts
cd frontend && npx vitest run --config vitest.local.config.ts && npm run lint && npm run build
```
Expected: 全过。

- [ ] **Step 5: 提交**

```bash
cd /Users/ruanying/project/ai-admin-com
git add frontend/src/components/ai-workspace/ frontend/e2e/ai-workspace.spec.ts
git commit -m "feat(ai): 内容区窄时右侧栏改成抽屉,对话区不被挤扁"
```

---

## 自检（对照规格）

| 规格条目 | 在哪个任务 |
| -------- | ---------- |
| 宽版容器：整页不滚（`overflow:hidden` + flex） | Task 1、Task 3（不滚的断言） |
| 对话区吃满剩余高度 | Task 2 |
| 意图卡片墙 → 输入框上方的抽屉 | Task 3 |
| 右侧栏 = 待确认/审计/规则 | Task 1 |
| 规则与 AI 的分工在侧栏里单栏堆叠 | Task 1（`RuleSplit` 的 `stacked`） |
| 模型条做减法（解释进 tooltip） | Task 4 |
| 待确认提示文案 | Task 4 |
| 内容区 < 900px ⇒ 侧栏变抽屉 | Task 5 |
| 两个宿主都受益 | 共享 `AiWorkspaceWide`（Task 1 改一处，两边都变） |
| 不动窄版 400px 浮层 | 全程（只改 `AiWorkspaceWide`/`WideChat`，窄版走 `ChatPanel`） |
| 不动后端 / 会话 / 流式 | 全程 |
| 守卫：不滚、抽屉能开能收、右侧栏可切页签 | Task 1/2/3 的 e2e |
