# 项目目录结构清理（2026-11-16）

> 交接文档 —— 关联 issue **#55**。

## 目标

- **关联**：issue #55 · PR _（待填）_
- **一句话**：把仓库整理成「一处一个真相」—— 指引只留一份、上游 Ant Design Pro 遗留全部归档、现状文档与实际目录一致。

## 状态

进行中（实现已完成，待 PR / 合并）

## 短设计（规模：中 ⇒ 按 `docs/process.md` §3 写短设计，不写 spec/plan）

**要动的五块 + 一条贯穿原则**：

| 块 | 做法 | 为什么这么定 |
| -- | ---- | ------------ |
| ① 指引去重 | **`AGENTS.md` = 唯一完整的一份**；`CLAUDE.md` 变成**纯指路**（零章节） | 两个宿主（pi / Claude Code）都可能读指引 ⇒ 指路那份必须**不含任何独有段落**，否则又会漂移 |
| ② 上游 Pro 遗留 | `git mv` 到 `docs/legacy/ant-design-pro/` + `docs/legacy/README.md` 索引 | **归档优先于删除**（PM 明确要求）；归档后根 README 一行指路 |
| ③ 上游 roadmap 拷贝 | 同上归档；`docs/pm/roadmap.md` 的补丁改成「已归档，勿再引用」 | 补丁里的路径会失效 ⇒ 一起改 |
| ④ `docs/aipm/` | `git mv` 到 `docs/archive/aipm/` + `docs/archive/README.md` 写清**为什么归档** | M1 已搁置（人 2026-11-14 定）⇒ 规格/原型不作现行依据，但**不许凭空消失** |
| ⑤ 现状文档 | 重写 `docs/directory-structure.md`（现在是 monorepo 之前的**前端**结构，已整体过期）+ 给**核对命令**；根 `README.md` 加目录索引 + 两条部署路径定位 | 文档要能被一条命令验证，才不会再次漂移 |
| ⑥ skills | `.agents/skills/` = 唯一正文；`.claude/skills/<name>/SKILL.md` 改成**指路存根** | `.agents/` 是 Agent Skills 标准位置（pi / Codex 等宿主直接认）⇒ 正文放这里 |

**贯穿原则**：**归档 = 移动 + 留指路**，任何被移走的东西都要在原处留下一句话说明去哪了。

### ⚠️ 一处与「不做」栏的冲突（已按最小改动处理，需 reviewer 知情）

`docs/cheatsheet.{en-US,zh-CN}.md` **不是死文档，是前端构建输入**：
`frontend/src/pages/Welcome.tsx` 直接 `import` 它们，`docker/web/Dockerfile` 也 `COPY` 它们。
⇒ 归档它们必然要同步改 4 处**纯路径**：

1. `frontend/src/pages/Welcome.tsx` 的 2 行 import
2. `docker/web/Dockerfile` 的 `COPY` 行（+ 注释）
3. `.dockerignore` 的注释
4. `scripts/e2e/web-container.static.cjs` 的静态断言（它断言的正是那行 `COPY`）

**行为零变化**（同一个文件、同一段内容，只是路径变了）。不改这 4 处 ⇒ 归档即**打断构建**。
⇒ 选择：**改这 4 处路径**，并在 PR 正文里点名说明。

## 已完成

| 提交 | 做了什么 |
| ---- | -------- |
| `2c23375` | 指引去重：`CLAUDE.md` 收敛为纯指路（零章节）；`AGENTS.md` 标题订正 + 清掉被运行日志污染的「工作区隔离」一节 + 补工作区位置表；AI Skills 一节改指 `.agents/skills/` |
| `d8f3a9c` | 归档上游 Pro 遗留 → `docs/legacy/ant-design-pro/`（7 个文件，`git mv`）+ `docs/legacy/README.md` 索引；cheatsheet 是构建输入 ⇒ 同步改 4 处纯路径；`docs/pm/roadmap.md` 补丁改「已归档，勿再引用」 |
| `ab4ef38` | 归档 `docs/aipm/` → `docs/archive/aipm/`（29 个文件）+ `docs/archive/README.md`（为什么归档 + 怎么捡回来）；失效引用改指归档路径 |
| `0128645` | 技能收敛为一份：`.claude/skills/<name>/SKILL.md` 改成指路存根 + `.claude/skills/README.md` |
| `d0449de` | 重写 `docs/directory-structure.md`（原文是 monorepo 之前的单仓树）+ §7 核对命令 |
| `2ad7294` | 根 `README.md` 加目录索引 + 归档区指路 + 两条部署路径定位 |
| `507f704` | `docs/ai-architecture.md` 定点对齐（服务位置 / 框架 / 文件索引） |
| `（本次）` | `docker/web/Dockerfile` 注释里的 cheatsheet 路径同步 |

**验证结果（2026-11-16，本工作区实跑）**：

