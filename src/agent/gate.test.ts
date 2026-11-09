import { describe, expect, it, vi } from "vitest";
import { createGateExtension, requiresConfirmation } from "./gate";
import { PendingWaiterRegistry } from "./pending-waiters";

/** 假的 pi 扩展 API（只实现我们用到的两个方法）。 */
function fakePi(): {
	pi: unknown;
	handlers: Map<string, (event: unknown) => Promise<unknown>>;
} {
	const handlers = new Map<string, (event: unknown) => Promise<unknown>>();
	const pi = {
		on: (event: string, handler: (e: unknown) => Promise<unknown>) => {
			handlers.set(event, handler);
		},
		registerTool: vi.fn(),
	};
	return { pi, handlers };
}

/** 假的「建 pending」（不落库）。 */
function fakeCreatePending(id = "p-fake"): (input: unknown) => Promise<{ id: string }> {
	return async () => ({ id });
}

describe("闸门", () => {
	it("只有「修改已有数据」的工具要人点头", () => {
		expect(requiresConfirmation("mcp__aiadmin__update_task")).toBe(true);
		expect(requiresConfirmation("mcp__aiadmin__patch_task_status")).toBe(true);
		expect(requiresConfirmation("mcp__aiadmin__create_task")).toBe(false);
		expect(requiresConfirmation("mcp__aiadmin__list_tasks")).toBe(false);
		expect(requiresConfirmation("load_skill")).toBe(false);
	});

	it("命中修改类工具 ⇒ 挂起；批准后放行（不 block）", async () => {
		const waiters = new PendingWaiterRegistry();
		const onPending = vi.fn();
		const { pi, handlers } = fakePi();

		await createGateExtension({
			waiters,
			createPending: fakeCreatePending(),
			context: () => ({
				conversationId: "c1",
				userId: "2",
				onPending,
			}),
		})(pi as never);

		const hook = handlers.get("tool_call");
		expect(hook).toBeDefined();

		const pending = hook?.({
			type: "tool_call",
			toolName: "mcp__aiadmin__update_task",
			toolCallId: "call-1",
			input: { id: 117, title: "新标题" },
		});

		// 挂起了：等待者在等，界面收到了通知
		await vi.waitFor(() => {
			expect(waiters.size()).toBe(1);
			expect(onPending).toHaveBeenCalledTimes(1);
		});
		const row = onPending.mock.calls[0]?.[0] as { id: string; command: string };

		// 批准 ⇒ 放行（返回 undefined ⇒ pi 照常执行原调用）
		expect(waiters.decide(row.id, "approved")).toBe(true);
		expect(await pending).toBeUndefined();
	});

	it("拒绝 ⇒ block，并给出人话原因", async () => {
		const waiters = new PendingWaiterRegistry();
		const onPending = vi.fn();
		const { pi, handlers } = fakePi();

		await createGateExtension({
			waiters,
			createPending: fakeCreatePending(),
			context: () => ({ conversationId: "c1", userId: "2", onPending }),
		})(pi as never);

		const pending = handlers.get("tool_call")?.({
			type: "tool_call",
			toolName: "mcp__aiadmin__update_task",
			toolCallId: "call-1",
			input: { id: 117 },
		});

		await vi.waitFor(() => {
			expect(waiters.size()).toBe(1);
		});
		const row = onPending.mock.calls[0]?.[0] as { id: string };
		waiters.decide(row.id, "rejected");

		const result = (await pending) as { block?: boolean; reason?: string } | undefined;
		expect(result?.block).toBe(true);
		expect(result?.reason).toContain("拒绝");
	});

	it("超时 ⇒ block，并说清是等太久", async () => {
		const waiters = new PendingWaiterRegistry();
		const onPending = vi.fn();
		const { pi, handlers } = fakePi();

		await createGateExtension({
			waiters,
			timeoutMs: 10,
			createPending: fakeCreatePending(),
			context: () => ({ conversationId: "c1", userId: "2", onPending }),
		})(pi as never);

		const pending = handlers.get("tool_call")?.({
			type: "tool_call",
			toolName: "mcp__aiadmin__update_task",
			toolCallId: "call-1",
			input: { id: 117 },
		});

		const result = (await pending) as { block?: boolean; reason?: string } | undefined;
		expect(result?.block).toBe(true);
		expect(result?.reason).toContain("作废");
	});

	it("不在修改类工具上 ⇒ 直接放行（不等批准）", async () => {
		const waiters = new PendingWaiterRegistry();
		const { pi, handlers } = fakePi();

		await createGateExtension({
			waiters,
			createPending: fakeCreatePending(),
			context: () => ({ conversationId: "c1", userId: "2", onPending: vi.fn() }),
		})(pi as never);

		const result = await handlers.get("tool_call")?.({
			type: "tool_call",
			toolName: "mcp__aiadmin__create_task",
			toolCallId: "call-1",
			input: { title: "新任务" },
		});

		expect(result).toBeUndefined();
		expect(waiters.size()).toBe(0);
	});
});
