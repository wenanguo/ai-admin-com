# 「与 AI 讨论」只切上下文、不发命令

> 日期：2026-11-11
> 范围：`frontend/`（后端与 AI 服务**不动**）

## 意图与为什么

用户点「与 AI 讨论」（任务列表 / 看板 / 甘特 / 项目列表 / 项目详情）时，
**他并没有说话**。现在的实现却替用户发一条真命令：

```
已切换到当前任务：#123 标题。所属项目：X；所属里程碑：Y。请先说明这条任务的现状与风险，再问我要做什么。
```

这条命令会落库成一条 USER 消息、真的调一次模型、可能触发工具调用 ⇒
- 用户没开口，AI 却先说了一大段；
- 每次切上下文都产生一次模型调用与一次上下文消耗；
- 聊天记录里混着「不是用户说的话」的 USER 消息。

用户要的是：**点了只把当前对象加进上下文，不发任何命令。**

## 目标

- 点「讨论」⇒ 当前讨论上下文切换到该任务/项目，**不产生任何命令、消息、模型调用**。
- 用户随后自己说的第一句话，就带着这个上下文。

## 非目标

- 不改 AI 服务（`backend/ai/`）与 AiAdmin 后端。
- 不改写操作收窄的规则（任务上下文仍只许改 status/工时/说明）。
- 不动 DiscussionBar、「结束讨论」、展开面板、切「对话」页签。

## 约束

- **服务端已经把上下文拼在每条消息前面**（`backend/ai/src/agent/runtime.ts` 的
  `renderAiTaskContext`）⇒ 用户的第一句真话天然带上下文 ⇒
  **不需要**靠一条假消息去「通知」智能体。这是本次改动成立的前提。
- 上下文是**每条消息带一次**（`useWorkspace.submit` 里读 `aiContext.context`），
  不是会话级 ⇒ 切上下文对下一句立即生效。
- 后端对那句固定提示词**没有任何特判**（grep `已切换` 无命中）⇒ 删掉它，
  不留任何行为缺口。

## 方案（已选：A · 纯上下文切换）

点「讨论」只做三件事：`setContext` → `requestExpand` → `requestFocus`。
第四步 `requestInject(...)` 整条链路删掉。

### 删掉的代码

| 文件 | 删什么 |
| --- | --- |
| `frontend/src/models/ai-bridge.ts` | `injectRequest` / `requestInject` 字段与实现（含那条「为什么要点一下就替用户发一句」的注释） |
| `frontend/src/components/ai-workspace/useWorkspace.ts` | 监听 `aiContext.injectRequest` 并 `send(request.text, 'context')` 的那个 effect；`send` 的第二参 `origin` |
| `frontend/src/components/pm/aiContext.ts` | `contextPromptText`（只服务于那条固定提示词） |
| `frontend/src/components/ai-workspace/MessageBubble.tsx` | 用户气泡上的「上下文 / 已加入上下文」标记块 |
| `frontend/src/components/ai-workspace/useAgentStream.ts` | `ChatMessage.origin` 字段与 `createUserMessage` 的 `origin` 参数、`appendUserMessage` 的 `origin` 参数 |
| 5 个页面入口 | `aiBridge.requestInject(contextPromptText(context))` 这一行与相应 import |

页面入口（都只删这一行 + import，其余不动）：
`pages/module_pm/task/{index,board,gantt}.tsx`、`pages/module_pm/project/{index,detail}.tsx`

### 保留的

- `setContext` / `requestExpand` / `requestFocus`（点完就能看见上下文、就能说话）
- `clearContext` 与 DiscussionBar 的「结束讨论」按钮
- DiscussionBar 本身（面板头部常驻显示「正在讨论任务 #123 标题 / 所属项目 / 当前状态」）
  ⇒ **它是这次唯一的反馈来源**，所以它必须在切上下文后立刻更新（它读的是全局
  `aiContext.context`，天然会更新）

### 测试

- 三个假 model（`AiWorkspaceShell.test.tsx` / `index.test.tsx` / `useWorkspace.test.ts`）
  里的 `injectRequest: null` / `requestInject: vi.fn()` 字段删掉。
- 新增一条测试钉住新行为：**点「讨论」不产生任何命令**。
  做法：在 `useWorkspace.test.ts` 里断言 `sendAiCommand` **一次都没被调用**，
  而上下文已设置。（不写 e2e：那套要起真服务，太重。）
- `npm run test`（前端 vitest）全绿。

## 交互后果（用户要知道的）

点完「讨论」之后：
- 面板展开、停在「对话」页签、头部出现「正在讨论任务 #123 …」条；
- **聊天区没有任何新气泡，AI 也不会先开口**；
- 用户自己打第一句话时，那句话就带着该任务上下文。

## 风险

- **「点了没反应」的观感回来**：这是用户明确要的取舍 —— 反馈由 DiscussionBar 承担。
  若实测不够，再单独讨论（不在这份设计里）。

## 备选方案（没选，记录一下）

- **B：加一条纯前端气泡**（不发服务端，只在聊天区显示「已切换到当前任务 #123」）。
  没选：刷新即消失，且长得像真消息，容易被当成对话内容。
