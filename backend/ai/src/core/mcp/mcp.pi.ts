/**
 * pi 路径的 MCP 接线（**pi 专有** ⇒ 单独一个文件）。
 *
 * ## 为什么单独放
 *
 * `mcp.ts` 是**两个 runner 共用**的（配置形状 + dsh 的翻译）⇒ 它不许 import pi。
 * 而 pi 的 MCP 扩展（`registerMcpServer`）是 pi 专有的 ⇒ 挪到这里。
 *
 * ⚠️ **拔 pi（#123）时这个文件整个删掉**（pi 路径一起走）。
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { McpExposure, McpServerSpec } from "./mcp.ts";

/** pi 路径的 MCP 服务器（**多了个测试用的传输层工厂**）。 */
export interface PiMcpServerSpec extends McpServerSpec {
	/** 传输层工厂（**测试用**：注入假 MCP 服务器）。 */
	createTransport?: (
		entry: unknown,
		cwd: string,
		authProvider: unknown,
	) => unknown;
}

/** MCP 服务器配置（pi 的 `McpHttpServerConfig` 的形状）。 */
export interface McpServerConfig {
	type: "http";
	url: string;
	headers: Record<string, string>;
	exposure: McpExposure;
}

/**
 * 造一台 MCP 服务器的 pi 配置。
 *
 * @param spec 服务器（名字、地址、token、暴露方式）。
 */
export function createMcpServerConfig(spec: McpServerSpec): McpServerConfig {
	return {
		type: "http",
		url: spec.url,
		// ⚠️ **token 只在内存里**（绝不落盘、绝不进日志）
		headers:
			spec.token === undefined
				? {}
				: { Authorization: `Bearer ${spec.token}` },
		exposure: spec.exposure ?? "direct",
	};
}

/**
 * 造一个注册 **若干** MCP 服务器的扩展。
 *
 * ⚠️ 这是 **inline extension**：pi 在加载扩展时调用它 ⇒
 *    正好是「会话建立」的时刻 ⇒ 每个会话带自己的 token。
 *
 * @param servers 要挂的服务器（**可以 0 / 1 / N 个**）。
 */
export function createMcpServersExtension(
	servers: readonly PiMcpServerSpec[],
): (pi: ExtensionAPI) => void {
	return (pi: ExtensionAPI) => {
		for (const server of servers) {
			pi.registerMcpServer(server.name, createMcpServerConfig(server));
		}
	};
}
