# 智能体白名单漂移守卫（2026-11-27）

> 交接文档 —— **让下一棒（可能是另一个会话的 agent）接得上**。

## 目标

- **关联**：issue **#194**（milestone #16「v1.3 · 收尾续」· 规模**小**）· PR **#201**
- **一句话**：给 `backend/ai/agents/<id>/agent.yaml` 的 `tools:` 白名单加一条**离线守卫**，
  把它与插件命令名（`*_TOOL_NAME`）**双向**核对 ⇒ 漂移在 CI 里就红，
  不再「工具静默不注册 ⇒ 模型看不到 ⇒ 不报错、不告警」。

## 状态

**已完成**（守卫 + CI + 负例自测 + 修一处真漂移 ⇒ PR #201 已开，**未合并** ⇒ 等人拍板）。
⇒ issue #194 上已留评论（做了什么 / 怎么验 / PR 号）⇒ 标签保持 `in-progress`（合并后 PR 的 `Closes #194` 自动关单）。

## 已完成

| 提交 | 做了什么 |
| ---- | -------- |
| `b364076` | **骨架**：守卫脚本（`scripts/e2e/agent-tools-whitelist.static.cjs`）+ 接进 CI（`agent-tools-whitelist` job）+ npm 脚本 `e2e:agent-tools:static` |
| `edd49fc` | **守卫做实**：默认插件识别（读 `src/plugins.ts` 的注册顺序）/ 插件 id 撞车检查 / 报错点名「哪个名字·哪个智能体·怎么改」/ 负例自测（改坏 ⇒ 红 ⇒ 改回 ⇒ 绿）/ 修真漂移（`agents/sample/agent.yaml`）/ `agents/README.md` 补口径 |
| `909cb76` | 交接文档（本文件） |
| `a5614e8` | 报错去重：显式写的插件压根不存在时，只报规则 ④（别再报「属于别的插件」） |

**交付物**：

| 东西 | 是什么 |
| ---- | ------ |
| `scripts/e2e/agent-tools-whitelist.static.cjs` | **离线**守卫（不联网 · 不装依赖 · 自带负例自测） |
| `.github/workflows/ci.yml` | 新增 job `agent-tools-whitelist`（独立 job ⇒ 与其它守卫并行 · 5 分钟内能跑完） |
| `package.json` | 新增 `npm run e2e:agent-tools:static` |
| `backend/ai/agents/README.md` | 「`tools` 里写的是插件命令的名字 + 有守卫盯着」写进配置说明 |

## 决策记录（★ 最值钱的部分）

| 决定 | 为什么 | 错了的代价 |
| ---- | ------ | ---------- |
| **守卫写在 `scripts/e2e/`（不是 `backend/ai/src/`）** | 守卫是**离线静态检查**（不装依赖 · 不联网 ⇒ 任何 runner 都能跑）⇒ 与 `mcp-tools-snapshot.static.cjs` / `node-version.static.cjs` 同一族；放后端源码里就得跟 `yaml` 依赖绑在一起 | 放进后端 ⇒ CI 要先 `npm ci` ⇒ 守卫跑不起来（而且它本来不需要那些依赖） |
| **自己写「最简 YAML 解析」，不引 `yaml` 包** | 根目录**没有** node_modules（两套 npm）⇒ 守卫要能 `node xxx.cjs` 直接跑 ⇒ 只能零依赖 | 引 `yaml` ⇒ 要么从 `backend/ai/node_modules` 里 require（**违反「守卫不装依赖」**）⇒ 要么把守卫挪进后端 ⇒ 又回到上一条 |
| **只解析 `id` / `plugin` / `tools` 三个字段** | 守卫只需要这三个 ⇒ 解析面越小 ⇒ YAML 写法变化时**炸得越响**（解析不出 `id` ⇒ **报错**，不许静默当「没问题」放过去） | 解析整个 YAML ⇒ 自己实现半个 YAML 引擎 ⇒ 迟早有边角 ⇒ 守卫自己变成 bug 来源 |
| **规则 3（插件命令 ⊆ 白名单）只对**显式**写了 `plugin:` 的智能体生效** | 没写 `plugin:` 的智能体用**默认插件**（`core/session/agent-resolver.ts` 的 `pluginOf`）⇒ **允许它一个工具都不要**（`qa` 就是「只会聊天」⇒ 白名单故意是空的）⇒ 若一刀切，`qa` 会天天红 | 一刀切 ⇒ `qa` 立刻红 ⇒ 大家就学会忽略守卫（比没有守卫更坏） |
| **规则 2（白名单名字必须属于**实际用的**那个插件）对两种智能体都生效** | 白名单里写别的插件的命令名 ⇒ 运行时被过滤掉 ⇒ **静默**不注册 ⇒ 这是「静默」的一种，必须盯 | 只对显式插件生效 ⇒ 靠默认插件的智能体留了静默的口子 |
| **默认插件离线识别**：读 `src/plugins.ts` 的 `plugins` 数组**第一项** | 必须与运行时同一个口径（`core/plugins.ts` 的 `defaultPlugin()` = 注册的第一个）⇒ 否则守卫和运行时对不上 ⇒ 守卫会误判 | 猜「目录名排序第一个」⇒ 与运行时不一致 ⇒ 误判 ⇒ 守卫被改松 |
| **负例自测改的是 `os.tmpdir()` 里的拷贝** | 「改坏真文件再改回」在 CI 里**危险**（脚本崩了 ⇒ 仓库脏 ⇒ 下一个 job 挂在奇怪的地方）⇒ 改拷贝 ⇒ 同样的断言、零风险 | 改真文件 ⇒ 万一中途失败 ⇒ 仓库被留在坏状态（而且本地跑的人会忘记改回来） |
| **负例自测同时断言**整个脚本的退出码**（1 ⇒ 0）** | 只断言「检查函数报了错」不够 ⇒ 还得证明**脚本真的红**（退出码 1）⇒ 守卫接进 CI 才有意义 | 只测函数 ⇒ 脚本的退出码/参数处理坏了也不知道 ⇒ CI 上「红」可能变成「绿」 |
| **真漂移按「与运行时等价」修**（`sample` 的白名单清空） | 守卫一上来就抓到真漂移：`agents/sample/agent.yaml` 还写着**改名前**的 `create_task`（#169 改名时漏了它）⇒ 它**从来没有真的注册过**（运行时只认 `pm_create_task`）⇒ 清空白名单 = **零行为变化**，且让界面上的「工具数」从「1（骗人）」变成「0（实话）」 | 顺手改成 `pm_create_task` ⇒ **行为变更**（示例智能体会真的能建任务）⇒ 超出本 issue 范围 ⇒ 要人拍板 |
| **产品代码 0 改动** | issue 的验收明写「产品代码 0 改动（只加守卫脚本；除非发现真的漂移 ⇒ 那要在 PR 正文里点名）」⇒ 唯一的配置改动（`sample`）**点名在 PR 正文** | 顺手改后端逻辑 ⇒ 评审的人要同时看守卫和逻辑 ⇒ 分不清哪个是必须的 |

