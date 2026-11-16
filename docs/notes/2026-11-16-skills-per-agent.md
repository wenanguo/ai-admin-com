# 技能按智能体装配（2026-11-16）

> 交接文档 —— 让下一棒（可能是另一个会话的 agent）接得上。

## 目标

- **关联**：issue #80 · PR（待提）
- **一句话**：技能从「**全局唯一一份**」改成「**按智能体装配**」
  ⇒ 每个智能体带自己的技能目录 ⇒ 智能体之间**不串味**（复用 pi 的 loader，不造第二套机制）。

## 状态

**已完成**（代码已实现、单测已钉住；等提 PR + 合并）。

## 已完成

| 位置 | 做了什么 |
| ---- | -------- |
| `backend/ai/src/agent/pi-session.ts` | **`noSkills: true`** ⇒ pi **默认的项目目录（`<cwd>/.pi/skills`）与用户家目录一律不加载**；只加载智能体配置里列的目录（`additionalSkillPaths`） |
| `backend/ai/src/agent/skill-catalog.ts` | 清单按**多个目录**列（改用 pi 的 `loadSkills`，`includeDefaults: false`） |
| `backend/ai/src/agent/runtime.ts` | 新增 `listAgentSkills(agentId?)`（按智能体；没配技能 ⇒ 空列表） |
| `backend/ai/src/routes/agent.ts` | `GET /api/agent/skills` 支持 `?agentId=xxx`（不给 ⇒ 默认智能体） |
| `backend/ai/agents/pm/agent.yaml` | 注释说清：`.pi/skills` **由 PM 助手这份配置领用**（别的智能体看不到） |
| `backend/ai/agents/README.md` · `backend/ai/README.md` | 技能按智能体的口径 |
| 单测 | `skills.integration.test.ts`（**真 SDK**，3 条：配了有 / 没配没有 / A 看不到 B）· `skill-catalog.test.ts`（5 条）· `runtime.agents.test.ts`（+1 条）· `routes/skills.test.ts`（5 条） |

**下一步**：下一条是 #81（存储解耦：`ai_*` 表可指向自己的库 + `ai_conversation` 加 `agent_id`）—— **数据模型高风险**。

## 决策记录（★ 最值钱的部分）

| 决定 | 为什么 | 错了的代价 |
| ---- | ------ | ---------- |
| **`noSkills: true`**（只靠 `additionalSkillPaths` 喂目录） | pi 默认还会加载 `<cwd>/.pi/skills` 与 `~/.agents/skills` ⇒ ① 串味；② **同名抢技能**：pi 按名字去重、先到先得 ⇒ 项目目录那份赢 ⇒ **配置里的那份反而没了**（实测踩到：`create-task` 同名 ⇒ 智能体的技能整个消失） | 继续用 `noSkills: false` + 事后过滤 ⇒ 同名时配置里的技能被吞 ⇒ 用户以为「技能没生效」 |
| 技能**清单**也用 pi 的 `loadSkills`（不是 `loadSkillsFromDir` 拼） | 多目录的合并/去重/诊断与**会话里**一致 ⇒ 清单不会和模型看到的不一样 | 自己拼目录 ⇒ 两套口径 ⇒ 清单与实际不符 |
| 清单按**智能体**返回（`?agentId=`），不给 ⇒ 默认智能体 | 「当前智能体」在 HTTP 层没有上下文（清单不是某个会话的）⇒ 用查询参数最省事；前端还没做智能体选择器 ⇒ 默认就是 PM 助手 ⇒ 行为不变 | 只能按会话 ⇒ 清单端点要带会话 id ⇒ 前端要先有会话才能看技能 |
| **不搬** `.pi/skills` 里的三个样板技能 | 验收标准写明「`<项目>/.pi/skills` 的既有规则不变 ⇒ 不引入第二套技能机制」；pm 配置**领用**它们 ⇒ 「不是全局」也成立（别的智能体没列 ⇒ 看不到） | 搬到 `agents/pm/skills/` ⇒ pi 的项目目录机制空掉、镜像与验收脚本都要改 |
| 未配置技能 ⇒ **空列表**（不是异常） | 技能是可选的；「通用问答」那种智能体本就没有技能 | 报错 ⇒ 建会话直接失败 |
| 清单接口保留 `/api/agent/skills` 路径 | 前端已经在用它（`SkillList.tsx`）⇒ 改路径要动前端 | 改成 `/api/skills` ⇒ 前端要改（本条不做前端界面） |

## 怎么验

```bash
cd backend/ai
npm run typecheck
npm test            # 415 条（含真 SDK 的技能隔离 3 条）
```

人眼要看的（需要真环境）：

1. `GET /api/agent/skills` ⇒ 默认智能体（PM 助手）的三个技能；
2. `GET /api/agent/skills?agentId=qa` ⇒ **空列表**（通用问答没配技能）；
3. 用「通用问答」建会话聊一句 ⇒ 模型**没有**技能可用（也不会去加载任务技能）。

## 坑与提醒

- ⚠️ **同名抢技能**是这条最大的坑（见上面的决策）⇒ 现在靠 `noSkills: true` 根治。
- ⚠️ pi 的 `~/.agents/skills`（用户家目录）实测有**三十多个**技能
  ⇒ 以前靠过滤挡掉；现在**根本不加载** ⇒ 更省事、更安全。
- ⚠️ 真 SDK 的技能隔离测试在 `src/agent/skills.integration.test.ts`
  （**不 mock SDK**）⇒ 观察点是「`load_skill` 工具在不在」+「能不能加载某个技能」。
- ⚠️ `pi.agent.state.tools` 里能看到 `load_skill`；`getActiveToolNames()` 里**看不到**
  （那是「暴露给模型」的工具列表）⇒ 断言用前者。
