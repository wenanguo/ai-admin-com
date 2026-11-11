import { describe, expect, it, vi } from "vitest";
import {
	AIADMIN_MCP_SERVER_NAME,
	createAiadminMcpConfig,
	createAiadminMcpExtension,
} from "./mcp.ts";

describe("AiAdmin 的 MCP 服务器配置", () => {
	it("名字是 aiadmin（工具名前缀就是 mcp__aiadmin__）", () => {
		expect(AIADMIN_MCP_SERVER_NAME).toBe("aiadmin");
	});

	it("HTTP + 带上调用方的 token + 直接暴露给模型", () => {
		const config = createAiadminMcpConfig({
			url: "https://example.test/api/v1/mcp",
			token: "user-jwt",
		});
		expect(config.type).toBe("http");
		expect(config.url).toBe("https://example.test/api/v1/mcp");
		expect(config.headers).toMatchObject({ Authorization: "Bearer user-jwt" });
		// ⚠️ 直接暴露 ⇒ 模型一眼就能看到这些工具（任务模块只有几个）
		expect(config.exposure).toBe("direct");
	});

	it("注册扩展时用**同一个** token 注册服务器", async () => {
		const registerMcpServer = vi.fn();
		const extension = createAiadminMcpExtension({
			url: "https://example.test/api/v1/mcp",
			token: "user-jwt",
		});

		await extension({ registerMcpServer } as never);

		expect(registerMcpServer).toHaveBeenCalledTimes(1);
		const [name, config] = registerMcpServer.mock.calls[0] as [
			string,
			{ headers?: Record<string, string> },
		];
		expect(name).toBe("aiadmin");
		expect(config.headers).toMatchObject({ Authorization: "Bearer user-jwt" });
	});
});
