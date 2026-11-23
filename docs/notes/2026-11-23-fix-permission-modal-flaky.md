# 修 PermissionModal.test.tsx 的随机失败（#154）

> 交接文档 —— 让下一棒（可能是另一个会话的 agent）接得上。

## 目标

- **关联**：issue #154
- **一句话**：`frontend/src/pages/module_system/role/PermissionModal.test.tsx`
  里的「打开后立刻提交」那条用例**随机红**（CI 约 1/5 概率）⇒ 定位真因、修掉、
  并证明连跑 ≥ 20 次全绿。

## 状态

**已完成** —— PR **#160**（https://github.com/wenanguo/ai-admin-com/pull/160 ），
**未合并**（按约定等 PM / 人拍板）。
issue #154 上已留评论（做了什么 / 怎么验 / PR 号）。

## 真因（已实测定位，不是猜的）

**根因 = 组件行为；暴露它的是测试时序。** 两句话都要说清楚。

### ① 组件行为

**a) ProComponents 的 `ModalForm` 挂载时会把提交按钮「搬」一次**

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

⇒ **第一帧**：`footerRef.current === null` ⇒ 提交按钮 **inline 渲染在表单旁边**；
⇒ footer 的 ref 挂上 ⇒ `forceUpdate({})` ⇒ **第二帧**：按钮被 `createPortal`
**搬进 `.ant-modal-footer`**；
⇒ 挂载位置变了 ⇒ React **卸载旧节点、挂载新节点** ⇒ **DOM 节点被换掉一次**。

**实测证据**（`MutationObserver` 抓的现场，**确定性复现**，与 flaky 无关）：

```
ADD  #1 <div.ant-modal-container>   inFooter=false
REM  #2 <div.>                      inFooter=false   ← 旧按钮被摘掉
ADD  #3 <div.>                      inFooter=true    ← 新按钮进了 footer
```

**b) antd 的 `Modal` 有入场动画 ⇒ 弹窗里的东西在打开后**还会继续动**

实测（每 25–30ms 采一次 `getBoundingClientRect`）：

```
render() 返回后： top 329→377→413→421→430→437→440→441→442（~250ms 才停）
                  height  6→ 17→ 25→ 27→ 29→ 31→ 32→ 32
```

⇒ 「确定」按钮的**盒子在动画没结束前一直在变**（位置和大小都变）。
⇒ Playwright 的 `click()` 要等元素「**稳定**」（连续两帧盒子不变）才肯落点
⇒ 实测这一步让这一次点击**多花 ~640ms**（点击总耗时 638ms）。

**c) 菜单树数据到达 ⇒ 弹窗内容变高 ⇒ 底部的「确定」按钮**又移位**

实测：树加载前按钮最终停在 `top=442`，树加载后停在 `top=498`（差 56px）。

### ② 测试时序

旧用例是「拿到**第一个**出现的确定按钮就点」，而且它的 `beforeEach` 让
**菜单树 / 部门树的数据会到达** ⇒ 点的时候弹窗还在动（a/b/c 三个来源叠加）⇒

- **本地症状**：`Error: Test timed out in 15000ms while waiting for click.`
  ⇒ Playwright 一直等不到「稳定」，`click()` 永不返回；
- **CI 症状**：`AssertionError: expected "vi.fn()" to be called at least once`
  ⇒ 点了，但点在一个**正在被搬走 / 正在移动**的节点上 ⇒ 提交没发生。

**为什么只有测试会翻车**：真人点不到那个窗口（弹窗还在滑入，人手再快也赶不上）
⇒ **业务上没有 bug**，不需要改组件。

**复现条件**（本地实测）：

| 跑法 | 结果 |
| ---- | ---- |
| 单跑该文件 | 0/45 全绿（**本地几乎不复现**） |
| 整仓一起跑（74 个文件并行，浏览器被抢） | **能红**（CI 上约 1/5；本地需要「浏览器被抢」才复现） |

## 修法（测试侧；**没有** sleep、**没有**放宽超时）

`frontend/src/pages/module_system/role/PermissionModal.test.tsx`：

1. **把两个异步依赖吊住**（`getCurrentUser` / `getDeptTree` 永不 resolve）
   ⇒ 「中间没有异步窗口」从「碰巧没赶上」变成「**物理上不可能有**」
   ⇒ 顺带掐掉 (c) 那个移位来源
   ⇒ 用例比原来**更强**（提交的菜单只能来自 record 的同步预填）。
2. **等「确定按钮已经落在 `.ant-modal-footer` 里」**（`expect.poll` + DOM 查询）
   ⇒ 等的是**状态**（按钮的最终位置），不是时间 ⇒ 保证点到的那个节点**就是最终那个**。
   - 实测这个状态 `render()` 返回后 **~1ms** 就达成（不是「等一个窗口」）。
   - ⚠️ `timeout: SUBMIT_TIMEOUT_MS` 是「状态等待的**上限**」，不是「等一个必然超时的窗口」。
