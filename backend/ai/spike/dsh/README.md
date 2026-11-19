# dsh 底座摸底 spike（issue #119）

> **这不是生产代码** —— 它是一个**可复现的尖峰**：起一个真的 dsh 运行时（子进程 + stdio JSON-RPC），
> 跑通「模型 + 一个工具」的玩具任务，把八问里最不确定的几问**用证据钉死**。
>
> 对应的结论与目标架构在
> [`docs/superpowers/specs/2026-11-19-dsh-底座摸底-目标架构-design.md`](../../../../docs/superpowers/specs/2026-11-19-dsh-底座摸底-目标架构-design.md)。

---

## 1. 跑法

```bash
cd backend/ai/spike/dsh

# 装 dsh（版本由 dsh-versions.lock.json 精确锁死；pnpm 是 dsh 生态自己的包管理器）
pnpm install

# 跑玩具任务（会真的调模型 ⇒ 需要凭据）
DSH_SPIKE_API_KEY=<key> DSH_SPIKE_BASE_URL=<openai 兼容网关的 /v1> \
  node scripts/01-toy-task.mjs
```

- 凭据**只从环境变量读**（或 `PI_MODELS_FILE` 指向一个含 provider 路由的 models.json）⇒ **不入库**。
- 首次运行会在 `out/dsh-home/` 下创建 dsh 的 `sdk` profile，并把「玩具工具」与
  `@deepseek-ai/dsh-mcp-client` 装进 profile（`pnpm add`）。
- 结果写到 `out/spike-log.json`（`out/` 被 gitignore）⇒ **日志可复现**：同一个脚本重复跑即可。
- 环境要求：**Node ≥ 24.9**（`@deepseek-ai/dsh` 的 engines 要求）+ **pnpm**。
- ⚠️ `pnpm-lock.yaml` **不入库**（见仓根 `.gitignore`）：dsh 的包全是**精确版本**
  （版本锁在 `dsh-versions.lock.json`），锁文件只影响传递依赖的解析 ⇒ 本地 `pnpm install` 会重新生成。

## 2. 这个 spike 证明了什么（2026-11-19 实测，全绿）

| 阶段 | 证明了什么 | 实测输出 |
| ---- | ---------- | -------- |
| 1 模型 | provider-neutral 的 LLM seam 能接上 OpenAI 兼容网关上的 DeepSeek 模型 | `final: 2。` |
| 2 我们的工具 | **我们自己的工具**（cordis 插件 + `defineTool`）能挂进 dsh 的 tool registry，模型会调用它 | `tool calls: toy_echo` → `TOY-ECHO:hello-dsh` |
| 3 MCP | **标准 MCP server 能挂**（`@deepseek-ai/dsh-mcp-client`），工具名被服务端限定成 `mcp__<server>__<tool>` | `tool calls: mcp__toy__toy_echo` → `MCP-TOY-ECHO:hello-mcp` |
| 4 闸门 | dsh 的 `approval/request` 能一路走到**我们的进程**（= 我们的闸门回答者），三种结果都能表达：`allowed-once` / `rejected` / 没有回答者 ⇒ `unavailable`（fail closed） | `approval requests: 1 {"toolName":"toy_echo",...}` → `TOY-ECHO:MUTATE-task-42` / `REJECTED:rejected` |
| 5 事件 | dsh 的会话事件序列（= 我们 SSE 契约的映射依据），且 `assistant/message.stream` 里**带增量文本**（`text-chunks`） | 见下 |

事件序列（阶段 5 实测）：

```
agent/inbox/spliced → turn/start → agent/inbox/spliced → step/start → system/message →
user/message ×5 → request/header → request/context → session/title → assistant/message →
tool/call → approval/asked → approval/decided → tool/result → step/end → step/start →
assistant/message → step/end → turn/end
```

## 3. 三个「踩坑点」（下次别再踩）

1. **patch 语法**：改已有条目用 `- id: <已有 id>`；**加**新插件用 `- insert: [ { id, name, config } ]`
   （顶层没有 `id` ⇒ 追加到根条目树）。写成 `- id: 新名字` 会被 loader 拒绝：
   `patch: entry "xxx" not found`。
2. **插件必须能被 profile 解析到**：profile 是独立的 pnpm 工程 ⇒ 我们的玩具工具要先
   `pnpm add file:<路径>` 进 profile，loader 才认得它（否则插件静默不加载 ⇒ 工具不在工具表里）。
3. **Windows 上 pnpm 11 的供应链策略**会拦「刚发布不到一天」的 rc 包 ⇒
   `pnpm-workspace.yaml` 里显式 `minimumReleaseAge: 0`（版本已由我们精确锁死，不是装最新的）。

## 4. 目录

```
backend/ai/spike/dsh/
├── dsh-versions.lock.json   # ★ 版本锁（唯一出处）
├── package.json              # spike 专用依赖（精确版本）—— 不进 AI 服务的依赖
├── pnpm-workspace.yaml       # 只为放开 minimumReleaseAge
├── patch-pi-ai.yml           # profile 补丁：LLM 路由 + 玩具工具 + 玩具 MCP
├── scripts/01-toy-task.mjs   # 主脚本（五个阶段）
├── toy-tool/                 # 「我们自己的」玩具工具（cordis 插件）+ 闸门接缝
└── toy-mcp/server.mjs        # 玩具 MCP server（stdio，一个工具）
```

## 5. 不做（issue 的「不做」栏）

- ❌ 不改任何生产代码（`backend/ai/src/**` 一个字没动）
- ❌ 不写真实业务数据（只回显玩具字符串）
- ❌ 不写凭据（只从环境变量读）
