import { describe, expect, it } from "vitest";
import { PendingWaiterRegistry } from "./pending-waiters.ts";

describe("待确认等待者", () => {
	it("批准 ⇒ 等待者被唤醒成 approved", async () => {
		const registry = new PendingWaiterRegistry();
		const waiting = registry.wait("p1", 1000);
		expect(registry.size()).toBe(1);
		expect(registry.decide("p1", "approved")).toBe(true);
		expect(await waiting).toBe("approved");
	});

	it("拒绝 ⇒ 唤醒成 rejected", async () => {
		const registry = new PendingWaiterRegistry();
		const waiting = registry.wait("p2", 1000);
		registry.decide("p2", "rejected");
		expect(await waiting).toBe("rejected");
	});

	it("超时 ⇒ 唤醒成 timeout（宁可不做）", async () => {
		const registry = new PendingWaiterRegistry();
		const waiting = registry.wait("p3", 10);
		expect(await waiting).toBe("timeout");
		expect(registry.size()).toBe(0);
	});

	it("对不存在的 id 作决定 ⇒ false（不能凭空唤醒）", () => {
		const registry = new PendingWaiterRegistry();
		expect(registry.decide("nope", "approved")).toBe(false);
	});

	it("⚠️ 决定**先到**（等待者还没注册）⇒ 等的人一注册就拿到", async () => {
		// ⚠️ 挂起流程是「先通知外面（onPending）⇒ 再等（wait）」
		//    ⇒ 人在通知那一刻就点了「同意」 ⇒ 决定先于 wait 到达。
		const registry = new PendingWaiterRegistry();
		expect(registry.decide("p-early", "approved")).toBe(false);
		expect(await registry.wait("p-early", 1000)).toBe("approved");
	});

	it("决定先到且被消费了 ⇒ 不会影响后面的等待", async () => {
		const registry = new PendingWaiterRegistry();
		registry.decide("p-once", "rejected");
		expect(await registry.wait("p-once", 50)).toBe("rejected");
	});

	it("重复决定只生效一次（幂等）", async () => {
		const registry = new PendingWaiterRegistry();
		const waiting = registry.wait("p4", 1000);
		expect(registry.decide("p4", "approved")).toBe(true);
		expect(registry.decide("p4", "rejected")).toBe(false);
		expect(await waiting).toBe("approved");
	});
});
