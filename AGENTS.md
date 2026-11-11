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

## AI Skills

This project ships with two built-in Claude Code Skills (`.claude/skills/`). If you already have these skills in your project, no installation is needed — just run them directly. To update to the latest skill definitions, run `npx skills add ant-design/ant-design-pro`.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

---