| 命令 | 结果 |
| ---- | ---- |
| `npm run lint`（frontend：biome + tsc） | ✅ exit 0 |
| `npm run test`（frontend） | ✅ 68 文件 / 584 用例 |
| `npm run test`（backend/ai） | ✅ 37 文件 / 347 用例 |
| `npm run test:agent` | ✅ 10 用例 |
| `cd frontend && npm run build` | ✅ 成功（cheatsheet 移动后仍能解析） |
| `node scripts/e2e/web-container.static.cjs` | ✅ 14 条 |
| `node scripts/e2e/compose.static.cjs` | ✅ 17 条 |
| `node scripts/e2e/ai-container.static.cjs` | ✅ 15 条 |

⚠️ **环境坑（下次别踩）**：工作区里的 `node_modules` 若是 **MSYS 软链**（`/d/project/...`），
原生 node / utoopack 解析不了 ⇒ 报 `Symlink frontend/node_modules could not be resolved`。
⇒ 用 **Windows junction**（`New-Item -ItemType Junction`）或直接 `npm ci` 装一份真的。

**下一步（具体到文件与命令）**：

```bash
# ① 全绿（前端 lint + 两个仓的测试）
npm run lint && npm run test

# ② 静态验收脚本（不用 docker）
node scripts/e2e/web-container.static.cjs
node scripts/e2e/compose.static.cjs

# ③ 前端构建必须过（cheatsheet 的 import 路径改过 ⇒ 这条最关键）
cd frontend && npm run build

# ④ 更新本 note（补 PR 号）→ 提 PR
```

## 决策记录

| 决定 | 为什么 | 错了的代价 |
| ---- | ------ | ---------- |
| `AGENTS.md` 当唯一完整指引，`CLAUDE.md` 降级为纯指路 | `AGENTS.md` 已经多出「PM 调度层」「agent 工作区隔离」两节（`CLAUDE.md` 没有）⇒ 完整版天然是它；指路那份零章节 ⇒ 结构上不可能再漂移 | 若选 `CLAUDE.md` 当完整版 ⇒ 要把两节搬过去，且 pi 宿主（读 `AGENTS.md`）会读到空文件 ⇒ 反而更容易漏规则 |
| 归档而不是删除 | PM 明确「归档优先于删除」；上游文档里的信息（如 `THIRD-PARTY-NOTICES` 的第三方声明）仍有用 | 直接删 ⇒ 第三方声明丢失、以后想查没处查 |
| `docs/legacy/`（上游遗留） 与 `docs/archive/`（本仓自己的搁置物）分开 | 上游 Pro 的东西 vs 本仓因决策搁置的东西，**性质不同**：前者「不是本仓真相」，后者「本仓写过但暂缓」⇒ 混在一起会让人搞不清 | 混放 ⇒ 半年后不知道某份文档是「别人的」还是「我们自己的」 |
| `.agents/skills/` 当正文，`.claude/skills/` 留指路存根 | `.agents/` 是 Agent Skills **标准位置**（pi / Codex 等直接发现）；`.claude/` 是 Claude Code 约定 ⇒ 两者都留，但正文只存一份 | 删掉 `.claude/skills` ⇒ Claude Code 用户得重跑 `npx skills add` 才能用 `/antd` |
| `.gitignore` **不动** | 实测 `**/.DS_Store` 已同时覆盖根目录与子目录（`git check-ignore -v .DS_Store` 命中 `.gitignore:36`）⇒ 验收标准已满足，再加一行是重复规则 | 无 |
| `docs/ai-architecture.md` 只做**定点对齐**，不重写 | 该文档 518 行、大量描述的是**上一代 Next.js 版 AI 服务**（现在是 `backend/ai` 下的 Express 服务）⇒ 全面重写属「大改造」，超出本条范围（PM 只写「若已过期」）⇒ 只改会误导人的事实（框架、路径、仓库名） | 不改 ⇒ 文档继续骗人；重写 ⇒ 范围失控、review 不了 |

## 怎么验

```bash
# ① 唯一完整指引（CLAUDE.md 必须零章节）
grep -c '^## ' CLAUDE.md            # 期望 0
grep -c '^## ' AGENTS.md            # 期望 ≥ 8

# ② 归档到位 + 留了指路
ls docs/legacy/ant-design-pro/ docs/archive/aipm/
grep -n "legacy/ant-design-pro\|archive/aipm" README.md docs/legacy/README.md docs/archive/README.md

# ③ 目录结构文档与实际一致（文档 §7 里的核对命令）
for p in frontend backend/ai docker .pi/prompts docs/pm docs/notes docs/legacy docs/archive \
         scripts/agent scripts/e2e frontend/cloudflare-worker backend/ai/.pi/skills; do
  [ -e "$p" ] && echo "✓ $p" || echo "✗ 缺失 $p"
done

# ④ 构建没被打断（cheatsheet 移动后仍可解析）
cd frontend && npm run build

# ⑤ 全绿
npm run lint && npm run test
node scripts/e2e/web-container.static.cjs
```

## 坑与提醒

- **`docs/cheatsheet.*.md` 是构建输入**，不是死文档 ⇒ 归档它必须同步 4 处路径（见上）。
- **`AGENTS.md` 的「agent 工作区隔离」一节被上一棒 agent 的运行日志污染过**（有几行是它的 stdout 记录，还把 Windows 路径里的 `\` 吃掉了）⇒ 本次顺手清干净。
- `git mv` 之后 `git status` 里是 rename ⇒ 确认 diff 是 R 而不是 D+A。
