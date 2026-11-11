import { describe, expect, it, vi } from "vitest";
import { prisma } from "./db.ts";

vi.mock("./db", () => ({
	prisma: {
		aiPendingAction: { create: vi.fn(), updateMany: vi.fn() },
	},
}));

describe("待确认的写侧", () => {
	it("建一条 pending ⇒ 状态 PENDING、带过期时间", async () => {
		const { createPendingAction } = await import("./pending-write.ts");
		vi.mocked(prisma.aiPendingAction.create).mockResolvedValue({
			id: "p1",
		} as never);

		const result = await createPendingAction({
			userId: "2",
			command: "update_task",
			args: { id: 117, title: "新标题" },
			preview: { title: "新标题" },
			ttlMs: 60_000,
		});

		expect(result.id).toBe("p1");
		const data = vi.mocked(prisma.aiPendingAction.create).mock.calls[0]?.[0]
			?.data as Record<string, unknown>;
		expect(data["status"]).toBe("PENDING");
		expect(data["command"]).toBe("update_task");
		expect(data["expiresAt"]).toBeInstanceOf(Date);
	});

	it("批准 ⇒ 状态改成 CONFIRMED 并记下是谁批的", async () => {
		const { resolvePendingAction } = await import("./pending-write.ts");
		vi.mocked(prisma.aiPendingAction.updateMany).mockResolvedValue({
			count: 1,
		});

		expect(await resolvePendingAction("p1", "CONFIRMED", "2")).toBe(true);
		const data = vi.mocked(prisma.aiPendingAction.updateMany).mock.calls[0]?.[0]
			?.data as Record<string, unknown>;
		expect(data["status"]).toBe("CONFIRMED");
		expect(data["resolvedBy"]).toBe("2");
	});

	it("重复批准 ⇒ 改不到行（不会重复执行）", async () => {
		const { resolvePendingAction } = await import("./pending-write.ts");
		vi.mocked(prisma.aiPendingAction.updateMany).mockResolvedValue({
			count: 0,
		});

		expect(await resolvePendingAction("p1", "CONFIRMED", "2")).toBe(false);
	});
});
