# 治 CI flaky：PermissionModal「换角色后提交新角色」偶发红（#193）

> 交接文档 —— 让下一棒（可能是另一个会话的 agent）接得上。
>
> ⚠️ **状态：进行中（骨架已落）** —— 真因定位与修法见下面「真因」一节。

## 目标

- **关联**：issue #193（本条是 milestone #16 的第一条）
- **一句话**：`frontend/src/pages/module_system/role/PermissionModal.test.tsx`
  里「换一个角色，表单里是**新**角色的菜单」那条用例**在 CI 上随机红**
  ⇒ 定位真因（不是「再等一会儿」）、修掉、**并把「连跑」接进 CI**。

## 状态

**进行中** —— 骨架已落（CI 重复跑 job + 本文件）；真因定位与修法待补。

## 现场证据（CI 日志，不是猜的）

### ① 失败的**是哪一条**

`gh run view 45926795199 --log-failed`（PR #185 的 `coverage CI`，2026-11-27T02:11）：

```
FAIL  chromium src/pages/module_system/role/PermissionModal.test.tsx > 角色授权弹窗的预填
      > 换一个角色,表单里是**新**角色的菜单,不会提交上一个角色的   11330ms
AssertionError: expected "vi.fn()" to be called at least once
 ❯ vi.waitFor.timeout src/pages/module_system/role/PermissionModal.test.tsx:539:41
```

- `11330ms` ≈ **`vi.waitFor` 的 10 秒超时打满** ⇒ **不是「慢」，是「提交根本没发生」**；
- 断言挂在 `expect(mocks.setRolePermission).toHaveBeenCalled()` ⇒
  **`onFinish` 一次都没走到**（或走到了但提前 `return false`）。

### ② 同一批里**哪些用例红、哪些绿**（同一个文件、同一台机器、同一轮）

| 用例 | 耗时 | 结果 |
| ---- | ---- | ---- |
| 打开时预填角色的现有菜单 | 455ms | ✅ |
| 预填不再请求角色详情 | 225ms | ✅ |
| 什么都不动直接提交 | 724ms | ✅ |
| 打开后**立刻**提交（#154 加了「等按钮进 footer」） | 825ms | ✅ |
| 确定按钮最终落在弹窗底部 | 237ms | ✅ |
| 关掉再打开 | 1173ms | ✅ |
| 同一个角色、但记录里的菜单变了 | 1019ms | ✅ |
| 记录里没有菜单信息时不许提交 | 235ms | ✅ |
| 换角色后确定按钮依然可点 | 1250ms | ✅ |
| **换一个角色,表单里是新角色的菜单** | **11330ms** | ❌ |

⚠️ **注意**：同一条「换角色」的用例，#154 修过之后**又红过**（2026-11-16 那次红的是
`同一个角色、但记录里的菜单变了` ⇒ 见 run `43865989086`）⇒
**红的对象会漂** ⇒ 说明真因不是某条用例的写法，而是**一类时序**。

### ③ 红的那几条的共同点（先看到的规律）

历史两次红 + 本次红，**全都是「`rerender` 换记录」的那几条**：

- `换一个角色,表单里是新角色的菜单`（本次）
- `同一个角色、但记录里的菜单变了`（2026-11-16）
- （另一条「换角色后确定按钮依然可点」是同族，只是这次侥幸绿了）

⇒ 而 `rerender` 换记录 ⇒ `RolePermissionModal` 的 `key={formKey}` 变了
⇒ **`RolePermissionForm` 整个卸载重挂** ⇒ **`ModalForm` 也整个重挂**
⇒ **弹窗的 DOM、提交按钮的 DOM 节点、入场动画、菜单树的数据，全都是「重新来一遍」**。

⇒ **这正是 #154 没根治的那一半**：#154 修的是「**第一次**挂载」的那条用例
（`打开后立刻提交`）—— 它吊住异步依赖 + 等按钮进 footer；
而**重挂载**的那几条（换角色 / 换记录）**没有**这一步。

## 真因（待补：正在用诊断脚本抓现场）

（占位 —— 见下面「下一步」。）

## 怎么验

```bash
cd frontend

# ① 单文件连跑 20 次（抗 flaky 的标准跑法）
node scripts/repeat-vitest.mjs src/pages/module_system/role/PermissionModal.test.tsx 20

# ② 整仓连跑 20 次（⚠️ 这才是**真正**能复现原 bug 的跑法 —— 浏览器被抢才会红）
node scripts/repeat-vitest.mjs 20

# ③ 单条用例 / lint / 类型
npx vitest run src/pages/module_system/role/PermissionModal.test.tsx
npm run biome:lint && npm run tsc
```

## 决策记录

| 决定 | 为什么 |
| ---- | ------ |
| **把「连跑 10 次」接进 `ci.yml`**（新 job `frontend-flaky-repeat`） | issue 的验收标准；flaky 的特点是「跑一次绿了不能证明修好了」⇒ 只能靠连跑 ⇒ 得让 CI 天天跑它 |
| **重复跑只跑那个文件，不跑整仓** | 整仓一轮 CI 上 ~65s ⇒ 10 轮 ~11 分钟；而 flaky 的触发条件在**同一个文件里** ⇒ 单文件够 |
| **继续用 `frontend/scripts/repeat-vitest.mjs`**（#154 入库的） | 已有脚本，别造第二个；它已经会把「一个文件都没跑到」判成失败 |

## 下一步

1. 用诊断脚本抓「重挂载 ⇒ 提交按钮节点被换掉」的**现场时间线**；
2. 写**能复现原竞态的负例**（确定性，不靠概率）；
3. 修：**等状态**，不加超时、不加重试；
4. 扫前端其它同款「等 DOM 节点」的测试。
