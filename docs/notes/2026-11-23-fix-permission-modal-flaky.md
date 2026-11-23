# 修 PermissionModal.test.tsx 的随机失败（#154）

> 交接文档 —— 让下一棒（可能是另一个会话的 agent）接得上。

## 目标

- **关联**：issue #154
- **一句话**：`frontend/src/pages/module_system/role/PermissionModal.test.tsx`
  里的「打开后立刻提交」那条用例**随机红**（CI 约 1/5 概率）⇒ 定位真因、修掉、
  并证明连跑 ≥ 20 次全绿。

## 状态

**已完成**（PR 已提，未合并 —— 等人拍板）。

## 真因（已实测定位，不是猜的）

**根因 = 组件行为；暴露它的是测试时序。** 两句话都要说清楚：

### ① 组件行为：ProComponents 的 `ModalForm` 挂载时会把提交按钮**搬一次**

`@ant-design/pro-components` → `form/layouts/_shared/useOverlayForm.js`：

```js
const footerDomRef = useRefFunction((element) => {
  if (footerRef.current === null && element) forceUpdate({});  // ← 触发一次重渲染
  footerRef.current = element;
});

const contentRender = useRefFunction((formDom, submitterDom) => (
  <>
    {formDom}
    {footerRef.current && submitterDom
      ? createPortal(submitterDom, footerRef.current)   // ← 有 footer 才 portal
      : submitterDom}                                     // ← 没有就 inline 渲染
  </>
));
```

⇒ **第一帧**：`footerRef.current === null` ⇒ 提交按钮 **inline 渲染在表单旁边**。
⇒ footer 的 ref 挂上 ⇒ `forceUpdate({})` ⇒ **第二帧**：按钮被 `createPortal`
**搬进 `.ant-modal-footer`**。
⇒ 因为挂载位置变了（`<Submitter/>` → `<Fragment key="submitter">`），
React **卸载旧节点、挂载新节点** ⇒ **DOM 节点被换掉一次**。

**实测证据**（`MutationObserver` 抓的现场，确定性复现，与 flaky 无关）：

```
ADD  #1 <div.ant-modal-container>   inFooter=false
REM  #2 <div.>                      inFooter=false   ← 旧按钮被摘掉
ADD  #3 <div.>                      inFooter=true    ← 新按钮进了 footer
```

### ② 测试时序：旧用例是「拿到**第一个**出现的确定按钮就点」

```js
await getByRole('button', { name: /确\s*认/ }).click();
```

⇒ 若这一步落在「按钮还是 inline 的那一帧」，点中的就是**马上要被替换**的节点
⇒ **点击丢失** ⇒ `form.submit()` 根本没跑 ⇒ `setRolePermission` 没被调用
⇒ 报 `expected "vi.fn()" to be called at least once`。

**为什么只有测试会翻车**：真人点不到那个窗口（弹窗还在动画入场，人手再快也
赶不上那 1 帧）⇒ **业务上没有 bug**，不需要改组件。

**复现条件**（本地实测）：

| 跑法 | 结果 |
| ---- | ---- |
| 单跑该文件 | 0/45 全绿（**本地几乎不复现**） |
| 整仓一起跑（`npx vitest run`，74 个文件并行） | **必红**（已连中 3 次） |

⇒ 触发条件是**浏览器被抢**（CI 的 runner 更慢 ⇒ 约 1/5 概率）。

## 修法（测试侧；**没有** sleep、**没有**放宽超时）

`frontend/src/pages/module_system/role/PermissionModal.test.tsx`：

1. **等「状态」而不是等「时间」**：等提交按钮已经落在 `.ant-modal-footer` 里
   （`expect.poll` + DOM 查询）⇒ 这就是「等具体 UI 出现」，正是 issue 要求的。
   - 顺带说明：`vi.waitFor` 那个 10 秒窗口**没动**（它等的是「提交真的发生了」，
     不是这次翻车的根因）。
2. **把两个异步依赖吊住**（`getCurrentUser` / `getDeptTree` 永不 resolve）
   ⇒ 「中间没有异步窗口」从「碰巧没赶上」变成「**物理上不可能有**」
   ⇒ 用例比原来**更强**（提交的菜单只能来自 record 的同步预填）。
3. **补一条用例**钉住「确定按钮最终落在弹窗底部」⇒ 防止有人把等待去掉。

## 怎么验

```bash
cd frontend

# ① 单文件连跑 20 次（任一次挂就停 ⇒ 直接看到那次失败的现场）
node scripts/repeat-vitest.mjs src/pages/module_system/role/PermissionModal.test.tsx 20

# ② 整仓连跑 20 次（⚠️ 这才是真正能复现原 bug 的跑法 —— 别只跑单文件）
node scripts/repeat-vitest.mjs 20
```

