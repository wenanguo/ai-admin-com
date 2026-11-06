# MCP 接入实现计划（阶段 1：工具来源换成后端 MCP）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 pi 会话**从 AiAdmin 的 MCP 服务**拿到工具（`mcp__aiadmin__*`），工具调用带**当前用户的 JWT** ⇒ 后端接口自动成为 AI 的能力，后端加接口 AI 侧不用改代码。

**Architecture:** 用 pi 官方的 MCP 扩展（`createMcpExtension()`）做工具来源；用 `pi.registerMcpServer()` 在**每个会话**注册一个带该用户 token 的 HTTP 服务器（`exposure: "direct"`）；建完会话调 `session.bindExtensions({mode:"print"})` 触发 `session_start` ⇒ MCP 连接建立。测试用**假的 MCP 传输层**（`createTransport` 钩子）跑通整条链路，不依赖后端。

**Tech Stack:** pi SDK `@earendil-works/pi-coding-agent` 1.5.0（`createMcpExtension` / `registerMcpServer` / `bindExtensions`）、`@earendil-works/pi-mcp`（假传输层）、typebox、vitest

**Spec:** `docs/superpowers/specs/2026-11-06-aipm-mcp-skills-design.md`（§3 约束、§6.1 MCP、§6.2 JWT、§7 风险 2/3/5、§8 阶段 1）

## Global Constraints

- **只用 pi 官方扩展点**：MCP 扩展 + `registerMcpServer` + `bindExtensions`；不自己实现 MCP 协议。
- **每个会话带各自的 token**：MCP 服务器配置在**建会话时**用当次调用方的 token 构造 ⇒ 绝不用静态 token、不落盘。
- **不写 `.pi/mcp.json`**：静态文件表达不了「每个用户不同的 token」⇒ 全部运行时注册。
- **`exposure: "direct"`**：任务模块的工具数是个位数 ⇒ 直接进模型的工具声明。
  切换条件：工具数 > 15 时改 `"deferred"` + `createToolSearchExtension()`。
- **MCP 连不上不许崩**：后端还没部署 MCP 时，会话仍要能用（只是没有 MCP 工具）⇒ 任何连接错误都不许冒泡成会话创建失败。
- **不改现有事件流**：pi 的 MCP 工具调用会产生 `tool_call` / `tool_result` 事件 ⇒ 现有的 `event-mapper.ts` 照旧映射 ⇒ 前端零改动。
- 仓内风格：TypeScript、**tab 缩进**、中文注释解释「为什么」；提交信息 conventional commits（`feat(ai): …`）。
- 验证命令：`npx vitest run`（全部）与 `npx tsc --noEmit`（必须无输出）。

## Review Focus

规格暗示、但没有哪条任务会自然覆盖的失败模式（每条都要有对应的测试）：

1. **后端 MCP 没部署 / 连不上** ⇒ **会话仍要建得起来**（不能因为 MCP 失败就 500）。
2. **token 换了（用户重新登录、token 轮换）** ⇒ 老会话**不能**继续用旧 token 去调 MCP（否则是越权）。
3. **MCP 工具名带前缀** ⇒ 模型看到的是 `mcp__aiadmin__*`，**不是**后端接口原名 ⇒ 技能与提示词都按带前缀的名字说话。
4. **用户 JWT 透传** ⇒ MCP 服务器配置的 `Authorization` 头必须是**当次调用方**的 token（不是服务自己的、也不是上一个用户的）。
5. **MCP 的工具调不通时**（后端 500）⇒ 模型看到的是**工具错误**，不是整个会话崩掉。

---

### Task 1: MCP 服务器配置与注册

**Files:**
- Create: `src/agent/mcp.ts`
- Test: `src/agent/mcp.test.ts`

**Interfaces:**
- Consumes: pi 的 `ExtensionFactory`（`(pi: ExtensionAPI) => void | Promise<void>`）、`McpHttpServerConfig`
- Produces:
  ```ts
  export const AIADMIN_MCP_SERVER_NAME = "aiadmin";
  export function createAiadminMcpConfig(options: {
    url: string;
    token: string;
    exposure?: "direct" | "deferred" | "codemode" | "hidden";
  }): McpHttpServerConfig;
  export function createAiadminMcpExtension(options: {
    url: string;
    token: string;
  }): ExtensionFactory;
  ```

