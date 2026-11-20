/**
 * 闸门**决策** —— 等人点头 + 按规则收窄参数。
 *
 * ⚠️ 闸门**不写死业务知识**：哪些字段能改、哪个工具不许用 ⇒ 都是**插件的写规则**
 *    （`WriteToolRule`）。这里用的是**假规则** ⇒ 单测不依赖任何业务插件。
 *
 * ⚠️ 这份测试以前挂在 pi 的 `tool_call` hook 上（issue #123 拔 pi ⇒ 改成直接测决策）。
 */

import { describe, expect, it, vi } from "vitest";
import type { ContextAnchor, WriteToolRule } from "../context/anchor.ts";
import { requiresConfirmation } from "./gate.ts";
import { decideWrite, type GateContext } from "./decision.ts";
import { PendingWaiterRegistry } from "./pending-waiters.ts";

/** 假的「建 pending」（不落库）。 */
function fakeCreatePending(id = "p-fake"): GateContext["createPending"] {
	return async () => ({ id });
}

/** 造一个闸门上下文（**假等待者 + 假待确认表**）。 */
function contextOf(overrides: Partial<GateContext> = {}): GateContext & {
	pending: { id: string; command: string; args: Record<string, unknown> }[];
} {
	const pending: { id: string; command: string; args: Record<string, unknown> }[] = [];
	return {
		conversationId: "c1",
		userId: "2",
		waiters: new PendingWaiterRegistry(),
		createPending: async (input) => {
			const row = { id: `pending-${pending.length + 1}`, ...input };
			pending.push(row);
			return { id: row.id };
		},
		timeoutMs: 50,
		onPending: () => undefined,
		...overrides,
		pending,
	} as GateContext & {
		pending: { id: string; command: string; args: Record<string, unknown> }[];
	};
}

