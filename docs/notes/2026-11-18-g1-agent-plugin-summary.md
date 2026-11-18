# G1 收尾：能力摘要报出插件 + 「core 零业务词」进 CI（2026-11-18）

> 交接文档 —— 让下一棒（可能是另一个会话的 agent）接得上。

## 目标

- **关联**：issue #112 · PR（待填）
- **一句话**：补上 G1（通用智能体内核）收尾时的两处缺口 ——
  ① `GET /api/agents` 的能力摘要里**报出这个智能体挂了哪个插件**（没显式写 `plugin:` 的按**默认插件**算）；
  ② 「**core 零业务词**」从「靠人眼」变成 **CI 里可执行的检查**（第二档 + 允许清单）。

## 状态

**已完成**（后端 + 前端类型 + 两个检查 + 单测；CI 绿后合并 ⇒ issue 自动关闭）。

## 已完成

| 提交 | 做了什么 |
| ---- | -------- |
| `020164e` | ★ 能力摘要报出插件：后端 `AgentCapabilities.plugin?: string` ⇒ **`plugins: string[]`**；`toAgentSummary` 按运行时同一口径取插件；前端 `AiAgentSummary.capabilities` 同步加 `plugins` |
| `013c474` | ★ `scripts/check-core-purity.cjs` 加**第二档**（业务词）+ **允许清单**；原 `scripts/check-core-business-words.cjs` 并入本脚本 |
| `d5a43b5` | ★ 钉住两个智能体的能力差异（`qa` 命令集为空 / `pm` 恰含 `create_task`） |

### 1) 能力摘要报出插件

- `backend/ai/src/core/config/types.ts`：`AgentCapabilities` 的 `plugin?: string` ⇒ **`plugins: string[]`**。
  - ⚠️ 为什么是**数组**：现在每个智能体最多挂一个插件，但**将来能挂多个** ⇒ 一次把契约定好，不用再改前端类型。
- `backend/ai/src/core/config/catalog.ts`：
  - `toAgentSummary(config, defaultPluginId = pluginRegistry.defaultPlugin()?.id)`；
  - **口径与运行时一致**（`core/session/runtime.ts` 的 `#pluginOf`）：配置里写了 `plugin:` 就按写的算，
    没写才回落**默认插件** ⇒ 否则「清单说挂了 pm、实际会话用的是别的插件」⇒ 界面会骗人。
- `frontend/src/services/api/ai/types.ts`：`AiAgentSummary.capabilities.plugins: string[]`（必填 ⇒ 服务端总给）。

### 2) 「core 零业务词」进 CI（第二档）

`scripts/check-core-purity.cjs` 现在有**两档**：

| 档 | 查什么 | 怎么查 |
| -- | ------ | ------ |
| 第一档 | `core/**` 不许 import `plugins/**` | 解析 import 说明符 ⇒ 算出落点（**原样保留**） |
| 第二档 | `core/**` 的**代码**里不许出现业务实体名 | 剥掉注释与字符串字面量 ⇒ 只查剩下的代码 |

- **业务词**（10 个）：`aiadmin` / `aipm` / `pm_task` / `pm_project` / `module_pm` / `status_code` /
  `任务` / `项目` / `里程碑` / `风险`（拉丁词**大小写不敏感** ⇒ `AiAdmin` / `AIADMIN` 都算）。
- **强业务标识**（表名 / 模块名 / 字段名：`pm_task` / `pm_project` / `module_pm` / `aipm` / `status_code`）
  ⇒ **连字符串里也查** —— 通用内核里没有它们的正常用法 ⇒ 出现就是**真依赖**。
- **测试文件不算**（`*.test.ts`）⇒ 那里是**夹具**（模拟上游载荷）。
- **允许清单**：`scripts/core-business-words.allow.json`
  ```json
  { "env/env.ts": { "words": ["aiadmin"], "reason": "为什么必须提（什么时候清掉）" } }
  ```
  粒度是**文件 × 词**（不是整文件豁免）⇒ 豁免了一个词，同文件别的业务词照样报。
  ⚠️ 当前清单是**空的** ⇒ 内核真的零业务词。
- **原 `scripts/check-core-business-words.cjs` 已删除** ⇒ 它的逻辑并进第一/第二档 ⇒ **CI 只跑一条命令**
  （`.github/workflows/ci.yml` 的 ai-service job）。

### 3) 两个智能体的能力差异（单测钉住）

- 新文件 `backend/ai/src/agent-capabilities.test.ts`（**放在 `src/`，不在 `core/`**）——
  因为它要同时看**内核的机制**（插件注册表 + `buildCommandTools(..., { only })` 白名单）与**插件的命令目录**
  ⇒ 而内核不许 import 插件（第一档检查会红）。
