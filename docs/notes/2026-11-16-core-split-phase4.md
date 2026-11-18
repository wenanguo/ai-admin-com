# 目录拆分 · 阶段 4：接线（配置指插件 · 能力可见 · 业务词检查）（2026-11-16）

> 交接文档 —— 让下一棒（可能是另一个会话的 agent）接得上。

## 目标

- **关联**：issue #82 · PR（阶段 4；**#82 还没完**，见下面「下一步」）
- **一句话**：让「**哪个智能体用哪个插件**」**真的能配**（`agent.yaml` 的 `plugin:` 字段），
  并把「内核不含业务词」这条判据**变成可执行的检查** ⇒ 进 CI。

## 状态

**阶段 4 已完成**（接线 + 两条可执行检查；**行为不变** ⇒ 453 条单测全绿）。
**阶段 5 还没做** ⇒ #82 保持开着。

## 已完成

| 位置 | 做了什么 |
| ---- | -------- |
| `backend/ai/src/core/config/{schema,types,loader}.ts` | 智能体配置多一个 `plugin:` 字段（**用哪个业务插件**；内核按**名字**去注册表取 ⇒ 内核不 import 插件） |
| `backend/ai/src/core/config/catalog.ts` | `GET /api/agents` 的**能力摘要里报出插件**（界面据此知道这个智能体有哪些业务能力） |
| `backend/ai/src/core/plugins.ts` | 注册表多一个 `defaultPlugin()`（配置没写 `plugin:` 时用它） |
| `backend/ai/src/core/session/runtime.ts` | ★ **按智能体取插件**：命令目录、讨论上下文、写规则**都来自这个智能体的插件**；新增 `validatePlugins()`（配置里的插件没注册 ⇒ **启动即失败**） |
| `backend/ai/src/core/session/session-registry.ts` | 通道多存一份**写规则**（与锚点来自同一个插件） |
| `backend/ai/src/plugins.ts` | ★ **import 即注册**（模块副作用）：运行时是**模块级单例**（import 时就构造）⇒ 注册必须早于它 |
| `backend/ai/src/server.ts` | `start()` 里调 `validatePlugins()` ⇒ 拼错插件名**服务起不来**；`import "./plugins.ts"` 排在所有 import 之前 |
| `backend/ai/agents/pm/agent.yaml` | 写上 `plugin: pm`（**接线真的落地**；通用问答不写 ⇒ 不挂业务插件） |
| `scripts/check-core-business-words.cjs` | ★ **业务词检查**（剥掉注释 ⇒ 只查代码）+ **允许清单**（每条都写清为什么、什么时候清） |
| `backend/ai/src/core/purity.test.ts` | 两条检查各有「**抓得住**违规」的负向用例 |
| `.github/workflows/ci.yml` | CI 里跑两条检查 |
| `backend/ai/src/core/mcp/mcp.fake.ts` · `core/skills/skill-tools.ts` | 夹具/提示词里的业务词改通用说法 |
| 文档 | `backend/ai/agents/README.md`（`plugin:` 字段）· `docs/ai-architecture.md`（文件索引） |

## 决策记录（★ 最值钱的部分）

| 决定 | 为什么 | 错了的代价 |
| ---- | ------ | ---------- |
| **插件按智能体选**（配置里的 `plugin:`），不是「所有插件的命令合起来」 | 「一个智能体 = 一套业务能力」⇒ 通用问答不该拿到 PM 的命令；**内核不 import 插件** ⇒ 只能按**名字**取 | 命令目录变成全局的 ⇒ 加第二个插件时两个智能体的能力会串 |
| **`plugin:` 写错 ⇒ 启动即失败**（`validatePlugins()`） | 配置拼错是**人**的错误 ⇒ 越早报越好（仓库的老规矩：非法配置启动即报错） | 静默降级成「没有命令」⇒ 用户看到「AI 变傻了」，查不到原因 |
| **校验放在 `start()`，不放运行时构造里** | 运行时的构造发生在**模块 import 时**⇒ 那时插件还没注册（注册在入口侧）⇒ 放那儿会误报 | 放构造里 ⇒ 每次单测都要先注册插件 ⇒ import 顺序变脆 |
| **插件注册改成「import 即注册」** | 运行时是**模块级单例**（import 时构造）⇒ 注册必须**早于**它 ⇒ 显式函数调用做不到（import 先跑完） | 保留函数调用 ⇒ 插件注册晚于运行时构造 ⇒ 命令目录永远是空的 |
| **业务词检查剥掉注释再查** | 注释里出现业务名词是**正常的**（那是文档）⇒ 直接 grep 会命中一百多处 ⇒ 白名单一大片 = 没查 | 不剥注释 ⇒ 要么误报满天飞，要么把文档也逼成「上游」 |
| **测试文件不算业务词** | 测试里的业务词是**夹具**（模拟上游载荷）⇒ 内核的**代码**没依赖它 | 连测试一起查 ⇒ 几百条豁免 ⇒ 检查形同虚设 |
| **允许清单只有 3 条**，每条写清「什么时候清」 | 剩下的是**真遗留**（AIADMIN_* 环境变量 / 健康检查探针 / MCP 默认地址）⇒ 写在脸上比藏起来好 | 不写清单 ⇒ 「零业务词」变成一句空话 |

## 怎么验

```bash
cd backend/ai
npm run typecheck        # ✅
npm test                 # ✅ 49 个文件 / 451 条
cd ../..
node scripts/check-core-purity.cjs           # ✅ 内核不 import 插件
node scripts/check-core-business-words.cjs   # ✅ 内核无业务词（3 条白名单）
node scripts/e2e/ai-container.static.cjs     # ✅ 20 条
```

**接缝自检**：

```bash
cd backend/ai
grep -rn "plugins/" src/core/ | grep -v "^\S*: \*"   # 只应剩注释 ⇒ 无 import
grep -rn "plugin" agents/pm/agent.yaml              # ⇒ plugin: pm
```

## 坑与提醒

- ⚠️ **单测里的假插件 id 要跟真配置一致**（`agents/pm/agent.yaml` 写的是 `plugin: pm`）
  ⇒ 假插件 id 写 "fake" ⇒ 真实智能体找不到插件 ⇒ **一个工具都没注册**（测试会以「等待超时」的形式失败 ⇒ 难查）。
- ⚠️ **`GET /api/agents` 的能力摘要多了 `plugin` 字段** ⇒ 前端多一个字段（向后兼容 ✓）。
- ⚠️ **`skill-tools.ts` 的 `load_skill` 描述改了一个词**（「当任务与…」→「当要做的事与…」）
  ⇒ 模型看到的提示词变了一点点（行为不变，但别以为是 bug）。
- ⚠️ **工作区里前端的浏览器模式测试与 `npm run build` 跑不起来**（junction 软链）⇒ 与本改动无关。

## 下一步（阶段 5 = 收口）

1. **`AIADMIN_*` 归插件**（设计 §12.3）⇒ 内核的 env 只留通用变量；
   ⚠️ 要连带两件事：① **健康检查探针**（探 AiAdmin）② **MCP 默认地址** ⇒ 插件要提供这两个能力。
2. **公开入口**：`core/index.ts`（对外只从这里 import）+ 依赖清单可枚举 + 配置 schema 写进 `agents/README.md`。
3. 清掉业务词检查的**允许清单**（3 条 ⇒ 0 条）⇒ 「内核零业务词」真正成立。
4. **每一步一个分支一个 PR**；#82 在**阶段五**后才关。
