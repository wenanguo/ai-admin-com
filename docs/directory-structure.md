# 项目目录结构总览

> **面向新加入的同学与 AI 协作工具** —— 只回答**「东西放在哪」**。
> 怎么干活见 [`../AGENTS.md`](../AGENTS.md)；流程见 [`process.md`](process.md)。
>
> ⚠️ **2026-11-16 重写**：monorepo 化之后，本文件原来那份「前端单仓目录树」整体过期
> （issue #55）⇒ 现按**当前实际目录**重写，并给出**核对命令**（见 §7）。

## 技术栈速览

| 层次 | 选型 |
| ---- | ---- |
| 前端框架 | UmiJS Max 4（utoopack / Turbopack 构建）· React 19 · antd 6 · ProComponents 3 |
| 样式 | Tailwind CSS v4 + antd-style + CSS Modules |
| 数据 | @tanstack/react-query + 自建 axios 服务层 |
| 规范 | TypeScript strict + Biome（替代 ESLint/Prettier） |
| 测试 | Vitest（前端）· node:test（agent 脚本）· Playwright / 静态断言脚本 |
| AI 服务 | Express 5 + `@earendil-works/pi-coding-agent`（pi SDK）· Prisma |
| 后端 | 对接 **AiAdmin（FastAPI，独立项目，不在本仓）** |

---

## 1. 仓库根目录

```
ai-admin-com/
├── frontend/                # ★ 前端（Umi Max 4 + React 19 + antd 6）
├── backend/ai/              # ★ AI 服务（Express + pi SDK）—— 技能与智能体在这
├── docker/                  # 部署（本仓主线：前端静态 + AI 服务两个容器）
├── docs/                    # 文档（现状 / 流程 / 排期 / 交接 / 归档）
├── scripts/                 # 辅助脚本（agent 工作流 · e2e 验收 · PM 巡检）
├── .pi/                     # pi 宿主配置：prompts/（/pm、/dev 两个角色提示词）
├── .agents/                 # ★ 项目级技能正文（antd、pro-upgrade）—— 只有这一份
├── .claude/                 # 项目级技能的**指路存根**（给只扫 .claude/ 的宿主）
├── .github/                 # Issue/PR 模板 + CI workflows
├── .husky/                  # Git hooks（lint-staged / commitlint）
├── AGENTS.md                # ★ 唯一一份 agent 指引（CLAUDE.md 只留指路）
├── README.md                # 人看的门面：快速开始 + 目录索引
├── package.json             # 根聚合脚本（dev/test/lint/e2e 都从这儿进）
├── biome.json               # 唯一的 lint/格式化配置（无 ESLint、无 Prettier）
└── LICENSE / CODE_OF_CONDUCT.md / skills-lock.json / .gitignore / .dockerignore
```

> ⚠️ **依赖各装各的**：`frontend/` 与 `backend/ai/` 各有一套 `node_modules` ⇒
> **仓根没有 `node_modules`** ⇒ husky / lint-staged / commitlint 的二进制在
> `frontend/node_modules/.bin/` 里。

---

## 2. `frontend/` —— 前端

| 位置 | 内容 |
| ---- | ---- |
| `frontend/src/pages/` | 页面：`module_system/`（系统管理）· `module_pm/`（项目管理）· `ai/workspace/`（AI 工作台）· `dashboard/` · `account/` · 以及 Pro 模板示例页 |
| `frontend/src/components/` | 通用组件：`CrudTable/`（共享 CRUD 脚手架）· `ai-workspace/`（工作台组件族）· `pm/` · `RightContent/` 等 |
| `frontend/src/services/api/` | 服务层：`system/` · `pm/` · `ai/`（REST + SSE） |
| `frontend/src/locales/` | 8 种语言 |
| `frontend/config/` | `routes.ts`（路由表）· `config.ts` · `proxy.ts` · `defaultSettings.ts` |
| `frontend/mock/` | 本地 Mock（Express 风格） |
| `frontend/e2e/` | Playwright 端到端 |
| `frontend/tests/` | Vitest 全局 setup 与通用 mock |
| `frontend/cloudflare-worker/` | **独立的 Hono 应用**（演示用 Mock API，`wrangler.toml`）⇒ **不是**本仓主线部署路径，见 §6 |
| `frontend/public/` | 静态资源 |
| `frontend/scripts/` | 前端自己的辅助脚本（i18n 清理 / 模板裁剪） |

👉 细节看 [`../frontend/README.md`](../frontend/README.md)。

---

## 3. `backend/ai/` —— AI 服务（智能体）

