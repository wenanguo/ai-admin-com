/**
 * 审计的留痕带 —— 记住「最近写过哪些命令」。
 *
 * ⚠️ 它的唯一用途：**判「这次工具调用有没有自己写审计」**
 *    ⇒ 写工具已经留过痕的 ⇒ 不再补一条调用痕迹（同一件事不记两遍）。
 */

import { describe, expect, it } from "vitest";
import { AuditTrail } from "./audit-trail.ts";
import type { AuditEntry } from "./audit.ts";

/** 一条最小审计。 */
function entryOf(command: string): AuditEntry {
	return {
		actorType: "AI",
		command,
		args: {},
		before: null,
		after: null,
		userId: "7",
	};
}

describe("审计留痕带", () => {
	it("转发给真的 writer", async () => {
		const written: AuditEntry[] = [];
		const trail = new AuditTrail({
			write: async (entry: AuditEntry) => {
				written.push(entry);
			},
		});
		await trail.write(entryOf("create_x"));
		expect(written).toHaveLength(1);
		expect(written[0]?.command).toBe("create_x");
	});

	it("写过了 ⇒ `wroteSince` 为真（**从某个时刻起**）", async () => {
		const trail = new AuditTrail({ write: async () => {} });
		const since = Date.now();
		await trail.write(entryOf("create_x"));
		expect(trail.wroteSince("create_x", since)).toBe(true);
	});

	it("别的命令 / 起点之前 ⇒ 为假", async () => {
		const trail = new AuditTrail({ write: async () => {} });
		const since = Date.now();
		await trail.write(entryOf("create_x"));
		expect(trail.wroteSince("other_x", since)).toBe(false);
		expect(trail.wroteSince("create_x", since + 60_000)).toBe(false);
	});

	it("转发失败也**记上了**（⇒ 不会因为写库失败就多记一条调用痕迹）", async () => {
		const trail = new AuditTrail({
			write: async () => {
				throw new Error("写不进去");
			},
		});
		const since = Date.now();
		await expect(trail.write(entryOf("create_x"))).rejects.toThrow(/写不进去/);
		expect(trail.wroteSince("create_x", since)).toBe(true);
	});
});
