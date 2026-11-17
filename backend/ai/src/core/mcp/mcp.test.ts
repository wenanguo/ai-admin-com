/**
 * MCP 服务器配置 —— **名字是配置来的**（不再写死 `aiadmin`）。
 *
 * ## 钉住的事
 *
 * 1. 工具名的前缀按**服务器名**生成（`mcp__<name>__`）⇒ 多服务器不互相盖名；
 * 2. 前缀的算法必须和 pi 一致（非法字符变 `_`）⇒ 否则认不出自己的工具；
 * 3. token 只在内存里（进 header，不进别处）。
 */

import { describe, expect, it, vi } from "vitest";
import {
	createMcpServerConfig,
	createMcpServersExtension,
	mcpToolPrefix,
	stripMcpToolPrefix,
} from "./mcp.ts";

describe("MCP 服务器配置", () => {
	it("HTTP + 带上调用方的 token + 直接暴露给模型", () => {
		const config = createMcpServerConfig({
			name: "aiadmin",
			url: "https://example.test/api/v1/mcp",
			token: "user-jwt",
		});
		expect(config.type).toBe("http");
		expect(config.url).toBe("https://example.test/api/v1/mcp");
		expect(config.headers).toMatchObject({ Authorization: "Bearer user-jwt" });
		// ⚠️ 直接暴露 ⇒ 模型一眼就能看到这些工具（任务模块只有几个）
		expect(config.exposure).toBe("direct");
	});

	it("没有 token ⇒ 不带 Authorization 头（外部 MCP 服务器不需要）", () => {
		const config = createMcpServerConfig({
			name: "docs",
			url: "https://docs.test/mcp",
		});
		expect(config.headers).toEqual({});
	});

	it("注册扩展时按**配置的名字**注册（可以多台）", async () => {
		const registerMcpServer = vi.fn();
		const extension = createMcpServersExtension([
			{ name: "aiadmin", url: "https://a.test/mcp", token: "user-jwt" },
			{ name: "docs", url: "https://b.test/mcp" },
		]);

		await extension({ registerMcpServer } as never);

		expect(registerMcpServer).toHaveBeenCalledTimes(2);
		const [firstName, firstConfig] = registerMcpServer.mock.calls[0] as [
			string,
			{ headers?: Record<string, string> },
		];
		expect(firstName).toBe("aiadmin");
		expect(firstConfig.headers).toMatchObject({ Authorization: "Bearer user-jwt" });

		const [secondName] = registerMcpServer.mock.calls[1] as [string];
		expect(secondName).toBe("docs");
	});
});

describe("MCP 工具名的前缀", () => {
	it("前缀是 `mcp__<服务器名>__`", () => {
		expect(mcpToolPrefix("aiadmin")).toBe("mcp__aiadmin__");
		expect(mcpToolPrefix("docs")).toBe("mcp__docs__");
	});

	it("名字里的非法字符按 pi 的规则变成 `_`（要和 pi 一致）", () => {
		// ⚠️ pi 的规则：`mcp__<server>__<tool>` 里的非 `[A-Za-z0-9_]` 全变 `_`
		expect(mcpToolPrefix("my-server")).toBe("mcp__my_server__");
	});

	it("按已知前缀剥掉服务器名（多服务器也不会认错）", () => {
		const prefixes = [mcpToolPrefix("aiadmin"), mcpToolPrefix("docs")];
		expect(stripMcpToolPrefix("mcp__aiadmin__update_task", prefixes)).toBe(
			"update_task",
		);
		expect(stripMcpToolPrefix("mcp__docs__search", prefixes)).toBe("search");
	});

	it("认不出来的前缀 ⇒ 按 pi 的解析方式兜底", () => {
		expect(stripMcpToolPrefix("mcp__unknown__tool", [])).toBe("tool");
		// 不是 MCP 工具 ⇒ 原样返回
		expect(stripMcpToolPrefix("create_task", [])).toBe("create_task");
	});
});
