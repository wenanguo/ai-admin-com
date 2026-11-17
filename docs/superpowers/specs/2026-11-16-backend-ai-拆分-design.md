# backend/ai 拆分：通用智能体内核（core/）+ 业务插件（plugins/pm/）—— 设计文档

> **状态**：设计稿（阶段一交付物）· 对应 issue **#82** · 2026-11-16
>
> ⚠️ **本阶段只出文档，不动代码**（issue #82 的两阶段闸门：设计被批 ⇒ 才允许搬）。

---

## 0. 目标与非目标

**目标**：把 `backend/ai` 从「AiAdmin 的 AI 服务」拆成「**可复用的通用智能体内核 + 业务插件**」：

```
backend/ai/
├── core/          # 内核：通用智能体能力（**不认识 PM**）
├── plugins/pm/    # 业务插件：PM 的命令 / 上下文 / 数据源 / AiAdmin 客户端
├── agents/        # 智能体配置（YAML）—— 已存在
└── src/           # 入口（server / main）+ 接线
```

⇒ **内核不认识 PM** ⇒ 以后接别的系统，只带 `core/` + 自己的插件/配置即可。

**非目标**（issue 的「不做」栏）：
- ❌ 不改任何功能行为（本条是「搬家 + 划边界」，不是「改造」）
- ❌ 不扩充 PM 命令
- ❌ 不拆成独立仓 / 独立 npm 包（**但边界按「可发布」设计**，见 ⑧）
- ❌ 不动 AiAdmin 那个仓 · 不动前端

---

## 1. ① 「什么算内核」的可判定标准 = **通用智能体**

内核里**只允许**出现这几个通用概念：**对话 / 会话 / 命令 / 技能 / MCP / 审计 / 上下文锚点 / 闸门**。

**不允许**出现：
1. 具体业务实体的字段名/表名/枚举（任务、项目、里程碑、风险、`status_code`、`pm_task`…）
2. 业务 HTTP 路径（`/pm_*`）
3. 业务提示词
4. 业务表名

**为什么这样可判定**：不是靠人读代码，而是靠**可执行的校验**（见 ⑤）：

```bash
grep -rE "AiAdmin|aipm|AIADMIN|pm_task|pm_project|module_pm|任务|项目|里程碑|风险" \
  backend/ai/src/core/ && echo "❌ 还有业务词" || echo "✅ 干净"
```

**今天的实测（搬家前的基线）**：

| 文件 | 业务词命中 | 归属 |
| ---- | ---------- | ---- |
| `src/aadmin/types.ts` | 63 | 插件 |
| `src/adapter/datasource.ts` | 62 | 插件 |
| `src/agent/context.ts` | 59 | **拆**（见 ③） |
| `src/adapter/enums.ts` | 54 | 插件 |
| `src/tools/create-task.ts` | 52 | 插件 |
| `src/adapter/capabilities.ts` | 43 | 插件 |
| `src/aadmin/client.ts` | 23 | 插件 |
| `src/agent/runtime.ts` | 12 | **拆**（见 ③/④） |
| `src/agent/gate.ts` | 10 | **拆**（见 ③） |
| `src/env.ts` | 9 | **拆**（见 ③） |
| `src/agent/identity.ts` | 9 | **拆**（见 ④） |
| `src/agent/skills.ts` | 0 | 内核 |
| `src/agent/frame-buffer.ts` · `event-mapper.ts` | 0 | 内核 |

⇒ **绝大多数命中都在插件侧或「需要拆」的文件里** ⇒ 拆完 core/ 天然干净。

---

## 2. ② `core/` 内部按**能力**组织（不按层）

**理由**：外部接入方关心的是「我要配一个智能体 ⇒ 哪些能力可用」，不是「它在哪一层」；
按能力则「**加一个能力 = 加一个目录**」，且 `core/config/`（已存在）本来就是按能力。

