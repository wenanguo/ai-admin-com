# 目录拆分 · 阶段 2：拆 `context.ts`（讨论上下文 ⇒ 内核锚点 + 插件语义）（2026-11-16）

> 交接文档 —— 让下一棒（可能是另一个会话的 agent）接得上。

## 目标

- **关联**：issue #82 · PR（阶段 2；**#82 还没完**，见下面「下一步」）
- **一句话**：`src/agent/context.ts`（437 行、59 处业务词）拆成
  **内核的通用机制**（`core/context/anchor.ts`）+ **PM 的业务语义**（`plugins/pm/context/pm-context.ts`）
  ⇒ 内核第一次**没有**「任务 / 项目 / 报告人」这些词。

## 状态

**阶段 2 已完成**（代码 + 测试 + **行为等价验证**齐了；**行为不变**）。
**阶段 3~5 还没做** ⇒ #82 保持开着。

## 已完成

| 位置 | 做了什么 |
| ---- | -------- |
| `backend/ai/src/core/context/anchor.ts` | ★ **内核的通用机制**：`ContextAnchor`（作用域 + 基线 + 键值 + 可写字段白名单）· `WriteToolRule`（插件给的写规则）· `narrowWriteArgs`（**按白名单收窄写操作**）· `blockedWriteReason` · `writeTargetId` · `changedFields` · `stripNullishArgs` |
| `backend/ai/src/core/context/anchor.test.ts` | 新增：通用机制的用例（**规则都是假的** ⇒ 内核不依赖业务插件） |
| `backend/ai/src/plugins/pm/context/pm-context.ts` | ★ **PM 的语义**：`parsePmContext`（解析）· `renderPmContext`（渲染）· `PM_WRITABLE_FIELDS`（那三个字段）· `PM_WRITE_RULES`（`update_task` / `patch_task_status` 的规则）· `pmContextProvider` |
| `backend/ai/src/plugins/pm/context/pm-context.test.ts` | 新增：**从 `src/agent/context.test.ts` 逐条搬过来**的断言（白名单 / 渲染 / 收窄 / 目标 id） |
| `backend/ai/src/plugins/pm/index.ts` | 插件多带一个能力：`context: pmContextProvider` |
| `backend/ai/src/core/plugins.ts` | `AiPlugin` 多一个 `context?: ContextProvider`；注册表多一个 `contextProvider()` |
| `backend/ai/src/agent/gate.ts` | 闸门**不再写死业务知识**：`sanitizeWriteArgs` ⇒ `narrowWriteArgs`；`isAvailabilityTool`（patch_task_status 的判断）**挪进插件的写规则**（`blocked`） |
| `backend/ai/src/agent/runtime.ts` | 通道里存**锚点**（不是 PM 的上下文）；解析/渲染/收窄/目标 id 都走**插件**；`changedFields` 改用内核那份（白名单由锚点给） |
| `backend/ai/src/agent/session-registry.ts` | 通道字段 `taskContext` ⇒ `anchor` |
| `backend/ai/src/agent/context.ts` · `context.test.ts` | **删掉**（拆到内核 + 插件两侧） |
| `backend/ai/src/agent/gate.test.ts` | 改成用**假锚点 + 假规则**（不再 import 业务插件） |
| `backend/ai/src/agent/runtime.test.ts` | 假插件多带一个**假上下文提供器**（「与 AI 讨论」的用例照旧） |
| 文档 | `backend/ai/README.md` 目录树 · `frontend/src/services/api/ai/{pendingArgs,types}.ts` 的路径注释 · `backend/ai/src/routes/agent.ts` 的注释 |

## 决策记录（★ 最值钱的部分）

