/**
 * 闸门的**真链路**（真 SDK + 假 MCP 服务器）。
 *
 * ## 为什么要有它
 *
 * 闸门的主张是「**批准后 pi 照常执行原工具调用**（那一轮不打断）」。
 * 这件事只有**真的 pi**（真的 `tool_call` hook + 真的 await）才能证明。
 *
 * ## ⚠️ 一个实测出来的坑
 *
 * `tool.execute(...)` 是**直接调工具** ⇒ **绕过了整条流水线**
 * ⇒ `tool_call` hook **不会触发** ⇒ 闸门形同不存在。
 * ⇒ 真链路里要调 **`session.agent.beforeToolCall(...)`**（流水线的入口）。
 *
 * ## 覆盖三件事
 *
 * 1. 命中「修改类工具」⇒ **挂起**（通知到了）；
 * 2. 批准 ⇒ hook 放行（返回 undefined）⇒ 流程可以继续执行原调用；
 * 3. 拒绝 ⇒ hook 返回 `{block:true, reason}` ⇒ 模型会收到「被拒绝」的错误。
 */

import { describe, expect, it, vi } from "vitest";
import {
	createAgentSession,
	createMcpExtension,
	DefaultResourceLoader,
	SessionManager,
	type AgentSession,
} from "@earendil-works/pi-coding-agent";
import { createFakeMcpServer } from "./mcp.fake";
import { createAiadminMcpExtension } from "./mcp";
import { createGateExtension } from "./gate";
import { PendingWaiterRegistry } from "./pending-waiters";

/** 造一个带假 MCP 服务器 + 闸门的会话。 */
async function sessionWithGate(fake: {
	createTransport: () => never;
}, waiters: PendingWaiterRegistry): Promise<{
	session: AgentSession;
	pendingRows: Array<{ id: string; command: string; args: Record<string, unknown> }>;
}> {
	const pendingRows: Array<{ id: string; command: string; args: Record<string, unknown> }> = [];
	const loader = new DefaultResourceLoader({
		cwd: process.cwd(),
		agentDir: `${process.cwd()}/.ai/agent`,
		noExtensions: true,
		noSkills: false,
		extensionFactories: [
			createMcpExtension({ createTransport: fake.createTransport as never }),
			createAiadminMcpExtension({ url: "http://fake.local/mcp", token: "user-jwt" }),
			createGateExtension({
				waiters,
				context: () => ({
					conversationId: "c1",
					userId: "2",
					onPending: (row) => {
						pendingRows.push(row);
					},
				}),
				// 不落库（单测里没有 DB）
				createPending: async () => ({ id: "p-fake" }),
			}),
		],
	});
	await loader.reload();

	const { session } = await createAgentSession({
		resourceLoader: loader,
		sessionManager: SessionManager.inMemory(),
	});
	await session.bindExtensions({ mode: "print" });
	return { session, pendingRows };
}

/**
 * 走**真实流水线**的入口（`tool.execute` 会绕过它 ⇒ hook 不触发）。
 */
function callThroughPipeline(
	session: AgentSession,
	toolName: string,
	args: Record<string, unknown>,
): Promise<{ block?: boolean; reason?: string } | undefined> {
	const agent = session.agent as unknown as {
		beforeToolCall?: (context: unknown) => Promise<
			{ block?: boolean; reason?: string } | undefined
		>;
	};
	return (
		agent.beforeToolCall?.({
			assistantMessage: { role: "assistant", content: [] },
			toolCall: { id: "call-1", name: toolName, arguments: args },
			args,
			context: {},
		}) ?? Promise.resolve(undefined)
	);
}

