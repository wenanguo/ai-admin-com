# dsh runner（骨架换 DeepSeek Harness）（2026-11-19）

> 交接文档 —— **让下一棒（可能是另一个会话的 agent）接得上**。

## 目标

- **关联**：issue **#120**（G4 主战役）· PR（本 PR）
- **一句话**：把 AI 服务的**执行层**换成 DeepSeek Harness（**子进程 + stdio JSON-RPC**），
  **对外契约一字不改** ⇒ 前端零改动；**双跑可切**（`AI_RUNNER=pi|dsh`），本期**不删 pi**。

## 状态

**已完成**（PR 已开、**未合并** —— 等人/PM 拍板：这是高风险改动）。

## 已完成

| 提交 | 做了什么 |
| ---- | -------- |
| `chore(ai)` | **边界守卫** `scripts/check-dsh-boundary.cjs`（三档：目录 / 类型 / pi-ai）+ 接进 CI |
| `feat(ai)` | **适配层** `core/adapter/dsh/**`（协议词汇 · 事件映射 · 工具 schema · 闸门接线 · 客户端 · 会话 · profile 引导 · 命令桥） |
| `feat(ai)` | **双跑开关**：`AI_RUNNER=pi|dsh`（缺省 pi ⇒ 行为不变）；运行时分支 + 技能段照旧 |
| `feat(ai)` | **我们自己的 provider**（`backend/ai/dsh-plugin/`）：OpenAI 兼容 ⇒ **DeepSeek 官方 + MiniMax**，**不依赖 pi-ai** |
| `feat(ai)` | **命令桥**：dsh 侧插件回调我们的服务执行命令（命令本体 / 审计 / 参数收窄都在我们这边） |
| `test(ai)` | **验收脚本** `scripts/e2e/dsh-runner.cjs`（自带假模型服务 ⇒ **不要凭据**）：会话 + 闸门全绿 |

**下一步**：

```
- 人拍板 ⇒ 合并本 PR（别自动合并！）
- D3：用**官方 DeepSeek key** 实测 `deepseek-direct` 路由（现在**没有官方 key** ⇒ 未测）
- #121 存储与审计、#122 技能/MCP/插件、#123 拔 pi（本期不删 pi）
```

## 决策记录（★ 最值钱的部分）

| 决定 | 为什么 | 错了的代价 |
| ---- | ------ | ---------- |
| **D1=A：子进程 + stdio JSON-RPC** | 人 2026-11-19 拍板；`text_delta` **成批到达**但**契约不变** ⇒ 前端零改动 | 流式体感变差（可回退到进程内嵌入） |
| **D2=A+C：abort = 停掉并重建该会话的 dsh 进程**；并给 dsh 提 `session/cancel` 的 issue | SDK 协议**没有 cancel** ⇒ 只能粗一点；一会话一进程 ⇒ 停掉只影响这个会话 | 这一轮 dsh 侧上下文丢失（我们的历史在 `ai_message` 表里 ⇒ 下次重建会还原） |
| **D3=A：官方 key 实测**（**未测**：环境里没有官方 key） | 不许拿兼容网关冒充 | D3 这条验收**未完成** ⇒ 已在 issue 上明说 |
| **D5=A：自己写 provider，**不许** `@deepseek-ai/dsh-llm-pi-ai`** | 它建在 pi 的 `pi-ai` 上 ⇒ 与「拔 pi」冲突 | — |
| **一个会话一个 dsh 进程** | 鉴权（用户 token）、中止隔离、崩溃隔离都简单 | 进程多（会话多了 ⇒ 内存吃紧）⇒ 后面可能要合并 |
| **命令桥（loopback HTTP + 进程内随机密钥）** | 我们的命令要库 / 审计 / 用户 token ⇒ 不能在 dsh 进程里跑 | 多一个内部端点（**不在对外契约里**） |
| **dsh 侧插件挂在 profile 的「补丁层」**（不是 bundle） | bundle 在 root 作用域 ⇒ 看不见 agent 作用域里的**审批缝 / 工具表** ⇒ 工具变「unknown tool」 | — |
| **provider 路由注册到 `ctx.root.get('llm')`** | 插件自己作用域里的 llm 实例是**另一个** ⇒ agent 报「no adapter registered」 | — |
| **插件用 `link:` 装进 profile**（不是 `file:`） | `file:` 会**拷贝**一份 ⇒ 改源码不生效（开发时拿着旧代码跑） | — |
| **适配层把 dsh 事件翻译成「pi 形状」的事件** | 运行时（闸门 / 审计 / 落库）只认一套事件 ⇒ 运行时**一个字不改** ⇒ 契约零风险 | 拔 pi（#123）时要把这套词汇改成我们自己的（改名，不是重写） |

## 怎么验

```bash
# ① 单测（含适配层与插件的协议翻译）
cd backend/ai && npm test

# ② 边界守卫（三档）
node scripts/check-dsh-boundary.cjs

# ③ 端到端（**自带假模型服务 ⇒ 不需要任何凭据**）
#    需要 Node ≥ 24.9 + pnpm
node scripts/e2e/dsh-runner.cjs
#    ⇒ 期望：模型被调用 / 模型看见我们的工具 / 闸门挂起待确认 / 批准⇒执行 / 拒绝⇒不执行
```

## 坑与提醒

- **dsh 的插件作用域**：插件里的 `ctx.llm` / `ctx.tools` 与 agent 用的**可能不是同一个实例**
  ⇒ provider 路由注册到 `ctx.root.get('llm')`；工具与审批缝用插件自己作用域的（补丁层）。
- **模型侧的工具声明**来自 agent 作用域的工具表 ⇒ 工具**注册在 agent 作用域**才看得见。
- **profile 要 pnpm**（dsh 的 profile 是 pnpm 工程）⇒ 第一次跑要 `pnpm add` 我们的插件（慢）。
- **pi-ai 仍在依赖树里**（`@deepseek-ai/dsh` 自带 `dsh-llm-pi-ai` ⇒ 它依赖 pi-ai；
  另外本期保留的 pi runner 也带 pi-ai）⇒ **我们的 provider 不用 pi-ai**，
  但「依赖树里搜不到 pi-ai」这条**字面**做不到 ⇒ 已向人说明。
- **dsh 运行时启动慢**（Windows 上 profile 加载 ~7 秒）⇒ 第一次会话会慢。
- 我们的 `dsh-plugin` 是**纯 JS**（跑在 dsh 进程里 ⇒ 不走 TS 编译）⇒ 改动后**立即生效**（link）。
