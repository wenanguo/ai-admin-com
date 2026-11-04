import { describe, expect, it } from "vitest";
import { FrameBuffer } from "./frame-buffer";

/** 造一帧（`rebuildable` = 是不是「可从快照重建」的帧）。 */
function frame(event: string, text: string, rebuildable = false): {
	event: string;
	data: string;
	rebuildable: boolean;
} {
	return { event, data: text, rebuildable };
}

describe("帧缓冲（回放用）", () => {
	it("没超上限 ⇒ 帧都留着", () => {
		const buffer = new FrameBuffer({ maxBytes: 1000 });
		buffer.push(frame("text_delta", "a"));
		buffer.push(frame("tool_call", "b"));
		expect(buffer.list().map((item) => item.event)).toEqual(["text_delta", "tool_call"]);
		expect(buffer.byteSize).toBeGreaterThan(0);
	});

	it("超上限 ⇒ 先丢可重建的帧（text_delta），结构帧留着", () => {
		// 一帧 ≈ 事件名 + 载荷 + 16 字节开销 ⇒ 40 字的载荷约 65~66 字节
		const buffer = new FrameBuffer({ maxBytes: 140 });
		buffer.push(frame("text_delta", "x".repeat(40), true));
		buffer.push(frame("tool_call", "y".repeat(40), false));
		buffer.push(frame("text_delta", "z".repeat(40), true));

		const events = buffer.list().map((item) => item.event);
		// 结构帧活着
		expect(events).toContain("tool_call");
		// 可重建的帧被丢了一帧（丢的是最老的那帧）
		expect(events.length).toBe(2);
		expect(events[0]).toBe("tool_call");
		expect(buffer.byteSize).toBeLessThanOrEqual(140);
	});

	it("结构帧也超上限 ⇒ 继续丢最老的帧，绝不超上限", () => {
		const buffer = new FrameBuffer({ maxBytes: 70 });
		buffer.push(frame("tool_call", "a".repeat(40), false));
		buffer.push(frame("tool_result", "b".repeat(40), false));

		expect(buffer.byteSize).toBeLessThanOrEqual(70);
		expect(buffer.list().map((item) => item.event)).toEqual(["tool_result"]);
	});

	it("清空后不留东西", () => {
		const buffer = new FrameBuffer({ maxBytes: 1000 });
		buffer.push(frame("text_delta", "a"));
		buffer.clear();
		expect(buffer.list()).toEqual([]);
		expect(buffer.byteSize).toBe(0);
	});
});
