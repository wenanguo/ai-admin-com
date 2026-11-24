# AGENTS.md

> ⚠️ **本文件是本仓唯一的一份 agent 指引**（`CLAUDE.md` 只留一行指路，**不含任何正文**）
> ⇒ 改指引**只改这里**，别再维护第二份。

## Project

**AiAdmin monorepo** —— 两部分：

| 目录 | 是什么 | 技术栈 |
| ---- | ------ | ------ |
| `frontend/` | 前端（管理后台） | Umi Max 4 · React 19 · antd 6 · ProComponents 3 |
| `backend/ai/` | AI 服务（智能体） | Express 5 · **DeepSeek Harness（dsh）** · Prisma |

⚠️ **AiAdmin 后端（FastAPI）不在这个仓里** —— 独立项目，通过 HTTP / MCP 对话。
⚠️ **依赖各装各的**（两套 npm）⇒ 根目录**没有** node_modules ⇒
husky / lint-staged / commitlint 都用 `frontend/node_modules/.bin/` 里的二进制。

## Workflow（★ 干活前先看这里）

**完整流程见 [`docs/process.md`](docs/process.md)** —— 「人提 issue → agent 开发 → 提 PR」。

硬规矩：

1. **不直落 main** ⇒ 一个 issue 一个分支（`feat/<短号>-<关键词>`），完工提 PR。
2. **接手的会话先读 [`docs/notes/`](docs/notes/)** —— 上一棒做到哪、**为什么这么定**。
   做一条就更新对应的 note（模板：`docs/notes/TEMPLATE.md`）。
3. **规模分级**（`docs/process.md` §3）：小改动不写设计文档；大改造才写 spec + plan。
4. **改动要有测试**；端到端行为要有**入库的**验收脚本（`scripts/e2e/`）。
5. **AiAdmin（FastAPI）是另一个仓** ⇒ 改它要单独提 PR 到那个仓。

## Commands

**根目录（聚合）**：`npm run dev:frontend` · `npm run dev:ai` · `npm run test` ·
`npm run lint` · `npm run build` · `npm run e2e`

**前端（cd frontend）**：`npm start`（dev+mock）· `npm run dev`（真实后端）·
`npm run build`（utoopack）· `npm run lint`（Biome+tsc）· `npm run test`（Vitest）·
`npx antd lint ./src` · `npm run simple`（**不可逆**）

**AI 服务（cd backend/ai）**：`npm run dev`（tsx watch，3100）· `npm run build`（tsc → ESM）·
`npm start` · `npm test`（Vitest）· `npm run typecheck`

⚠️ AI 服务是 **ESM-only** ⇒ 产物必须是 ESM。
⚠️ AI 服务依赖 **cwd 相对**的 `.pi/skills` ⇒ 必须在 `backend/ai/` 下启动。

## Critical Rules

- **Never edit `src/services/ant-design-pro/`** — auto-generated, regenerate with `npx max openapi`
- **Biome only** — no ESLint, no Prettier. Both `npm run lint` and `npx antd lint ./src` must pass before commit
- **Always `npx antd info <Component>` before writing antd code** — don't guess APIs from memory
- **`npm run simple` is irreversible** — always commit/branch first
- **Conventional commits** required (commitlint enforced)
- **TypeScript strict** · **Node ≥ 24.9**（`node -v` 要 ≥ v24.9.0 · 起因：`@deepseek-ai/dsh` 的 engines 要求）· **`package-lock.json`** (not yarn/pnpm)
- **`.umi` dir is auto-generated** — delete `src/.umi` and restart if dev server acts up
- **技能（`backend/ai/.pi/skills/**`）是提示词** ⇒ 它进模型上下文 ⇒ 走 git 评审，别写凭据
- ⚠️ **服务里不许有 pi**（issue #123）⇒ 依赖清单 / 源码都不许出现 `@earendil-works/pi-*`
  ⇒ 守卫：`node scripts/check-dsh-boundary.cjs` 与 `node scripts/e2e/dispatch-dsh.static.cjs`

## Architecture Essentials

### 前端（`frontend/`）

**Config**: `config/config.ts` (defineConfig), `config/routes.ts` (declarative routes). Route `name` → `menu.xxx` i18n key; `access` field gates visibility.

**Convention files** (`src/`): `app.tsx` (runtime config + `getInitialState`), `access.ts` (permissions), `global.tsx` (side effects), `loading.tsx`, `typings.d.ts`.

