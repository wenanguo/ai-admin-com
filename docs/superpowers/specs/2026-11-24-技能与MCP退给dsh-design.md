# 技能与 MCP 退给 dsh —— 设计文档（spec）

> **状态**：**已实现**（issue **#153** 的交付物）· 2026-11-24
>
> ⚠️ **本条是减法**：能退给 dsh 的退给 dsh ⇒ **代码变少**。
> ⚠️ **技能正文一个字不改** · **对外 9 个端点不动** · **dsh 版本锁 0.2.2-rc.5**。
>
> **上游**：[`2026-11-20-dsh-技能-MCP-插件-design.md`](./2026-11-20-dsh-技能-MCP-插件-design.md)
> （那一条把三层「挂到 dsh 上」；**本条把「自己造的那部分」退回去**）
> · **交接文档**：[`../../notes/2026-11-24-技能与MCP退给dsh.md`](../../notes/2026-11-24-技能与MCP退给dsh.md)

---

## 0. 摘要（边界表）

| 层 | 退给 dsh 的部分 | 留在我们这边的部分 |
| -- | ---------------- | ------------------ |
| **技能** | 发现 / 加载 / 目录渲染 / 按需加载工具（`skill`） | **智能体的技能目录配置**（`agent.yaml` 的 `skills:`）· UI 的技能清单端点（**退不回去**，见 §4） |
| **MCP** | 客户端挂载与管理面（`dsh-mcp-manager`：装 / 卸 / 列 / 探活 / 重连） | **凭据与每用户 token**（AiAdmin 的 MCP 带用户 JWT）· 闸门 |
| **不退** | — | 闸门口径 · 审计 · 用户/权限 · 讨论上下文锚点 · 对外 9 个端点 · 会话事件流与存储 |

**代码量**：删掉 7 个文件（`skill-loader.ts` / `skills.ts` / `skill-tools.ts` / `system-prompt.ts`
+ 3 个测试）⇒ 服务侧少了 **≈ 900 行**；dsh 插件那边只多了「挂管理面 + 等它挂上」。

---

## 1. 技能层

### 1.1 dsh 自带的机制（**本来就挂在 sdk profile 里**）

| 包 | 干什么 |
| -- | ------ |
| `dsh-skill` | 技能登记表（provider 注册 · 快照 · 摘要） |
| `dsh-skill-filesystem` | **从目录发现技能**（`FileSystemSkillProvider`） |
| `dsh-tool-skill` | 给模型两样东西：**技能目录**（`agent/pre-step` 时作为**用户消息**注入）+ **`skill` 工具**（按需加载正文） |

⚠️ **发现是「一层深」**：`<root>/<名字>/SKILL.md` 或 `<root>/<名字>.md`
⇒ **再往里一层找不到**（我们以前的 loader 会递归）。

### 1.2 我们怎么接线（**只给目录**）

```
智能体配置（agent.yaml 的 skills:）
  → runtime.ts：skillDirs: agent.skills
  → runner.ts：环境变量 AI_DSH_SKILL_DIRS（base64 的 JSON 数组）
  → dsh 子进程：profile 补丁把 skill-filesystem 配成
       includeDefaultRoots: false          ← 不扫默认根
       customSkillDirs: <AI_DSH_SKILL_DIRS> ← 只扫我们给的
```

⚠️ **默认根必须关**：dsh 的默认根 = `<项目根>/.dsh/skills` + `<项目根>/.agents/skills`
+ `<dsh home>/skills` + `~/.agents/skills`
⇒ 不关的话，**仓库自己的开发技能**（`.agents/skills/antd` 等）与**开发者私人技能**
会混进业务会话 ⇒ 既串味又不安全。

⚠️ **目录用环境变量而不是配置文件**：dsh 的 profile 是**磁盘上的工程**
⇒ 写进配置就变成「所有会话共用一份技能目录」
⇒ 环境变量天然**一个会话一份** ⇒ **不跨智能体串味**
（与 [`../../notes/2026-11-16-skills-per-agent.md`](../../notes/2026-11-16-skills-per-agent.md) 同口径）。

