# 按智能体配置装配会话（2026-11-16）

> 交接文档 —— 让下一棒（可能是另一个会话的 agent）接得上。

## 目标

- **关联**：issue #78 · PR（待提）
- **一句话**：把「建会话」从**硬编码**改成**按智能体配置装配**
  ⇒ 同一份代码能起多种定位的智能体（提示词 / 模型 / 技能 / MCP / 工具全走配置）。

## 状态

**已完成**（代码已实现、单测已钉住；等提 PR + 合并）。

## 已完成

| 位置 | 做了什么 |
| ---- | -------- |
| `backend/ai/src/core/config/registry.ts`（新） | `AgentProvider`（按 id 取配置）· **会话 id ↔ 智能体绑定**（`<agentId>_<uid>`） |
| `backend/ai/src/agent/runtime.ts` | 建会话时定智能体；建 pi 会话时**按配置装配**（提示词 / 模型 / 技能目录 / MCP / 工具白名单） |
| `backend/ai/src/agent/pi-session.ts` | 新增 `skillsDirs`（技能目录来自配置 ⇒ 只认这些目录里的技能） |
| `backend/ai/src/agent/skills.ts` | `createSkillsOverride(dirs)`（可多个目录；老函数保留成薄封装） |
| `backend/ai/src/tools/index.ts` | `buildCommandTools(context, { only })` —— **工具白名单** |
| `backend/ai/src/agent/store.ts` | 建会话可以**指定 id**（不带智能体 id 的会话 id ⇒ 回落默认智能体） |
| `backend/ai/src/routes/agent.ts` | `POST /api/agent/conversations` 接受 `agentId` |
| `backend/ai/src/env.ts` | 新增 `AI_DEFAULT_AGENT`（缺省 `pm`） |
| `backend/ai/agents/pm/`（新） | **PM 助手**：提示词（从 `src/agent/prompt.ts` **一字未改**搬来）· `create_task` · `aiadmin` MCP · `.pi/skills` |
| `backend/ai/agents/qa/`（新） | **通用问答**：无工具、无 MCP、无技能 |
| `backend/ai/src/agent/prompt.ts` | **删除**（提示词的事实源改成配置） |
| 单测 | `runtime.agents.test.ts`（5 条）· `registry.test.ts`（7 条）· `agents-shipped.test.ts`（3 条）· `conversations.test.ts`（4 条）· `pi-session.test.ts`（+2 条） |

**下一步**：下一条是 #79（MCP 多服务器配置化）。本条留下的口子：
`#mcpUrlOf()` 只取 `mcpServers[0]` ⇒ 多服务器要在那里展开。

## 决策记录（★ 最值钱的部分）

| 决定 | 为什么 | 错了的代价 |
| ---- | ------ | ---------- |
| **会话 id 里编进智能体 id**（`<agentId>_<uid>`） | ① 不用动数据模型（`ai_conversation` 加列是 #81 的活）；② 绑定**跟着会话走** ⇒ 进程重启后重建会话仍是同一个智能体（内存映射会丢） | 用内存映射 ⇒ 重启后老会话回落默认智能体 ⇒ 「不串味」不成立 |
| **老会话**（id 里没有 `_`）⇒ 回落**默认智能体** | 本条之前建的会话要继续能用（行为不变） | 直接报错 ⇒ 老会话全废 |
| 智能体 id 限死「小写字母/数字/连字符、≤30 字符」 | 会话 id 要靠 `_` 分割反查 ⇒ id 里不能有 `_`；还要给 uid 留位置（`ai_conversation.id` 是 64 位） | 不限 ⇒ 反查有歧义 / id 超列宽 |
| 默认智能体用**环境变量** `AI_DEFAULT_AGENT`（缺省 `pm`） | 换默认智能体不用改代码；不配也能用（老身份就是 PM 助手） | 写死 ⇒ 换默认要改代码 + 重启 |
| PM 助手的提示词**一字未改**搬进 `agents/pm/prompt.md` | issue 的验收标准「现有 PM 助手的行为不变」⇒ 提示词必须逐字相同 | 顺手改写 ⇒ 行为变了 ⇒ e2e 可能红、用户觉得「怎么变傻了」 |
| PM 助手的技能仍指向 **本服务自己的 `.pi/skills`**（`../../.pi/skills`） | 原来技能就是从 `<cwd>/.pi/skills` 发现的 ⇒ 等价复现 | 换成别的目录 ⇒ 技能少了 ⇒ 行为变了 |
| 工具**白名单**为空 ⇒ **一个工具都不注册** | 「通用问答」要真的什么都不能做 ⇒ 空数组必须等于「没有」 | 空数组当成「全部」⇒ 通用问答照样能建任务 ⇒ 两个智能体没区别 |
| MCP：配置里写 `url` 就用它；不写 ⇒ 用全局默认；两者都没有 ⇒ **不接 MCP** | 保持老行为（后端没上线时不连）；本条只支持第一个服务器（多服务器是 #79） | 默认连 ⇒ 配错一个地址就连错 |
| 技能过滤从「`<cwd>/.pi/skills`」改成「**配置里的目录**」 | 「技能目录来自配置」是验收标准 ⇒ 不在配置里的目录（含 pi 默认扫的）一律不算数 | 不改 ⇒ 通用问答也会看到 PM 的技能 ⇒ 两个智能体串味 |
| 删掉 `src/agent/prompt.ts` | 两份提示词 ⇒ 迟早漂移 | 留着 ⇒ 有人改了代码里那份，配置里的没改 ⇒ 行为不明 |

## 怎么验

```bash
cd backend/ai
npm run typecheck
npm test                      # 含 runtime.agents / registry / agents-shipped / conversations

# 仓里那几份配置能装出来
npx tsx -e "import('./src/core/config/registry.ts').then(m => console.log(m.createFileAgentProvider('agents','pm').list().map(c => c.id)))"
```

人眼要看的（需要真环境）：

1. 起服务（`cd backend/ai && npm run dev`）⇒ `POST /api/agent/conversations {"agentId":"qa"}`
   ⇒ 返回的会话 id 形如 `qa_xxx`；
2. 用这个会话聊一句 ⇒ 模型**没有**任何工具（也不会去建任务）；
3. 不带 `agentId` 建会话 ⇒ id 形如 `pm_xxx` ⇒ 行为与从前一致（能建任务）。

## 坑与提醒

- ⚠️ **会话 id 的形态变了**（多了 `<agentId>_` 前缀）⇒ 前端把它当不透明串用即可；
  但**老的会话 id**（cuid）仍然有效 ⇒ 会回落默认智能体。
- ⚠️ **vitest 会自动加载 `backend/ai/.env`** ⇒ 断言 MCP 地址这类**依赖环境变量**的地方，
  要在运行时里显式注入（`mcpUrl`），否则本机有 `.env` 的同事会看到不一样的结果。
- ⚠️ `additionalSkillPaths` 是 pi 的 loader 选项（不是 `createAgentSession` 的）⇒
  给错了会被静默忽略（技能就不来了）。
- ⚠️ 镜像里必须带 `agents/pm/prompt.md`（提示词）⇒ 容器验收脚本已加断言。
