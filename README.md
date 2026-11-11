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
| `frontend/README.md` | 前端自己的说明（模块清单、菜单约定、接口约定） |
| `backend/ai/README.md` | AI 服务：MCP、技能、待确认闸门 |
| `docs/ai-architecture.md` | AI 架构：事件流、快照/回放、闸门、验收记录 |
| `docs/directory-structure.md` | 目录结构总览 |
| `docs/superpowers/{specs,plans}/` | 设计与实现计划 |

---

## 两条硬规矩

1. **技能是提示词** ⇒ `.pi/skills/**` 里的内容会进模型上下文 ⇒ 走 git 评审，别写凭据。
2. **改已有数据要人点头** ⇒ `update_*` / `patch_*` 类的工具会被闸门拦下，等人在界面上点「同意」。
