# 角色授权弹窗：「确定按钮可点」与「允许提交」同源（2026-11-18）

> 交接文档 —— **让下一棒（可能是另一个会话的 agent）接得上**。

## 目标

- **关联**：issue #109 · PR（待提）
- **一句话**：把角色授权弹窗里那两份互相对不上的事实源（按钮的 `disabled` 与 `onFinish` 的守卫）
  收成**一份** `canSubmit` ⇒ 不再存在「按钮可点、点了没反应、也不报错」的中间态。

## 状态

**已完成**（实现 + 单测 + e2e 都绿；**PR 只开不合并** —— 本条属高风险四类里的「权限」，等 PM 亲自看内容）。

## 已完成

| 提交 | 做了什么 |
| ---- | -------- |
| `6d00b8d` | `PermissionModal.tsx`：去掉 `useRef(roleId)` 那道守卫，改成 `canSubmit` 单一事实源；漂移时按钮禁用 + 可见原因 |
| `d1ad5fe` | 单测：换角色后「确定可点 + 真的提交」；拿不到记录时「禁用 + 可见原因」；漂移时「禁用 + 原因 + 不发请求」 |
| `f8a52a0` / `cc68308` | e2e（`frontend/e2e/role.spec.ts`）：「换角色后点确定 ⇒ 真的 PUT，带的是新角色的 id 与新角色的菜单」 |

**下一步**：等 PM 抽查 PR 内容后再合并（**本 PR 不由开发 agent 合并**）。

## 真因（先说清楚「原来到底是不是真的坏了」）

### ① issue 里说的那个根因：**方向对，机制不对**

issue 说：`useRef(roleId)` 的初值只取一次 + ModalForm 常驻 ⇒ `boundRoleIdRef.current !== roleId` 恒成立 ⇒ 静默拒绝提交。

**实测**：这条路径**今天走不到**。

- `boundRoleIdRef` 在 `RolePermissionForm` 里；父组件用 `key={formKeyOf(roleId, permission)}` 挂它，
  而 `formKeyOf` **把 roleId 算进了 key** ⇒ roleId 一变 ⇒ key 变 ⇒ **整个组件实例重建** ⇒ `useRef` 重新取初值。
- 写了一个 scratch 用例专门验这条 React 语义（`key` 变 ⇒ ref 重取；`key` 不变 ⇒ ref 停在初值）——
  结论：**只要 `key` 里带 roleId，那道守卫就不可能命中**。
- 反过来：**一旦 `key` 被拿掉**（或 roleId 不在 key 里），`useRef` 就永远停在旧角色上 ⇒
  `onFinish` 里 `return false` ⇒ **不提交、不报错、弹窗不关** ⇒ 正是 issue 描述的「点了没反应」。

⇒ 所以它是一条**哑火的地雷**：今天不炸，但只要有人动了 `key` 就炸，而且炸出来的症状最难查。
⇒ **这才是要修的东西**：不是「今天为什么没炸」，而是「别让它有机会炸」。

### ② CI 上那两个用例反复挂：**不是它**

翻 CI 日志（run `43864803786` attempt 1，2026-11-16）：失败的是「关掉再打开」，
断言 `expected "vi.fn()" to be called at least once`（`setRolePermission` 没被调用），
该用例总耗时 1567ms、其中 `vi.waitFor` 吃掉了**默认的 1000ms** ⇒
**「点确定 → 提交落地」这条异步链在 CI 慢机上超过了 1 秒** ⇒ 等不到就判失败。
⇒ 那是 #96 已经修掉的**时序**问题（把 `vi.waitFor` 的超时显式给到 10 秒）。
⇒ **本次不动它**：断言没改、没加 sleep、没塞 `vi.waitFor` 糊。

## 修法（单一事实源）

```tsx
// PermissionModal.tsx
const [boundFormKey] = useState(formKey);        // 这个表单实例是为哪份记录建的
const drifted = boundFormKey !== formKey;         // 记录变了但表单没重建
const canSubmit = permission !== undefined && roleId !== null && !drifted;

submitter={{ submitButtonProps: { disabled: !canSubmit } }}   // ← 同一个 canSubmit
onFinish={async (values) => {
  if (!canSubmit) return false;                              // ← 同一个 canSubmit
  ...
}}
```

