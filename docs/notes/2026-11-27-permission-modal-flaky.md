# 治 CI flaky：PermissionModal「换角色后提交新角色」偶发红（#193）

> 交接文档 —— 让下一棒（可能是另一个会话的 agent）接得上。
>
> ⚠️ **状态：已完成（待人拍板合并）** —— PR #198。

## 目标

- **关联**：issue #193（本条是 milestone #16 的第一条）
- **一句话**：`frontend/src/pages/module_system/role/PermissionModal.test.tsx`
  里「换一个角色，表单里是**新**角色的菜单」那条用例**在 CI 上随机红**
  ⇒ 定位真因（不是「再等一会儿」）、修掉、**并把「连跑」接进 CI**。

## 状态

**已完成** —— 修法 + 负例 + CI 重复跑 job 全部入库；PR #198 待人拍板。

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
  **`onFinish` 一次都没走到**（或走到了但提前 `return false`）；
- **点击本身没抛错** —— `await getByRole('button', {name:/确\s*认/}).click()` 正常返回了
  ⇒ **不是「找不到按钮」也不是「点不动」**，而是**点下去的那一下没打到该打的节点**。

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

### ④ 两次红其实是**两种不同的失败**（拉日志才看出来的）

把两次红的日志都拉下来对比，发现**签名不一样**：

| run | 时间 | 红的用例 | 签名 | 性质 |
| --- | ---- | -------- | ---- | ---- |
| `43865989086` | 2026-11-16 | `同一个角色、但记录里的菜单变了` | `expected "vi.fn()" to be called at least once`，**用例只跑了 1519ms** | 提交**慢**（>1s）⇒ 那时 `vi.waitFor` 用的是 **vitest 默认的 1 秒窗口** ⇒ 窗口不够 |
| `45926795199` | 2026-11-27 | `换一个角色,表单里是新角色的菜单` | 同一条断言，但**用例跑了 11330ms**（= 10 秒超时打满） | 提交**根本没发生** |

⇒ 2026-11-16 那次是 **#154 已经修掉的那一类**（窗口不够）。
⇒ 2026-11-27 这次是**新的一类**：**点下去的那一下没打中**。
⇒ #193 要治的是**后者**。

### ⑤ 在 CI 上抓到的现场（`feat/193-diag` 分支，临时插桩，已删）

在 CI 上给 `onFinish`、鼠标事件、按钮状态都打了 `[DIAG]` 日志，
用新增的 `frontend-flaky-repeat` job 跑了**整仓 10 轮 + coverage 1 轮**：

```
[DIAG] mouse   {"t":"T+419ms","type":"mousedown","target":"#1","tag":"SPAN","text":"确 认","connected":true,"inFooter":true}
[DIAG] mouse   {"t":"T+423ms","type":"mouseup",  "target":"#1", …,"inFooter":true}
[DIAG] mouse   {"t":"T+423ms","type":"click",    "target":"#1", …,"inFooter":true}
[DIAG] after click {"modalClass":"ant-modal css-dev-only-do-not-override-eofgey","transform":"none", …}
```

⇒ **绿的那几轮里**：mousedown / mouseup / click **落在同一个节点上**、
节点在 footer 里、点的时候弹窗的动效类**已经摘掉** ⇒ 点击本身是好的。
⇒ ⇒ **绿的时候点击没问题 ⇒ 这条链路平时是通的；红的时候是「这一下没落到位」。**

## 真因

**「`rerender` 换记录 ⇒ 弹窗重建 ⇒ 弹窗重新走一遍入场动画」这半个窗口，
#154 没有等。**

拆开看，弹窗的「确定」按钮从挂载到能安全点，中间隔着**两段**：

1. **portal 搬运**（ProComponents `useOverlayForm`）
   —— 提交按钮先 **inline 渲染在表单旁边**，等 footer 的 ref 挂上后
   `forceUpdate` + `createPortal` **搬进 footer** ⇒ **DOM 节点被换掉一次**。
   ⇒ **#154 等的就是这一段**（`waitForSubmitButtonInFooter`）。
2. **入场动画**（antd 的 zoom 动效）
   —— 搬完之后，弹窗还要走一遍 `ant-zoom-appear` 动效
   （**是 CSS `animation`，不是 `transition`**）
   ⇒ 这段时间里弹窗整体在**缩放**（`transform` 从 `matrix(0.2,…)` 长到 `none`），
   底部的按钮跟着在**动**。

⇒ **#154 等的是「挂载那一刻」的状态，而动画在它**之后**才开始**
⇒ 于是「动画期间按钮还在动」这半个窗口**一直没人管**。

### 为什么这一下会「点不中」

