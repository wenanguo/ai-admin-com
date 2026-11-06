/**
 * MCP 链路（**假服务器**）—— 证明整条链路真的通。
 *
 * ## 为什么用假服务器
 *
 * MCP 的真实对手方是后端（还没部署）⇒ 但「模型能看到 MCP 工具、调用它时参数原样送过去」
 * 这条链路必须**现在**就能验证。
 *
 * pi 的 MCP 扩展接受 `createTransport` 钩子 ⇒ 注入一个假的传输层，
 * 它按 JSON-RPC 应答 `initialize` / `tools/list` / `tools/call`。
 *
 * ⚠️ 两个实测出来的关键点：
 * 1. **`extensionFactories` 是 `DefaultResourceLoader` 的选项**，不是 `createAgentSession` 的
 *    （后者会静默忽略 ⇒ 扩展根本没加载 ⇒ 一个工具都不出现）。
 * 2. **连接是异步的**：`bindExtensions` 之后要等一个事件循环 ⇒ 测试里得 `waitFor`。
 *
 * ⚠️ 这里**没有模型**（不调模型、不花钱）⇒ 工具的调用是**直接调工具**触发的。
 */

import { describe, expect, it, vi } from "vitest";
import {
	createAgentSession,
	createMcpExtension,
	DefaultResourceLoader,
	SessionManager,
	type AgentSession,
} from "@earendil-works/pi-coding-agent";
import { createFakeMcpServer, type FakeMcpServer } from "./mcp.fake";
import { createAiadminMcpExtension } from "./mcp";
import { createPiSession } from "./pi-session";

/** 造一个带假 MCP 服务器的会话（与生产同构：扩展工厂挂在 loader 上）。 */
async function sessionWithFakeMcp(fake: FakeMcpServer): Promise<{
	session: Awaited<ReturnType<typeof createAgentSession>>["session"];
}> {
	const loader = new DefaultResourceLoader({
		cwd: process.cwd(),
		agentDir: `${process.cwd()}/.ai/agent`,
		// ⚠️ 与生产一致：扩展只走 inline 工厂，不读磁盘上的扩展
		noExtensions: true,
		noSkills: false,
		extensionFactories: [
			createMcpExtension({ createTransport: fake.createTransport as never }),
			createAiadminMcpExtension({ url: "http://fake.local/mcp", token: "user-jwt" }),
		],
	});
	await loader.reload();

	const { session } = await createAgentSession({
		resourceLoader: loader,
		sessionManager: SessionManager.inMemory(),
	});
	await session.bindExtensions({ mode: "print" });
	return { session };
}

/** 找工具。 */
function toolOf(
	session: Awaited<ReturnType<typeof createAgentSession>>["session"],
	name: string,
): { execute: (id: string, params: object) => Promise<unknown> } | undefined {
	return session.agent.state.tools.find((candidate) => candidate.name === name) as
		| { execute: (id: string, params: object) => Promise<unknown> }
		| undefined;
}

describe("MCP 链路（假服务器）", () => {
	it("模型能看到 mcp__aiadmin__* 的工具", async () => {
		const fake = createFakeMcpServer({
			tools: [
				{ name: "list_tasks", description: "列任务", inputSchema: { type: "object" } },
			],
		});

		const { session } = await sessionWithFakeMcp(fake);
		try {
			await vi.waitFor(() => {
				expect(session.getActiveToolNames()).toContain("mcp__aiadmin__list_tasks");
			});
		} finally {
			session.dispose();
		}
	});

	it("调用 MCP 工具时参数原样送到后端（假服务器收到了）", async () => {
		const fake = createFakeMcpServer({
			tools: [
				{ name: "list_tasks", description: "列任务", inputSchema: { type: "object" } },
			],
			onCallTool: (name, args) => ({
				content: [{ type: "text", text: `ok ${name} ${JSON.stringify(args)}` }],
			}),
		});

		const { session } = await sessionWithFakeMcp(fake);
		try {
			await vi.waitFor(() => {
				expect(session.getActiveToolNames()).toContain("mcp__aiadmin__list_tasks");
			});

			const tool = toolOf(session, "mcp__aiadmin__list_tasks");
			expect(tool).toBeDefined();

			const result = await tool?.execute("call-1", { project_id: 45 });

			// ⚠️ 参数原样送到了 MCP 服务器
			expect(fake.calls).toEqual([{ name: "list_tasks", args: { project_id: 45 } }]);
			// 结果回到调用方
			expect(JSON.stringify(result)).toContain("ok list_tasks");
		} finally {
			session.dispose();
		}
	});

	it("服务器报的工具错误 ⇒ 回到调用方（不是崩掉）", async () => {
		const fake = createFakeMcpServer({
			tools: [
				{ name: "list_tasks", description: "列任务", inputSchema: { type: "object" } },
			],
			onCallTool: () => ({
				content: [{ type: "text", text: "后端挂了" }],
				isError: true,
			}),
		});

		const { session } = await sessionWithFakeMcp(fake);
		try {
			await vi.waitFor(() => {
				expect(session.getActiveToolNames()).toContain("mcp__aiadmin__list_tasks");
			});
			const tool = toolOf(session, "mcp__aiadmin__list_tasks");
			const result = await tool?.execute("call-1", {});
			expect(JSON.stringify(result)).toContain("后端挂了");
		} finally {
			session.dispose();
		}
	});

	it("MCP 连不上 ⇒ 会话仍要建得起来（后端没部署时不能 500）", async () => {
		const loader = new DefaultResourceLoader({
			cwd: process.cwd(),
			agentDir: `${process.cwd()}/.ai/agent`,
			noExtensions: true,
			noSkills: false,
			extensionFactories: [
				createMcpExtension({
					createTransport: () => {
						throw new Error("连不上");
					},
				}),
				createAiadminMcpExtension({ url: "http://fake.local/mcp", token: "user-jwt" }),
			],
		});
		await loader.reload();

		const { session } = await createAgentSession({
			resourceLoader: loader,
			sessionManager: SessionManager.inMemory(),
		});
		try {
			await session.bindExtensions({ mode: "print" });
			// 会话能用（只是没有那些工具）
			expect(session.getActiveToolNames()).not.toContain("mcp__aiadmin__list_tasks");
		} finally {
			session.dispose();
		}
	});
});

describe("MCP 链路（走真实的 createPiSession）", () => {
	it("⭐ 生产代码路径：会话建好后，模型能看到 mcp__aiadmin__* 的工具", async () => {
		const fake = createFakeMcpServer({
			tools: [
				{ name: "list_tasks", description: "列任务", inputSchema: { type: "object" } },
			],
		});

		const session = (await createPiSession({
			tools: [],
			systemPrompt: "你是助手。",
			conversationId: "conv-1",
			history: [],
			model: "minimax-cn/MiniMax-M3.1-Flash",
			mcp: {
				url: "http://fake.local/mcp",
				token: "user-jwt",
				createTransport: fake.createTransport as never,
			},
		})) as unknown as AgentSession;

		try {
			await vi.waitFor(() => {
				expect(session.getActiveToolNames()).toContain("mcp__aiadmin__list_tasks");
			});
		} finally {
			session.dispose();
		}
	});
});
