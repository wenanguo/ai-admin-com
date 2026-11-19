# 通用内核复用验收（读书笔记示例系统）（2026-11-19）

> 交接文档 —— **让下一棒（可能是另一个会话的 agent）接得上**。

## 目标

- **关联**：issue #116 · PR **#117**（**只开不合并**，等 PM 拍板）
- **一句话**：造一个**不依赖 AiAdmin** 的示例系统（读书笔记），证明内核换个业务系统照样能用；
  它**只从 `core/index.ts` 公开入口**接入内核（检查脚本钉死 + 进 CI），
  并有一条**可复跑的 e2e**（docker compose：内核 + 示例插件 + 示例自己的空库）。

## 状态

进行中（PR 已开，**等 PM 拍板** ⇒ 本次**不合并**）

> 2026-11-19 更新：PR #117 的 CI 有**两处失败** ⇒ 已按根因修掉（见下「CI 修复」）⇒ 推上去等 CI 重跑。

## 已完成

| 提交 | 做了什么 |
| ---- | -------- |
| `936201d` | `backend/ai/src/core/app.ts`：**内核的 HTTP 装配**（`createCoreApp` / `createCoreHealthRouter` / `assertCoreReady`）—— 公开入口原来缺这一块；`core/index.ts` 导出它；`src/server.ts` 改成薄壳（**行为不变**）+ 单测 |
| `a7f7db4` | `backend/ai/examples/reading-notes/`：示例系统（插件 / 智能体 YAML / compose / Dockerfile / README / 单测） |
| `d6ae93e` | `scripts/check-core-reuse.cjs`：三档检查（只用公开入口 / 不碰别的业务系统 / compose 里没有别的服务）⇒ 进 CI；`scripts/e2e/reuse-core-example.cjs`：真起 compose 验收（清单能列 / 身份自己认 / 会话建得出 / 命令真能调） |
| `eb22455` | `docs/how-to/reuse-core.md`：复用指南（拷内核 → 写插件 → 写 YAML → 装配）+ 短设计 + 本 note |

**下一步（具体到文件与命令）**：

```
PM 看完 PR ⇒ 拍板 ⇒ 合并（node scripts/agent/merge-pr.cjs <PR号> --yes）
合并后：issue #116 自动关闭（PR 里 Closes #116）⇒ 本 note 改成「已完成」+ 补 PR 号
```

## CI 修复（PR #117 的两处失败）

| # | 失败 | 根因 | 修法 |
| - | ---- | ---- | ---- |
| 1 | `docker ai` job：`静态断言（镜像配置）` 挂 —— 「健康检查挂在根路径 /health」 | 断言**只读 `backend/ai/src/server.ts`** 找 `app.use("/health"`；但 issue #116 把 HTTP 装配搬进了内核（`src/core/app.ts` 才有 `app.use("/health", …)`），`src/server.ts` 变成薄壳 ⇒ **断言读错了文件**（代码没错，断言错了） | `scripts/e2e/ai-container.static.cjs`：改成**挨个找「真正挂 /health 的那个文件」**（候选：`core/app.ts` → `server.ts`），任一命中即通过 ⇒ 装配再搬家也不用改断言。**没有**为了迁就断言把 `server.ts` 改回去 |
| 2 | `内核复用验收` job：`docker compose build` 挂在 `COPY --from=builder /app/dist ./dist` ⇒ `/app/dist: not found` | 示例的 `tsconfig.json` 里 `outDir: "./dist"` 是相对**它自己那份 tsconfig** 解析的（不是相对 WORKDIR）⇒ 产物实际落在 **`/app/examples/reading-notes/dist/`**，而 Dockerfile 拷的是 `/app/dist` ⇒ 路径对不上 | `backend/ai/examples/reading-notes/Dockerfile`：`COPY --from=builder /app/examples/reading-notes/dist ./dist`（**以 tsconfig 的真实产物目录为准**）⇒ 运行阶段仍是 `/app/dist/{examples/reading-notes/main.js, src/core/**}` ⇒ 与 `CMD ["node", "dist/examples/reading-notes/main.js"]` 对得上。**没有**改 tsconfig 的 outDir（那会让本地编译产物污染 `backend/ai/dist`） |