| 决定 | 为什么 | 错了的代价 |
| ---- | ------ | ---------- |
| **内核只认「锚点」**（作用域 + 基线 + 键值 + 白名单），不认识「任务 / 项目」 | 业务词进内核 ⇒ 这个内核就绑死在 PM 上 ⇒ 换个业务系统复用不了 | 把 `AiTaskContext` 整个搬进 core ⇒ 白拆 |
| **写规则（`WriteToolRule`）是插件给的数据，内核只按数据算** | 「哪个工具、哪些必填字段、哪个工具在这个 scope 里不许用」全是业务知识 ⇒ 数据化 ⇒ 内核不用认识任何一个字段名 | 让内核直接 switch 工具名 ⇒ 内核又长出业务分支 |
| **规则分两种形状**（`wholeObject` 整对象 PUT / 不写=自己拼） | PM 的两个工具真的是两种形状：`update_task` 要带全基线，`patch_task_status` 只要 ids+status ⇒ 一个算法要能同时表达它们 | 只做一种 ⇒ 另一个工具要么行为变了，要么在内核里开特例 |
| **「由锚点决定的字段」分两类**：静默丢掉（`update_task` 的 `id`）vs 算「被改」（`patch_task_status` 的 `ids`） | 这是**今天的真实行为**（虽然只有测试看得见）⇒ 照搬，别在重构里偷偷改语义 | 统一成一种 ⇒ 预览里多报/少报一个字段（用户能看见的差异） |
| **报错文案由插件给**（`missingFieldMessage`） | 「回填任务失败：缺少必填字段 x」是业务文案 ⇒ 进内核就带业务词 | 内核自己写文案 ⇒ core 里出现「回填任务」 |
| **`patch_task_status` 的「它是改可用状态的工具」整条挪进插件** | 这条判断（连同它的警告文案）是 PM 的线上事实 ⇒ 闸门只该问插件「这个工具不许用吗」 | 留在闸门 ⇒ 阶段 3 把闸门搬进 `core/` 时就带着业务词进去了 |
| **锚点里单列 `baseline`（基线）**，不塞进 `values` | 内核的收窄算法要**找到**基线 ⇒ `values` 是「插件放什么 core 不解释」的袋子 ⇒ 基线得是**内核认识**的那一格 | 基线塞 `values` ⇒ 内核得约定一个键名 ⇒ 又是一种业务耦合 |
| **作用域 id 统一用字符串**（设计稿的形状） | 插件自己解释成什么类型（PM 那边是数字）⇒ 内核不碰业务类型 | 内核用 `number` ⇒ 别的业务系统的 id 不是数字就装不下 |
| **等价性用「旧实现 vs 新实现」逐条对拍来验**（不是靠肉眼看 diff） | 阶段 2 是**唯一有逻辑改动的一步** ⇒ 光靠单测不够（单测只钉住几个用例）⇒ 拿 git HEAD 的旧实现跑同一批输入，逐项比对 | 只跑单测 ⇒ 漏掉的边界（项目作用域、nullish、必填字段缺失…）悄悄变了 |

## 怎么验

```bash
cd backend/ai
npm run typecheck        # ✅
npm test                 # ✅ 48 个文件 / 447 条
npm run build            # ✅
cd ../.. && node scripts/e2e/ai-container.static.cjs   # ✅ 20 条
```

**接缝自检**：

```bash
cd backend/ai
grep -rn "plugins/" src/core/ | grep -v "^\S*: \*"   # 只应剩注释 ⇒ 无 import
grep -rn "plugins/" src/agent/                      # 应为空
```

**行为等价（阶段 2 的关键证据）**：拿 `git show HEAD:backend/ai/src/agent/context.ts`（旧实现）
与新实现跑同一批输入（17 种上下文 × 5 个工具 × 6 组参数），逐项比对
**解析结果 / 渲染文本（逐字）/ 收窄后的载荷 / 被丢字段 / 目标 id** ⇒ **全部一致**。

（脚本没入库 —— 它依赖旧实现文件；等阶段 3 之后再用「保留旧实现的一个 PR」重做一次即可。）

## 坑与提醒

- ⚠️ **上下文提供器也是插件给的** ⇒ 没注册插件 ⇒ **没有**「与 AI 讨论」上下文
  （普通聊天照旧）。单测里要用 ⇒ 塞一个**假插件**（带 `context` 能力）。
- ⚠️ **通道里存的是锚点**（`channel.anchor`），不是 PM 的上下文 ⇒
  以后加「别的业务系统的讨论上下文」⇒ 只要插件给一个 `ContextProvider` 就行。
- ⚠️ **`args` 里的 `null`/`undefined` 必须整个键去掉**（MCP 的入参校验不吃 null）⇒
  内核的 `stripNullishArgs` 负责；**必填字段检查在它之后** ⇒ 基线里必填字段是空的 ⇒
  明确报错（不放一个会 422 的 PUT 出去）。
- ⚠️ **`update_task` 在项目作用域里必然报错**（「缺少必填字段 id」）—— 这是**今天的行为**
  （`id` 一律不从模型取）⇒ 照搬了；⚠️ 改它属于**改行为**，别在重构里顺手改。
- ⚠️ 工作区里前端的浏览器模式测试与 `npm run build` 跑不起来（junction 软链）⇒ 与本改动无关。

## 下一步（阶段 3~5）

1. **阶段 3**：`src/agent/*` ⇒ `src/core/session/*`（`runtime.ts` / `store.ts` / `gate.ts` / `mcp.ts` /
   `skills.ts` / `session-registry.ts` / `pi-session.ts` / `event-mapper.ts` / `frame-buffer.ts` /
   `startup-lock.ts` / `pending-waiters.ts` / `context.ts`…），同时 `src/http/*` ⇒ `src/core/http/*`。
   ⚠️ **这一步之前**要先解开 `src/http/errors.ts` 对插件错误类（`AdapterErrorException`）的依赖。
2. **阶段 3 收尾**：加**可执行的**内核纯净度检查（`scripts/check-core-purity.cjs` + 单测）⇒ 进 CI。
3. **阶段 4**：插件**接线**（智能体配置里写 `plugin: pm`；`GET /api/agents` 报出插件能力）。
4. **阶段 5**：对外可发布的 API 边界。
5. **每一步一个分支一个 PR**；#82 在**阶段五**后才关。
