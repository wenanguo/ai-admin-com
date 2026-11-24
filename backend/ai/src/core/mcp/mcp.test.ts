/**
 * MCP 服务器配置 —— **翻译成 dsh 管理面的形状**（语义不变）。
 *
 * ## 钉住的事
 *
 * 1. `agent.yaml` 的 `mcpServers` **语义不变**（名字 / 地址 / token / 暴露方式）；
 * 2. 翻译成 **dsh 管理面的登记**（**名字是键** + 条目：`transport` / `url` / `headers` / 超时）；
 * 3. token 只在内存里（进 header，不进别处）；
 * 4. `exposure: hidden` ⇒ **不挂**（模型看不到）。
 *
 * ⚠️ **管理面退给 dsh**（issue #153）⇒ 我们只负责「按用户算好配置」，
 *    装 / 卸 / 列 / 探活都是 dsh 的活。
 */

import { describe, expect, it } from "vitest";
import { buildDshMcpServerRegistrations } from "./mcp.ts";

describe("MCP 服务器配置（dsh 管理面形状）", () => {
	it("一台服务器 ⇒ 一份登记（streamable-http + Bearer）", () => {
		const registrations = buildDshMcpServerRegistrations([
			{
				name: "aiadmin",
				url: "https://example.test/api/v1/mcp",
				token: "user-jwt",
			},
		]);
		expect(registrations).toHaveLength(1);
		expect(registrations[0]?.name).toBe("aiadmin");
		expect(registrations[0]?.entry).toMatchObject({
			transport: "streamable-http",
			url: "https://example.test/api/v1/mcp",
			headers: { Authorization: "Bearer user-jwt" },
		});
	});

	it("没有 token ⇒ 不带 Authorization 头（外部 MCP 服务器不需要）", () => {
		const registrations = buildDshMcpServerRegistrations([
			{ name: "docs", url: "https://docs.test/mcp" },
		]);
		expect(registrations[0]?.entry.headers).toEqual({});
	});

	it("多台服务器 ⇒ 多份登记（名字决定工具名前缀）", () => {
		const registrations = buildDshMcpServerRegistrations([
			{ name: "aiadmin", url: "https://a.test/mcp", token: "jwt" },
			{ name: "docs", url: "https://b.test/mcp" },
		]);
		expect(registrations.map((registration) => registration.name)).toEqual([
			"aiadmin",
			"docs",
		]);
	});

	it("`exposure: hidden` ⇒ **不挂**（模型看不到这家）", () => {
		const registrations = buildDshMcpServerRegistrations([
			{ name: "aiadmin", url: "https://a.test/mcp" },
			{ name: "secret", url: "https://s.test/mcp", exposure: "hidden" },
		]);
		expect(registrations.map((registration) => registration.name)).toEqual(["aiadmin"]);
	});

	it("其余暴露方式在 dsh 形状里都等价于「直接给模型看」", () => {
		const registrations = buildDshMcpServerRegistrations([
			{ name: "a", url: "https://a.test/mcp", exposure: "deferred" },
			{ name: "b", url: "https://b.test/mcp", exposure: "codemode" },
		]);
		expect(registrations.map((registration) => registration.name)).toEqual(["a", "b"]);
	});

	it("一台都没配 ⇒ 空列表（**不是异常**）", () => {
		expect(buildDshMcpServerRegistrations([])).toEqual([]);
	});

	it("超时都在登记里（**dsh 的条目要求写明**）", () => {
		const [registration] = buildDshMcpServerRegistrations([
			{ name: "aiadmin", url: "https://a.test/mcp" },
		]);
		expect(registration?.entry.toolCallTimeoutMs).toBeGreaterThan(0);
		expect(registration?.entry.startupTimeoutMs).toBeGreaterThan(0);
	});
});
