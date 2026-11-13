# CLAUDE.md

## Project

**AiAdmin monorepo** —— 两部分：

| 目录 | 是什么 | 技术栈 |
| ---- | ------ | ------ |
| `frontend/` | 前端（管理后台） | Umi Max 4 · React 19 · antd 6 · ProComponents 3 |
| `backend/ai/` | AI 服务（智能体） | Express 5 · `@earendil-works/pi-coding-agent`（pi SDK）· Prisma |

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

⚠️ pi SDK 是 **ESM-only** ⇒ AI 服务的产物必须是 ESM。
⚠️ AI 服务依赖 **cwd 相对**的 `.pi/skills` 与 `.ai/auth.json` ⇒ 必须在 `backend/ai/` 下启动。

## Critical Rules

- **Never edit `src/services/ant-design-pro/`** — auto-generated, regenerate with `npx max openapi`
- **Biome only** — no ESLint, no Prettier. Both `npm run lint` and `npx antd lint ./src` must pass before commit
- **Always `npx antd info <Component>` before writing antd code** — don't guess APIs from memory
- **`npm run simple` is irreversible** — always commit/branch first
- **Conventional commits** required (commitlint enforced)
- **TypeScript strict** · **Node ≥ 22** · **`package-lock.json`** (not yarn/pnpm)
- **`.umi` dir is auto-generated** — delete `src/.umi` and restart if dev server acts up
- **技能（`backend/ai/.pi/skills/**`）是提示词** ⇒ 它进模型上下文 ⇒ 走 git 评审，别写凭据

## Architecture Essentials

### 前端（`frontend/`）

**Config**: `config/config.ts` (defineConfig), `config/routes.ts` (declarative routes). Route `name` → `menu.xxx` i18n key; `access` field gates visibility.

**Convention files** (`src/`): `app.tsx` (runtime config + `getInitialState`), `access.ts` (permissions), `global.tsx` (side effects), `loading.tsx`, `typings.d.ts`.

**Auth**: `getInitialState()` → `GET /api/currentUser`; 401 → redirect login. `access.ts`: `canAdmin = currentUser.access === 'admin'`. Mock creds: `admin`/`ant.design` or `user`/`ant.design`.

**State**: `useModel('filename')` for global hooks (`src/models/`). `useModel('@@initialState')` for currentUser/settings. ProTable `request` prop for most data loading. `@tanstack/react-query` for complex server state.

**Styling priority**: Tailwind CSS v4 (layout) → antd-style v4 / `createStyles` (theme tokens) → CSS Modules → Less (legacy only).

**Request**: built-in `request` from `@umijs/max`, configured in `src/requestErrorConfig.ts`. Per-page `service.ts` for non-generated APIs.

**i18n**: 8 locales in `src/locales/`. `useIntl().formatMessage({ id, defaultMessage })`.

**Mock**: `mock/` (global) + `src/pages/**/_mock.ts` (co-located). Express-style handlers.

**Cloudflare Worker**: `frontend/cloudflare-worker/` — separate Hono app, own `package.json`, not an npm workspace.

### AI 服务（`backend/ai/`）

**内核**（`src/agent/`）：`pi-session.ts`（建 pi 会话：挂 MCP 扩展 + 闸门 + 技能段）·
`runtime.ts`（会话/命令/事件流）· `gate.ts`（改数据要人点头）· `mcp.ts`（AiAdmin MCP 服务器，带用户 JWT）·
`skills.ts` / `skill-tools.ts`（技能提示词段 + `load_skill`）· `session-entries.ts`（历史 → pi entries）·
`event-mapper.ts`（pi 事件 → SSE 事件）· `frame-buffer.ts`（回放窗口）

**HTTP**（`src/routes/`）：`agent.ts`（会话/命令/approve|reject/事件流）· `events.ts`（SSE）·
`pending.ts` · `audit.ts` · `contract.ts`（9 个端点的行为契约表）

**两条主线**：
- **工具来自后端 MCP**（`AIADMIN_MCP_URL`）⇒ 后端加接口，AI 侧不用改代码；
- **技能（`.pi/skills/*/SKILL.md`）教模型怎么用** ⇒ 加一条能力 = 加一个 markdown。

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

\工作区已存在：D:projectai-admin-com-worktreesdev
补做：
  · frontend/node_modules 已是链接/目录 ⇒ 跳过
  · backend/ai/node_modules 已是链接/目录 ⇒ 跳过
  · 生成前端类型（max setup）…
  · max setup 退出码非 0，但类型已生成 ⇒ 视为成功
工作区：
  · D:/project/ai-admin-com  [main] （主 checkout）
  · D:/project/ai-admin-com-worktrees/dev  [agent/dev] 

规矩：一个 agent 一个工作区（别共用主 checkout）
  · 已摘掉 junction：frontend/node_modules
  · 已摘掉 junction：backend/ai/node_modules
- 目录在**仓库外**（仓库内的 .worktrees/ 被另一个 agent 删过）
- **名字带角色前缀**（开发 agent ⇒ agent-dev；PM 调度 agent ⇒ agent-pm）⇒ 不会撞车
- 脚本会接好 node_modules（junction）并生成前端类型（max setup）⇒ 新工作区立刻能跑测试
- 合并在**主 checkout** 里跑（merge-pr.cjs 常驻 main）

## AI Skills

This project ships with two built-in Claude Code Skills (`.claude/skills/`). If you already have these skills in your project, no installation is needed — just run them directly. To update to the latest skill definitions, run `npx skills add ant-design/ant-design-pro`.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

---