```
core/
├── config/    # 智能体配置装载（已存在：schema/loader/registry/catalog/types/errors）
├── session/   # 会话与运行时：runtime · pi-session · session-entries · session-registry
│              #   · frame-buffer · event-mapper · events · startup-lock · identity
├── skills/    # skills · skill-tools · skill-catalog
├── mcp/       # mcp（多服务器）
├── tools/     # 命令工具的**类型与注册**（不含任何业务工具）
├── gate/      # 闸门（写操作要点头）· gate · pending-waiters · pending-query · pending-write
├── audit/     # 审计：audit（写）· audit-query（读）· audit-redact
├── store/     # 持久化：db（Prisma 单例）· store（会话与消息）
├── context/   # **上下文锚点的通用机制**（不含任何业务字段）
├── http/      # 中间件与错误：auth · body · cors · errors · respond · sse
├── routes/    # HTTP 端点：agent · agents · audit · pending · events · health · contract · support
├── types/     # 共享类型（信封等）—— **就近定义优先**，避免「万能 common 桶」
└── env/       # 环境变量解析（env · load-env）
```

**共享类型放 `core/types/`（或就近定义，避免出现「万能 common 桶」）**。

### 2.1 现状 → 目标目录（逐文件）

| 现在 | 目标 | 备注 |
| ---- | ---- | ---- |
| `src/core/config/**` | `core/config/**` | **已经在目标位置** ⇒ 阶段 1 几乎不用动它 |
| `src/agent/runtime.ts` | `core/session/runtime.ts` | 拆：PM 相关部分见 ③/④ |
| `src/agent/pi-session.ts` | `core/session/pi-session.ts` | |
| `src/agent/session-entries.ts` `session-registry.ts` `frame-buffer.ts` `event-mapper.ts` `events.ts` `startup-lock.ts` `identity.ts` | `core/session/**` | `identity.ts`（当前用户解析）见 ④ |
| `src/agent/skills.ts` `skill-tools.ts` `skill-catalog.ts` | `core/skills/**` | |
| `src/agent/mcp.ts` `mcp.fake.ts` | `core/mcp/**` | |
| `src/agent/gate.ts` `pending-waiters.ts` | `core/gate/**` | |
| `src/pending-query.ts` `pending-write.ts` | `core/gate/**` | 待确认 = 闸门的一半 |
| `src/audit.ts` `audit-query.ts` `audit-redact.ts` | `core/audit/**` | |
| `src/agent/store.ts` `src/db.ts` | `core/store/**` | |
| `src/agent/context.ts` | **拆**：`core/context/anchor.ts`（通用）+ `plugins/pm/context/pm-context.ts`（PM 语义） | 见 ③ |
| `src/tools/types.ts` `src/tools/index.ts` | `core/tools/**`（类型与注册） | |
| `src/tools/create-task.ts` | `plugins/pm/tools/create-task.ts` | 业务命令 |
| `src/http/**` | `core/http/**` | |
| `src/routes/**` | `core/routes/**` | `contract.ts`（9 个端点的行为契约）一起搬 |
| `src/types/api.ts` | `core/types/**` | |
| `src/env.ts` `src/load-env.ts` | `core/env/**` | 见 ③（`AIADMIN_*` 变量名） |
| `src/aadmin/**` | `plugins/pm/adapter/aadmin/**` | AiAdmin 的 HTTP 客户端 |
| `src/adapter/**` | `plugins/pm/adapter/**` | 数据源/枚举/能力 |
| `src/server.ts` `src/main.ts` | `src/**`（入口） | 入口负责**装插件** |
| —（新） | `src/plugins.ts` | **插件注册表**（见 ④） |

---

## 3. ③ `context.ts`（437 行 / 59 处业务词）怎么切

### 3.1 core 保留「上下文锚点」的**通用机制**

一个**通用**的锚点形状 + 一张键值映射 + **可写字段白名单机制**：

```ts
// core/context/anchor.ts —— 内核只认「作用域 + 字段白名单」，不认识 task/project
export interface ContextAnchor {
  /** 作用域（通用）：插件自己定义 type 与 id 的形状 */
  scope: { type: string; id: string };
  /** 锚点上的键值（通用）：插件放什么，core 不解释 */
  values: Record<string, unknown>;
  /** **可写字段白名单**：由插件注入（core 不写死任何字段名） */
  writableFields?: string[];
}
```