**Auth**: `getInitialState()` → `GET /api/currentUser`; 401 → redirect login. `access.ts`: `canAdmin = Boolean(currentUser?.is_superuser)`（⚠️ **真后端的字段名是 `is_superuser`** ⇒ `access === 'admin'` 只是 **mock** 的形状，别拿它判权限）。Mock creds: `admin`/`ant.design` or `user`/`ant.design`.

**State**: `useModel('filename')` for global hooks (`src/models/`). `useModel('@@initialState')` for currentUser/settings. ProTable `request` prop for most data loading. `@tanstack/react-query` for complex server state.

**Styling priority**: Tailwind CSS v4 (layout) → antd-style v4 / `createStyles` (theme tokens) → CSS Modules → Less (legacy only).

**Request**: built-in `request` from `@umijs/max`, configured in `src/requestErrorConfig.ts`. Per-page `service.ts` for non-generated APIs.

**i18n**: 8 locales in `src/locales/`. `useIntl().formatMessage({ id, defaultMessage })`.

**Mock**: `mock/` (global) + `src/pages/**/_mock.ts` (co-located). Express-style handlers.

**Cloudflare Worker**: `frontend/cloudflare-worker/` — separate Hono app, own `package.json`, not an npm workspace.

### AI 服务（`backend/ai/`）

**内核**（`src/core/`，**不 import 插件** ⇒ `node scripts/check-core-purity.cjs` 有检查）：
`session/`（`runtime.ts` 会话/命令/事件流 · `agent-event.ts` **我们自己的事件词汇** ·
`event-mapper.ts` 事件 → SSE 事件 · `frame-buffer.ts` 回放窗口 · `session-registry.ts` 通道）·
`adapter/dsh/`（**执行层**：dsh 运行时子进程 + 事件翻译 + 闸门接线）·
`gate/gate.ts` + `gate/decision.ts`（改数据要人点头；**口径只有一份**）·
`mcp/mcp.ts`（AiAdmin MCP 服务器，带用户 JWT）·
`skills/`（**技能清单**；发现与加载**退给 dsh** ⇒ 我们只给目录）· `context/anchor.ts`（讨论上下文的通用机制）· `plugins.ts`（插件契约 + 注册表）

**业务插件**（`src/plugins/pm/`）：PM 的适配层 / 命令目录 / 讨论上下文 ⇒ **业务概念都归它**；
入口 `src/plugins.ts` 是**唯一 import 插件的地方**。

**HTTP**（`src/core/routes/`）：`agent.ts`（会话/命令/approve|reject/事件流）· `events.ts`（SSE）·
`pending.ts` · `audit.ts` · `contract.ts`（9 个端点的行为契约表）

**两条主线**：
- **工具来自后端 MCP**（`AIADMIN_MCP_URL`）⇒ 后端加接口，AI 侧不用改代码；
- **技能（`.pi/skills/*/SKILL.md`）教模型怎么用** ⇒ 加一条能力 = 加一个 markdown。

**内核可复用**：`backend/ai/src/core/index.ts` 是**唯一公开入口**（外部只从这里 import）。
⇒ 示例系统：[`backend/ai/examples/reading-notes/`](backend/ai/examples/reading-notes/)
（读书笔记，**不依赖 AiAdmin**）· 指南：[`docs/how-to/reuse-core.md`](docs/how-to/reuse-core.md)
⇒ 钉它的检查：`node scripts/check-core-reuse.cjs`（只用公开入口 / 不碰别的业务系统）。

**闸门口径**：**新增放行、修改要点头**（`update_*` / `patch_*` 会被拦下等人在界面点「同意」）。

## PM 调度层（可选角色）

本仓除了「开发 agent」外，还有一个 **PM 调度角色**（人 ↔ PM ↔ GitHub ↔ 开发 agent）。

**何时进入 PM 模式**：用户说「排期 / 里程碑 / 今天做什么 / 建个 issue / 现在到哪了」。

| 角色 | 干什么 | 不干什么 |
| ---- | ------ | -------- |
| **人** | 说需求 · 拍板排期 · review 高风险 PR | 手写 issue 正文（PM 写） |
| **PM 调度 agent** | 沟通 · 拆需求 · 排版本/能力块 · 写 milestone + issue · 维护 `docs/pm/` · 抽查高风险 PR | ❌ 写产品代码 ❌ 合并 PR |
| **开发 agent** | 领 issue · 设计/实现/自审 · 提 PR · 测试 · 合并 · 关 issue · 删分支 · **自动领下一条** | 决定排期 · 自造需求 |

