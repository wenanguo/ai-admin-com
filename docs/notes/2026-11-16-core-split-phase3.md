# 目录拆分 · 阶段 3：`agent/` 按能力搬进 `core/`（纯搬家）+ 内核纯净度检查（2026-11-16）

> 交接文档 —— 让下一棒（可能是另一个会话的 agent）接得上。

## 目标

- **关联**：issue #82 · PR（阶段 3；**#82 还没完**，见下面「下一步」）
- **一句话**：把 `src/agent/`、`src/http/`、`src/routes/` 等**按能力**搬进 `src/core/`，
  并加**可执行的内核纯净度检查**（`core/**` 不许 import `plugins/**`）⇒ 进 CI。

## 状态

**阶段 3 已完成**（纯搬家 + 纯净度检查；**行为不变** ⇒ 449 条单测全绿）。
**阶段 4~5 还没做** ⇒ #82 保持开着。

## 已完成

| 位置 | 做了什么 |
| ---- | -------- |
| `src/agent/{runtime,pi-session,session-entries,session-registry,frame-buffer,event-mapper,events,startup-lock}.ts` | ⇒ `src/core/session/**` |
| `src/agent/{skills,skill-tools,skill-catalog}.ts` | ⇒ `src/core/skills/**` |
| `src/agent/{mcp,mcp.fake}.ts` | ⇒ `src/core/mcp/**` |
| `src/agent/{gate,pending-waiters}.ts` + `src/{pending-query,pending-write}.ts` | ⇒ `src/core/gate/**` |
| `src/{audit,audit-query,audit-redact}.ts` | ⇒ `src/core/audit/**` |
| `src/agent/store.ts` + `src/db.ts` | ⇒ `src/core/store/{store,db}.ts` |
| `src/http/**` | ⇒ `src/core/http/**` |
| `src/routes/**` | ⇒ `src/core/routes/**` |
| `src/types/api.ts` | ⇒ `src/core/types/api.ts` |
| `src/{env,load-env}.ts` | ⇒ `src/core/env/{env,load-env}.ts` |
| `src/plugins/pm/adapter/aadmin/errors.ts` | ⇒ `src/core/errors.ts`（★ **内核认得这个错误的形状** ⇒ HTTP 层才能把它翻成 401/502 ⇒ 不能 import 插件）；兜底文案改成**通用说法** |
| `src/plugins.ts` · `src/server.ts` · `src/main.ts` | **不动**（入口侧：唯一 import 插件的地方 / app 装配 / 进程入口） |
| `scripts/check-core-purity.cjs` | ★ **可执行的**内核纯净度检查（解析 import 说明符 ⇒ 算出落点 ⇒ 判是否落在 `plugins/**`） |
| `backend/ai/src/core/purity.test.ts` | ★ 架构的**单测**：跑同一条检查（并验它**抓得住**违规：造一个临时的 core/ + plugins/） |
| `.github/workflows/ci.yml` | ★ 新增 job「AI 服务（单测 + 内核纯净度）」⇒ **后端的 449 条单测第一次进 CI**（之前只在容器验收里跑） |
| 文档 | `AGENTS.md`（AI 服务那节）· `backend/ai/README.md`（目录树 + 若干路径）· `backend/ai/agents/README.md` · `docs/directory-structure.md` · `docs/ai-architecture.md` · `scripts/e2e/ai-container.static.cjs`（健康检查/SSE 的路径） |

## 决策记录（★ 最值钱的部分）