⚠️ **验收请用 ②**：单文件跑**本来就不红**（红的前提是「浏览器被抢」）。

⚠️ 脚本会把「**一个测试文件都没跑到**」判成失败 ——
vitest 匹配不到文件时会打印 `No test files found, exiting with code 0` 并**退出 0**
⇒ 不拦的话会把「啥都没跑」报成「全绿」。

## 同类排查（issue #154 的第 4 条）

扫 `frontend/src/**/*.test.tsx`：找「**点一下 ⇒ 靠一个等待窗口确认结果**」的写法
（`.click()` 之后 12 行内出现 `vi.waitFor(`）：

| 类别 | 数量 | 说明 |
| ---- | ---- | ---- |
| **A：点了之后靠 `vi.waitFor` 的「默认 1 秒」窗口确认** | 29 处 | 同一家族的隐患 |
| **B：等待窗口已显式放宽** | 6 处 | 全在 `PermissionModal.test.tsx`（本次修的就是它） |

**A 类里值得盯的（按风险排序）**：

| 位置 | 隐患 |
| ---- | ---- |
| `src/pages/module_system/user/ModalForm.test.tsx:109-113` | **同款**：在 `ModalForm` 里点「确认」⇒ 提交按钮可能还是那个「马上要被 portal 换掉」的节点；且等待窗口是**默认 1 秒**（CI 慢 ~8 倍）。**本次没改**（超出 #154 范围）⇒ 建议照抄本文件的 `waitForSubmitButtonInFooter()` + 放宽窗口。 |
| `src/pages/form/basic-form/index.test.tsx:143-147` | 不是 `ModalForm`（没有 portal 换节点），但「点了 ⇒ 1 秒窗口确认提交」同款；1 秒在 CI 上偏紧。 |
| `src/pages/table-list/index.test.tsx:174-176` | 挂载后 1 秒窗口等接口被调用 —— 便宜，低风险。 |
| 其余 26 处（`components/**`） | 多数是本地组件、无 `ModalForm` ⇒ 只有「窗口 1 秒」这半个隐患。 |

**为什么 `PermissionModal.test.tsx` 里另外 5 条提交用例不受影响**：
它们点按钮**之前**都先等 `aria-checked=true`（等菜单树的数据到）⇒
那是**异步**信号 ⇒ 必然晚于「按钮被搬进 footer」⇒ 点到的永远是最终节点。

## 决策记录

| 决定 | 为什么 | 错了的代价 |
| ---- | ------ | ---------- |
| 修在**测试侧**，不动 `PermissionModal.tsx` | 真因在 ProComponents（第三方库）里；且**业务上没有 bug**（真人点不到那 1 帧）⇒ 改组件只会扩大风险、违反「不改业务行为」 | 组件被改坏 ⇒ 权限弹窗出问题 |
| 等「按钮在 footer 里」这个**状态** | issue 明确要求「等具体 UI 出现」；这是唯一能同时满足「不 sleep」「不放宽超时」「保住用例意图」的做法 | 只能靠 sleep/放宽超时 ⇒ 违反 issue 的「不做」 |
| 把两个异步依赖**吊住** | 让「中间没有异步窗口」从概率事件变成**事实** ⇒ 用例更强、更抗环境抖动 | 「立刻提交」这条用例名不副实 |
| 复现脚本**入库**（`frontend/scripts/repeat-vitest.mjs`） | PM 要自己复跑验收 ⇒ 得有一条现成的命令 | 每次验收都要手搓命令 |
| 用「整仓一起跑」当复现手段 | flake 的前提是**机器慢**；单跑永远不红 ⇒ 证明不了 | 以为修好了 ⇒ CI 还是随机红 |
| 脚本把「**一个测试文件都没跑到**」判成失败 | vitest 匹配不到文件时**退出 0** ⇒ 不拦就会把「啥都没跑」报成「全绿」 | 验收时拿到假绿 |

## 产出

| 位置 | 做了什么 |
| ---- | -------- |
| `frontend/src/pages/module_system/role/PermissionModal.test.tsx` | 修「立刻提交」那条用例 + 补一条「确定按钮落在弹窗底部」的用例 |
| `frontend/scripts/repeat-vitest.mjs` | 「连跑 N 次」的抗 flaky 复现脚本（任一次挂就停） |
| `docs/notes/2026-11-23-fix-permission-modal-flaky.md` | 本文件 |