3. **补一条用例**钉住「确定按钮最终落在弹窗底部」⇒ 防止有人把等待去掉。

⚠️ **没动** `vi.waitFor` 那个 10 秒窗口 —— 它等的是「提交真的发生了」，
**不是**这次的根因（放宽它只会掩盖问题）。

## 怎么验

```bash
cd frontend

# ① 整仓连跑 20 次（⚠️ 这才是真正能复现原 bug 的跑法）
node scripts/repeat-vitest.mjs 20

# ② 单文件连跑 20 次
node scripts/repeat-vitest.mjs src/pages/module_system/role/PermissionModal.test.tsx 20

# ③ 单条用例 / lint / 类型
npx vitest run src/pages/module_system/role/PermissionModal.test.tsx
npm run biome:lint && npm run tsc
```

**实测结果**：

| 跑法 | 结果 |
| ---- | ---- |
| **整仓连跑 20 次** | **20/20 全绿**（每轮 74 个测试文件 / 634 条用例） |
| **单文件连跑 20 次** | **20/20 全绿**（每轮 11 条用例） |

⚠️ **复现提示**：原 bug **单跑该文件几乎不复现**（本地 0/45），
**整仓一起跑才容易红**（浏览器被别的测试文件抢走 ⇒ 机器慢）⇒
**验收请用整仓模式**，别只跑单文件。

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
| `src/pages/module_system/user/ModalForm.test.tsx:109-113` | **同款**：`ModalForm` 里点「确认」⇒ 提交按钮在挂载时被 portal 搬一次；等待窗口是**默认 1 秒**。**本次没改**（超出 #154 范围）⇒ 建议照抄本文件的 `waitForSubmitButtonInFooter()` |
| `src/pages/form/basic-form/index.test.tsx:143-147` | 不是 `ModalForm`（没有 portal 换节点），但「点了 ⇒ 1 秒窗口确认提交」同款；1 秒在 CI 上偏紧。 |
| `src/pages/table-list/index.test.tsx:174-176` | 挂载后 1 秒窗口等接口被调用 —— 便宜，低风险。 |
| 其余 26 处（`components/**`） | 多数是本地组件、无 `ModalForm` ⇒ 只有「窗口 1 秒」这半个隐患。 |

**为什么 `PermissionModal.test.tsx` 里另外 5 条提交用例不受影响**：
它们点按钮**之前**都先等 `aria-checked=true`（等菜单树的数据到）⇒
那时弹窗已经稳定 ⇒ 点的时机没问题。

## 决策记录

| 决定 | 为什么 |
| ---- | ------ |
| **改测试，不改组件** | 真因在 ProComponents/ant's 挂载与动画里，但**业务上没有 bug**（真人点不到那个窗口）⇒ 改组件属于超范围，且改不动第三方库 |
| **等「状态」而不是等「时间」** | issue 的硬要求。等的是「按钮已在 footer 里」这个**可判定的状态**（`expect.poll`），不是「睡 N 毫秒」 |
| **把异步 mock 改成永不 resolve** | 用例名字叫「中间没有异步窗口」，那就让它**真的没有**：从「碰巧没赶上」变成「物理上不可能有」⇒ 用例更强 |
| **复现脚本入库**（`frontend/scripts/repeat-vitest.mjs`） | PM 要自己复跑验收 ⇒ 得有一条现成的命令 |
| **脚本把「一个测试文件都没跑到」判成失败** | vitest 匹配不到文件时**退出 0** ⇒ 不拦就会把「啥都没跑」报成「全绿」（作者自己先踩了一次） |
| **整仓连跑才算验收** | 单跑该文件本地 0/45 不红 ⇒ 证明不了 |

## ⚠️ 诚实说明（别夸大结论）

- **本地没能稳定复现这个 flake**：整仓连跑 15 次 + 「8 个核跑满 CPU」再连跑 8 次
  ⇒ **一次都没红**。⇒ **A/B 无法隔离**「两处改动各贡献多少」，
  ⇒ 结论只能是「**两处一起**让这条用例确定」。
- 曾写过一个「等按钮**停下来**」的 helper ⇒ **实测它 1ms 就返回**
  （浏览器在两次 `requestAnimationFrame` 之间还没把动画算进去）
  ⇒ **没用** ⇒ **删掉了**。⇒ 这也说明「等状态」必须挑对状态。
- 早期版本把真因写成「点中那个马上要被替换的节点 ⇒ 点击丢失」——
  **后来的实测否掉了这句**（locator 解析到的已经是 footer 里那个最终节点）。
  本文档与 PR 正文已按实测改正。

## 交接（下一棒要看什么）

- 改动只落在 `frontend/src/pages/module_system/role/PermissionModal.test.tsx`
  （+ `frontend/scripts/repeat-vitest.mjs` + 本文件）⇒ **业务代码一行没动**。
- `src/pages/module_system/user/ModalForm.test.tsx` 的**同款隐患没修**
  ⇒ 建议另开一条 issue。