- [ ] **Step 1: 写失败测试**

```ts
// src/agent/mcp.test.ts
import { describe, expect, it, vi } from "vitest";
import {
	AIADMIN_MCP_SERVER_NAME,
	createAiadminMcpConfig,
	createAiadminMcpExtension,
} from "./mcp";

describe("AiAdmin 的 MCP 服务器配置", () => {
	it("名字是 aiadmin（工具名前缀就是 mcp__aiadmin__）", () => {
		expect(AIADMIN_MCP_SERVER_NAME).toBe("aiadmin");
	});

	it("HTTP + 带上调用方的 token + 直接暴露给模型", () => {
		const config = createAiadminMcpConfig({
			url: "https://example.test/api/v1/mcp",
			token: "user-jwt",
		});
		expect(config.type).toBe("http");
		expect(config.url).toBe("https://example.test/api/v1/mcp");
		expect(config.headers).toMatchObject({ Authorization: "Bearer user-jwt" });
		// ⚠️ 直接暴露 ⇒ 模型一眼就能看到这些工具（任务模块只有几个）
		expect(config.exposure).toBe("direct");
	});

	it("注册扩展时用**同一个** token 注册服务器", async () => {
		const registerMcpServer = vi.fn();
		const extension = createAiadminMcpExtension({
			url: "https://example.test/api/v1/mcp",
			token: "user-jwt",
		});

		await extension({ registerMcpServer } as never);

		expect(registerMcpServer).toHaveBeenCalledTimes(1);
		const [name, config] = registerMcpServer.mock.calls[0] as [string, { headers?: Record<string, string> }];
		expect(name).toBe("aiadmin");
		expect(config.headers).toMatchObject({ Authorization: "Bearer user-jwt" });
	});
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/agent/mcp.test.ts`
Expected: FAIL —— `Cannot find module './mcp'`

- [ ] **Step 3: 实现 `src/agent/mcp.ts`**

```ts
/**
 * AiAdmin 的 MCP 服务器 —— **工具的来源**。
 *
 * ## 为什么走 MCP，而不是自己写命令
 *
 * 后端已经把「接口」变成「MCP tool」（`AiAdmin/backend/app/plugin/module_mcp`）⇒
 * 后端加接口，AI 侧**一行代码都不用改**。
 *
 * ## 为什么每个会话单独注册
 *
 * MCP 调用要带**调用方的 JWT**（后端靠它做权限码校验）⇒ 每个用户、每个会话的
 * token 都不同 ⇒ 不能用静态的 `.pi/mcp.json`，只能运行时 `registerMcpServer`。
 *
 * ⚠️ token **只活在内存里**（服务器配置对象里），绝不落盘、绝不进日志。
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** 服务器名（工具名前缀就是 `mcp__aiadmin__`）。 */
export const AIADMIN_MCP_SERVER_NAME = "aiadmin";

/** MCP 服务器配置。 */
export interface AiadminMcpConfig {
	type: "http";
	url: string;
	headers: Record<string, string>;
	exposure: "direct" | "deferred" | "codemode" | "hidden";
}

/** 造 AiAdmin 的 MCP 服务器配置。 */
export function createAiadminMcpConfig(options: {
	url: string;
	token: string;
	exposure?: AiadminMcpConfig["exposure"];
}): AiadminMcpConfig {
	return {
		type: "http",
		url: options.url,
		headers: { Authorization: `Bearer ${options.token}` },
		// ⚠️ 默认直接暴露给模型（任务模块工具数是个位数）
		exposure: options.exposure ?? "direct",
	};
}

/**
 * 造一个注册 AiAdmin MCP 服务器的扩展。
 *
 * ⚠️ 这是 **inline extension**：它由 pi 在加载扩展时调用 ⇒
 *    正好是「会话建立」的时刻 ⇒ 每个会话带自己的 token。
 */
export function createAiadminMcpExtension(options: {
	url: string;
	token: string;
}): (pi: ExtensionAPI) => void {
	return (pi: ExtensionAPI) => {
		pi.registerMcpServer(
			AIADMIN_MCP_SERVER_NAME,
			createAiadminMcpConfig({ url: options.url, token: options.token }),
		);
	};
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/agent/mcp.test.ts`
Expected: PASS（3 passed）

