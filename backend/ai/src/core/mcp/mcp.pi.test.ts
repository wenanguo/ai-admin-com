/**
 * pi 路径的 MCP 接线（**pi 专有** ⇒ 单独一个测试文件）。
 *
 * ⚠️ **拔 pi（#123）时这个文件整个删掉**。
 */
import { describe, expect, it, vi } from "vitest";
import { createMcpServerConfig, createMcpServersExtension } from "./mcp.pi.ts";

describe("MCP 服务器配置（pi 路径）", () => {
	it("HTTP + 带上调用方的 token + 直接暴露给模型", () => {
		const config = createMcpServerConfig({
			name: "aiadmin",
			url: "https://example.test/api/v1/mcp",
			token: "user-jwt",
		});
		expect(config.type).toBe("http");
		expect(config.url).toBe("https://example.test/api/v1/mcp");
		expect(config.headers).toMatchObject({ Authorization: "Bearer user-jwt" });
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
