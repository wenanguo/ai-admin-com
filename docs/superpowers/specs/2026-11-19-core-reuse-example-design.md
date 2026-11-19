# 通用内核复用验收（读书笔记示例系统）—— 短设计（issue #116）

> **规模**：中（PM 判断）⇒ 短设计。
> **状态**：已实现（PR 待 PM 拍板）· 关联 issue #116

## 意图与为什么

G1 收工后，内核（`backend/ai/src/core/**`）**只有一个使用方**（AiAdmin）
⇒ 「内核可复用」还是**自说自话**。阶段 5 造的 `core/index.ts`（唯一公开入口）
就是为这件事准备的，**但还没有第二个使用方来验证它**。

⇒ 本设计要造**第二个使用方**：一个**不依赖 AiAdmin** 的示例系统，
并用**可执行的检查**（不是人盯）证明两件事：

1. **只用公开入口**也能把内核用起来（⇒ 公开入口真的公开）；
2. **内核不依赖任何业务系统**（⇒ 换系统照样能跑）。

## 目标 / 不做 / 反目标

**目标**

- 示例系统：自己的业务插件（`add_note` / `list_notes`）+ 自己的智能体 YAML + 自己的 compose + 自己的空库；
- 示例**只从 `core/index.ts`** 接入内核 ⇒ 一条检查脚本钉住（进 CI）；
- 一条**可复跑**的 e2e（docker compose 起内核 + 示例 + 空库）⇒ 断言清单能列、命令能调；
- 一份**复用指南**（拷内核 → 写插件 → 写 YAML）并指向示例。

**不做**（issue 的硬边界）

- ❌ 不接任何真实业务系统（示例是玩具级）；
- ❌ 不动 AiAdmin 那个仓、不改 AiAdmin 的任何配置；
- ❌ 不改 core 的**既有行为**、不重排 core；
- ❌ 不把示例做成框架 / 脚手架；
- ❌ 不解决「第二个系统用 MCP 接入」那条路。

**反目标**（做成这些就当失败）

- 示例在示例目录里**自己抄一遍内核的装配逻辑** ⇒ 那是「复制粘贴能跑」，不是「内核可复用」；
- 检查脚本只查「没有 aiadmin 字样」而不查 import 落点 ⇒ 换个内部路径照样破。

## 约束

- 内核只依赖通用件（pi SDK / express / prisma / zod / typebox / yaml）—— 已由 `check-core-purity.cjs` 钉住；
- 内核**不 import 插件**（依赖方向：插件 → 内核）；
- 智能体配置与技能**按 cwd 相对**找；
- 端到端行为要有**入库的**验收脚本（`scripts/e2e/`）。

## 方案（三个可选，选了哪个 & 为什么）

### 方案 A：示例**自己装配**（只 export 路由给外部）

`core/index.ts` 导出各个 router，示例自己写 express 装配。

- ✅ 不动 core 的结构；
- ❌ **装配逻辑两处**（AiAdmin 一份、示例一份）⇒ 内核改路由，示例静默失配；
- ❌ 「公开入口」变成一堆零件的清单，而不是「能起一个服务」。

### 方案 B：**装配搬进内核**（`core/app.ts`）+ 示例一行装配 ✅ **选它**

新增 `core/app.ts`：`createCoreApp({ plugins, agentsRoot, configure })` /
`createCoreHealthRouter(plugins)` / `assertCoreReady()`；`src/server.ts` 变成薄壳
（`createApp()` 委托过去，**对外行为不变**）。

- ✅ 装配只有**一份**（内核的）⇒ 示例与 AiAdmin 跑的是同一套装配；
- ✅ 装配**与业务无关**（健康检查的探针**由插件给** ⇒ 可注入）⇒ 不违反「内核不懂业务」；
- ✅ 公开入口名副其实：「外部能起一个服务」；
- ⚠️ 代价：`src/server.ts` 变薄壳（**行为不变**，单测与 e2e 兜底）。

### 方案 C：内核**打成 npm 包**再复用

- ✅ 最「正统」；
- ❌ 本条不做（issue 明确说「不把示例做成框架/脚手架」）⇒ 现在做是超范围。

## 各个部分怎么定的

| 部分 | 定的样子 | 为什么 |
| ---- | -------- | ------ |
| 示例放哪 | `backend/ai/examples/reading-notes/` | 复用本包依赖与 prisma 客户端 ⇒ 只差「内核 + 插件 + YAML」三样 |
| 示例的业务数据 | 内存（`store.ts`） | 验收点不是「业务多完整」；真接业务时换成自己的数据源 |
| 示例的身份 | 自己认 token（`demo-` 开头） | 内核不解析 token ⇒ 演示「自己的身份系统」；**不依赖 AiAdmin** |
| 库的归属 | 内核的 `ai_*` 表住在示例自己的 MySQL | 验收标准要「自己的空库」；顺带证明元数据表可与业务系统分库 |
| 「只用公开入口」怎么钉 | `scripts/check-core-reuse.cjs`：**解析 import 说明符 ⇒ 算落点** | 查字面量没用（路径会变）⇒ 与 `check-core-purity.cjs` 同一套路 |
| e2e 断言到哪 | 有模型 key ⇒ 断言工具真被调；没 key ⇒ 断言到「装配成功」 | 模型调用不确定 ⇒ 没 key 时硬断言会 flaky；验收标准也要求没 key 能跑到装配成功 |
| 容器里怎么建表 | 示例镜像**带** prisma CLI ⇒ 启动先 `migrate deploy` | 示例的库第一次要有表；AiAdmin 那套的迁移在部署脚本里 ⇒ 取舍不同，不必一致 |

## 留给实现者的（已在本 PR 落地）

1. `core/app.ts` + 公开入口导出 + `server.ts` 变薄壳；
2. 示例系统（插件 / YAML / compose / Dockerfile / README / 单测）；
3. `scripts/check-core-reuse.cjs`（三档）+ `scripts/e2e/reuse-core-example.cjs` + CI 接线；
4. `docs/how-to/reuse-core.md`（三步指南）；
5. 回归：`npm test`（backend/ai）绿 + AiAdmin 那套服务的既有行为不变（本地起服务验过 `/health` / `/api/agents` / 404）。
