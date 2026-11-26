/**
 * 会话注册表 —— **回放窗口**（SSE 补发缓冲）与**通道**的基本行为。
 *
 * ⚠️ 之前这些断言住在 `frame-buffer.test.ts`（issue #169 · S4：那个文件没了
 *    ⇒ 机制并进注册表 ⇒ 断言跟着搬过来，**一条都不许少**）。
 */

import { describe, expect, it } from "vitest";
import { ReplayWindow } from "../http/sse.ts";
import { SessionRegistry } from "./session-registry.ts";

/** 造一帧（`rebuildable` = 是不是「可从快照重建」的帧）。 */
function frame(event: string, text: string, rebuildable = false): {
	event: string;
	data: string;
	rebuildable: boolean;
} {
	return { event, data: text, rebuildable };
}

describe("回放窗口（SSE 补发缓冲）", () => {
	it("没超上限 ⇒ 帧都留着", () => {
		const buffer = new ReplayWindow(1000);
		buffer.push(frame("text_delta", "a"));
		buffer.push(frame("tool_call", "b"));
		expect(buffer.list().map((item) => item.event)).toEqual(["text_delta", "tool_call"]);
		expect(buffer.byteSize).toBeGreaterThan(0);
	});

	it("超上限 ⇒ 先丢可重建的帧（text_delta），结构帧留着", () => {
		// 一帧 ≈ 事件名 + 载荷 + 16 字节开销 ⇒ 40 字的载荷约 65~66 字节
		const buffer = new ReplayWindow(140);
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
		const buffer = new ReplayWindow(70);
		buffer.push(frame("tool_call", "a".repeat(40), false));
		buffer.push(frame("tool_result", "b".repeat(40), false));

		expect(buffer.byteSize).toBeLessThanOrEqual(70);
		expect(buffer.list().map((item) => item.event)).toEqual(["tool_result"]);
	});

	it("清空后不留东西", () => {
		const buffer = new ReplayWindow(1000);
		buffer.push(frame("text_delta", "a"));
		buffer.clear();
		expect(buffer.list()).toEqual([]);
		expect(buffer.byteSize).toBe(0);
	});

	it("**序号单调递增** ⇒ 回放快照与增量流之间不重不漏", () => {
		const buffer = new ReplayWindow(1000);
		const first = buffer.push(frame("text_delta", "a"));
		const second = buffer.push(frame("tool_call", "b"));
		expect(first.seq).toBe(1);
		expect(second.seq).toBe(2);
		expect(buffer.list().map((item) => item.seq)).toEqual([1, 2]);
	});
});

describe("会话注册表", () => {
	it("同一个会话 ⇒ 同一个通道", () => {
		const registry = new SessionRegistry();
		const first = registry.ensure("conv-1");
		const second = registry.ensure("conv-1");
		expect(second).toBe(first);
		expect(registry.size).toBe(1);
	});

	it("发布一帧 ⇒ 进回放窗口，也送给订阅者", () => {
		const registry = new SessionRegistry();
		const channel = registry.ensure("conv-1");
		const seen: number[] = [];
		registry.subscribe("conv-1", (item) => seen.push(item.seq));

		registry.publish(channel, frame("tool_call", "{}", false));

		expect(channel.backlog.list().map((item) => item.event)).toEqual(["tool_call"]);
		expect(seen).toEqual([1]);
	});

	it("一个订阅者抛错 ⇒ 不拖累别人", () => {
		const registry = new SessionRegistry();
		const channel = registry.ensure("conv-1");
		const seen: string[] = [];
		registry.subscribe("conv-1", () => {
			throw new Error("这个客户端写失败了");
		});
		registry.subscribe("conv-1", (item) => seen.push(item.event));

		registry.publish(channel, frame("tool_call", "{}", false));

		expect(seen).toEqual(["tool_call"]);
	});

	it("关掉通道 ⇒ 顺带把 dsh 会话释放掉", () => {
		const registry = new SessionRegistry();
		const channel = registry.ensure("conv-1");
		let disposed = false;
		channel.session = {
			prompt: async () => {},
			subscribe: () => () => {},
			dispose: () => {
				disposed = true;
			},
			isStreaming: false,
		};

		registry.close("conv-1");

		expect(disposed).toBe(true);
		expect(registry.get("conv-1")).toBeUndefined();
	});
});