core 负责的只有一件事：**按白名单收窄写操作**（提交时把不在白名单里的字段剔掉）。

### 3.2 plugins/pm 提供 PM 的具体语义

- 两种 scope 的形状：`task` / `project`（id 的类型、标题、状态…）
- 三个可写字段：`status_code` / `actual_hours` / `description`
- PM 的表与枚举（`src/adapter/enums.ts`）

### 3.3 判据

**core 里出现「可写字段」必须由插件注入** ⇒ core 不写死任何字段名。

⇒ 现状里 core 侧要动的地方（`src/agent/context.ts`）：
`WRITABLE_FIELDS`（`status_code`/`actual_hours`/`description`）· `writeTargetId`（`task:321` 这类 id 形状）·
`changedFields`（按字段名算变更）· `renderAiTaskContext`（把上下文渲染成提示词）· `parseAiTaskContext`（解析前端传来的上下文）。

⇒ **切法**：
| 现在的函数 | 去处 |
| ---------- | ---- |
| `parseAiTaskContext`（解析 `kind: 'task' \| 'project'`） | `plugins/pm/context/`（插件解析 ⇒ core 只收「已解析的锚点」） |
| `renderAiTaskContext`（渲染成提示词段落） | `plugins/pm/context/`（插件渲染） |
| `WRITABLE_FIELDS` | 插件注入（core 只保留「白名单机制」） |
| `writeTargetId` / `changedFields` | core 保留**通用算法**（按 scope + 白名单算），具体字段名由插件给 |

⚠️ **这是唯一有逻辑改动的一步**（阶段 2）⇒ 单独 PR、单独 review。

---

## 4. ④ 插件接口 —— **注册表 + 依赖注入**

一个插件 = 一个**注册单元**，按需提供：

| 能力 | 说明 | PM 插件提供什么 |
| ---- | ---- | ---- |
| `commands` | 命令工具 | `create_task`（+ 未来的任务/项目/里程碑读写） |
| `context` | 上下文提供器 | 解析/渲染 PM 的上下文 + 可写字段白名单 |
| `skills` | 可选技能目录 | `.pi/skills`（PM 的三个技能） |
| `data` | 可选数据源/枚举 | AiAdmin 的数据源 + 线上码归一 |

### 4.1 内核怎么发现插件

**注册表 + 依赖注入**（core 定义接口与注册表，plugins 实现并注册）。

⚠️ **不是** core 直接 import plugins（那会破坏依赖方向）⇒ 见 ⑤。

```ts
// core/plugins.ts —— 内核侧：接口 + 注册表 + 按名字取插件
export interface AiPlugin {
  /** 插件 id（如 "pm"） */
  id: string;
  /** 命令工具 */
  commands?: CommandDefinition[];
  /** 上下文提供器 */
  context?: ContextProvider;
  /** 额外的技能目录（绝对路径） */
  skills?: string[];
  /** 数据源/枚举 */
  data?: PluginData;
}

export class PluginRegistry {
  register(plugin: AiPlugin): void;
  get(id: string): AiPlugin | undefined;
  list(): AiPlugin[];
}
```

### 4.2 接线点在哪

- **入口**（`src/main.ts` / `src/server.ts`）负责**注册**插件（唯一允许 import plugins 的地方）；
- **配置**里可以指插件（`agents/pm/agent.yaml` ⇒ `plugin: pm`）⇒ core 按名字取插件 ⇒
  **core 不 import plugins，插件也不 import core 的具体实现**（只用 core 的接口）。

⇒ 「配置里 `tools:` 指向插件」的具体形状（阶段 4 定）：先按**插件 id + 命令名**两段式，
`tools: [create_task]` 保持向后兼容（解析时用「当前插件的命令目录」核对），
将来要跨插件时再扩成 `tools: ["pm.create_task"]`。

