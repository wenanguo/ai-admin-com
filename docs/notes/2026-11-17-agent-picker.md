# 工作台智能体选择器（2026-11-17）

> 交接文档 —— **让下一棒（可能是另一个会话的 agent）接得上**。

## 目标

- **关联**：issue #101 · PR #103
- **一句话**：AI 工作台（窄版 + 宽版）加一个**智能体下拉框**，选项来自
  `GET /api/agents`；**挑中 ⇒ 另起一个会话**并把 `agentId` 传给后端
  （落库到 `ai_conversation.agent_id`）。

## 状态

**已完成**（PR 已提，**未合并** ⇒ 等人拍板）

## 已完成

| 提交 | 做了什么 |
| ---- | -------- |
| `fafe121` | 新增 `AgentSelector.tsx`（选择器）+ `useAgents.ts`（清单三态）；`useWorkspace` 加 `agentId` / `selectAgent`；`client.ts` 的 `createAiConversation(title?, agentId?)` 会带上 `agentId`；窄版头部加一行选择器，宽版头部按钮区摆**同一个**实例 |
| `ed4023b` | 单测（选择器三态 + 切换带对 agentId + 旧会话不被改动 + 窄版 400px 不撑破）|
| `0e1fae0` | e2e 脚本 `scripts/e2e/ai-agent-picker.cjs` + README |
| `d022dd3` | 本笔记 |

**下一步（具体到文件与命令）**：

```
等 PM 抽查 PR ⇒ 合并 ⇒ issue 自动关闭（PR 里写了 Closes #101）
合并后：
  cd frontend && npm run lint && npm run test     # 复核
  node scripts/e2e/ai-agent-picker.cjs            # 真跑一遍（要前端 + AI 服务 + token）
```

## 决策记录（★ 最值钱的部分）

| 决定 | 为什么 | 错了的代价 |
| ---- | ------ | ---------- |
| **挑智能体 = 另起一个会话**（不是改当前会话的）| 会话的智能体是**建会话时**定的（`ai_conversation.agent_id`）⇒ 已经建好的会话改不了 | 如果改成「就地改」，要么后端加一个改会话的接口（超范围），要么界面显示的智能体与实际用的对不上（骗人）|
| **没挑过 ⇒ 不传 `agentId`**（让服务端用默认智能体）| 前端不知道服务端哪个是默认（`AI_DEFAULT_AGENT` 在后端 env 里）⇒ 猜错就是「用户没选却被换掉了」 | 传错默认值 ⇒ 用户莫名其妙在用另一个智能体 |
| **选择器放在 `AiWorkspace` 容器里造好，宽窄共用同一个实例**（窄版摆在头部第二行，宽版摆在按钮区）| 宽窄两版**共用同一个 `<AiWorkspace>` 实例** ⇒ 同一个实例 ⇒ 切形态不丢选择、不重复读清单 | 抄两遍 ⇒ 改一处漏一处（历史上有先例：`ConversationHistory` 就是这么抽出来的）|
| **窄版的选择器单独一行**（不挤在标题那一行）| 窄版面板只有 400px ⇒ 标题行已经有「最大化 / 标题 / 历史对话 / 关闭」⇒ 挤同一行会把标题压扁 | 挤同一行 ⇒ 标题被压没 |
| **选择器宽度固定 180px**（不自适应）| 智能体名是配置里自己写的 ⇒ 可能很长 ⇒ 自适应会把窄版头部撑破 | 自适应 ⇒ 长名字撑破 400px 的布局 |
| **清单读不到 ⇒ 降级（一句原因 + 重试），不白屏**| 工作台是浮层 ⇒ AI 服务没起来时不该整块坏掉 | 白屏 ⇒ AI 服务一挂，整个工作台都不能用 |
| **只有一个智能体 ⇒ 只显示名字，不显示下拉框**| 没得选就别装个下拉框（点开只有一项）| 多此一举，还占地方 |
| **换智能体会新建会话 ⇒ 当前流式输出会断** | 这是「用另一个智能体重新开始」的语义 | 保留当前会话 ⇒ 界面显示的与实际用的不是同一个智能体 |

## 怎么验

```bash
# ① 单测（选择器三态 / 切换带对 agentId / 布局不撑破）
cd frontend && npx vitest run src/components/ai-workspace src/services/api/ai/client.test.ts

# ② 全量（lint + test）
npm run lint && npm run test

# ③ 端到端（要前端 8000 + AI 服务 3100 + token）
node scripts/e2e/login.cjs
node scripts/e2e/ai-agent-picker.cjs
```

## 坑与提醒

- ⚠️ **antd 会在两个汉字之间插空格**（"重 试"）⇒ 单测里按钮的可访问名要用正则
  `/重\s*试/`，不能写死 `'重试'`。
- ⚠️ antd v6：`Select` 的 `optionFilterProp` **废弃**了 ⇒ 要写在
  `showSearch={{ optionFilterProp: 'label' }}` 里（`npx antd lint ./src` 会报）。
- ⚠️ `vitest-browser-react` 的 `render` 返回的 locator 绑的是 **`document.body`**，
  不是那个容器 div ⇒ 下拉框的选项（在 portal 里）也能用 `getByText` 找到。
- ⚠️ 本 worktree 里 **dev server 起不来**（utoopack 的 symlink 越出文件系统根）⇒
  界面上手工验布局要在主 checkout 里跑，或靠 `index.test.tsx` 里那条
  「400px 容器 + 超长名字 ⇒ 不横向溢出」的断言。
- ⚠️ 后端**一行没改**：`POST /api/agent/conversations` 本来就收 `agentId`，
  `GET /api/agents` 本来就有 ⇒ 本条只补界面那一层。
