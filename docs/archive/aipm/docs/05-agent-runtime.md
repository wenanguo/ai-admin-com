# 05 · Agent 运行时

> pi agent 怎么接、会话怎么管、流式怎么传、确认怎么桥接、降级怎么办。

## 1. 组件

```
后端进程
 ├── ConversationRegistry     Map<conversationId, AgentSession>（会话注册表）
 ├── LifecycleRegistry        Map<conversationId, {starts, firstStartedAt, lastStartedAt, lastClosedAt}>
 ├── StartLocks               Map<conversationId, Promise>（并发 prompt 串行化）
 ├── PendingActions           Map<actionId, {resolve, reject, timer, pendingId}>（挂起的工具调用）
 ├── EventStreams             Map<conversationId, Set<closer>>（SSE 连接）
 └── PmExtension              注册 tool + tool_call 钩子 + UI 桥
```

**进程退出钩子**：`process.once("exit")` 逐个 destroy；`SIGINT`/`SIGTERM` 统一 shutdown（给 5s 宽限期，让挂起的确认请求 reject 干净）。

## 2. 会话生命周期

```
创建   POST /api/agent/new → createAgentSession(...) → 注册表登记 → 绑定扩展
使用   POST /api/agent/:cid/command { type:"prompt" } → 启动锁排队 → session.prompt()
流式   GET  /api/agent/:cid/events → SSE 订阅
空闲   超过 IDLE_TIMEOUT（默认 10min）无事件 → shutdown → 从持久化存储恢复
销毁   会话关闭 → 从注册表移除 → 清理定时器 → reject 所有挂起请求
```

**重建（recreate）**：当工具集或模型发生变化时，先 shutdown 旧会话并**等待其 dispose 完成**，再从持久化存储重开（保留历史）。实现上用 `waitUntilDisposed` + `__piStartLocks` 保证不与正在运行的轮次打架。

**工具集一旦有历史就固定**——与 pi 一致：会话已有消息后改工具集需要 recreate，而不是原地切换。

## 3. 事件桥

### 3.1 pi 事件 → 前端事件

| pi 事件 | 前端事件 | 说明 |
|---|---|---|
| `message_update`（`text_delta`） | `text_delta` | 文本增量 |
| `message_update`（thinking） | `thinking_delta` | 思考增量 |
| `message_end` | `message_end` | 一条消息完成 |
| `tool_execution_start` | `tool_call` | 命令开始 |
| `tool_execution_end` | `tool_result` | 命令结束 |
| `extension_ui_request` | `action_request` | 确认请求 |
| `extension_ui_response` 发出后 | `action_resolved` | 确认已处理 |
| `agent_settled` | `agent_settled` | 本轮彻底结束 |
| — | `state_dirty` | 自定义：工具执行后提示前端刷新哪些实体 |

### 3.2 SSE 细节
- 首帧 `connected`（含 `pendingActionIds`）。
- 心跳 15s（`heartbeat` 帧）。
- backlog 上限 16MB；超限丢弃**可重建增量帧**，保留结构性事件。
- 客户端断线不影响服务端挂起的工具调用；重连靠 `connected` 帧补发。

### 3.3 挂起请求表
```ts
Map<actionId, { resolve(value): void; reject(err): void; timer: NodeJS.Timeout; pendingId: string }>
```
- 工具 `execute()` 里 `await new Promise(resolve => pendingActions.set(actionId, {resolve, ...}))`。
- 前端 `action_response` → 查表 → `resolve(decision)` → 工具恢复。
- 超时（30min）→ `timer` 到点 → resolve 为 `expired` → 工具返回"已过期"。
- 会话销毁 → 全部 reject，避免 promise 泄漏。

## 4. 模型接入（MiniMax）

| 项 | 值 |
|---|---|
| baseURL（OpenAI 兼容） | `https://api.minimax.cn/v1` |
| baseURL（Anthropic 兼容，AI SDK 默认） | `https://api.minimax.cn/anthropic` |
| 模型 | `minimax-cn/MiniMax-M3.1-Flash`（默认）、`minimax-cn/MiniMax-M3` |
| 鉴权 | `MINIMAX_CN_API_KEY`（国内）/ `MINIMAX_API_KEY`（国际） |

**三条硬约束（必须遵守）**

1. **`toolChoice` 只支持 `auto`** —— 不能强制模型调工具。"必须走命令"只能靠 **system prompt 约束 + 命令 description 质量**实现。因此必须有"模型只回文本没调工具"的兜底：**不得猜测意图直接执行**。
2. **多轮 function call 必须回填完整 assistant 消息** —— 含 `tool_calls` 的消息与其 tool 结果必须**成组保留或成组丢弃**，裁剪以**完整轮次**为单位，否则思维链断裂。
3. **Interleaved Thinking 会把思考写进 `content`** —— 解析时**只看 `tool_calls` 数组**，不解析 `content`，避免把内心戏当回复展示。

## 5. System Prompt

四块，缺一不可：