---

## 5. ⑤ 怎么保证「core 不 import plugins」—— 三层

| 层 | 手段 | 谁来跑 |
| -- | ---- | ------ |
| **1. 结构** | `plugins/` 与 `core/` **同级**、**不在 core 内** | 物理上不会误 import |
| **2. 可执行的单测（主力）** | 扫 `core/` 下所有 import，断言**没有**指向 `plugins/` | 进 CI（`npm test`）⇒ **不靠 grep 脆弱匹配** |
| **3. 补充** | CI 里再跑一次「core 不含业务词」的 grep（① 的标准） | 进 CI（**允许清单**式检查：有白名单例外） |

### 5.1 单测怎么写（可执行 ⇒ 不是 grep）

`backend/ai/src/architecture.test.ts`（**放在 `src/` 根，不在 `core/` 内**）：

1. 递归读 `src/core/**` 的所有 `.ts`；
2. 用**解析 import 语句**（正则匹配 `from "..."` 与 `import("...")`）拿到被引用的路径；
3. 断言没有任何一个指向 `plugins/`（含 `../plugins/`、`../../plugins/`）；
4. 顺便断言 `src/core/**` 里**没有** `.test.ts` 引用插件（测试也不例外）。

⇒ 用解析而不是 `grep`：grep 会把注释、字符串里的 "plugins/" 也算上 ⇒ 误报 ⇒ 大家就会加白名单糊弄过去。

### 5.2 CI 里的 grep（带允许清单）

`backend/ai/scripts/check-core-purity.cjs`：
- 扫 `src/core/**` 的**业务词**（① 的正则）；
- **允许清单**：`core/config/**` 的**错误文案**里可能出现「任务」等词（中文提示）⇒ 逐条列出并写明理由；
- 退出码非 0 ⇒ CI 红。

⇒ 脚本同时被单测调用（⇒ 本地也能跑：`node backend/ai/scripts/check-core-purity.cjs`）。

---

## 6. ⑥ 迁移分几个阶段 —— **5 个阶段，每个一个 PR**

| 阶段 | 内容 | 怎么证明没变 | 回滚 |
| ---- | ---- | ---------- | ---- |
| **0** | 本 issue 的阶段一：spec + plan（**纯文档 PR**，等人 review） | — | 删文档 |
| **1** | **纯搬家**：`adapter/` · `aadmin/` · `tools/create-task.ts` → `plugins/pm/`，**只改 import 路径** | e2e 全绿 + 单测全绿 | `git revert` |
| **2** | **唯一有逻辑改动的一步**：拆 `context.ts`（core 锚点机制 + plugin 的 PM 语义） | e2e 全绿 + 单测全绿 + 「提交的白名单字段」不变 | `git revert` |
| **3** | **纯搬家**：`agent/` 剩余部分按 ② 的能力目录重组 | e2e 全绿 + 单测全绿 | `git revert` |
| **4** | **接线**：插件注册表 · 配置里 `tools:` 指向插件 · `GET /api/agents` 报出插件能力 | e2e 全绿 + 单测 | `git revert` |
| **5** | **按「可发布」收口**（见 ⑧）：公开入口 · 依赖不外泄 · exports | e2e 全绿 | `git revert` |

⇒ **每个阶段独立可 revert** ⇒ 任何一步不对，回退一个 PR 即可，不影响前面的阶段。

⚠️ **阶段顺序的理由**：先把「业务」挪出去（阶段 1）⇒ 再动唯一有逻辑的那一步（阶段 2）⇒
再把内核按能力整理（阶段 3）⇒ 最后接线与收口（阶段 4/5）。

---

## 7. ⑦ 路径变化会波及哪些地方（**逐项核对清单**）