### 1.3 语义差异清单（★ 退让的地方，**逐条记下来**）

| # | 以前（我们自己的） | 现在（dsh 的） | 影响 |
| - | ------------------ | -------------- | ---- |
| 1 | 技能目录进**系统提示词**（`<available_skills>` XML 段） | 技能目录进**用户消息**（`<system-reminder>` 里的 `<available_skills>`） | 提示词结构变了 ⇒ **模型仍然看得见技能列表**；但**技能正文仍是按需加载**（`skill` 工具）⇒ 正文照旧进模型上下文 |
| 2 | 工具名 `load_skill` | 工具名 **`skill`** | 技能正文里**没有**写工具名 ⇒ 正文不用改；只有**智能体提示词**里提了一句 ⇒ 已改成 `skill` |
| 3 | 发现**递归**（子目录里的 `SKILL.md` 也算） | 发现**只一层** | 现有三个样板都是一层 ⇒ **无影响**；以后写技能别再套目录 |
| 4 | 名字缺失时**回落成目录名** | 名字**必须在 frontmatter**，且 kebab-case（`^[a-z0-9]+(?:-[a-z0-9]+)*$`） | 写坏的技能**直接不生效**（而不是以奇怪的名字生效） |
| 5 | 名字允许 `--` 等 | 名字**不许** `--` / 大写 / 下划线 | 同上 ⇒ 写坏就**不生效** |
| 6 | 只读 `name` + `description` | 多支持 `whenToUse` / `metadata`；`disable-model-invocation` 等是**布尔文法**（写错就跳过并告警） | 能力**变多**；旧的驼峰键（`disableModelInvocation`）**会被拒** ⇒ 别再用 |
| 7 | `load_skill` 能读技能目录里的**附属文件** | `skill` 工具**只回正文**（附属文件只是给个路径提示） | 技能正文**别依赖附属文件** |
| 8 | 加载时**读缓存** | 每次加载**重读** | 改了正文立刻生效（更好） |

⇒ **回归手段**：§4 的「清单读取」单测（规则逐条对齐）+ 真 e2e（目录进上下文 / `skill` 工具在）。

---

## 2. MCP 层

### 2.1 边界（★ 为什么不能全退）

| 归谁 | 为什么 |
| ---- | ------ |
| **dsh-mcp-manager** | 服务器的**装 / 卸 / 列 / 探活 / 重连**是通用能力 ⇒ 我们不造第二套 |
| **我们** | AiAdmin 的 MCP 要带**调用方的 JWT**（后端靠它做权限码校验）⇒ **token 只有我们知道** ⇒ 「按用户算好配置」这段必须留在我们这边 |

⇒ **服务侧**（`core/mcp/mcp.ts`）现在只做一件事：把 `agent.yaml` 的 `mcpServers`
（**语义一个字没变**）翻译成**管理面的登记**（`{name, entry}`）。

| 我们的配置 | 管理面的条目 |
| ---------- | ------------ |
| `name` | **map 的键**（也是 `serverName` ⇒ 工具名前缀 `mcp__<name>__`） |
| `url` | `url`（`transport: streamable-http`） |
| `type: http \| sse` | 都走 `streamable-http`（dsh 只有这一种 HTTP 传输） |
| `exposure: hidden` | **不挂这台**（模型看不到） |
| 调用方的 token | `headers: { Authorization: "Bearer …" }`（**只在内存里**） |
| — | `toolCallTimeoutMs: 60_000` · `startupTimeoutMs: 15_000`（**管理面的条目要求写明**） |

### 2.2 dsh 侧怎么挂（`dsh-plugin/src/mcp.js`）

```
ctx.plugin(McpServerManager)            ← 挂在**我们这个作用域**
  → manager.register(name, entry)        ← 逐台登记
  → 等状态离开 connecting               ← 管理面是**异步挂**的
```

⚠️ **必须挂在我们的作用域**（不能挂 root）：dsh 的工具表**按作用域**
⇒ 注册在 root 的工具，agent **看不见**（会变成 "unknown tool"）
⇒ 挂在与 agent 同层 ⇒ MCP 工具落进 agent 那份工具表 ✓。