- 钉住：`qa` 的命令集 **= []**、`pm` 的命令集 **= `["create_task"]`**（恰含，不多不少）、
  两者不同 ⇒ 换智能体真的换能力。
- 另外钉住**摘要里的插件**：`pm` ⇒ `["pm"]`（显式）、`qa` ⇒ `["pm"]`（**默认插件**）。

## 决策记录（★ 最值钱的部分）

| 决定 | 为什么 | 错了的代价 |
| ---- | ------ | ---------- |
| **`plugin?: string` ⇒ `plugins: string[]`**（不是加一个新字段） | 阶段 4 留下的 `plugin?` **没有任何消费方**（前端类型里根本没有）⇒ 保留它只会让接口里有两个含义重叠的字段 | 两个字段并存 ⇒ 前端不知道该信哪个 ⇒ 契约腐烂 |
| **能力摘要按「运行时同一口径」取插件**（`#pluginOf`） | 摘要与实际行为不一致 ⇒ 界面骗人 ⇒ 比没有摘要更糟 | 清单写 `pm`、会话跑的是默认插件 ⇒ 排障时互相打架 |
| **`listAgentSummaries` 不能直接 `.map(toAgentSummary)`** | `map` 会把**下标**当第二个参数传进来 ⇒ 那个参数是「默认插件 id」⇒ 摘要里会出现 `"0"` / `"1"` 这种鬼东西（**已被单测抓到**） | 摘要里的插件 id 是数字 ⇒ 界面显示错插件 ⇒ 难查 |
| **第二档只查「代码」（剥掉注释 + 字符串）」** | 业务词在注释里是**文档**、在字符串里常常是**人话**（「任务创建失败」）⇒ 全量 grep ⇒ 一百多处命中 ⇒ 要么白名单一大片（等于没查），要么把文档逼成「上游」 | 全量 grep ⇒ 检查形同虚设（大家习惯性加白名单） |
| **强业务标识连字符串也查** | 只查标识符 ⇒ `db.query("SELECT ... FROM pm_task")` 这种**真依赖**会漏掉 | 表名/字段名能悄悄溜进内核 ⇒ 换个业务系统就炸 |
| **允许清单粒度 = 文件 × 词**（不是整文件） | 整文件豁免 ⇒ 一个文件里所有业务词都放行 ⇒ 白名单会越滚越大 | 白名单膨胀 ⇒ 检查再次形同虚设 |
| **业务词检查并进 `check-core-purity.cjs`**（删掉独立脚本） | issue 的口径是「一个脚本两档」⇒ 两个入口跑同一件事 ⇒ 迟早只跑一个 | 维护两份同类检查 ⇒ 口径漂移 |
| **能力差异的单测放在 `src/` 而不是 `core/`** | 它要同时用内核机制与插件命令目录 ⇒ 放 core 就得 import 插件 ⇒ **第一档检查直接红** | 把测试塞进 core ⇒ 第一档检查失效 ⇒ 架构判据被测试破掉 |

## 怎么验

```bash
# ① 内核两档检查（本地就能跑）
node scripts/check-core-purity.cjs
# ⇒ ✅ 内核纯净：backend/ai/src/core 没有 import plugins/**
# ⇒ ✅ 内核无业务词：10 个词（剥掉注释与字符串后查代码 + 强业务标识查字符串）

# ② 后端单测（含能力摘要 + 能力差异 + 两档检查的自测）
cd backend/ai && npm run typecheck && npm test
# ⇒ 52 个文件 / 470 条全绿

# ③ 前端（类型同步 ⇒ 夹具补了 plugins）
cd frontend && npm run lint && npm run test
# ⇒ 73 个文件 / 630 条全绿

# ④ 手动看接口（起服务后）
curl -s -H "Authorization: Bearer $TOKEN" localhost:3100/api/agents
# ⇒ data[i].capabilities.plugins = ["pm"]（pm 显式 / qa 默认）
```

## 坑与提醒

- ⚠️ **允许清单文件**：`scripts/core-business-words.allow.json`（现在是空的 `{}`）。
  加豁免时**必须写 `reason`**（半年后要有人看得懂为什么在这儿）。
- ⚠️ **业务词检查跳过 `*.test.ts`** ⇒ 测试夹具里可以有业务词（那是**模拟上游的载荷**）。
- ⚠️ **`capabilities.plugins` 是必填** ⇒ 前端任何地方造 `AiAgentSummary` 都要带上（TS 会拦）。
- ⚠️ **中文业务词在字符串里放过** ⇒ 「内核代码里不许出现业务词」这条判据现在指的是
  **标识符 / 键名 / 结构**（+ 强业务标识在字符串里）；这是**有意放宽**，别当漏洞。