| # | 位置 | 会受什么影响 | 阶段 |
| - | ---- | ------------ | ---- |
| 1 | `backend/ai/src/**` 内部的相对 import | **大量**（每个文件的相对路径都变）⇒ 用 `scripts/add-ts-extensions.mjs` 同款脚本批量改 | 1/3 |
| 2 | 入口：`src/main.ts` · `src/server.ts` | 挂载路径、插件注册 | 1/4 |
| 3 | `backend/ai/package.json`（scripts / test 路径） | `vitest.config.ts` 的 include、`test:coverage` 路径 | 1/3 |
| 4 | `backend/ai/tsconfig*.json`（include / paths） | 编译产物目录（`dist/`）不变 ⇒ **Dockerfile 的 CMD 不变** | 1/3 |
| 5 | `backend/ai/Dockerfile`（COPY 路径 · WORKDIR） | `COPY backend/ai/src ./src` ⇒ **不变**；`COPY backend/ai/agents ./agents` ⇒ 不变 ⇒ **镜像路径零变化** | — |
| 6 | `backend/ai/prisma`（生成客户端与迁移命令的路径） | `prisma/schema.prisma` 路径不变 ⇒ 迁移命令不变 ⇒ **但 `prisma generate` 的输出目录不变** | — |
| 7 | `backend/ai/src/core/config/loader.ts`（**技能目录的相对解析**） | ⚠️ **配置里路径写法会变**：`agents/pm/agent.yaml` 的 `skills: [../../.pi/skills]` 是**相对配置目录**的 ⇒ **配置目录不动** ⇒ **不变** ✅（但要写进回归测试） | 3 |
| 8 | `scripts/e2e/ai-*.cjs` · `docker*.cjs` | 它们跑构建/启服务，可能引用路径 ⇒ 逐个核对 | 1/3 |
| 9 | `.github/workflows/*.yml`（docker ai / compose / CI） | 工作目录与路径 ⇒ 逐个核对 | 1/3 |
| 10 | 文档：`docs/directory-structure.md` · `docs/ai-architecture.md` · `docs/notes/` | 路径引用要同步 | 3/5 |
| 11 | 前端 `frontend/` | **不直接引用后端路径** ⇒ 只确认 `AI_API_BASE_URL` 之类**不变** ✅ | — |
| 12 | `backend/ai/agents/**`（智能体配置） | **目录不动** ⇒ 配置里的相对路径不变 ✅ | — |

⚠️ 第 7 条是**最容易踩的坑**：技能目录是**相对智能体配置目录**解析的 ⇒
只要 `agents/` 不动，配置**一个字都不用改** ⇒ 阶段 3 搬家时**不要动 `agents/`**。

---

## 8. ⑧ 未来**按「可发布」来设计**

（人定）⇒ 边界要求：

1. **core 有明确的公开入口**（对外只暴露稳定 API）
   ⇒ `core/index.ts` 导出：配置装载 · 运行时 · 插件接口与注册表 · 通用类型；
   ⇒ **其余路径都是内部实现**（换目录不会破坏外部接入方）。
2. **依赖不外泄**（core 只依赖 pi SDK / express / prisma / zod / yaml 等**通用件**）
   ⇒ core **不得**依赖 `@/services/...`（前端那套）、不得依赖任何业务包；
   ⇒ 依赖清单在 `core/package.json`（或 core 目录的说明）里写明。
3. **配置 schema 稳定**
   ⇒ `core/config/schema.ts` 的字段是**对外契约** ⇒ 阶段 5 之后再改就要走版本号。
4. **阶段 5 专门收口这件事** ⇒ 将来真要独立成包/独立仓时**不用再拆一次**。

⇒ 阶段 5 的验收：`core/index.ts` 是唯一公开入口（单测断言：外部只从这里 import），
且 `core/` 的依赖清单可枚举。

---

## 9. 风险清单