- **按钮可点 ⇔ 允许提交**（同一个 `canSubmit`）⇒ 不可能有「可点但点了没反应」。
- **保留**「拿不到记录就不提交」这条防误清空的规则（`permission === undefined` ⇒ 不许提交）。
- 漂移（记录变了、表单没重建）时：**按钮禁用 + 弹窗里给出可见原因**，
  而不是像原来那样在 `onFinish` 里静默 `return false`。
- `useState(formKey)` 取代 `useRef(roleId)`：语义从「当前的角色 id」（会过期）变成
  「这个实例出生时的身份」（不会过期）—— **这才是 #109 那个坑的来源**。

## 决策记录

| 决定 | 为什么 | 错了的代价 |
| ---- | ------ | ---------- |
| 用 `canSubmit` 一个布尔量同时驱动 `disabled` 与 `onFinish` 守卫 | 「可点」与「可提交」必须是同一个事实；两个事实源就一定会漂移 | 两个事实源漂移 ⇒ 用户点确定没反应（issue 描述的症状） |
| 删掉 `useRef(roleId)` 那道守卫，而不是「修好它」 | 它今天就够不着（key 里带 roleId ⇒ 实例必重建）；留着就是哑火地雷 | 留着 ⇒ 以后谁动了 key，就出现「静默拒绝」 |
| 漂移时**禁用 + 给可见原因**，而不是提交时静默拒绝 | 「点了没反应、也不报错」是最糟的体验；禁用 + 说明 ⇒ 用户知道该干嘛 | 静默拒绝 ⇒ 用户反复点，排查成本极高 |
| 用 `useState` 记实例身份（而不是 `useRef`） | `useRef` 很容易被误读成「当前值」；`useState` 的初值语义就是「创建时定下」 | 继续用 ref ⇒ 下一个人还是会踩同一个坑 |
| **不改** `data_scope` 的取值来源、**不加** `required` 规则 | 那是 #96 的结论（值总是来自记录；`required` 只会造成校验失败⇒点了没反应） | 改回去 ⇒ 慢机上又出现「点不动」 |
| e2e 的第二个角色用「岗位管理」而不是「角色授权」 | rc-tree 会把勾上的子节点**向上联动**（唯一子节点勾上 ⇒ 父节点也显示勾上）⇒ 用同一个父节点下的菜单做区分会误判 | 用「角色授权」当第二个角色的菜单 ⇒ 断言看着通过，其实没区分度 |
| e2e 断言提交内容而不是只看勾选态 | 勾选态会被 rc-tree 的联动影响；**提交出去的内容**才是权限本身 | 只断言勾选态 ⇒ 回归时可能仍然红/绿不对 |

## 怎么验

```bash
# ① 单测（vitest 浏览器模式）—— 连跑 20 次全过
cd frontend
for i in $(seq 1 20); do
  npx vitest run src/pages/module_system/role/PermissionModal.test.tsx || break
done

# ② e2e（要构建产物：npm run build）
npx playwright test e2e/role.spec.ts
```

⚠️ **worktree 里 `npm run build` 会失败**（`node_modules` 是 junction ⇒ utoopack 的 symlink 解析跨盘失败）
⇒ 要跑 e2e 就**在主 checkout 里构建**（本次就是这么验的：把分支的文件取到主 checkout → build → 跑 e2e → 还原）。

本次实测：单测 **20/20 全过**；e2e `role.spec.ts` **11 条全过**（连跑 3 轮都过）。

## 坑与提醒

- ⚠️ **antd 的按钮文案里两个汉字之间有空格**（「确 认」「取 消」）⇒ 选择器用正则 `/确\s*认/`。
- ⚠️ **rc-tree 的勾选会向上联动**：一个节点只有一个孩子时，勾上孩子 ⇒ 父节点也显示为勾上
  ⇒ 想在 e2e 里区分两个角色，**要用不同父节点下的菜单**（本次用「岗位管理」id=4）。
- ⚠️ ProComponents 的 `ModalForm` 在 `destroyOnHidden` 时是**关闭动画结束后 `resetFields()`**，
  不是「销毁表单实例」；表单实例的生命周期跟着组件实例走（靠 `key` 重建）。
- ⚠️ `vi.waitFor` 默认超时只有 1 秒 ⇒ CI 慢机上「等一条异步链」要显式给时间（#96 的结论，本次沿用）。