- [ ] **Step 5: 提交**

```bash
git add src/agent/mcp.ts src/agent/mcp.test.ts
git commit -m "feat(ai): AiAdmin 的 MCP 服务器配置与注册扩展"
```

---

### Task 2: 接进 pi 会话

**Files:**
- Modify: `src/agent/pi-session.ts`
- Modify: `src/env.ts`（新增 `AIADMIN_MCP_URL`）
- Modify: `src/agent/pi-session.test.ts`（SDK mock 要有 `bindExtensions` 与 `createMcpExtension`）

**Interfaces:**
- Consumes: Task 1 的 `createAiadminMcpExtension(options)`
- Produces: `PiSessionOptions` 新增 `mcp?: { url: string; token: string }`（不给就不接 MCP）

- [ ] **Step 1: 写失败测试（改 `src/agent/pi-session.test.ts`）**

SDK mock 里补上 `createMcpExtension` 与 session 的 `bindExtensions`：

```ts
const bindExtensions = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("@earendil-works/pi-coding-agent", () => ({
	// …已有的 mock…
	createMcpExtension: vi.fn(() => ({ name: "mcp", factory: () => undefined })),
	// createAgentSession 返回的 session 要有 bindExtensions
	createAgentSession: vi.fn(async () => ({
		session: { dispose: () => {}, bindExtensions },
		extensionsResult: {},
	})),
}));
```

新增用例：

```ts
it("挂了 MCP 扩展并把扩展绑定上（bindExtensions 才会触发 session_start ⇒ 连接才建）", async () => {
	await createPiSession({
		tools: [fakeTool],
		systemPrompt: "你是助手。",
		conversationId: "conv-1",
		history: [],
		model: "minimax-cn/MiniMax-M3.1-Flash",
		mcp: { url: "https://example.test/api/v1/mcp", token: "user-jwt" },
	});

	// 扩展工厂里有 MCP 扩展 + 我们注册服务器的扩展
	const loader = vi.mocked(createAgentSession).mock.calls[0]?.[0]?.resourceLoader as {
		options?: { extensionFactories?: unknown[] };
	};
	expect(loader.options?.extensionFactories?.length).toBeGreaterThanOrEqual(2);
	// ⚠️ bindExtensions 必须被调用：它才发 session_start ⇒ MCP 才连
	expect(bindExtensions).toHaveBeenCalled();
});

it("没给 mcp ⇒ 不挂 MCP 扩展（后端没部署时也要能用）", async () => {
	await createPiSession({
		tools: [fakeTool],
		systemPrompt: "你是助手。",
		conversationId: "conv-1",
		history: [],
		model: "minimax-cn/MiniMax-M3.1-Flash",
	});

	const loader = vi.mocked(createAgentSession).mock.calls[0]?.[0]?.resourceLoader as {
		options?: { extensionFactories?: unknown[] };
	};
	expect(loader.options?.extensionFactories ?? []).toHaveLength(0);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/agent/pi-session.test.ts`
Expected: FAIL —— 扩展工厂为空、`bindExtensions` 没被调用

- [ ] **Step 3: 改 `src/env.ts`**

在 `Env` 接口与 zod schema 里加：

```ts
/**
 * AiAdmin 的 MCP 地址（工具的来源）。
 *
 * ⚠️ **缺省** `${AIADMIN_BASE_URL}/mcp` ⇒ 一般不用单独配；
 *    本地后端端口与线上不同时才需要显式写。
 */
AIADMIN_MCP_URL?: string;
```

（`AIADMIN_BASE_URL` 已在 `Env` 里 ⇒ 缺省值在用到的地方算，不在校验里算。）

- [ ] **Step 4: 改 `src/agent/pi-session.ts`**

- `PiSessionOptions` 加：

```ts
	/**
	 * AiAdmin 的 MCP 服务器（**不给就不接 MCP**）。
	 *
	 * ⚠️ token 是**这次调用方**的 ⇒ 每个会话一份。
	 */
	mcp?: { url: string; token: string };
```