Playwright 的 `click()` 有一套**启发式**（等元素「可见 / 可点 / **盒子不再变**」）。
它**通常**能把这条等出来（本地实测：把动画拉到 4 秒，click 会等 4292ms 才落下），
但它是**启发式**，不是保证：

- 元素「稳定」的判定是**连续两帧的盒子相同**；
- CI 上浏览器被整仓 74 个文件抢 ⇒ **帧来得不均匀**
  ⇒ 两帧可能落在动画的同一处 ⇒ 判定成「已经稳了」
  ⇒ **按旧位置算出来的落点，打下去时按钮已经挪了** ⇒ 这一下落空。

⇒ 表现就是 CI 上看到的样子：**`click()` 正常返回、不报错，但提交没发生**，
用例只能等到 `vi.waitFor` 的 10 秒超时才红。

### 顺带量到的另一个位移源

菜单树数据到达 ⇒ 弹窗内容变高 ⇒ 底部的「确定」按钮**整体上移**
（实测 `top 442 → 498`，#154 的 note 里记过）⇒ **同一个性质的「按钮在动」**。

### ⚠️ 说清楚哪些是**实测**、哪些是**推断**

| 结论 | 证据强度 |
| ---- | -------- |
| 换记录 ⇒ 弹窗重建 ⇒ 重新入场动画 | **实测**（`ant-zoom-appear` 在 `rerender` 之后**立刻**就在 `.ant-modal` 上） |
| 动画期间按钮在动（`transform` 一直在变） | **实测**（逐帧采样：`matrix(0.2)` → `matrix(1)`） |
| #154 等的「在 footer 里」发生在动画**之前** | **实测**（`waitForSubmitButtonInFooter` 在 ~1ms 内就达成，动画还要 ~300ms） |
| 「帧不均匀 ⇒ Playwright 误判稳定 ⇒ 落点失效」 | **推断**（Playwright 的稳定判定是启发式；**本地/CI 都未能复现出红的现场**） |

⇒ **诚实的说法**：**机制**（动画窗口存在、#154 没等）是实测的；
**具体是哪一帧、为什么这一下落空**没有抓到现场（本地 45/45、CI 11 轮整仓都绿）。
⇒ 所以修法选的是**「让这一类窗口根本不存在」**，而不是去猜某一帧。

## 修法

### ① 等**状态**，不等时间 —— `frontend/tests/modal-submit.ts`（新）

新增一个**共享**助手（`tests/` 不在 vitest 的 `include` 里 ⇒ 不会被当成测试文件）：

- `submitButtonState(scope?)` —— **同步**的状态判定，返回
  `'no-modal' | 'animating' | 'no-button' | 'not-in-footer' | 'disabled' | 'ready'`；
  **判定顺序从外到内** ⇒ 动画没结束时报出来的就是 `animating`。
- `waitForSubmitButtonReady({timeout?, scope?})` —— 反复问上面那个状态，直到 `ready`。
  另外还要求**按钮的盒子在两次采样之间没变**（盖住「内容变高把按钮挪走」）。

⇒ **等的是状态，不是时间**：没有任何 sleep、没有「多等一会儿」；
`timeout` 只是这条状态等待的**上限**（状态在几百毫秒内达成），
作用是「状态永远达不成时**快速失败**」，不是「靠拖时间把用例糊过去」。

⚠️ **动效类的判定用的是 rc-motion 的命名约定**（`appear` / `enter` / `leave`），
不是 antd 的某个具体类名 ⇒ antd 换主题/换动效名也不影响。

### ② 所有「点确定」之前都过这一关

- `src/pages/module_system/role/PermissionModal.test.tsx` —— **6 处**点确定全部加上；
- `src/pages/module_system/user/ModalForm.test.tsx` —— **同款**（ModalForm + portal + 动画）也加上。

### ③ 负例：**能复现原竞态**（不是只测 happy path）

新增 `describe('原竞态的复现（issue #193）')`：

- 用一条 CSS 把 antd 弹窗的入场动画**拉长到 2 秒**
  （`animation-duration` —— 因为 antd 的 zoom 动效是 **CSS animation**）
  ⇒ 竞态窗口从「~300ms、偶发撞上」变成「**2 秒、必然撞上**」；
- 断言①：换角色后 `submitButtonState()` **就是 `'animating'`**（竞态窗口确实存在）；
- 断言②：在这个窗口里，`waitForSubmitButtonReady()` **不放行**；
- 断言③：动画结束后放行 ⇒ 点确定 ⇒ **真的提交**（守卫不会把用例卡死）。

⚠️ **这个负例是「load-bearing」的**（验过）：
把 `submitButtonState()` 里判 `animating` 的那行去掉 ⇒ 断言①立刻红
（`expected 'ready' to be 'animating'`）⇒ **谁把这一层等待去掉，它就红**。

