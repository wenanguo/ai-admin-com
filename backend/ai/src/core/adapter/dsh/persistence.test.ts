/**
 * dsh 的留痕层 —— dsh 事件 / 闸门决策 ⇒ **会话事件日志** + **审计**。
 *
 * ⚠️ 三条口径：
 * 1. 每个 dsh 事件都进**事件日志**（dsh 形状的追加式日志）；
 * 2. **模型调用 / 工具调用 / 闸门决策**三类都进**审计**（现有检索口径查得到）；
 * 3. **写工具自己写过审计 ⇒ 不再补一条**（同一件事不记两遍）。
 */

import { describe, expect, it } from "vitest";
import { DshTracer, MODEL_CALL_COMMAND, truncatePayload } from "./persistence.ts";
import { AuditTrail } from "../../audit/audit-trail.ts";
import type { AuditEntry } from "../../audit/audit.ts";
import type { SessionEventInput, SessionEventStore } from "../../store/session-events.ts";

/** 假的事件日志（记下追加了什么）。 */
function fakeEvents(): SessionEventStore & { appended: SessionEventInput[] } {
	const appended: SessionEventInput[] = [];
	return {
		appended,
		append: async (input: SessionEventInput): Promise<void> => {
			appended.push(input);
		},
		list: async () => [],
	};
}

/** 假的审计 writer（记下写了什么）。 */
function fakeAudit(): { writer: AuditTrail; entries: AuditEntry[] } {
	const entries: AuditEntry[] = [];
	const writer = new AuditTrail({
		write: async (entry: AuditEntry): Promise<void> => {
			entries.push(entry);
		},
	});
	return { writer, entries };
}

/** 造一个留痕层。 */
function tracerOf(overrides: {
	events?: ReturnType<typeof fakeEvents>;
	audit?: ReturnType<typeof fakeAudit>;
	userId?: string;
} = {}): {
	tracer: DshTracer;
	events: ReturnType<typeof fakeEvents>;
	audit: ReturnType<typeof fakeAudit>;
} {
	const events = overrides.events ?? fakeEvents();
	const audit = overrides.audit ?? fakeAudit();
	const tracer = new DshTracer({
		conversationId: "conv-1",
		dshSessionId: "conv-1",
		userId: overrides.userId ?? "7",
		model: "deepseek-chat",
		events,
		audit: audit.writer,
		trail: audit.writer,
	});
	return { tracer, events, audit };
}

describe("dsh 事件 ⇒ 事件日志", () => {
	it("每个事件都追加一行（**追加式**）", async () => {
		const { tracer, events } = tracerOf();
		await tracer.handleEvent({ type: "assistant/message", data: { message: {} } });
		await tracer.handleEvent({ type: "tool/call", data: { callId: "c1", name: "list_x" } });
		await tracer.handleEvent({ type: "turn/end", data: {} });
		expect(events.appended.map((row) => row.kind)).toEqual([
			"model_call",
			"tool_call",
			"turn_end",
		]);
		expect(events.appended[0]?.conversationId).toBe("conv-1");
		expect(events.appended[0]?.eventName).toBe("assistant/message");
	});

	it("不认识的事件 ⇒ `other`（**只增不删** ⇒ 以后加类型不用改表）", async () => {
		const { tracer, events } = tracerOf();
		await tracer.handleEvent({ type: "brand/new-event", data: { a: 1 } });
		expect(events.appended[0]?.kind).toBe("other");
	});

	it("写事件日志失败 ⇒ **不影响对话**", async () => {
		const events = fakeEvents();
		events.append = async () => {
			throw new Error("表还没迁移");
		};
		const { tracer, audit } = tracerOf({ events });
		await expect(
			tracer.handleEvent({ type: "assistant/message", data: {} }),
		).resolves.toBeUndefined();
		// ⚠️ 审计那条**照写**（两件事互不牵连）
		expect(audit.entries).toHaveLength(1);
	});
});

describe("三类留痕 ⇒ 审计", () => {
	it("模型调用 ⇒ 一条 `model_call` 审计", async () => {
		const { tracer, audit } = tracerOf();
		await tracer.handleEvent({
			type: "assistant/message",
			data: { message: { content: [] }, usage: { totalTokens: 42 } },
		});
		expect(audit.entries).toHaveLength(1);
		const entry = audit.entries[0];
		expect(entry?.command).toBe(MODEL_CALL_COMMAND);
		expect(entry?.actorType).toBe("AI");
		expect(entry?.model).toBe("deepseek-chat");
		expect(entry?.tokens).toBe(42);
		expect(entry?.userId).toBe("7");
	});

	it("工具调用（**没有自己写审计**）⇒ 补一条调用痕迹", async () => {
		const { tracer, audit } = tracerOf();
		await tracer.handleEvent({
			type: "tool/call",
			data: { callId: "c1", name: "list_x", arguments: JSON.stringify({ q: "a" }) },
		});
		await tracer.handleEvent({
			type: "tool/result",
			data: { message: { toolCallId: "c1", content: [] } },
		});
		expect(audit.entries).toHaveLength(1);
		expect(audit.entries[0]?.command).toBe("list_x");
		expect(audit.entries[0]?.actorType).toBe("AI");
	});

	it("工具调用（**自己写过审计**）⇒ **不重复记**", async () => {
		const { tracer, audit } = tracerOf();
		await tracer.handleEvent({
			type: "tool/call",
			data: { callId: "c1", name: "create_x", arguments: "{}" },
		});
		// ⚠️ 写工具在执行期间自己写了一条写审计
		await audit.writer.write({
			actorType: "AI",
			command: "create_x",
			args: {},
			before: null,
			after: null,
			userId: "7",
		});
		await tracer.handleEvent({
			type: "tool/result",
			data: { message: { toolCallId: "c1", content: [] } },
		});
		// ⚠️ 只有写工具自己那条 ⇒ 没有多出来的调用痕迹
		expect(audit.entries).toHaveLength(1);
		expect(audit.entries[0]?.command).toBe("create_x");
	});

	it("闸门决策 ⇒ 一条**人**做的审计 + 一条事件", async () => {
		const { tracer, audit, events } = tracerOf();
		await tracer.handleGateDecision({
			command: "update_x",
			args: { title: "新标题" },
			decision: "approved",
		});
		expect(audit.entries).toHaveLength(1);
		expect(audit.entries[0]?.actorType).toBe("USER");
		expect(audit.entries[0]?.command).toBe("update_x");
		expect(audit.entries[0]?.args).toMatchObject({ decision: "approved" });
		expect(events.appended[0]?.kind).toBe("gate_decided");
		expect(events.appended[0]?.eventName).toBe("gate/decided");
	});

	it("没有用户 ⇒ **写不了审计**（只进事件日志）", async () => {
		const { tracer, audit, events } = tracerOf({ userId: "" });
		await tracer.handleEvent({ type: "assistant/message", data: {} });
		expect(audit.entries).toHaveLength(0);
		expect(events.appended).toHaveLength(1);
	});
});

describe("载荷截断", () => {
	it("太长的载荷 ⇒ 截断（**别把库撑爆**）", () => {
		const payload = { text: "x".repeat(20_000) };
		const result = truncatePayload(payload) as { truncated?: boolean; bytes?: number };
		expect(result.truncated).toBe(true);
		expect(result.bytes).toBeGreaterThan(8 * 1024);
	});

	it("短的载荷 ⇒ 原样", () => {
		expect(truncatePayload({ a: 1 })).toEqual({ a: 1 });
	});
});
