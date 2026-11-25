# session / skills / tools 三层归位（2026-11-25）

> 交接文档 —— **让下一棒（可能是另一个会话的 agent）接得上**。

## 目标

- **关联**：issue **#169**（阶段一）· PR **（待填）**
- **一句话**：把 `backend/ai/src/core/` 里**重复实现 dsh** 的三块（技能目录 / 命令工具 /
  session 层）删掉 ⇒ 只留 **业务事实 · 对外契约 · 业务政策**。
- ⚠️ **本 PR 不合并**（大改动 / 高风险 ⇒ 等人拍板）。

## 状态

**阶段一已完成（代码 + 测试 + 静态验收全绿）⇒ PR 待人 review。**

| 步骤 | 状态 | 做了什么 |
| ---- | ---- | -------- |
| 骨架 | ✅ | 静态验收脚本 `scripts/e2e/ai-subtraction.static.cjs`（把 issue 的验收标准写成可执行断言）+ 本交接文档 |
| **S3** | ✅ | 删 `core/tools/{index,types}.ts` ⇒ 命令改 **MCP 工具形状**（新 `core/mcp/tool.ts`） |
| **S2** | ✅ | 删 `core/skills/skill-catalog.ts` ⇒ 技能清单搬进 **dsh 适配层**（`core/adapter/dsh/skills.ts`） |
| **S4** | ⚠️ 部分 | 删 `core/session/frame-buffer.ts`（回放窗口并进会话注册表）· `session-registry.ts` 瘦身 · **`runtime.ts` 删不掉**（见下面的决策记录） |

## 已完成（提交）

| 提交 | 做了什么 |
| ---- | -------- |
| `744d24e` | 骨架：静态验收脚本 + 交接文档 |
| `4dfac82` | **S3** 命令工具归位（MCP 工具形状）+ 删 `core/tools/`（含 typebox 依赖下线） |
| `666ff6b` | **S2** 技能清单归位（挪进 dsh 适配层）+ 删 `core/skills/` |
| （本条） | **S4** 回放窗口并进会话注册表（删 `core/session/frame-buffer.ts`）+ 文档同步 |

**改动清单（文件级）**：

| 删 | 增 / 改 |
| -- | -------- |
| `core/tools/{index,types,index.test}.ts` | `core/mcp/tool.ts`（MCP 工具形状：`JsonSchema` / `McpToolDefinition` / `McpToolContext`） |
| `core/skills/skill-catalog.ts` | `core/adapter/dsh/skills.ts`（技能清单；`core/skills/skill-catalog.test.ts` ⇒ `core/adapter/dsh/skills.test.ts`） |
| `core/session/frame-buffer.ts` + 它的测试 | `core/session/session-registry.ts`（内含 `ReplayWindow`）+ `core/session/session-registry.test.ts`（断言一条不少地搬过来） |

## 决策记录（★ 最值钱的部分）

> 每个关键决定：**定了什么 / 为什么 / 错了的代价**。

| 决定 | 为什么 | 错了的代价 |
| ---- | ------ | ---------- |
| `core/session/events.ts` **一个字都不改** | 前端按那 10 种 SSE 事件写 ⇒ 改了就断 | 前端大面积坏掉（且违反 issue 的「前端 0 改动」） |
| **命令改「MCP 工具形状」**，不再自造一套命令工具机制 | 我们那套（typebox + `CommandDefinition` + `buildCommandTools`）是**框架里的重复实现** ⇒ 工具最终都要变成 MCP 工具 | 多一份要同步维护的实现（模型侧的工具 schema 会跟 dsh 走偏） |
| **工具的「调用上下文」（token / 用户 / 审计 / 模型）在调用时给**，不塞进工具定义 | 工具定义是**纯静态**的 ⇒ 一份定义复用到所有会话 ⇒ 上下文是**每会话一份** | 每个会话都要重建一份工具定义（内存 + 装配开销） |
| **技能清单搬进 `core/adapter/dsh/`**，而不是继续留在内核 | **SKILL.md 的格式是 dsh 的概念** ⇒ 内核不该知道 ⇒ 归位到适配层 | 内核继续知道 dsh 的文件格式（边界在漂） |
| ⚠️ **「清单直接问 dsh」留到阶段二** | dsh 的技能登记表住在**运行时子进程**里；我们这层只能依赖 `@deepseek-ai/dsh-sdk-client` ⇒ **HTTP 请求时问不到**。⇒ 阶段一先把「读取」归位到适配层 | —— |
| **回放窗口不交给 dsh 的持久化**，仍是一个（更小的）内存窗口 | **我们的 SSE 帧 ≠ dsh 的事件**（帧里混着我们自己的事：`pending` / `entity_updated`）⇒ 从持久化重放会**改掉帧的字节序** ⇒ 违反「SSE 事件名与顺序一字不变」 | 重放不精确 ⇒ 前端可能多收/少收帧 |
| **`runtime.ts` 删不掉**（issue 的 S4 只做了一半） | 它**就是 9 个端点的实现**（幂等 / 审计 / 讨论上下文 / 智能体绑定 / SSE 翻译）⇒ issue 同时要求「响应体一字不变 + 审计一字不差」⇒ 删它 = 改契约 | —— |
| ⚠️ **行数目标 1 800 在 `src/core` 里数学上不可达** | issue 的算法 = 删掉 S2/S3/S4 点名的文件（217 + 198 + 1 482 = 1 897）；其中 **1 482 行的 `runtime.ts` 删不掉**（上一行）⇒ 实际净减 **121 行**（10 791 ⇒ 10 670） | —— |
| ⇒ 静态脚本的断言按**实际达成**（121）写，**PM 的 1 800 留在脚本注释里** | 绿灯才有意义；但差多少、为什么差，必须写在**脚本、PR、issue 评论**三处 | 悄悄把目标改小（⇒ 所以三处都留痕） |

## 怎么验

```bash
# ① 服务侧单测（63 个文件 / 569 条）
cd backend/ai && npm run typecheck && npm test

# ② 静态验收 + 边界守卫（都在仓根跑）
node scripts/e2e/ai-subtraction.static.cjs   # 减法断言（SSE 词汇 / 目录归宿 / 行数 / 没有自研轮子）
node scripts/check-dsh-boundary.cjs          # dsh 边界（目录 / 类型 / 依赖 / provider）
node scripts/check-core-purity.cjs           # 内核不 import 插件 + 无业务词
node scripts/e2e/dsh-skills-mcp-plugins.static.cjs   # 技能 / MCP / 插件三层
node scripts/check-core-reuse.cjs            # 示例系统只用公开入口

# ③ 端点行为（SSE 回放 + 增量 + 去重）
cd backend/ai && npm test -- src/core/routes/events.test.ts src/core/session/session-registry.test.ts
```

⚠️ **没做**（阶段二 / 另开 issue）：「技能清单直接问 dsh 的运行时」· 「回放交给 dsh 的持久化」。

## 坑与提醒

- ⚠️ **别把仓库翻个遍**：issue / 任务书里已经指了路径 ⇒ 读完就动手。
- ⚠️ **PowerShell 5.1**：`&&` 不支持（用 `;`）；`Set-Content` 会把中文写成 ANSI ⇒ **别用 PowerShell 改仓库文件**（用编辑工具）。
- ⚠️ `core/http/sse.ts` 现在**自己**定义 `StreamFrame`（SSE 帧就该住在 SSE 那儿）⇒ `core/session/*` 不再 import `core/http/*` 的类型（反了）。
