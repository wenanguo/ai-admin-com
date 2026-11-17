/**
 * MCP 服务器 —— **工具的来源**。
 *
 * ## 为什么走 MCP，而不是自己写命令
 *
 * 后端已经把「接口」变成「MCP tool」（`AiAdmin/backend/app/plugin/module_mcp`）⇒
 * 后端加接口，AI 侧**一行代码都不用改**。
 *
 * ## 为什么每个会话单独注册
 *
 * MCP 调用要带**调用方的 JWT**（后端靠它做权限码校验）⇒ 每个用户、每个会话的
 * token 都不同 ⇒ 不能用静态的 `.pi/mcp.json`，只能运行时 `registerMcpServer`。
 *
 * ⚠️ token **只活在内存里**（服务器配置对象里），绝不落盘、绝不进日志。
 *
 * ## 服务器名是**配置来的**（不再写死）
 *
 * 工具名的前缀是 `mcp__<服务器名>__<工具名>` ⇒ 名字由配置决定 ⇒
 * ① 多台服务器的工具**不会互相盖名**；② 接新的外部系统**不用改代码**。
 *
 * ⚠️ pi 会把名字里的非法字符换成 `_`（`mcp__<server>__<tool>` 的规则）⇒
 *    算前缀时要用**同一套规则**，否则认不出自己的工具。
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** 传输类型（本服务是 HTTP 服务 ⇒ 只做 http；`sse` 走同一个 HTTP 传输）。 */
export type McpTransportType = "http" | "sse";

/** 暴露方式（pi 的口径：直接给模型 / 延迟加载 / 只给 codemode / 隐藏）。 */
export type McpExposure = "direct" | "deferred" | "codemode" | "hidden";

/** 一台 MCP 服务器（会话建立时挂上去）。 */
export interface McpServerSpec {
	/** 服务器名（工具名前缀：`mcp__<name>__`）。 */
	name: string;
	/** 地址。 */
	url: string;
	/** 传输类型（缺省 `http`；`sse` 也走 HTTP 传输）。 */
	type?: McpTransportType;
	/** 暴露方式（缺省 `direct`）。 */
	exposure?: McpExposure;
	/** 调用方的 token（AiAdmin 的 MCP 靠它做权限码校验）。 */
	token?: string;
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
	servers: readonly McpServerSpec[],
): (pi: ExtensionAPI) => void {
	return (pi: ExtensionAPI) => {
		for (const server of servers) {
			pi.registerMcpServer(server.name, createMcpServerConfig(server));
		}
	};
}

/**
 * MCP 工具名的**服务器前缀**（pi 的规则：`mcp__<server>__`，非法字符变 `_`）。
 *
 * ⚠️ 必须和 pi 用**同一套规则**（否则认不出自己的工具 ⇒ 写操作判不出来）。
 */
export function mcpToolPrefix(serverName: string): string {
	return `mcp__${serverName.replace(/[^A-Za-z0-9_]/g, "_")}__`;
}

/**
 * 去掉 MCP 工具名的服务器前缀 ⇒ **工具本名**（如 `update_task`）。
 *
 * @param toolName 工具名（`mcp__<server>__<tool>`）。
 * @param prefixes 这个会话用到的服务器前缀（**认得准** ⇒ 不会认错服务器）。
 */
export function stripMcpToolPrefix(
	toolName: string,
	prefixes: readonly string[],
): string {
	for (const prefix of prefixes) {
		if (toolName.startsWith(prefix)) {
			return toolName.slice(prefix.length);
		}
	}
	// 兜底：按 pi 的解析方式（非贪婪）
	const match = /^mcp__(.+?)__(.+)$/.exec(toolName);
	return match?.[2] ?? toolName;
}