1. **角色与边界**：你是项目管理助理；只能通过工具操作数据；不要编造 id（不确定先查询）。
2. **工具使用规则**：多实体修改拆成多个命令；批量操作必须先预览；不确定参数先查再改；日期用相对表达式或绝对日期，不要自己算"下周一"。
3. **强制工具化**（因 `toolChoice=auto`）：任何"改/建/删/查项目数据"的意图**必须调用工具**，不得用文字代替；需求含糊时先调只读命令探查。
4. **输出风格**：中文、简洁、先结论后动作；每个结论带引用卡片。

**上下文注入**
- 注入：当前 project、可见项目列表、当前视图上下文、今天日期与时区（Asia/Shanghai）、周起点。
- **不预先把整个项目塞进 prompt**——需要更广数据时由模型先调只读命令。
- 历史：最近 N 轮 + 摘要，**按完整轮次裁剪**（§4 约束 2）。

## 6. 降级链

| 级别 | 触发 | 行为 | 用户感知 |
|---|---|---|---|
| L1 | 模型只回了文本，没调工具 | 纠正重试 1 次；仍不调则**放弃该轮** | "没理解成操作"提示 + 给出可用说法示例 |
| L2 | tool-calling 不可用（协议/模型不支持） | 退化为结构化 JSON 输出（`{command, args}`），用同一套 schema 校验 | 行为不变，仅内部路径不同 |
| L3 | LLM 整体不可用 | 返回"AI 暂不可用" | **手动操作与全部视图照常可用**（硬要求） |
| L4 | `AI_MOCK=1` | 本地 mock provider 返回预置响应 | 无 key / CI 环境可开发联调 |

**外部 API 不可用**是另一条独立降级：适配层返回 `RATE_LIMIT` / `AUTH_EXPIRED` 等错误 → 工具失败 → 模型把错误转达给用户 → **不重试写操作**。

## 7. 能力分级（AI 能力清单）

每项能力按七段式定义：触发 / 输入 / 输出 / 算法 / 评测 / 限流 / 降级。

| 能力 | 触发 | 输出 | 算法 | 评测指标 | 降级 |
|---|---|---|---|---|---|
| **NL 建/拆任务** | AI 工作台输入；任务页 ⌘K | 任务对象数组（强 schema） | tool-calling → `create_task` / `split_task` | schema 通过率 ≥ 95%；采纳率 ≥ 70%；字段准确率 ≥ 0.9；估时 MAPE < 30% | 错误码，手动可用 |
| **进度预测 / ETA** | 每日 cron 02:00；手动触发 | `{predicted_end_date, p50, p90, confidence, explanation}` | burndown 外推 + CPM；LLM 只润色 explanation | MAPE ≤ 25%；耗时 < 2s；预警覆盖率 ≥ 70% | 仅 burndown；数据不足则明说 |
| **风险预警** | 每日 cron 02:30；状态变更增量 | 5 类候选风险 + 等级 + 原因 | 规则层 80% + LLM 解释层 | 误报 < 25%；漏报 < 15%；采纳 ≥ 55% | 仅规则层（无自然语言解释） |
| **项目助理** | 常驻右侧工作台 | 回答 + 引用卡片 / 命令卡片 | 意图路由 → tool-calling 或只读命令 | 意图识别 ≥ 90%；P95 < 6s；引用准确率 100% | 意图不可用 → 用户下拉选 |
| **纪要总结** | 粘贴会议记录 | `{summary, decisions[], action_items[], risks[], open_questions[]}` | MiniMax 结构化输出；action_items 可一键转任务 | action items F1 ≥ 0.75；采纳 ≥ 60% | 错误码 |

**限流**：单用户 2 QPS（对话）、5 QPS（建任务）、手动预测 10 次/小时、风险订阅触发 50 次/小时。

## 8. 评测流水线

```
scripts/ai_eval/
├── datasets/
│   ├── nl_to_task_v1.jsonl        # 100 条：raw_text + ground_truth_tasks
│   ├── intent_v1.jsonl            # 200 问：query + true_intent + true_target_id
│   ├── progress_predict_v1.jsonl  # 30 个历史项目：history + actual_end_date
│   ├── risk_predict_v1.jsonl      # 200 条历史项目（80 正例）
│   └── meeting_summary_v1.jsonl   # 200 条会议记录 + 人工标 action_items
├── runners/{nl_to_task,intent,progress_predict,risk_predict,meeting_summary}.ts
├── run.ts                         # CLI: run.ts --task <name> --report
└── report_template.md
```

**CI 钩子**：PR 上跑 `run.ts --task all --report`，阈值不达标则 PR 变红，产出 `ai_eval_report.md`。

v1 优先做 `nl_to_task` 与 `intent` 两个评测集（覆盖最核心的两条链路）。

## 9. 可观测

| 指标 | 类型 | 说明 |
|---|---|---|
| `nl_to_task_latency_ms` | histogram | 建任务端到端延迟 |
| `ai_call_total{model,status}` | counter | 模型调用次数与成败 |
| `command_exec_total{command}` | counter | 命令执行次数 |
| `command_confirm_pending` | gauge | 当前待确认数 |
| `command_undo_total{command}` | counter | 撤销次数（回滚率） |
| `eta_mape` | gauge | 预测误差（离线评测写入） |
| `tool_call_blocked_total{reason}` | counter | 被阻断的工具调用（确认拦截 / 校验失败） |

每次 AI 调用带 `trace_id`，贯穿 `AuditLog` 与工具调用链。