⚠️ 两处都是**「读错/写错同一个事实」**，不是功能 bug ⇒ **没碰内核行为、没碰示例逻辑**。

### 修完的本地证据（本机**没有** docker ⇒ 手动模拟 builder/runtime 两阶段）

```bash
# ① 静态断言（CI 同一条）
node scripts/e2e/ai-container.static.cjs      # ✓ 20 条全过（原来 19 过 1 挂）

# ② 模拟 builder 阶段（把 /app 的布局搭出来再跑 tsc）
#    ⇒ 产物落在 <示例目录>/dist/{examples/reading-notes/main.js, src/core/**}
#    ⇒ **/app/dist 不存在**（复现了 CI 的报错）
# ③ 模拟 runtime 阶段（把那个 dist 拷成 runtime 的 ./dist）
node dist/examples/reading-notes/main.js      # ⇒ 起得来
curl /health                                  # ⇒ 200（{"status":"degraded"}：本地没库）
curl -H "Authorization: Bearer demo-reader" /api/agents   # ⇒ 200，列出 notes
```

⇒ **修复后的产物布局在本地被真跑过**（不只是改对了一行路径）。

## 决策记录（★ 最值钱的部分）

| 决定 | 为什么 | 错了的代价 |
| ---- | ------ | ---------- |
| **把 HTTP 装配搬进内核**（新增 `core/app.ts`，`server.ts` 变薄壳） | 公开入口原来**缺「装好的服务」** ⇒ 外部系统只能拿零件、装不成服务 ⇒ 「可复用」是自说自话。装配本身**与业务无关**（探针从插件来 ⇒ 可注入） ⇒ 搬进内核不违反「内核不懂业务」 | 若不改内核、只在示例里重写一遍装配 ⇒ 装配逻辑两处 ⇒ 内核一改路由，示例静默失配；且「公开入口」名不副实 |
| **示例放在 `backend/ai/examples/reading-notes/`**（不是仓根 `examples/`） | 能直接复用本包的依赖与 prisma 客户端 ⇒ 示例只差「内核 + 插件 + YAML」三样；编译产物 `dist/examples/reading-notes/main.js` | 放仓根 ⇒ 要另起 package.json + lockfile + 再装一遍依赖 ⇒ CI 变慢、示例与内核版本漂移 |
| **示例的业务数据放内存**（`store.ts`） | 验收点是「内核能换系统用」，**不是**「示例的业务多完整」；真接业务时换成自己的数据源即可 | 若给示例也建业务表 ⇒ 要第二套 prisma schema + 第二个生成客户端 ⇒ 复杂度翻倍，且偏离验收点 |
| **示例的身份自己认 token**（`demo-` 开头 ⇒ 读者 1；其它 ⇒ 401） | 内核**不解析 token**（那是权威系统的事）⇒ 演示「自己的身份系统」；用内核的 `AgentError("AUTH_EXPIRED")` ⇒ 内核自己翻成 401（不改内核） | 若示例也去问 AiAdmin ⇒ 示例就依赖 AiAdmin ⇒ **验收点直接作废** |
| **内核的 `ai_*` 表住在示例自己的 MySQL**（compose 里的 `db`） | 验收标准要求「自己的空库」；也顺带证明内核的元数据表**不与业务系统同库**（`AI_DATABASE_URL` 那条设计） | 与 AiAdmin 共库 ⇒ 示例会碰到 AiAdmin 的库 ⇒ 依赖关系说不清 |
| **容器里跑 `prisma migrate deploy` 再启动**（示例镜像**带** prisma CLI） | 示例自己的空库第一次要有表；AiAdmin 那套镜像不带 CLI（迁移在部署脚本里做）⇒ **两者的取舍不同，不必一致** | 镜像大一点（prisma CLI ~50MB）——示例无所谓 |
| **e2e 分两段：有模型 key ⇒ 断言工具真被调；没 key ⇒ 只断言到「装配成功」** | 模型调用是**不确定的**（模型可能不调工具）⇒ 没 key 时硬断言会 flaky；验收标准也明确要求「没有 key 时也要能跑到装配成功这一步」 | 无 key 的 CI 里工具链没被端到端验过（但有单测 + 有 key 时的真跑） |
| **检查脚本分三档**（只用公开入口 / 不碰别的业务系统 / compose 里没有别的服务） | 「可复用」= 公开入口 + 无业务耦合 + 编排独立，三条都要**可执行**地钉住 | 只钉一条 ⇒ 另外两条靠人盯 ⇒ 迟早破 |
| **静态断言「找挂载点」而不是「钉死一个文件」**（`ai-container.static.cjs` 的 /health 那条） | 装配代码会搬家（`server.ts` → `core/app.ts`）⇒ 断言钉死**文件路径**就会误报；钉死**事实**（根路径 /health）才稳 | 改成「候选文件里任一命中即可」⇒ 少一次「代码搬了家 ⇒ 断言红了 ⇒ 又把代码搬回去」的往返 |
| **镜像产物的路径以「示例 tsconfig 的 `outDir`」为准**（Dockerfile 的 COPY 跟着改，不改 tsconfig） | `outDir` 相对**声明它的那份 tsconfig** 解析（不是相对 WORKDIR）⇒ 猜 `/app/dist` 必错；而把 outDir 改成 `../dist` 会让本地编译产物落进 `backend/ai/dist` ⇒ 污染主构建产物 | 改 tsconfig ⇒ 本地 `npm run build` 的产物目录被示例搅乱（两种产物混在一个 dist 里） |