- 扩展工厂：

```ts
	const extensionFactories = options.mcp
		? [createMcpExtension(), createAiadminMcpExtension(options.mcp)]
		: [];
```

并把它放进 `DefaultResourceLoader` 的选项（`extensionFactories`）。

- 建完会话后：

```ts
	// ⚠️ **必须 bindExtensions**：它才发 `session_start` ⇒ MCP 服务器这时才连。
	//    没这一步 ⇒ 扩展加载了但连接不会建立 ⇒ 模型看不到任何 MCP 工具。
	await session.bindExtensions({ mode: "print" });
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run src/agent/pi-session.test.ts`
Expected: PASS

- [ ] **Step 6: 全量验证**

Run: `npx vitest run && npx tsc --noEmit`
Expected: 全部 PASS；tsc 无输出

- [ ] **Step 7: 提交**

```bash
git add src/agent/pi-session.ts src/agent/pi-session.test.ts src/env.ts
git commit -m "feat(ai): pi 会话挂上 MCP 扩展（每会话带自己的 token）"
```

---

### Task 3: 假 MCP 传输层 —— 证明整条链路真的通

**Files:**
- Create: `src/agent/mcp.fake.ts`（**测试专用的假传输层**）
- Test: `src/agent/mcp.integration.test.ts`

**Interfaces:**
- Consumes: pi 的 `McpExtensionOptions.createTransport`（`(entry, cwd, authProvider) => McpTransport`）
- Produces:
  ```ts
  export interface FakeMcpServerOptions {
    /** 服务器提供的工具。 */
    tools?: Array<{ name: string; description?: string; inputSchema?: object }>;
    /** 调用工具时的返回值。 */
    onCallTool?: (name: string, args: Record<string, unknown>) => { content: Array<{ type: "text"; text: string }>; isError?: boolean };
  }
  export function createFakeMcpServer(options?: FakeMcpServerOptions): {
    createTransport: McpTransportFactory;
    /** 连了几次（用来验「token 变了会不会重建连接」）。 */
    connectionCount: () => number;
    /** 被调用过的工具与参数。 */
    calls: Array<{ name: string; args: Record<string, unknown> }>;
  };
  ```

- [ ] **Step 1: 写失败测试**

```ts
// src/agent/mcp.integration.test.ts
import { describe, expect, it } from "vitest";
import { createFakeMcpServer } from "./mcp.fake";
import { createAgentSession } from "@earendil-works/pi-coding-agent";

describe("MCP 链路（假服务器）", () => {
	it("模型能看到 mcp__aiadmin__* 的工具", async () => {
		const fake = createFakeMcpServer({
			tools: [{ name: "list_tasks", description: "列任务", inputSchema: { type: "object" } }],
		});

		const { session } = await createAgentSession({
			sessionManager: SessionManager.inMemory(),
			extensionFactories: [
				createMcpExtension({ createTransport: fake.createTransport }),
				createAiadminMcpExtension({ url: "http://fake/mcp", token: "user-jwt" }),
			],
		});
		await session.bindExtensions({ mode: "print" });
		// 等连接建立
		await vi.waitFor(() => {
			expect(session.getActiveToolNames()).toContain("mcp__aiadmin__list_tasks");
		});
		session.dispose();
	});

	it("调用 MCP 工具时走的是假服务器（且参数原样传过去）", async () => {
		// …同上，创建会话后调用 session 的工具（具体调用 API 见实现时的 SDK 文档）
	});
});
```

> ⚠️ 这一步的**具体调用姿势**在实现时按 SDK 的实际 API 调整（`session.prompt` + 监听
> `tool_call` 事件，或直接用 pi 的工具调用入口）。**断言不变**：工具进了模型的工具列表，
> 调用时假服务器收到了参数。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/agent/mcp.integration.test.ts`
Expected: FAIL —— `Cannot find module './mcp.fake'`

- [ ] **Step 3: 实现 `src/agent/mcp.fake.ts`**

实现 `McpTransport`（`start` / `send` / `close` / `onMessage` / `onError` / `onClose`），
按 JSON-RPC 应答：

| 收到 | 回 |
| ---- | -- |
| `initialize` | `{protocolVersion:"2024-11-05", capabilities:{}, serverInfo:{name:"fake",version:"1"}}` |
| `notifications/initialized` | 不回（通知） |
| `tools/list` | `{tools: options.tools}` |
| `tools/call` | `options.onCallTool(name, args)` 的返回值 |

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/agent/mcp.integration.test.ts`
Expected: PASS