⚠️ **必须等它挂上**：管理面挂客户端是**异步**的
⇒ 不等 ⇒ 模型第一轮可能**看不到 MCP 工具**（表现为「模型没调用工具」）。

### 2.3 闸门**不许被绕过**

MCP 的工具是 **dsh 直接注册**的 ⇒ **不经过我们的命令桥** ⇒ 不会有人问
⇒ 我们在 dsh 插件里补了拦截点 `tools/pre-execute`：
**`mcp__*` 且裸名以 `update_` / `patch_` 开头 ⇒ 返回 `ask`**
⇒ 走 dsh 的**审批缝** ⇒ **我们的进程**处理（挂待确认 ⇒ 等真人点头 ⇒ 放行/拒绝）。
⚠️ **只问 MCP 的工具**（我们的命令在工具内部已经问过了 ⇒ 不许问两遍）。

---

## 3. 不变量与回归手段

| 不变量 | 钉它的东西 |
| ------ | ---------- |
| 技能正文**一个字没改** | `scripts/e2e/dsh-skills-mcp-plugins.static.cjs` ①（三个 `SKILL.md` 的 frontmatter 完整 + 名字 kebab-case） |
| 服务侧**不再有** `load_skill` | 静态 e2e ③（源码里不许出现） |
| 技能**只认配置里列的目录** | 静态 e2e ④（`includeDefaultRoots: false` + `AI_DSH_SKILL_DIRS`）+ `runtime.agents.test.ts`（PM 有目录、问答没有） |
| **清单 = 模型看到的** | `core/skills/skill-catalog.test.ts`（逐条对齐 dsh 的发现规则：只一层 / kebab-case / 必填字段 / 同名先来的赢） |
| MCP 写操作**仍要人点头** | 真 e2e ⑤⑥（拒绝 ⇒ **服务端一次都没被叫**） |
| MCP 工具名**归一化只有一处** | 静态 e2e ⑥（`core/mcp/tool-names.ts`） |
| 对外 9 个端点**不动** | `core/routes/contract.ts`（本次**一个字没改**） |

---

## 4. 退不回去的部分（**说清楚，别硬退**）

| 退不回去的 | 为什么 |
| ---------- | ------ |
| **UI 的技能清单端点**（`GET /api/agent/skills`） | dsh 的技能登记表住在**运行时进程里**（每个会话一个子进程）⇒ 我们的 HTTP 层**问不到它** ⇒ 只能自己读一遍文件 ⇒ 保留**最小的一份**（只读 frontmatter 的 `name` / `description` ⇒ 规则与 dsh 对齐 ⇒ 界面看到的 = 模型看到的） |
| **凭据与每用户 token** | AiAdmin 的 MCP 靠**调用方的 JWT** 做权限码校验 ⇒ dsh 不知道我们是谁 |
| **闸门口径** | 「修改已有数据要人点头」是我们的产品口径 ⇒ 只有一份（`core/gate/decision.ts`）⇒ dsh 那边只**接线**，不**定义** |
| **审计 / 用户权限 / 上下文锚点 / 会话事件流** | 都不是 dsh 的职责 ⇒ 原样不动 |

---

## 5. 验收结果（2026-11-24）

| 验收项 | 结果 |
| ------ | ---- |
| 技能目录**进模型上下文**（用户消息里的 `<available_skills>`） | ✅ 真 e2e ④ |
| 模型看得见 `skill` 工具 | ✅ 真 e2e ④ |
| MCP 工具**真的被调**（服务端收到 `tools/call`） | ✅ 真 e2e ③ |
| MCP **写操作仍要点头**（拒绝 ⇒ 服务端一次都没被叫） | ✅ 真 e2e ⑤⑥ |
| 我们的命令**照旧挂进工具表** | ✅ 真 e2e ③ |
| 服务侧单测 | ✅ 570 条全过 |
| 静态验收 + 边界守卫 | ✅ 全过 |