describe("闸门（真链路）", () => {
	it("命中修改类工具 ⇒ 先挂起（通知到了，工具还没执行）", async () => {
		const fake = createFakeMcpServer({
			tools: [
				{ name: "update_task", description: "改任务", inputSchema: { type: "object" } },
			],
		});
		const waiters = new PendingWaiterRegistry();
		const { session, pendingRows } = await sessionWithGate(fake, waiters);
		try {
			await vi.waitFor(() => {
				expect(session.getActiveToolNames()).toContain("mcp__aiadmin__update_task");
			});

			const calling = callThroughPipeline(session, "mcp__aiadmin__update_task", {
				id: 117,
				title: "新标题",
			});

			await vi.waitFor(() => {
				expect(pendingRows).toHaveLength(1);
			});
			expect(pendingRows[0]?.command).toBe("mcp__aiadmin__update_task");
			// 还没执行（假服务器没收到调用）
			expect(fake.calls).toHaveLength(0);

			waiters.decide("p-fake", "rejected");
			await calling;
		} finally {
			session.dispose();
		}
	});

	it("⭐ 批准 ⇒ hook 放行（返回 undefined ⇒ 流程继续执行原调用）", async () => {
		const fake = createFakeMcpServer({
			tools: [
				{ name: "update_task", description: "改任务", inputSchema: { type: "object" } },
			],
		});
		const waiters = new PendingWaiterRegistry();
		const { session, pendingRows } = await sessionWithGate(fake, waiters);
		try {
			await vi.waitFor(() => {
				expect(session.getActiveToolNames()).toContain("mcp__aiadmin__update_task");
			});

			const calling = callThroughPipeline(session, "mcp__aiadmin__update_task", {
				id: 117,
				title: "新标题",
			});
			await vi.waitFor(() => {
				expect(pendingRows).toHaveLength(1);
			});

			waiters.decide("p-fake", "approved");
			// 放行 ⇒ 没有 block ⇒ 流水线继续（pi 接着执行原调用）
			expect(await calling).toBeUndefined();

			// 放行之后，原调用真的执行了（参数还是模型给的那份）
			const tool = session.agent.state.tools.find(
				(candidate) => candidate.name === "mcp__aiadmin__update_task",
			);
			await tool?.execute("call-1", { id: 117, title: "新标题" });
			expect(fake.calls).toEqual([
				{ name: "update_task", args: { id: 117, title: "新标题" } },
			]);
		} finally {
			session.dispose();
		}
	});

	it("拒绝 ⇒ block（模型会收到「被拒绝」的错误）", async () => {
		const fake = createFakeMcpServer({
			tools: [
				{ name: "update_task", description: "改任务", inputSchema: { type: "object" } },
			],
		});
		const waiters = new PendingWaiterRegistry();
		const { session, pendingRows } = await sessionWithGate(fake, waiters);
		try {
			await vi.waitFor(() => {
				expect(session.getActiveToolNames()).toContain("mcp__aiadmin__update_task");
			});

			const calling = callThroughPipeline(session, "mcp__aiadmin__update_task", {
				id: 117,
			});
			await vi.waitFor(() => {
				expect(pendingRows).toHaveLength(1);
			});
			waiters.decide("p-fake", "rejected");

			const result = await calling;
			expect(result?.block).toBe(true);
			expect(result?.reason).toContain("拒绝");
			// 工具**没有**执行
			expect(fake.calls).toHaveLength(0);
		} finally {
			session.dispose();
		}
	});

	it("创建类工具不受闸门影响（直接放行）", async () => {
		const fake = createFakeMcpServer({
			tools: [
				{ name: "create_task", description: "建任务", inputSchema: { type: "object" } },
			],
		});
		const waiters = new PendingWaiterRegistry();
		const { session, pendingRows } = await sessionWithGate(fake, waiters);
		try {
			await vi.waitFor(() => {
				expect(session.getActiveToolNames()).toContain("mcp__aiadmin__create_task");
			});

			const result = await callThroughPipeline(session, "mcp__aiadmin__create_task", {
				title: "新任务",
			});

			expect(result).toBeUndefined();
			expect(pendingRows).toHaveLength(0);
			expect(waiters.size()).toBe(0);
		} finally {
			session.dispose();
		}
	});
});
