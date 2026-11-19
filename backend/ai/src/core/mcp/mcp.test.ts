/**
 * MCP 服务器配置 —— **迁到 dsh 的形状**（语义不变）。
 *
 * ## 钉住的事
 *
 * 1. `agent.yaml` 的 `mcpServers` **语义不变**（名字 / 地址 / token / 暴露方式）；
 * 2. 翻译成 **dsh 的客户端配置**（`serverName` / `url` / `headers` / transport）；
 * 3. token 只在内存里（进 header，不进别处）；
 * 4. `exposure: hidden` ⇒ **不挂**（模型看不到）。
 */

import { describe, expect, it } from "vitest";
import { buildDshMcpClientConfigs } from "./mcp.ts";

describe("MCP 服务器配置（dsh 形状）", () => {
	it("一台服务器 ⇒ 一份 dsh 客户端配置（streamable-http + Bearer）", () => {
		const configs = buildDshMcpClientConfigs([
			{
				name: "aiadmin",
				url: "https://example.test/api/v1/mcp",
				token: "user-jwt",
			},
		]);
		expect(configs).toHaveLength(1);
		expect(configs[0]).toMatchObject({
			transport: "streamable-http",
			serverName: "aiadmin",
			url: "https://example.test/api/v1/mcp",
			headers: { Authorization: "Bearer user-jwt" },
		});
	});

	it("没有 token ⇒ 不带 Authorization 头（外部 MCP 服务器不需要）", () => {
		const configs = buildDshMcpClientConfigs([
			{ name: "docs", url: "https://docs.test/mcp" },
		]);
		expect(configs[0]?.headers).toEqual({});
	});

	it("多台服务器 ⇒ 多份配置（名字决定工具名前缀）", () => {
		const configs = buildDshMcpClientConfigs([
			{ name: "aiadmin", url: "https://a.test/mcp", token: "jwt" },
			{ name: "docs", url: "https://b.test/mcp" },
		]);
		expect(configs.map((config) => config.serverName)).toEqual(["aiadmin", "docs"]);
	});

	it("`exposure: hidden` ⇒ **不挂**（模型看不到这家）", () => {
		const configs = buildDshMcpClientConfigs([
			{ name: "aiadmin", url: "https://a.test/mcp" },
			{ name: "secret", url: "https://s.test/mcp", exposure: "hidden" },
		]);
		expect(configs.map((config) => config.serverName)).toEqual(["aiadmin"]);
	});

	it("其余暴露方式在 dsh 形状里都等价于「直接给模型看」", () => {
		const configs = buildDshMcpClientConfigs([
			{ name: "a", url: "https://a.test/mcp", exposure: "deferred" },
			{ name: "b", url: "https://b.test/mcp", exposure: "codemode" },
		]);
		expect(configs.map((config) => config.serverName)).toEqual(["a", "b"]);
	});

	it("一台都没配 ⇒ 空列表（**不是异常**）", () => {
		expect(buildDshMcpClientConfigs([])).toEqual([]);
	});
});
