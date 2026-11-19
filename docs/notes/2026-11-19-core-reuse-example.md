# 通用内核复用验收（读书笔记示例系统）（2026-11-19）

> 交接文档 —— **让下一棒（可能是另一个会话的 agent）接得上**。

## 目标

- **关联**：issue #116 · PR **#117**（**只开不合并**，等 PM 拍板）
- **一句话**：造一个**不依赖 AiAdmin** 的示例系统（读书笔记），证明内核换个业务系统照样能用；
  它**只从 `core/index.ts` 公开入口**接入内核（检查脚本钉死 + 进 CI），
  并有一条**可复跑的 e2e**（docker compose：内核 + 示例插件 + 示例自己的空库）。

## 状态

进行中（PR 已开，**等 PM 拍板** ⇒ 本次**不合并**）

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

## 怎么验

```bash
# ① 静态断言（不需要 docker，任何机器都能跑）
node scripts/check-core-reuse.cjs

# ② 内核单测 + 示例单测（backend/ai）
cd backend/ai && npm test          # 53 个文件 / 476 条
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