### ④ 「重复跑」接进 CI —— `.github/workflows/ci.yml`

新 job `frontend-flaky-repeat`（**同一 commit 连跑 10 次**）。

⚠️ **跑的是整仓，不是单文件** —— 这是被实测纠正过一次的设计：

- 最初写的是「只跑那个 flaky 文件」（理由：触发条件在同一个文件里）；
- **实测行不通**：单文件连跑 **45/45 全绿**（本地），整仓才有红
  ⇒ 触发条件不是「文件内部的时序」，而是**整仓并行时的浏览器争抢**；
- ⇒ 现在跑**整仓 10 轮**（CI 上一轮 ~65s ⇒ ~11 分钟）。

### ⑤ 扫前端其它同款「等 DOM 节点」的测试

全仓 `document.querySelector` / `querySelectorAll` 的测试用法扫了一遍（34 处）：

| 文件 | 结论 |
| ---- | ---- |
| `src/pages/module_system/role/PermissionModal.test.tsx` | **同款** ⇒ 已修 |
| `src/pages/module_system/user/ModalForm.test.tsx` | **同款**（ModalForm + portal + 动画）⇒ 已修 |
| 其余 32 处 | **不同款** —— 都是「按 `data-role` / `.ant-tag` / `.gantt_*` 取节点做**断言**」，**没有**「等这个节点出现再点它」⇒ 无此雷 |

⚠️ **另外记一笔（本次不动，属另一类雷）**：
`src/pages/module_system/user/ModalForm.test.tsx` 的
`vi.waitFor(() => expect(onSubmit).toHaveBeenCalled())` 用的是 **vitest 默认的 1 秒窗口**
⇒ 和 2026-11-16 那次红（§④）是同一类「窗口不够」的雷。
**本 issue 只治「点不中」那一类**，所以**没有**动这个窗口（免得又被当成「靠加长超时过关」）。
⇒ 建议**另开一条**按 #154 的口径把它改成有上限的状态等待。

## 怎么验

```bash
cd frontend

# ① 单文件连跑 20 次（抗 flaky 的标准跑法）—— 本次实测 20/20 绿
node scripts/repeat-vitest.mjs src/pages/module_system/role/PermissionModal.test.tsx 20

# ② 整仓连跑（⚠️ 这才是**真正**能复现原 bug 的跑法 —— 浏览器被抢才会红）
node scripts/repeat-vitest.mjs 3      # 本次实测 3/3 绿（且与 ① 并发跑的）

# ③ 负例单独跑（它会把「竞态窗口」放大到 2 秒，肉眼可见）
npx vitest run src/pages/module_system/role/PermissionModal.test.tsx -t '原竞态的复现'

# ④ lint / 类型
npm run biome:lint && npm run tsc
```

## 决策记录

| 决定 | 为什么 |
| ---- | ------ |
| **改测试，不改组件** | 与 #154 一致：业务上没 bug（按钮 `disabled` 与 `onFinish` 守卫同源）；问题在测试点得太早 |
| **等「动效类消失」这个状态，不等「盒子不动」** | #154 的教训：「等它不动」在「动画还没开始」时会**立刻**满足（实测 ~1ms）⇒ 落进缝里；而动效类在**挂载那一刻**就在（实测）⇒ 没有缝 |
| **把等待做成共享助手**（`frontend/tests/modal-submit.ts`） | 同款至少两个文件 ⇒ 不造第二套；`tests/` 不在 vitest `include` 里 ⇒ 不会被当测试文件 |
| **负例用「把动画拉长」而不是「靠概率」** | 本地/CI 都复现不出原 bug ⇒ 负例必须**自己制造**那个窗口（2 秒 ⇒ 必然撞上） |
| **重复跑改成整仓 10 轮** | 实测：单文件 45/45 绿，整仓才有红 ⇒ 单文件跑**复现不出来**（等于没接） |
| **没动 `user/ModalForm.test.tsx` 的 1 秒窗口** | 那是**另一类**雷（窗口不够），本 issue 只治「点不中」；动了会被当成「靠加长超时过关」 |
| **CI job 保留在 `ci.yml`**（不是单独 workflow） | 跟其它前端 job 在一起 ⇒ 每次 push 都会跑 |

## 下一步（给人 / 下一棒）

1. **人拍板** PR #198（高风险口径：动了「点确定」的时序 ⇒ 值得人亲眼看一遍 diff）。
2. 合并后建议**观察几轮 CI**：`frontend-flaky-repeat` 会天天连跑 10 轮整仓 ⇒ flaky 自己会露出来。
3. **另开一条**处理 `user/ModalForm.test.tsx` 的 1 秒窗口（§⑤ 末尾）。