| 位置 | 内容 |
| ---- | ---- |
| `backend/ai/src/core/` | ★ **内核**（只懂通用概念；**不 import 插件** ⇒ `scripts/check-core-purity.cjs` 有检查）：`session/`（会话与命令）· `gate/`（改数据要人点头）· `mcp/` · `skills/` · `context/`（讨论上下文的通用机制）· `plugins.ts`（插件契约 + 注册表） |
| `backend/ai/src/core/` | ★ **内核**（通用概念：命令机制 / 插件契约 / 智能体配置 / 身份契约）—— **不 import 插件**（`src/core/index.ts` = **公开入口**，说明见 `src/core/README.md`） |
| `backend/ai/src/plugins/pm/` | ★ **PM 业务插件**（`adapter/` 调 AiAdmin 的适配层：鉴权透传 / 字段映射 / 错误归一；`tools/` 命令目录） |
| `backend/ai/src/core/routes/` | HTTP 层（`agent.ts` / `events.ts` SSE / `pending.ts` / `audit.ts` / `contract.ts`） |
| `backend/ai/.pi/skills/` | ★ **技能**（`create-task` / `list-tasks` / `update-task`）—— 业务能力 = 加一个 markdown |
| `backend/ai/.pi/prompts/` | AI 服务自己的 pi 提示词 |
| `backend/ai/prisma/` | `ai_*` 元数据表与迁移（⚠️ 与 AiAdmin 业务表**同库**） |
| `backend/ai/docs/` | AI 服务自己的设计文档与 spike 记录 |
| `backend/ai/Dockerfile` | AI 服务镜像 |

👉 细节看 [`../backend/ai/README.md`](../backend/ai/README.md) 与 [`ai-architecture.md`](ai-architecture.md)。

---

## 4. `docs/` —— 文档

| 位置 | 内容 | 性质 |
| ---- | ---- | ---- |
| `docs/ai-architecture.md` | AI 架构（事件流 / 闸门 / 回放） | **现状** |
| `docs/directory-structure.md` | 本文件 | **现状** |
| `docs/process.md` | 开发流程（人提 issue → agent 开发 → 提 PR） | **事实源** |
| `docs/notes/` | 交接文档（上一棒做到哪、为什么这么定） | 交接 |
| `docs/pm/` | PM 调度层：`roadmap.md`（规划事实源）· `log.md`（决定与理由）· `drafts/`（开单草稿）· `README.md` | 排期 |
| `docs/superpowers/{specs,plans}/` | 设计与实现计划（大规模改造用） | 历史记录 |
| `docs/legacy/` | **上游 Ant Design Pro 的遗留**（已归档，不是本仓事实源） | 归档 |
| `docs/archive/` | **本仓写过但因决策搁置的**（如 M1 AIPM 规格与原型） | 归档 |

> ⚠️ **`legacy/` 与 `archive/` 别混**：
> `legacy/` = 上游带来的；`archive/` = 本仓自己的搁置物。两类都**只当背景，不作现行依据**。

---

## 5. `scripts/` —— 辅助脚本

| 位置 | 内容 |
| ---- | ---- |
| `scripts/agent/` | agent 工作流：`pick-next.cjs`（领活）· `merge-pr.cjs`（合并 + 删分支）· `worktree.cjs`（工作区管理）· `lib/exec.cjs` |
| `scripts/e2e/` | 端到端验收脚本（**入库**，`*.static.cjs` 只读文件断言 ⇒ 没 docker 也能跑） |
| `scripts/pm/` | PM 巡检（`check-queue.cjs`） |

---

## 6. 两条部署路径（**只定位，不合并**）

| 路径 | 定位 | 用法 |
| ---- | ---- | ---- |
| `docker/` | ★ **本仓主线**：前端静态（nginx）+ AI 服务两个容器 | `docker/deploy.sh`（默认只检查，`--yes` 才动手）· 手册见 [`../docker/README.md`](../docker/README.md) |
| `frontend/cloudflare-worker/` | 独立的 Hono 应用（演示用 Mock API），**有自己 `package.json`，不是 npm workspace** | `wrangler` 单独部署 |

⚠️ 两者**互不替代**，也不在本仓内合并。

---

## 7. 怎么核对「本文档与实际一致」

```bash
# ① 顶层清单（对照本文档 §1）
git ls-files | awk -F/ 'NF==1' | sort   # 顶层**文件**
ls -A | grep -v '^\.git$'               # 顶层**目录**（含未跟踪的本地目录）

# ② 关键目录的内容（对照 §2~§6）
ls docker .pi/prompts docs/pm scripts/agent scripts/e2e frontend/cloudflare-worker

# ③ 本文档点名的路径是否都还在（逐个验，缺一个就说明文档过期了）
for p in frontend backend/ai docker .pi/prompts docs/pm docs/notes docs/legacy docs/archive \
         scripts/agent scripts/e2e frontend/cloudflare-worker backend/ai/.pi/skills; do
  [ -e "$p" ] && echo "✓ $p" || echo "✗ 缺失 $p"
done
```

⇒ 改了目录结构 ⇒ **改完顺手跑一遍 ③**，不一致就更新本文件（别让文档漂移）。

---

## 8. 给新同学的三条实践要点

1. **加页面的顺序**：建 `frontend/src/pages/<component_path>/index.tsx` → `frontend/config/routes.ts` 注册路由
   → `frontend/src/services/api/<模块>/` 加 service → AiAdmin 后端菜单表补 `route_path` / `component_path`。
2. **不要动** `dist/`、`dist-dev/`、`frontend/src/.umi*`（Umi 自动生成）；**不要手改** `frontend/src/services/ant-design-pro/`（自动生成，`npx max openapi`）。
3. **技能正文只有一份**（`.agents/skills/`）⇒ 别在 `.claude/skills/` 里改正文（那是指路存根）。