| # | 风险 | 为什么会出事 | 怎么防 | 怎么发现 |
| - | ---- | ------------ | ------ | -------- |
| R1 | **搬目录时漏改一条 import** | 编译期能发现 ⇒ 风险低 | 阶段 1/3 只改路径 ⇒ `tsc` 立刻报 | `npm run tsc` |
| R2 | **技能目录的相对路径被改坏** | 技能加载不到 ⇒ 模型看不到技能（**静默**！） | 配置目录**不动**（⑦ 第 7 条）+ 回归测试 | 单测：`agents-shipped.test.ts` 断言 pm 的技能目录 |
| R3 | **`context.ts` 拆错 ⇒ 白名单失效** | ⚠️ **最严重**：提交时把不该写的字段写回去 ⇒ **静默改了别人的权限/状态** | 阶段 2 单独 PR + 钉死「白名单字段不变」的回归用例 | e2e + `context.test.ts` 迁移后的用例 |
| R4 | **插件注册时机错了**（会话里拿不到插件） | 命令/上下文消失 ⇒ 能力退化 | 阶段 4 的接线用例（两个智能体各起一个会话） | 单测 + e2e |
| R5 | **`core` 里残留业务词** | 换系统时又得拆一次 | ⑤ 的三层校验进 CI | CI 红 |
| R6 | **Docker 镜像路径变化** | 容器起不来 | `Dockerfile` 的 COPY 路径**不变**（⑦ 第 5 条）+ 容器 e2e | `scripts/e2e/ai-container.cjs` |
| R7 | **迁移历史与 prisma 路径** | `migrate deploy` 找不到 schema | prisma 目录**不动** | 迁移 e2e（人工，测试库） |
| R8 | **阶段 3 一次搬太多 ⇒ 不好 review** | 审不动 ⇒ 拖 | 阶段 1/3 分成小 PR（可再细分） | review 意见 |

---

## 10. 回滚办法

- **每个阶段一个 PR ⇒ 回滚 = `git revert` 那个 PR**（阶段 0 除外：删文档）。
- 阶段 1/3 是**纯搬家** ⇒ revert 后文件回到原位、路径回到原样 ⇒ **无数据影响、无配置影响**。
- 阶段 2 有逻辑 ⇒ revert 后 `context.ts` 回到原样 ⇒ **行为回到今天**（e2e 全绿即证明）。
- **任何阶段都不动数据库** ⇒ 不需要数据回滚（`ai_*` 表结构与数据都不变）。
- ⚠️ **配置也不动**（`agents/**` 不动）⇒ 不需要「改回配置」的回滚步骤。

---

## 11. 怎么验证（每个阶段都一样）

```bash
cd backend/ai
npm run typecheck        # 路径改错立刻报
npm test                 # 单测（含新增的架构单测）
cd ../.. && node scripts/e2e/ai-container.static.cjs   # 镜像/迁移的静态断言
cd frontend && npm run build && npx playwright test     # e2e（搬家类改动靠它证明「行为没变」）
```

⇒ **「行为没变」的判据 = e2e 全绿**（199 条）⇒ 这是本条的核心验收口径。

---

## 12. 未决问题（要人拍板）

1. **阶段 2 的白名单机制**：core 的锚点形状用 `scope: {type, id}` + `values` 键值映射，
   还是保留一个「可写字段」的一等公民字段？（本设计取后者：白名单由插件注入，core 不写死字段名。）
2. **`identity.ts`（当前用户解析）归哪**：它问的是「AiAdmin 的当前用户」⇒ 严格说是**插件**的事；
   但「会话要有个用户 id」是内核概念 ⇒ 本设计放 `core/session/identity.ts`，把**「怎么问」**做成插件注入的接口。
3. **`env.ts` 的 `AIADMIN_*` 变量名**：内核的 env 里出现 AiAdmin 的变量名 ⇒ 违反 ① ⇒
   本设计：这些变量**由插件声明**（`core/env` 只解析「插件声明的变量」），插件负责 `AIADMIN_*`。
4. **阶段 1 要不要同时把 `tools/index.ts` 的 `COMMAND_CATALOG` 拆开**（注册表在阶段 4 才接）：
   本设计：阶段 1 只把 `create-task.ts` 挪到插件侧，`COMMAND_CATALOG` 先改成**从插件注册表取**的占位
   （否则插件的命令进不来 ⇒ 阶段 1 就得接线）⇒ 阶段 1 会有一处**接口形状**的临时改动（不改行为）。
