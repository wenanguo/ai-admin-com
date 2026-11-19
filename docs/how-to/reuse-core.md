# 复用通用内核（换一个业务系统也能用）

> **一句话**：内核（`backend/ai/src/core/**`）只懂「对话 / 会话 / 命令 / 技能 / MCP / 审计 / 闸门」
> 这些**通用**概念；**业务能力做成插件**，**智能体写成 YAML**，**服务用内核装配** ⇒
> 换个业务系统，这套内核照样能用。

- **示例系统**：[`backend/ai/examples/reading-notes/`](../../backend/ai/examples/reading-notes/)
  （读书笔记，**不依赖 AiAdmin**；本文的每一步都能在它身上找到对应的东西）
- **只允许的入口**：`backend/ai/src/core/index.ts`（内核的**唯一**公开入口）

---

## 三步

### 第 ① 步：拷内核

把 `backend/ai/src/core/`（**整个目录**）拷进你的仓，例如 `your-app/src/core/`。

内核只依赖**通用件**（pi SDK / express / prisma / zod / typebox / yaml / node 内置）
⇒ **不依赖任何业务系统**（这条由 `scripts/check-core-purity.cjs` 在 CI 里钉着：
内核不许 import 业务插件，代码里不许出现业务词）。

拷完之后，你只要能 `import` 到它就行（示例里是 `../../src/core/index.ts`）。

⚠️ **只从公开入口 import**：

```ts
// ✅
import { createCoreApp, pluginRegistry, type AiPlugin } from "./core/index.ts";

// ❌ 内核内部路径**不是契约**（内核内部一改，外部就崩）
import { agentRuntime } from "./core/session/runtime.ts";
```

### 第 ② 步：写插件（你的业务能力）

插件就是**一个对象**（`AiPlugin`）：给它 id、命令目录、身份解析器。

```ts
import type { AiPlugin, CommandDefinition } from "./core/index.ts";

export const MY_PLUGIN_ID = "my-app";

export function createMyPlugin(): AiPlugin {
  return {
    id: MY_PLUGIN_ID,
    label: "我的业务插件",
    // ① 命令目录：**模型**看得见的工具（描述写清「什么时候用 / 参数是什么」）
    commands: [
      {
        name: "add_item",
        label: "记一条",
        build: (context) => ({
          name: "add_item",
          label: "记一条",
          description: "记一条东西……",
          parameters: Type.Object({ title: Type.String() }),
          annotations: { readOnlyHint: false, destructiveHint: false },
          execute: async (_id, params) => ({
            content: [{ type: "text", text: `记下了：${params.title}` }],
            details: { ok: true },
          }),
        }),
      },
    ] satisfies readonly CommandDefinition[],
    // ② 身份：**怎么问「当前用户是谁」由你决定**（内核只认这个契约）
    currentUser: new CachedCurrentUserResolver({
      async resolve(token) {
        if (!token.startsWith("my-")) {
          throw new AgentError("AUTH_EXPIRED", "令牌无效"); // ⇒ 内核翻成 401
        }
        return { id: 1, username: "me" };
      },
    }),
    // ③（可选）健康检查探针 / MCP 默认地址 / 讨论上下文 —— 都是你的业务语义
  };
}
```

注册（**注册表是进程级的、懒读的**）：

```ts
import { pluginRegistry } from "./core/index.ts";
pluginRegistry.register(createMyPlugin());
```

> 示例：[`backend/ai/examples/reading-notes/plugin.ts`](../../backend/ai/examples/reading-notes/plugin.ts)

### 第 ③ 步：写智能体 YAML

一个智能体一个目录：`agents/<id>/agent.yaml`（**cwd 相对** ⇒ 进程必须在那个目录下启动）。

```yaml
id: my-agent
name: 我的助手
description: 一句话说明它是干什么的。

systemPromptFile: prompt.md   # 或 systemPrompt: |
                                #   直接写提示词

skills: []                    # 技能目录（相对本配置目录）
mcpServers: []                # MCP 服务器（地址可省 ⇒ 用插件给的默认）
plugin: my-app                # 用哪个插件（**必须已注册**）
tools:                        # 工具白名单（**模型只看得到这些**）
  - add_item
```