/** 假的锚点（一条「被讨论的东西」：基线 + 可写字段白名单）。 */
function fakeAnchor(): ContextAnchor {
	return {
		scope: { type: "thing", id: "123" },
		baseline: {
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
		values: {},
		writableFields: ["status_code", "actual_hours", "description"],
	};
}

/** 假的写规则（整对象 PUT + 白名单 + 一个「不许用」的工具）。 */
const fakeRules: readonly WriteToolRule[] = [
	{
		tool: "update_thing",
		wholeObject: true,
		baseline: (anchor) => anchor.baseline,
		requiredFields: ["id", "project_id", "title", "type_code", "status_code", "priority_code"],
		anchorFields: ["id"],
	},
	{
		tool: "patch_thing_status",
		blocked: { reason: "这个工具改的是「是否可用」，不是状态。请用 update_thing。" },
	},
];

describe("闸门口径", () => {
	it("只有「修改已有数据」的工具要人点头", () => {
		expect(requiresConfirmation("mcp__aiadmin__update_task")).toBe(true);
		expect(requiresConfirmation("mcp__aiadmin__patch_task_status")).toBe(true);
		expect(requiresConfirmation("mcp__aiadmin__create_task")).toBe(false);
		expect(requiresConfirmation("mcp__aiadmin__list_tasks")).toBe(false);
		expect(requiresConfirmation("load_skill")).toBe(false);
	});
});

describe("闸门决策", () => {
	it("命中修改类工具 ⇒ 挂起；批准后放行", async () => {
		const waiters = new PendingWaiterRegistry();
		const onPending = vi.fn();
		const context = contextOf({ waiters, createPending: fakeCreatePending(), onPending });

		const pending = decideWrite(
			{ toolName: "mcp__aiadmin__update_task", args: { id: 117, title: "新标题" } },
			context,
		);

		// 挂起了：等待者在等，界面收到了通知
		await vi.waitFor(() => {
			expect(waiters.size()).toBe(1);
			expect(onPending).toHaveBeenCalledTimes(1);
		});
		const row = onPending.mock.calls[0]?.[0] as { id: string; command: string };

		// 批准 ⇒ 放行
		expect(waiters.decide(row.id, "approved")).toBe(true);
		const decision = await pending;
		expect(decision.kind).toBe("allow");
	});

	it("有讨论上下文 ⇒ 把写参数**收窄**到允许回填的字段", async () => {
		const waiters = new PendingWaiterRegistry();
		const onPending = vi.fn();
		const context = contextOf({
			waiters,
			createPending: fakeCreatePending(),
			onPending,
			anchor: fakeAnchor(),
			writeRules: fakeRules,
		});

		const pending = decideWrite(
			{
				toolName: "mcp__aiadmin__update_thing",
				args: {
					id: 123,
					title: "模型想改的标题",
					status_code: "done",
					actual_hours: "8",
					assignee_id: 999,
				},
			},
			context,
		);
		await vi.waitFor(() => {
			expect(onPending).toHaveBeenCalledTimes(1);
		});
		// 白名单外的字段被丢掉（回到锚点里的原值）
		const row = onPending.mock.calls[0]?.[0] as { args: Record<string, unknown> };
		expect(row.args["status_code"]).toBe("done");
		expect(row.args["actual_hours"]).toBe("8");
		expect(row.args["title"]).toBe("支付回调联调");
		expect(row.args["assignee_id"]).toBe(1);
		// 必填字段一个都不能少（整对象 PUT）
		for (const key of ["project_id", "title", "type_code", "status_code", "priority_code"]) {
			expect(row.args).toHaveProperty(key);
		}
		// 待确认卡片里显示的也是这份（用户确认的就是真正要写的）
		waiters.decide("p-fake", "approved");
		const decision = await pending;
		expect(decision.kind).toBe("allow");
	});

	it("插件说这个工具不许用 ⇒ 拦住（并说明为什么）", async () => {
		const waiters = new PendingWaiterRegistry();
		const onPending = vi.fn();
		const context = contextOf({
			waiters,
			createPending: fakeCreatePending(),
			onPending,
			anchor: fakeAnchor(),
			writeRules: fakeRules,
		});

		const decision = await decideWrite(
			{ toolName: "mcp__aiadmin__patch_thing_status", args: { ids: [123], status: "done" } },
			context,
		);

		expect(decision.kind).toBe("reject");
		expect(decision.kind === "reject" ? decision.reason : "").toContain("update_thing");
		// ⚠️ 拦在**建待确认之前** ⇒ 不留孤儿待确认记录
		expect(onPending).not.toHaveBeenCalled();
		expect(waiters.size()).toBe(0);
	});

	it("没有讨论上下文时那个工具照旧挂起（那是别的场景）", async () => {
		const waiters = new PendingWaiterRegistry();
		const context = contextOf({ waiters, createPending: fakeCreatePending() });

		const pending = decideWrite(
			{ toolName: "mcp__aiadmin__patch_task_status", args: { ids: [123], status: 1 } },
			context,
		);
		await vi.waitFor(() => {
			expect(waiters.size()).toBe(1);
		});
		waiters.decide("p-fake", "approved");
		expect((await pending).kind).toBe("allow");
	});

	it("拒绝 ⇒ 拒绝，并给出人话原因", async () => {
		const waiters = new PendingWaiterRegistry();
		const onPending = vi.fn();
		const context = contextOf({ waiters, createPending: fakeCreatePending(), onPending });

		const pending = decideWrite(
			{ toolName: "mcp__aiadmin__update_task", args: { id: 117 } },
			context,
		);

		await vi.waitFor(() => {
			expect(waiters.size()).toBe(1);
		});
		const row = onPending.mock.calls[0]?.[0] as { id: string };
		waiters.decide(row.id, "rejected");

		const decision = await pending;
		expect(decision.kind).toBe("reject");
		expect(decision.kind === "reject" ? decision.reason : "").toContain("拒绝");
	});

	it("超时 ⇒ 拒绝，并说清是等太久", async () => {
		const waiters = new PendingWaiterRegistry();
		const context = contextOf({
			waiters,
			createPending: fakeCreatePending(),
			timeoutMs: 10,
		});

		const decision = await decideWrite(
			{ toolName: "mcp__aiadmin__update_task", args: { id: 117 } },
			context,
		);

		expect(decision.kind).toBe("reject");
		expect(decision.kind === "reject" ? decision.reason : "").toContain("作废");
	});

	it("不在修改类工具上 ⇒ 直接放行（不等批准）", async () => {
		const waiters = new PendingWaiterRegistry();
		const context = contextOf({ waiters, createPending: fakeCreatePending() });

		const decision = await decideWrite(
			{ toolName: "mcp__aiadmin__create_task", args: { title: "新任务" } },
			context,
		);

		expect(decision.kind).toBe("allow");
		expect(waiters.size()).toBe(0);
	});
});