## 怎么验

```bash
# ① 静态断言（不需要 docker，任何机器都能跑）
node scripts/check-core-reuse.cjs

# ② 内核单测 + 示例单测（backend/ai）
cd backend/ai && npm test          # 54 个文件 / 480 条
cd backend/ai && npm run typecheck

# ③ 端到端（要 docker）
MINIMAX_CN_API_KEY=你的key node scripts/e2e/reuse-core-example.cjs
#    没有 key 也能跑（只验到「装配成功」这一步）

# ④ 手工看一眼示例（本地，要自己有 MySQL）
cd backend/ai/examples/reading-notes && npx tsx main.ts
#    curl -H "Authorization: Bearer demo-reader" http://127.0.0.1:3200/api/agents
```

## 坑与提醒

- ⚠️ **cwd 相对**：内核按 `cwd/agents/` 找智能体配置、`cwd/.pi/skills/` 找技能
  ⇒ 示例**必须**在自己的目录下启动（容器里 `WORKDIR=/app` + `agents/` 也在那）。
- ⚠️ **公开入口是契约**：`core/index.ts` 的导出**改它 = 改对外契约** ⇒ 以后内核重构要先想「外部看得见吗」。
- ⚠️ **`docker compose config` 会把环境变量原样打出来**（模型 key！）⇒ 验收脚本里只用 `config --services`。
- ⚠️ **示例的 Dockerfile 构建上下文 = 仓根**（要拿 `backend/ai/src/core` 与 prisma schema）。
- ⚠️ **`backend/ai/vitest.config.ts` 的 include 加了 `examples/**`** ⇒ 否则示例单测不会跑。
- ⚠️ 本机**没有 docker** ⇒ 容器级 e2e 只能靠 CI 跑（本地只跑得动静态断言与单测）。
- ⚠️ **`outDir` 相对「声明它的那份 tsconfig」解析**（不是相对 WORKDIR / cwd）
  ⇒ 示例的 `examples/reading-notes/tsconfig.json` 里 `outDir: "./dist"` ⇒ 产物在
  `examples/reading-notes/dist/`（**不是** `backend/ai/dist/`）⇒ Dockerfile 的 COPY 路径要跟这个走。
- ⚠️ **Dockerfile 里「产物路径」是三段对不上的**：builder 的 WORKDIR + tsconfig 的 outDir + COPY 的源路径
  ⇒ 改任一段都要三段一起对（这次就是 WORKDIR=`/app`、outDir=`/app/examples/reading-notes/dist`、COPY 源=后者）。
