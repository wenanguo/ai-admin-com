# `core/` —— 通用智能体内核

> **内核不认识任何业务系统**（任务 / 项目 / 里程碑 那些都归**插件**）。
> ⇒ 换业务系统：带 `core/` + 自己的插件 + 自己的智能体配置 ⇒ 就能起一个自己的 AI 服务。

## 里面是什么（按**能力**分，不按层）

| 目录 | 能力 | 关键文件 |
| ---- | ---- | -------- |
| `config/` | **智能体配置**（装载 / 校验 / 注册表） | `loader.ts`（读 `agents/<id>/agent.yaml`）· `schema.ts`（形状）· `catalog.ts`（清单） |
| `session/` | **会话**（会话与命令 / 事件流 / 历史） | `runtime.ts`（编排）· `agent-event.ts`（**我们自己的事件词汇**）· `event-mapper.ts`（事件 → SSE）· `session-registry.ts`（通道）· `identity.ts`（当前用户的**形状与契约**） |
| `skills/` | **技能**（提示词段 / `load_skill` / 清单） | `skills.ts` · `skill-tools.ts` · `skill-catalog.ts` |
| `mcp/` | **MCP**（多服务器；工具的来源） | `mcp.ts`（配置形状 + dsh 的翻译）· `tool-names.ts`（工具名归一化） |
| `tools/` | **命令工具的机制**（目录从插件来） | `index.ts`（`buildCommandTools` / `isDestructiveCommand`）· `types.ts` |
| `context/` | **上下文锚点**（讨论上下文的通用机制） | `anchor.ts`（锚点 + **按白名单收窄写操作**） |
| `gate/` | **闸门**（改数据要人点头） | `gate.ts`（口径）· `decision.ts`（**与宿主无关的决策**）· `pending-query.ts` / `pending-write.ts` |
| `audit/` | **审计**（每次 AI 写入留一条 `ai_audit_log`） | `audit.ts` · `audit-redact.ts` · `audit-query.ts` |
| `store/` | **持久化** | `store.ts`（会话与消息）· `db.ts`（Prisma 单例） |
| `http/` | HTTP 中间件与信封 | `respond.ts` · `errors.ts` · `auth.ts` · `sse.ts` |
| `routes/` | HTTP 端点 | `agent.ts` · `events.ts` · `pending.ts` · `audit.ts` · `agents.ts` · `health.ts` · `contract.ts` |
| `env/` | 环境变量（**只有通用变量**） | `env.ts`（zod 校验）· `load-env.ts` |
| `types/` | 共享类型 | `api.ts`（响应信封） |
| `plugins.ts` | **插件契约 + 注册表**（内核与插件之间唯一的接头） | `AiPlugin` · `PluginRegistry` |
| `adapter/dsh/` | **执行层**（dsh 运行时；dsh 的类型只许出现在这里） | `client.ts` · `runner.ts` · `session.ts` · `events.ts` · `approvals.ts` · `tools.ts` · `profile.ts` |
| `errors.ts` | 上游错误的**归一形状** | `AdapterErrorException`（内核认它 ⇒ 插件抛它） |
| `index.ts` | ★ **公开入口**（外部只从这里 import） | — |

## 依赖（**不外泄**）

内核只依赖**通用件**：

| 依赖 | 干什么 |
| ---- | ------ |
| `@deepseek-ai/dsh-sdk-client` | dsh 的 SDK 客户端（**只许出现在 `adapter/dsh/**`** ⇒ 边界由 `scripts/check-dsh-boundary.cjs` 钉住） |
| `express` | HTTP |
| `@prisma/client` | 持久化 |
| `zod` | 配置与环境变量的校验 |
| `typebox` | 工具的参数 schema |
| `yaml` | 读智能体配置 |
| `node:*` | 内置 |

⇒ **不依赖任何业务系统** ⇒ 这条由 `src/core/index.test.ts` 的单测**断言**（加了业务依赖就红）。
⇒ **也不依赖 pi**（issue #123：拔干净了）⇒ 同一条单测 + `scripts/check-dsh-boundary.cjs` 一起钉住。

## 硬规矩

1. **内核不 import 插件** ⇒ `node scripts/check-core-purity.cjs`（CI 跑）✓
2. **内核代码里不出现业务词** ⇒ `node scripts/check-core-purity.cjs` **第二档**（CI 跑，
   **允许清单现在是空的** —— 清单文件：`scripts/core-business-words.allow.json`）✓
3. **插件的依赖方向是单向的**：插件 → 内核 ✓
4. **智能体配置是对外契约** ⇒ 字段见 [`../../agents/README.md`](../../agents/README.md)
5. **内核里不许有 pi**（issue #123）⇒ 依赖清单 / 源码都不许出现 pi 的包 ✓

## 怎么用（写一个自己的插件）

```ts
// my-plugin.ts
import { pluginRegistry, type AiPlugin } from "../core/index.ts";

export const myPlugin: AiPlugin = {
  id: "my-system",
  commands: [
    {
      name: "do_something",
      label: "做点什么",
      build: (context) => ({
        name: "do_something",
        label: "做点什么",
        description: "……",
        parameters: {},
        execute: async () => ({ content: [] }),
      }),
    },
  ],
};
```

⇒ 在**入口侧**（`src/plugins.ts`，唯一 import 插件的地方）注册它 ⇒ 智能体配置里写 `plugin: my-system`。