目录长这样：

```
agents/
  my-agent/
    agent.yaml
    prompt.md
```

> 示例：[`backend/ai/examples/reading-notes/agents/notes/agent.yaml`](../../backend/ai/examples/reading-notes/agents/notes/agent.yaml)

---

## 装起来（第四步：装配）

```ts
import { assertCoreReady, createCoreApp, pluginRegistry } from "./core/index.ts";
import { createMyPlugin } from "./my-plugin.ts";

const plugin = createMyPlugin();
pluginRegistry.register(plugin);

// 启动自检：配置坏了 / 插件没注册 ⇒ 立刻退出（别等有人来调）
assertCoreReady();

const app = createCoreApp({
  plugins: [plugin],                       // 健康检查的探针从插件来
  configure: (app) => {
    // 你自己的业务端点（内核不懂你的业务 ⇒ 端点归你；在 404 之前挂）
    app.get("/api/items", (_req, res) => res.json({ code: 0, msg: "成功", data: [] }));
  },
});

app.listen(3200);
```

### 环境变量（内核认的这几个）

| 变量 | 必填 | 说明 |
| ---- | ---- | ---- |
| `MINIMAX_CN_API_KEY` | ✅ | 模型 key |
| `AI_MODEL` | ✅ | `provider/model`，例如 `minimax-cn/MiniMax-M3.1-Flash` |
| `AI_DEFAULT_AGENT` | | 默认智能体 id（缺省 `pm`；**你的系统要改成自己的**） |
| `ALLOWED_ORIGINS` | ✅ | 允许的跨域源（逗号分隔） |
| `DATABASE_URL` **或** `AI_DATABASE_URL` | ✅ | 内核自己的 `ai_*` 元数据表住在哪个库 |

⚠️ **没有业务系统的地址** ⇒ 内核不知道 AiAdmin 或别的系统在哪 ⇒ 你的业务系统地址由**你的插件**给。

---

## 三条容易踩的坑

1. **cwd 相对**：智能体配置在 `cwd/agents/`、技能在 `cwd/.pi/skills/`
   ⇒ **进程必须在你的系统目录下启动**（容器里 `WORKDIR` 也要对）。
2. **插件名要对上**：YAML 里的 `plugin:` 必须是**已注册的 id** ⇒ 对不上就**启动即失败**（不静默降级）。
3. **工具白名单**：YAML 的 `tools:` 没列的工具**模型看不到** ⇒ 插件写了命令但没列白名单 ⇒ 模型永远不用它。

---

## 自检（把你的系统也钉一遍）

| 想钉住什么 | 怎么钉 |
| ---------- | ------ |
| 内核不依赖业务系统 | `node scripts/check-core-purity.cjs` |
| 外部**只用公开入口**接入内核 | `node scripts/check-core-reuse.cjs`（示例版） |
| 端到端真跑一遍 | `node scripts/e2e/reuse-core-example.cjs`（示例版） |

---

## 公开入口现在给你什么

`backend/ai/src/core/index.ts` 的导出（**改它 = 改对外契约**）：

| 能力 | 导出 |
| ---- | ---- |
| 智能体配置 | `loadAgentConfigs` · `agentsRoot` · `listAgentSummaries` · `toAgentSummary` · `AgentConfigError` · 类型 `AgentConfig` / `AgentSummary` / … |
| 插件契约与注册表 | `AiPlugin` · `PluginRegistry` · `pluginRegistry` |
| 会话运行时 | `AgentRuntime` · `AgentError` |
| **HTTP 装配** | `createCoreApp` · `createCoreHealthRouter` · `assertCoreReady` · `corsMiddleware` · `notFoundHandler` · `errorHandler` |
| 命令与上下文锚点 | `buildCommandTools` · `isDestructiveCommand` · `narrowWriteArgs` · `writeTargetId` · 类型 `CommandDefinition` / `CommandTool` / `ContextAnchor` … |
| 身份契约 | `CurrentUser` · `CurrentUserResolver` · `CachedCurrentUserResolver` |
