# 智能体配置（YAML）+ 装载器 + `GET /api/agents`（2026-11-16）

> 交接文档 —— 让下一棒（可能是另一个会话的 agent）接得上。

## 目标

- **关联**：issue #77（已关闭）· PR #84（已合并，CI 全绿）
- **一句话**：一份 YAML 描述一个智能体（模型 / 角色提示词 / 技能集 / 工具），
  服务按配置装载 ⇒ **同一个内核能起多种定位的智能体**。
  本条只做「**读配置 + 暴露清单**」，**不**按配置装配会话（那是下一条）。

## 状态

**已完成**（代码已合，行为不变：会话仍然用写死的 `PM_AGENT_PROMPT`）。

## 已完成

| 位置 | 做了什么 |
| ---- | -------- |
| `backend/ai/src/core/config/types.ts` | `AgentConfig` / `AgentSummary` / `AgentCapabilities` 类型 |
| `backend/ai/src/core/config/schema.ts` | zod 形状校验（`strictObject` ⇒ 未知字段报错；`systemPrompt` 与 `systemPromptFile` 二选一） |
| `backend/ai/src/core/config/errors.ts` | `AgentConfigError`（带配置文件路径）+ 字段路径拼人话（`skills[1]`） |
| `backend/ai/src/core/config/loader.ts` | 扫 `agents/<id>/agent.yaml`、读 YAML、校验路径存在、解析成绝对路径 |
| `backend/ai/src/core/config/catalog.ts` | 配置 ⇒ 清单项（能力摘要：模型 / 技能数 / MCP 数 / 工具数） |
| `backend/ai/src/routes/agents.ts` | `GET /api/agents`（要 token；读真文件，不缓存） |
| `backend/ai/src/server.ts` | 挂 `/api/agents`；**`start()` 里先校验配置 ⇒ 非法配置启动即退出** |
| `backend/ai/agents/sample/agent.yaml` + `prompt.md` | 示例智能体（也是「仓里有真配置」的证据） |
| `backend/ai/agents/README.md` | 配置格式说明 |
| `frontend/src/services/api/ai/types.ts` | `AiAgentSummary`（与服务端字段一一对齐） |
| `frontend/src/services/api/ai/client.ts` | `listAiAgents()` |
| `backend/ai/Dockerfile` + `scripts/e2e/ai-container*.cjs` | 镜像里带上 `agents/`（cwd 相对 ⇒ `/app/agents`） |

**下一步（下一条要做的事）**：按配置装配会话 ⇒
`runtime.ts` 里 `systemPrompt: PM_AGENT_PROMPT` 改成「按会话选智能体 ⇒ 从配置取提示词 / 技能目录 / 工具白名单 / MCP」。
入口在 `backend/ai/src/agent/pi-session.ts` 的 `PiSessionOptions`（`tools` / `systemPrompt` / `model` 已经有了，
**缺 skills 目录与 mcpServers 的注入口** ⇒ 那条要一并扩 `PiSessionOptions`）。

## 决策记录（★ 最值钱的部分）

| 决定 | 为什么 | 错了的代价 |
| ---- | ------ | ---------- |
| 配置放 `backend/ai/agents/<agentId>/agent.yaml`，**cwd 相对** | 与 `.pi/skills` 一个规矩（AI 服务必须在 `backend/ai/` 下启动）；容器里 WORKDIR=`/app` ⇒ `/app/agents` | 换绝对路径 ⇒ 容器里读不到 ⇒ 清单永远是空的 |
| `id` **必须与目录名一致** | 清单里的 id 永远等于目录名 ⇒ 不会重复、不会指错；也让「一个智能体一个目录」这条规矩可校验 | 允许不一致 ⇒ 要额外处理重名与路径歧义 |
| 用 zod `strictObject` ⇒ **未知字段报错** | 拼错字段名（`sysPrompt`）会被静默丢掉 ⇒ 用户以为配了其实没配 | 用宽松对象 ⇒ 配置看着生效、实际没生效 ⇒ 极难查 |
| `systemPrompt` 与 `systemPromptFile` **二选一**，两个都给也报错 | 两个都写 ⇒ 不知道该用哪个 ⇒ 行为不确定 | 允许都写 ⇒ 要定优先级 ⇒ 又一套「隐藏规则」 |
| **非法配置启动即退出**（`start()` 里先 `loadAgentConfigs`） | 配置坏了却照常启动 ⇒ 用户看到「少了个智能体」却查不到原因 | 启动不校验 ⇒ 错误推迟到运行时 ⇒ 排查成本翻倍 |
| 端点挂在 **`/api/agents`**（不是 `/api/agent/agents`） | `/api/agent/**` 是会话那条线；智能体是「配置」那条线 ⇒ 独立前缀（将来 `POST /api/agents/:id/sessions` 也挂这儿） | 混在 `/api/agent` 下 ⇒ 以后那条线的端点越来越杂 |
| 清单端点**要 token** | 与 `/api/agent/skills` 一致（AI 能力只给登录用户看） | 匿名可读 ⇒ 泄露「服务里有哪些能力」 |
| 清单**不缓存**（每次请求重读文件） | 配置是文件 ⇒ 改完重启就能看到（与技能清单同口径） | 缓存 ⇒ 改完配置不重启就看不到 ⇒ 以为没生效 |
| 只放一个 **`sample` 示例智能体**，没动 `PM_AGENT_PROMPT` | 本条只做「读配置 + 暴露清单」；把 PM 提示词搬进配置属于「装配会话」那条 ⇒ 现在搬会出现**两份提示词**（漂移） | 现在就搬 ⇒ 提前改了 runtime 行为 ⇒ 超出本条范围 |
| 新增依赖 `yaml`（2.9.0） | 自己写 YAML 解析器不现实；`yaml` 已在依赖树里（pi SDK 的传递依赖）⇒ 加成直接依赖 | 不用 ⇒ 手写解析 ⇒ 边界情况一堆 |

## 怎么验

```bash
cd backend/ai
npm run typecheck
npm test                      # 含 src/core/config/** 与 src/routes/agents.test.ts

# 真目录能被读出来（示例智能体）
MINIMAX_CN_API_KEY=x AI_MODEL=minimax-cn/MiniMax-M3.1-Flash \
AIADMIN_BASE_URL=http://x/api/v1 DATABASE_URL=mysql://x ALLOWED_ORIGINS=http://localhost:8000 \
npx tsx -e "import('./src/core/config/loader.ts').then(m => console.log(m.loadAgentConfigs('agents')))"

cd ../..
node scripts/e2e/ai-container.static.cjs   # 断言镜像里带上 agents/
```

人工看：起服务（`cd backend/ai && npm run dev`）⇒
`curl -H "Authorization: Bearer <token>" http://localhost:3100/api/agents` ⇒ 能看到 `sample`。

## 坑与提醒

- **改坏配置 ⇒ 服务起不来**（故意的）⇒ 本地调试时先 `npx tsx` 单独跑一次装载器，别直接起服务。
- `agents/` 下**只有 `agent.yaml` 的子目录**才算智能体；`README.md` 这类文件会被跳过。
- 技能目录 / 提示词文件**相对配置目录**解析 ⇒ 允许 `../`（能引用共享目录），但**不存在就报错**。
- 容器里镜像必须带 `agents/` ⇒ 已加 `COPY backend/ai/agents ./agents`（漏了 ⇒ 线上清单永远是空的）。
