/**
 * AiAdmin 的 MCP 服务器 —— **工具的来源**。
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
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** 服务器名（工具名前缀就是 `mcp__aiadmin__`）。 */
export const AIADMIN_MCP_SERVER_NAME = "aiadmin";

/** MCP 服务器配置（pi 的 `McpHttpServerConfig` 的形状）。 */
export interface AiadminMcpConfig {
	type: "http";
	url: string;
	headers: Record<string, string>;
	exposure: "direct" | "deferred" | "codemode" | "hidden";
}

/**
 * 造 AiAdmin 的 MCP 服务器配置。
 *
 * @param options 地址、调用方 token、暴露方式。
 */
export function createAiadminMcpConfig(options: {
	url: string;
	token: string;
	exposure?: AiadminMcpConfig["exposure"];
}): AiadminMcpConfig {
	return {
		type: "http",
		url: options.url,
		headers: { Authorization: `Bearer ${options.token}` },
		// ⚠️ 默认直接暴露给模型（任务模块的工具数是个位数）
		exposure: options.exposure ?? "direct",
	};
}

/**
 * 造一个注册 AiAdmin MCP 服务器的扩展。
 *
 * ⚠️ 这是 **inline extension**：pi 在加载扩展时调用它 ⇒
 *    正好是「会话建立」的时刻 ⇒ 每个会话带自己的 token。
 *
 * @param options 地址与调用方 token。
 */
export function createAiadminMcpExtension(options: {
	url: string;
	token: string;
}): (pi: ExtensionAPI) => void {
	return (pi: ExtensionAPI) => {
		pi.registerMcpServer(
			AIADMIN_MCP_SERVER_NAME,
			createAiadminMcpConfig({ url: options.url, token: options.token }),
		);
	};
}
