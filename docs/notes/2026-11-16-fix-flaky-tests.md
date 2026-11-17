# 修两个 flaky 测试（PermissionModal 提交时序 + login e2e 依赖线上后端）（2026-11-16）

> 交接文档 —— 让下一棒（可能是另一个会话的 agent）接得上。

## 目标

- **关联**：issue #96 · PR（待提）
- **一句话**：CI 里两个**随机失败**的测试（2026-11-16 一天内卡了 3 个 PR）⇒ 找到真因并改成**稳定通过**。

## 状态

**已完成**（两个都改成稳定通过；20 次连跑全过）。

## 已完成

| 位置 | 做了什么 |
| ---- | -------- |
| `frontend/src/pages/module_system/role/PermissionModal.test.tsx` | 等「提交真的发生了」的 `vi.waitFor` **显式给 10 秒超时**（默认 1 秒在 CI 慢机上不够） |
| `frontend/src/pages/module_system/role/PermissionModal.tsx` | ① `onFinish` 的取值**回落**到记录里的值（`undefined` 才回落，空数组是用户的选择）② 去掉 `data_scope` 的 `required` 规则 |
| `frontend/e2e/login.spec.ts` | **验证码自己 mock**（`page.route` 拦 `/api/v1/system/auth/captcha/get`）⇒ 不再依赖线上后端；另加一条「验证码接口失败 ⇒ 页面给出重试入口」的用例 |

## 真因（两个都写清楚）

### ① `PermissionModal.test.tsx` —— **测试缺等待**（不是实现缺陷）

**证据**（CI 的 run #43864803786 attempt 1 / #43871631170 attempt 1）：

```
× 关掉再打开,表单里还是角色的菜单(不会把菜单权限清空)   1567ms
× 同一个角色、但记录里的菜单变了 ⇒ 表单跟着重建(不提交旧菜单)
AssertionError: expected "vi.fn()" to be called at least once
  ❯ src/pages/module_system/role/PermissionModal.test.tsx:314:39
    await vi.waitFor(() => { expect(mocks.setRolePermission).toHaveBeenCalled(); });
```

⇒ 两次失败**都是「表单被重建」的那两个用例**；其余 6 个（含「打开后立刻提交」）都过了。
⇒ 同一个文件：本地 ~1s，CI **7.6s** ⇒ **CI 的机器慢约 8 倍**。
⇒ 失败用例总共跑了 1567ms，其中 `vi.waitFor` 吃掉了**默认的 1000ms** ⇒
⇒ **「点确定 → 提交落地」这条异步链在 CI 上要超过 1 秒** ⇒ 默认超时**太紧** ⇒ 等不到就判失败。

⇒ **修法**：给这几处 `vi.waitFor` 显式超时（10 秒）。
⚠️ **这不是 sleep**：断言没变（还是「提交必须发生」），只是给这条异步链留够时间。

⇒ **顺带把实现的两个脆弱点补上**（不是 flaky 的成因，但同属「提交路径要稳」）：

- `onFinish` 的取值：`undefined` ⇒ 回落**记录里的值**（记录才是事实源）；
  **空数组是用户的选择**（把菜单清空）⇒ 不回落 ⇒ 「表单刚重建、值还没灌进来」时也不会提交出空菜单。
- 去掉 `data_scope` 的 `required` 规则：值**总是**来自记录 ⇒ 这条规则只会造成
  「校验失败 ⇒ 点确定**静默没反应**」⇒ 宁可让 `onFinish` 兜底。

### ② `login.spec.ts` —— **测试依赖真实后端**

⇒ 验证码图片是**后端下发**的 base64（`/api/v1/system/auth/captcha/get`），
而 e2e 的前端跑在**本地 preview**（8010）⇒ 不拦这个接口就等于**依赖线上后端**
⇒ 线上抖动 / 证书 / 验证码服务慢 ⇒ 随机失败。

⇒ **修法**：照仓里已有的做法（`e2e/helpers.ts` 的 `page.route`）**自己发一张图**
⇒ 用例只验「登录页长什么样」⇒ **跑得快也不抖**（本地：37s → 6.5s）。

## 决策记录

| 决定 | 为什么 | 错了的代价 |
| ---- | ------ | ---------- |
| 用例里给 `vi.waitFor` **显式超时**（而不是改全局 `testTimeout`） | 全局改大 ⇒ 所有用例都变慢 ⇒ 掩盖别的超时问题；只给「等提交」这几处 ⇒ 精确 | 全局放大 ⇒ 真超时的问题会被拖很久才发现 |
| **不动** `data_scope` 的取值来源，只加**回落** | 记录是事实源；但**用户的选择**（清空菜单 ⇒ 空数组）必须赢 ⇒ 只在 `undefined` 时回落 | 一律用记录的值 ⇒ 用户清空了菜单却被提交回旧值 ⇒ **静默撤销权限** |
| 去掉 `required` 规则 | 值总是来自记录 ⇒ 规则多余；留着只会造成「点确定没反应」的窗口 | 留着 ⇒ 慢机上偶发点不动 |
| 验证码**自己 mock**，不 mock 整个登录 | 这条用例只验「登录页长什么样」⇒ 只需要验证码那张图 | mock 整个登录 ⇒ 用例变成「测 mock 自己」 |

## 怎么验

**「连续跑 20 次」的验证方式**（两条都跑过，20/20 全过）：

```bash
# ① 单测（vitest 浏览器模式）
cd frontend
for i in $(seq 1 20); do
  npx vitest run src/pages/module_system/role/PermissionModal.test.tsx || break
done

# ② e2e（要构建产物：npm run build）
for i in $(seq 1 20); do
  npx playwright test e2e/login.spec.ts || break
done
```

⚠️ **e2e 跑的是 `dist/`** ⇒ 改完源码先 `npm run build`（这次踩过：跑的是旧产物）。

## 坑与提醒

- ⚠️ **worktree 里 `npm run build` 会失败**：`node_modules` 是 junction ⇒
  `node_modules/.cache` 与主 checkout 共用 ⇒ utoopack 的缓存互相踩。
  ⇒ 要跑 e2e 就**在主 checkout 里构建**（或 CI 里跑）。
- ⚠️ antd 的按钮文案里**两个汉字之间有空格**（「确 认」「重 试」）⇒
  选择器要用正则 `/确\s*认/`、`/重\s*试/`。
- ⚠️ `vi.waitFor` 的**默认超时只有 1 秒** ⇒ 慢机上「等一个异步链」要显式给时间。
