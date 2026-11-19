/**
 * 闸门接线 —— dsh 的 `approval/request` ⇒ **我们的闸门** ⇒ outcome。
 *
 * ⚠️ 口径：「新增放行、修改要点头」；没有回答者 ⇒ **不放行**（fail closed）。
 */

import { describe, expect, it } from "vitest";
import { decideApproval, type DshGateContext } from "./approvals.ts";
import { PendingWaiterRegistry } from "../../gate/pending-waiters.ts";

/** 造一个闸门上下文（**假等待者 + 假待确认表**）。 */
function contextOf(overrides: Partial<DshGateContext> = {}): DshGateContext & {
	pending: { id: string; command: string; args: Record<string, unknown> }[];
} {
	const pending: { id: string; command: string; args: Record<string, unknown> }[] = [];
	return {
		conversationId: "conv-1",
		userId: "7",
		waiters: new PendingWaiterRegistry(),
		createPending: async (input) => {
			const row = { id: `pending-${pending.length + 1}`, ...input };
			pending.push(row);
			return { id: row.id };
		},
		timeoutMs: 50,
		argsOf: () => ({}),
		onPending: () => undefined,
		...overrides,
		pending,
	} as DshGateContext & { pending: { id: string; command: string; args: Record<string, unknown> }[] };
}

describe("dsh 的审批 ⇒ 我们的闸门", () => {
	it("修改类工具 ⇒ **等人点头**（批准 ⇒ allowed-once）", async () => {
		const context = contextOf();
		const pending = decideApproval(
			{ sessionId: "conv-1", toolName: "update_task", callId: "c1" },
			context,
		);
		// ⚠️ 等人期间：待确认行已经建好 ⇒ 前端能看到
		await new Promise((resolve) => setTimeout(resolve, 5));
		expect(context.pending).toHaveLength(1);
		expect(context.pending[0]?.command).toBe("update_task");
		context.waiters.decide(context.pending[0]?.id ?? "", "approved");
		expect(await pending).toBe("allowed-once");
	});

	it("拒绝 ⇒ `rejected`（**工具不执行**）", async () => {
		const context = contextOf();
		const pending = decideApproval(
			{ sessionId: "conv-1", toolName: "patch_task_status", callId: "c1" },
			context,
		);
		await new Promise((resolve) => setTimeout(resolve, 5));
		context.waiters.decide(context.pending[0]?.id ?? "", "rejected");
		expect(await pending).toBe("rejected");
	});

	it("没人应答（超时）⇒ `rejected`（**fail closed**）", async () => {
		const context = contextOf({ timeoutMs: 10 });
		const outcome = await decideApproval(
			{ sessionId: "conv-1", toolName: "update_task", callId: "c1" },
			context,
		);
		expect(outcome).toBe("rejected");
	});

	it("新增类工具 ⇒ 直接放行（**不建待确认**）", async () => {
		const context = contextOf();
		const outcome = await decideApproval(
			{ sessionId: "conv-1", toolName: "create_task", callId: "c1" },
			context,
		);
		expect(outcome).toBe("allowed-once");
		expect(context.pending).toHaveLength(0);
	});

	it("参数从 `tool/call` 关联来（**审批载荷里没有参数**）", async () => {
		const context = contextOf({ argsOf: () => ({ title: "新标题" }) });
		const pending = decideApproval(
			{ sessionId: "conv-1", toolName: "update_task", callId: "c1" },
			context,
		);
		await new Promise((resolve) => setTimeout(resolve, 5));
		expect(context.pending[0]?.args).toEqual({ title: "新标题" });
		context.waiters.decide(context.pending[0]?.id ?? "", "approved");
		await pending;
	});
});