| 决定 | 为什么 | 错了的代价 |
| ---- | ------ | ---------- |
| **错误类挪进内核**（`core/errors.ts`），插件只是「抛它的人」 | HTTP 层要把上游错误翻成状态码（401/404/409/429/502）⇒ 它得认得这个**形状** ⇒ 形状属于内核；**谁抛**属于插件 | 留在插件 ⇒ `core/http/` import 插件 ⇒ 纯净度检查当场红 ⇒ 阶段 3 的目标就废了 |
| **兜底文案改成通用说法**（「上游找不到该资源」而不是「AiAdmin 里找不到」） | 内核不许出现业务词；⚠️ **所有调用点都自带文案** ⇒ 兜底几乎用不到 ⇒ 改它没有行为变化 | 保留 AiAdmin 文案 ⇒ 内核里出现业务系统名 |
| **`agents/` 与 `.pi/skills/` 一个字不动** | 智能体配置里的技能目录是**相对配置目录**解析的（`../../.pi/skills`）⇒ 挪 `agents/` ⇒ 技能目录解析错 ⇒ **静默**（模型看不到技能）⇒ `agents-shipped.test.ts` 已经钉住这条 | 挪 `agents/` ⇒ 技能全丢 ⇒ 用户看到「AI 好像变傻了」 |
| **搬文件用脚本改 import**（按「文件的新位置」重算相对路径） | 74 个文件、53 个文件的 import ⇒ 手改必漏；漏一个就是**编译期**错误（tsc 会抓） | 手改 ⇒ 漏 ⇒ 要么编译不过，要么**运行期**才炸 |
| **`vi.mock()` 的路径也要跟着改**（脚本第一版漏了） | 测试 mock 的是**模块**；模块搬了 ⇒ mock 路径不跟着改 ⇒ **mock 不生效** ⇒ 测试跑的是真实现 ⇒ 「502」「空清单」这类看不懂的失败 | 只改 import 不改 mock ⇒ 测试**假绿/假红**（最难查的一类） |
| **纯净度检查查 import，不查业务词** | grep 业务词会命中**注释**（「任务」在注释里很正常）⇒ 误报满天飞 ⇒ 没人看 | 靠 grep ⇒ 要么误报要么漏 |
| **后端单测进 CI** | 之前 CI **只跑**前端 + 容器验收 ⇒ 后端 449 条单测在 CI 里**根本没跑** ⇒ 重构没有安全网 | 不加 ⇒ 这次重构的「449 条全绿」只在本地成立 |
| **`AIADMIN_*` 环境变量仍留在 `core/env/`**（**故意留到阶段 4**） | 设计 §12.3 说「由插件声明」⇒ 但内核里还有两处要用它（**健康检查探针**、**MCP 默认地址**）⇒ 要挪就得先给插件加两个能力（探针 / 默认地址）⇒ 那是**阶段 4「接线」**的活 | 现在硬挪 ⇒ 插件能力接口还没定 ⇒ 改两遍 |

## 怎么验

```bash
cd backend/ai
npm run typecheck        # ✅
npm test                 # ✅ 49 个文件 / 449 条
npm run build            # ✅ 产物只剩 core/ + plugins/ + main.js + server.js + plugins.js
cd ../..
node scripts/check-core-purity.cjs     # ✅ 内核纯净
node scripts/e2e/ai-container.static.cjs   # ✅ 20 条
```

**接缝自检**：

```bash
cd backend/ai
grep -rn "plugins/" src/core/ | grep -v "^\S*: \*"   # 只应剩注释 ⇒ 无 import
grep -rn "plugins/" src/                             # 只有 src/plugins.ts 与 src/plugins/** 该有
```

## 坑与提醒

- ⚠️ **搬文件后 `vi.mock()` 的路径也要改**（第一版脚本只改 import ⇒ 27 条测试假失败）。
- ⚠️ **`dist/` 不会自动清** ⇒ 本地验证前先 `rm -rf dist`（否则旧产物还在，容易误判）。
- ⚠️ **`core/env/env.ts` 里还有 `AIADMIN_*`**（故意留到阶段 4）⇒ 业务词 grep 会命中它 ⇒
  **不要**把它当成「纯净度破了」（纯净度看的是 import 关系 ✓）。
- ⚠️ **工作区里前端的浏览器模式测试与 `npm run build` 跑不起来**（junction 软链）⇒ 与本改动无关。
- ⚠️ **CI 现在会跑后端单测** ⇒ 若本地偶发失败（资源紧张时 vitest 的 worker 会挂），
  先重跑一次确认不是真失败。

## 下一步（阶段 4~5）

1. **阶段 4：接线**（插件注册表 · 配置指插件 · 能力可见）：
   - 智能体配置里写 `plugin: pm`（**用哪个插件**）；
   - `GET /api/agents` 报出**插件能力**；
   - **`AIADMIN_*` 由插件声明**（内核的 env 只留通用变量）⇒ 需要给插件加两个能力：
     **健康检查探针**（探 AiAdmin）与 **MCP 默认地址**；
   - 技能的归属（设计 §4 的 `skills` 能力）。
2. **阶段 5**：对外可发布的 API 边界。
3. **每一步一个分支一个 PR**；#82 在**阶段五**后才关。
