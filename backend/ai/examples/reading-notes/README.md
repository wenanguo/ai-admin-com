# 读书笔记（**示例系统**）—— 通用内核可复用的验收

> ⚠️ **这是一个示例**（issue #116）—— 用来证明「**通用内核换个业务系统照样能用**」，
> 不是产品、不是脚手架、也不接任何真实业务。
> 业务数据放在内存里（重启即空）⇒ **别拿它干正事**。

## 它是什么

一个**独立的 AI 服务**（不依赖本仓的 AiAdmin 前后端）：

| 部件 | 在哪 | 说明 |
| ---- | ---- | ---- |
| **业务插件** | [`plugin.ts`](./plugin.ts) | 两条命令：`add_note`（记一条读书笔记）/ `list_notes`（列笔记）；外加**自己的身份系统**（`demo-` 开头的 token 认得出人） |
| **智能体配置** | [`agents/notes/agent.yaml`](./agents/notes/agent.yaml) | 一个 YAML 描述一个智能体（提示词在 `prompt.md`） |
| **业务数据** | [`store.ts`](./store.ts) | 内存里的笔记列表（玩具级） |
| **服务入口** | [`main.ts`](./main.ts) | 注册插件 → 装配内核 → 监听端口；另挂自己的业务端点 `GET /api/notes` |
| **自己的空库** | [`docker-compose.yaml`](./docker-compose.yaml) | compose 里的 `db`（MySQL）⇒ 内核的 `ai_*` 元数据表住这儿 |
| **镜像** | [`Dockerfile`](./Dockerfile) | 构建上下文 = 仓根（要拿内核源码） |

## 关键约束：**只从内核的公开入口进**

```ts
// ✅ 只有这一行是允许的
import { createCoreApp, pluginRegistry } from "../../src/core/index.ts";

// ❌ 内核内部路径不是契约（内核一改内部结构就崩）
import { agentRuntime } from "../../src/core/session/runtime.ts";
```

这条约束由 [`scripts/check-core-reuse.cjs`](../../../../scripts/check-core-reuse.cjs) **钉死**（进 CI）：

```bash
node scripts/check-core-reuse.cjs
```

## 怎么跑

### 一、docker compose（推荐）

```bash
# 起（内核 + 示例插件 + 示例自己的空库）
docker compose -f backend/ai/examples/reading-notes/docker-compose.yaml up -d --build

# 看看智能体清单（示例的 token 是 demo- 开头的）
curl -H "Authorization: Bearer demo-reader" http://127.0.0.1:13200/api/agents

# 列笔记（示例自己的业务端点）
curl http://127.0.0.1:13200/api/notes

# 收摊
docker compose -f backend/ai/examples/reading-notes/docker-compose.yaml down -v
```

⚠️ **没有模型 key 也能起**（只验到「装配成功」这一步）；要真的调通命令 ⇒ 给 `MINIMAX_CN_API_KEY`。

### 二、本地（要自己有 MySQL）

```bash
cd backend/ai/examples/reading-notes

MINIMAX_CN_API_KEY=你的key \
AI_MODEL=minimax-cn/MiniMax-M3.1-Flash \
AI_DEFAULT_AGENT=notes \
ALLOWED_ORIGINS=http://localhost:3200 \
DATABASE_URL=mysql://notes:notes@127.0.0.1:3306/notes \
npx tsx main.ts
```

⚠️ **cwd 相对**：内核按 `cwd/agents/` 找智能体配置 ⇒ **必须在这个目录下启动**。

### 三、验收脚本

```bash
node scripts/e2e/reuse-core-example.cjs   # 真起 compose ⇒ 清单能列、命令能调
```

## 它证明了什么

1. 内核**不依赖任何业务系统** —— 换一套插件 + 一份 YAML + 一个自己的库，就能起一个服务；
2. **公开入口是真的公开** —— 示例只 import `core/index.ts`，就能拿到插件契约、命令契约、身份契约、会话运行时、HTTP 装配；
3. **业务能力不进内核** —— `add_note` / `list_notes` 只在插件里，内核一个业务词都没有；
4. **内核的既有行为没变** —— AiAdmin 那套服务照旧（`core/app.ts` 只是把「装配」这段与业务无关的代码搬进内核）。

详见 [`docs/how-to/reuse-core.md`](../../../../docs/how-to/reuse-core.md)（复用指南）。