- [ ] **Step 5: 全量验证并提交**

```bash
npx vitest run && npx tsc --noEmit
git add src/agent/mcp.fake.ts src/agent/mcp.integration.test.ts
git commit -m "test(ai): 假 MCP 传输层 —— 证明模型能看到并调用 MCP 工具"
```

---

### Task 4: token 轮换 —— 换用户就换会话

**Files:**
- Modify: `src/agent/runtime.ts`（会话与 token 的绑定）
- Test: `src/agent/runtime.test.ts`

**Interfaces:**
- Consumes: `PiSessionOptions.mcp`
- Produces: 运行时在「token 变了」时**重建**该会话的 pi 会话（连带重建 MCP 连接）

- [ ] **Step 1: 写失败测试**

```ts
it("token 变了 ⇒ 重建 pi 会话（老会话不能继续用旧 token 调 MCP）", async () => {
	// 造一个能记录 createSession 调用次数的运行时
	// 第一次用 token-a 提交命令；第二次用 token-b 提交命令
	// ⇒ 断言 createSession 被调用了两次，且第二次带的是 token-b
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/agent/runtime.test.ts`
Expected: FAIL —— 现在 token 变了也不会重建会话

- [ ] **Step 3: 实现**

- `runtime.ts` 的 `submitCommand` 里：比较 `channel.token` 与新 token；不同 ⇒
  `this.#registry.close(conversationId)`（关掉旧 pi 会话与 MCP 连接），
  下一轮 `#ensureSession` 会用新 token 建一个新的。
- `#ensureSession` 把 `channel.token` 传给 `createSession({ ..., mcp: { url, token } })`。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/agent/runtime.test.ts`
Expected: PASS

- [ ] **Step 5: 全量验证并提交**

```bash
npx vitest run && npx tsc --noEmit
git add src/agent/runtime.ts src/agent/runtime.test.ts
git commit -m "feat(ai): token 轮换时重建会话（MCP 不复用旧 token）"
```

---

### Task 5: 环境变量与文档

**Files:**
- Modify: `src/env.ts`（`AIADMIN_MCP_URL` 的缺省值）
- Modify: `README.md`（新增「MCP」一节）
- Modify: `.env.example`

- [ ] **Step 1: 补 `AIADMIN_MCP_URL` 的缺省**

```ts
/** AiAdmin 的 MCP 地址（缺省 `${AIADMIN_BASE_URL}/mcp`）。 */
export function aiadminMcpUrl(baseUrl: string): string {
	return `${baseUrl.replace(/\/$/, "")}/mcp`;
}
```

- [ ] **Step 2: README 补「MCP」一节**

写清：工具从哪来（后端 MCP）、MCP 地址怎么配、工具名带 `mcp__aiadmin__` 前缀、
后端没部署时 AI 仍可用（只是没有这些工具）、**新增能力不用改本仓代码**。

- [ ] **Step 3: `.env.example` 补一行**

```
# AiAdmin 的 MCP 地址（工具的来源）；缺省 = AIADMIN_BASE_URL + /mcp
AIADMIN_MCP_URL=
```

- [ ] **Step 4: 全量验证并提交**

```bash
npx vitest run && npx tsc --noEmit
git add src/env.ts README.md .env.example
git commit -m "docs(ai): MCP 一节（工具来源、地址、前缀）"
```

---

## 不在本计划范围

- **真实后端验收**（`https://…/api/v1/mcp` 真的列出工具、真的建出任务）：等后端部署完成后手动跑。
- **阶段 3（待确认闭环）**：修改类工具挂起 + 用户点头 + 执行 + 注回会话。
- **技能里用上 MCP 工具名**：样板技能现在写「你工具里那个…的工具」⇒ MCP 接上后自动可用；
  若之后要写死名字，再单独评估（工具名会随后端 tag 白名单变化）。