## 怎么验

```bash
# ① 离线守卫（CI 里跑的就是它）—— 应输出「全部通过」
node scripts/e2e/agent-tools-whitelist.static.cjs

# ② 负例（脚本自带）：改坏白名单 ⇒ 守卫报红；改回 ⇒ 全绿
#    —— 它在**临时拷贝**上做（os.tmpdir()）⇒ 不碰仓库里的真配置
node scripts/e2e/agent-tools-whitelist.static.cjs

# ③ 手工负例（想亲眼看红）：把 backend/ai/agents/pm/agent.yaml 里的
#    `- pm_create_task` 改成 `- pm_create_task_v2` ⇒ 跑 ① ⇒ 应当红 ⇒ 改回
node scripts/e2e/agent-tools-whitelist.static.cjs

# ④ 别的守卫不许被弄坏
node scripts/e2e/mcp-tools-snapshot.static.cjs
node scripts/check-core-purity.cjs

# ⑤ 后端单测（智能体配置的「等价」测试）
cd backend/ai && npx vitest run src/core/config src/core/routes/agents.test.ts --no-file-parallelism
```

## 坑与提醒

- ⚠️ **白名单漂移的后果是「静默」的**：运行时是
  `plugin?.commands.filter((command) => agent.tools.includes(command.name))`
  ⇒ 名字对不上 ⇒ **工具不注册** ⇒ 模型**看不到** ⇒ **不报错、不告警**。
- ⚠️ **界面上的「工具数」取的就是白名单长度**（`core/config/catalog.ts` 的 `toolCount`）
  ⇒ 白名单漂移 ⇒ **界面也在骗人**（这回 `sample` 就是「工具数 1 · 实际 0 个」）。
- ⚠️ **MCP 的工具不受白名单管**（模型侧叫 `mcp__aiadmin__xxx` ⇒ 由 `mcpServers` 决定挂不挂）
  ⇒ 白名单里写 MCP 的裸名（如 `create_task`）⇒ **必然**是漂移 ⇒ 守卫会点名这件事。
- ⚠️ **守卫自己也有边界**：插件里**声明了** `*_TOOL_NAME` 但**没登记进** `commands`
  的命令 ⇒ 守卫看不出来（声明即事实源）。
- ⚠️ **将来要「子集白名单」**（例如某个智能体挂 pm 插件但不要建任务）
  ⇒ 规则 3 会拦 ⇒ **先给守卫开口子**（别偷偷改白名单绕过）。
- ⚠️ 这台机器内存很紧 ⇒ `vitest run` 并行跑会 OOM ⇒ 加 `--no-file-parallelism`。
- ⚠️ **本 PR 只开不合并**（用户明确要求）⇒ 等人拍板后再合。
