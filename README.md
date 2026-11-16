# ai-admin-com

> AiAdmin 的 **monorepo**：前端（Umi + React 19 + antd 6） + AI 服务（Express + pi SDK）。
>
> **AiAdmin 后端（FastAPI）不在这个仓里** —— 它是独立项目，通过 HTTP / MCP 与这里的服务对话。

```
ai-admin-com/
├── frontend/                 前端（Umi Max 4 + React 19 + antd 6 + ProComponents 3）
│   ├── src/                  页面、组件、服务层
│   ├── config/               路由（config/routes.ts）、代理（config/proxy.ts）
│   ├── e2e/                  Playwright 端到端
│   └── package.json
│
└── backend/
    └── ai/                   AI 服务（Express + @earendil-works/pi-coding-agent）
        ├── src/agent/         ★ 智能体内核（pi 会话、MCP、闸门、技能）
        ├── src/routes/        HTTP 层（Express）
        ├── .pi/skills/        ★ 技能（业务同学写 markdown 就能加 AI 能力）
        ├── prisma/            ai_* 元数据表
        └── package.json
```

---

## 快速开始

```bash
# 前端（8000）
cd frontend && npm install && npm run dev

# AI 服务（3100）
cd backend/ai && npm install && npm run dev
```

或者用根目录的聚合脚本：

```bash
npm run dev:frontend     # 前端
npm run dev:ai           # AI 服务
npm run test             # 两个仓的测试
npm run lint             # 前端 lint（biome + tsc）
```

⚠️ **依赖各装各的**（前端与 AI 服务是两套 npm 依赖）⇒ 根目录**没有** `node_modules` ⇒
husky / lint-staged / commitlint 都用 `frontend/node_modules/.bin/` 里的二进制。

---

## 目录索引（新人 5 分钟版）

| 顶层位置 | 是干什么的 |
| -------- | ---------- |
| `frontend/` | ★ 前端：页面、组件、服务层、路由、i18n、Mock、Playwright e2e（细节见 [`frontend/README.md`](frontend/README.md)） |
| `backend/ai/` | ★ AI 服务：pi 智能体内核、MCP 客户端、待确认闸门、技能、Prisma 元数据表（细节见 [`backend/ai/README.md`](backend/ai/README.md)） |
| `docker/` | ★ **本仓主线的部署路径**：前端静态（nginx）+ AI 服务两个容器；`deploy.sh` 默认只检查、`--yes` 才动手（手册见 [`docker/README.md`](docker/README.md)） |
| `docs/` | 文档总目录：现状（`ai-architecture.md`、`directory-structure.md`）· 流程（`process.md`）· 交接（`notes/`）· 排期（`pm/`）· 归档（`legacy/`、`archive/`） |
| `scripts/` | 辅助脚本：`agent/`（领活 · 合并 · 工作区）· `e2e/`（**入库的**端到端验收脚本）· `pm/`（巡检） |
| `.pi/` | pi 宿主配置：`prompts/pm.md`（PM 调度角色）· `prompts/dev.md`（开发角色） |
| `.agents/` | ★ **项目级技能正文**（`antd`、`pro-upgrade`）—— **只有这一份** |
| `.claude/` | 项目级技能的**指路存根**（给只扫 `.claude/` 的宿主；别在这里改正文） |
| `.github/` | Issue / PR 模板 + CI workflows（lint · 单测 · e2e · 镜像构建 · PR 正文检查） |
| `AGENTS.md` | ★ **唯一一份 agent 指引**（项目结构 · 命令 · 硬规矩 · PM 调度层 · 工作区隔离）；`CLAUDE.md` 只留指路 |
| `package.json` | 根聚合脚本（`dev:*` / `test` / `lint` / `build` / `e2e:*`） |
| `biome.json` | 唯一的 lint / 格式化配置（**没有 ESLint、没有 Prettier**） |

### 归档区（内容还在，但不是现行依据）

| 位置 | 是什么 |
| ---- | ------ |
| [`docs/legacy/ant-design-pro/`](docs/legacy/ant-design-pro/) | **上游 Ant Design Pro 的遗留**（README、cheatsheet、第三方声明、升级计划）—— 不是本仓事实源 |
| [`docs/archive/aipm/`](docs/archive/aipm/) | **本仓写过但搁置的** M1「AIPM 命令层」规格与原型（人 2026-11-14 定搁置） |

> 两类归档**别混**：前者是上游带来的，后者是本仓自己的决定。

### 两条部署路径（**只定位，不合并**）

- ★ `docker/` —— **本仓主线**（前端静态 + AI 服务两个容器）。
- `frontend/cloudflare-worker/` —— 独立的 Hono 应用（演示用 Mock API，有自己的 `package.json`，**不是** npm workspace）。

---

## 两部分怎么配合

```
浏览器 ──► frontend（8000）
              │  /api/**        → AiAdmin 后端（FastAPI，独立项目）
              │  /ai-api/**     → backend/ai（3100）
              ▼
        backend/ai（Express + pi）
              │  MCP（streamable HTTP）→ AiAdmin 后端的 MCP 端点
              ▼
        AiAdmin（FastAPI）—— 权威身份、权限码、业务事实源
```

- **AI 服务的工具来源是 AiAdmin 的 MCP 端点**（`AIADMIN_MCP_URL`）⇒
  **后端加接口，AI 侧不用改代码**。
- **技能（`.pi/skills/*/SKILL.md`）教模型怎么用这些工具** ⇒
  **加一条能力 = 加一个 markdown**（业务同学自己写）。
- 两者都在 `backend/ai/README.md` 与 `docs/ai-architecture.md` 里细说。

---

## 常用命令

| 命令 | 作用 |
| ---- | ---- |
| `npm run dev:frontend` | 起前端（8000） |
| `npm run dev:ai` | 起 AI 服务（3100） |
| `npm run test` | 两个仓的测试 |
| `npm run lint` | 前端 lint（biome + tsc） |
| `npm run e2e` | 前端端到端（playwright） |
| `npm run build` | 两个都构建 |

---

## 文档

| 位置 | 内容 |
| ---- | ---- |
| `AGENTS.md` | ★ agent 指引（唯一一份） |
| `docs/process.md` | 开发流程（人提 issue → agent 开发 → 提 PR） |
| `docs/notes/` | 交接文档（上一棒做到哪、为什么这么定） |
| `docs/directory-structure.md` | 目录结构总览（附核对命令） |
| `docs/ai-architecture.md` | AI 架构：事件流、快照/回放、闸门、验收记录 |
| `frontend/README.md` | 前端自己的说明（模块清单、菜单约定、接口约定） |
| `backend/ai/README.md` | AI 服务：MCP、技能、待确认闸门 |
| `docs/pm/` | 排期与决定（`roadmap.md` · `log.md`） |
| `docs/superpowers/{specs,plans}/` | 设计与实现计划 |

---

## 两条硬规矩

1. **技能是提示词** ⇒ `.pi/skills/**` 里的内容会进模型上下文 ⇒ 走 git 评审，别写凭据。
2. **改已有数据要人点头** ⇒ `update_*` / `patch_*` 类的工具会被闸门拦下，等人在界面上点「同意」。