**开发 agent 的自动续做**：做完一条且收尾干净后，若 `ready` 队列里还有、依赖已满足、且**不是高风险四类**，
就**直接领下一条继续干**（不用每次问人）。必停：高风险四类 / 队列空 / 超范围 / 卡住 / 本 milestone 做完。
详见 `.pi/prompts/dev.md` §⑨。**人掌握「做什么」** ⇒ PM 往 `ready` 里放什么，它就能做什么。

**判定规则**：说「领 #12 去做」⇒ **开发模式**（角色不变）；说「今天排什么」⇒ **PM 模式**。

**PM 是唯一对外接口（2026-11-17 起）**：

- **人只跟 PM 说需求** ⇒ PM 建 issue、**派活**给开发 agent（headless 子会话）、收结果、汇总给��。
- 开发 agent **不再由人直接启动** ⇒ 人不需要「领 #xx 去做」；需要人拍板的事（高风险 PR、设计 review、需求变更）
  由 **PM 去找人**。
- 派活脚本：`node scripts/agent/dispatch.cjs --issue <号> [--no-merge]`；看进度 `--status`；收结果 `--collect`。

**两个角色的命令**：

| 角色 | 命令 | 干什么 |
| ---- | ---- | ------ |
| PM 调度 | `/pm` | 读排期 → 报状态 → 给候选 → 等拍板 → 建/改 milestone 与 issue |
| 开发 agent | `/dev` | 领活 → 实现 → 测试 → PR → 合并 → 关 issue → 删分支 |

**领活**：`node scripts/agent/pick-next.cjs --claim`（挑 `ready` 里依赖已合并的那一条；`--issue <号>` 指定）。
**状态看板**：`ready` = 可领 · `in-progress` = 在途 · `agent-task` = 给 agent 的活。

**PM 模式的动作**：读 `docs/pm/README.md` → `docs/pm/roadmap.md` → `docs/pm/log.md` 末尾，
查 GitHub 现状，报状态 + 给 3~5 条候选，**等用户拍板**后才建/改 milestone 与 issue。
唤醒命令：`/pm`（pi 项目级 prompt 模板 `.pi/prompts/pm.md`）。

## agent 工作区隔离（worktree）

**一个 agent 一个工作区**，别共用同一个 checkout（实测：共用会互相切分支、互相带文件进提交）。

- 目录在**仓库外**（仓库内的 .worktrees/ 被另一个 agent 删过）
- **名字带角色前缀**（开发 agent ⇒ agent-dev；PM 调度 agent ⇒ agent-pm）⇒ 不会撞车
- 脚本会接好 node_modules（junction）并生成前端类型（max setup）⇒ 新工作区立刻能跑测试
- 合并在**主 checkout** 里跑（merge-pr.cjs 常驻 main）
- 管理脚本：`node scripts/agent/worktree.cjs list|add|remove`

工作区当前位置（示例，**别照抄**，用 `git worktree list` 自己查）：

| 目录 | 分支 | 用途 |
| ---- | ---- | ---- |
| `D:/project/ai-admin-com` | `main` | 主 checkout（**合并脚本常驻这里**） |
| `D:/project/ai-admin-com-worktrees/<角色>-<名字>` | `agent/<角色>-<名字>` | 每个 agent 自己的工作区 |

## AI Skills

本仓带两个项目级技能（`antd`、`pro-upgrade`）⇒ **正文只有一份**，在 [`.agents/skills/`](.agents/skills/)
（Agent Skills 标准位置 ⇒ pi / Claude Code / Codex 等宿主都能发现）：

| 技能 | 正文 |
| ---- | ---- |
| `antd` | [`.agents/skills/antd/SKILL.md`](.agents/skills/antd/SKILL.md) |
| `pro-upgrade` | [`.agents/skills/pro-upgrade/SKILL.md`](.agents/skills/pro-upgrade/SKILL.md) |

⚠️ `.claude/skills/<name>/SKILL.md` 是**指路存根**（给只认 `.claude/` 的宿主用）⇒ **不要在那里改正文**。
升级技能定义：`npx skills add ant-design/ant-design-pro`（装到 `.claude/` 的那份是工具产物，别手改）。

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

---
