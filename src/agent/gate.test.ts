import { describe, expect, it, vi } from "vitest";
import { createGateExtension, isAvailabilityTool, requiresConfirmation } from "./gate";
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

	it("有讨论上下文 ⇒ 把写参数**收窄**到允许回填的字段（就地改写）", async () => {
		const waiters = new PendingWaiterRegistry();
		const onPending = vi.fn();
		const { pi, handlers } = fakePi();
		const taskContext = {
			task: {
				id: 123,
				project_id: 6,
				title: "支付回调联调",
				type_code: "feature",
				status_code: "in_progress",
				priority_code: "P0",
				assignee_id: 1,
				due_date: "2026-11-10",
				actual_hours: "3",
				description: "原来的描述",
			},
		};
		await createGateExtension({
			waiters,
			createPending: fakeCreatePending(),
			context: () => ({
				conversationId: "c1",
				userId: "2",
				onPending,
				taskContext,
			}),
		})(pi as never);
		const hook = handlers.get("tool_call");
		// ⚠️ pi 把 args 的**同一个对象**传给 hook ⇒ 就地改写才生效
		const input: Record<string, unknown> = {
			id: 123,
			title: "模型想改的标题",
			status_code: "done",
			actual_hours: "8",
			assignee_id: 999,
		};
		const pending = hook?.({
			type: "tool_call",
			toolName: "mcp__aiadmin__update_task",
			toolCallId: "call-9",
			input,
		});
		await vi.waitFor(() => {
			expect(onPending).toHaveBeenCalledTimes(1);
		});
		// 模型给的参数已经被就地改写 ⇒ pi 之后执行的就是这份
		expect(input["status_code"]).toBe("done");
		expect(input["actual_hours"]).toBe("8");
		// 白名单外的字段被丢掉（回到上下文里的原值）
		expect(input["title"]).toBe("支付回调联调");
		expect(input["assignee_id"]).toBe(1);
		// 必填字段一个都不能少（整对象 PUT）
		for (const key of ["project_id", "title", "type_code", "status_code", "priority_code"]) {
			expect(input).toHaveProperty(key);
		}
		// 待确认卡片里显示的也是这份（用户确认的就是真正要写的）
		const row = onPending.mock.calls[0]?.[0] as { args: Record<string, unknown> };
		expect(row.args["status_code"]).toBe("done");
		expect(row.args["assignee_id"]).toBe(1);
		waiters.decide("p-fake", "approved");
		expect(await pending).toBeUndefined();
	});

	it("patch_task_status 其实是「改可用状态」的工具", () => {
		expect(isAvailabilityTool("mcp__aiadmin__patch_task_status")).toBe(true);
		expect(isAvailabilityTool("mcp__aiadmin__update_task")).toBe(false);
	});

	it("讨论某条任务时用 patch_task_status 改状态 ⇒ 拦住（它改不了 status_code）", async () => {
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
				taskContext: {
					task: {
						id: 123,
						project_id: 6,
						title: "支付回调联调",
						type_code: "feature",
						status_code: "in_progress",
						priority_code: "P0",
					},
				},
			}),
		})(pi as never);

		const result = (await handlers.get("tool_call")?.({
			type: "tool_call",
			toolName: "mcp__aiadmin__patch_task_status",
			toolCallId: "call-1",
			input: { ids: [123], status: "done" },
		})) as { block?: boolean; reason?: string } | undefined;

		expect(result?.block).toBe(true);
		expect(result?.reason).toContain("update_task");
		// ⚠️ 拦在**建待确认之前** ⇒ 不留孤儿待确认记录
		expect(onPending).not.toHaveBeenCalled();
		expect(waiters.size()).toBe(0);
	});

	it("没有讨论上下文时 patch_task_status 照旧挂起（那是别的场景）", async () => {
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
			toolName: "mcp__aiadmin__patch_task_status",
			toolCallId: "call-1",
			input: { ids: [123], status: 1 },
		});
		await vi.waitFor(() => {
			expect(waiters.size()).toBe(1);
		});
		waiters.decide("p-fake", "approved");
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
