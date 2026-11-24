/**
 * MCP 服务器 —— **工具的来源**。
 *
 * ## 为什么走 MCP，而不是自己写命令
 *
 * 后端已经把「接口」变成「MCP tool」（`AiAdmin/backend/app/plugin/module_mcp`）⇒
 * 后端加接口，AI 侧**一行代码都不用改**。
 *
 * ## 管理面退给 dsh（issue #153）
 *
 * 服务器的**装 / 卸 / 列 / 探活 / 重连**交给 dsh 自带的管理面
 * （`@deepseek-ai/dsh-mcp-manager`，在 dsh 插件里挂上）⇒ **我们不造第二套**。
 *
 * ⚠️ **但凭据仍然归我们**：AiAdmin 的 MCP 要带**调用方的 JWT**
 *    （后端靠它做权限码校验）⇒ token 只有我们知道 ⇒ **按用户构造配置**这段
 *    仍然在我们这儿（dsh 那边只拿到算好的配置）。
 *
 * ## 配置形状：**语义不变**（agent.yaml 的 `mcpServers`）
 *
 * | 我们的配置 | dsh 管理面的形状（`@deepseek-ai/dsh-mcp-manager`） |
 * | ---------- | --------------------------------------------------- |
 * | `name` | **map 的键**（也就是 `serverName` ⇒ 工具名前缀 `mcp__<name>__`） |
 * | `url` | `url`（streamable-http） |
 * | `type: http \| sse` | `transport: streamable-http`（dsh 只这一种 HTTP 传输） |
 * | `exposure: direct` | （无对应 ⇒ 直接给模型看） |
 * | `exposure: deferred \| codemode` | （无对应 ⇒ 同 direct） |
 * | `exposure: hidden` | **不挂这台**（模型看不到） |
 * | 调用方的 token | `headers: { Authorization: "Bearer …" }` |
 *
 * ⚠️ **token 只活在内存里**（子进程的环境变量 ⇒ 绝不落盘、绝不进日志）。
 *
 * ## 为什么每个会话单独挂
 *
 * MCP 调用要带**调用方的 JWT**（后端靠它做权限码校验）⇒ 每个用户、每个会话的
 * token 都不同 ⇒ 不能用静态配置，只能运行时算。
 */

/** 传输类型（本服务是 HTTP 服务 ⇒ 只做 http；`sse` 也走 HTTP 传输）。 */
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
}

/**
 * **dsh 管理面里的一台服务器**（`@deepseek-ai/dsh-mcp-manager` 的条目形状）。
 *
 * ⚠️ **我们自己声明这份类型**（不 import dsh 的类型）⇒ dsh 升级不会炸我们的编译
 *    （见 spec §7「类型边界」）。
 */
export interface DshMcpServerEntry {
	/** 传输（dsh 只有 `streamable-http` 一种 HTTP 传输）。 */
	transport: "streamable-http";
	/** MCP 端点地址。 */
	url: string;
	/** 附加的请求头（**token 在这里 ⇒ 只在内存里**）。 */
	headers: Record<string, string>;
	/** 一次工具调用的超时（毫秒）。 */
	toolCallTimeoutMs: number;
	/** 启动一台服务器的预算（毫秒）。 */
	startupTimeoutMs: number;
}

/** 一台服务器在 dsh 管理面里的登记（**名字是键** ⇒ 也是工具名的前缀）。 */
export interface DshMcpServerRegistration {
	/** 服务器名（工具名前缀：`mcp__<name>__`）。 */
	name: string;
	/** 条目本体（交给 dsh 管理面）。 */
	entry: DshMcpServerEntry;
}

/** 一次 MCP 工具调用的默认超时（毫秒）。 */
export const DEFAULT_MCP_TOOL_CALL_TIMEOUT_MS = 60_000;

/** 启动一台 MCP 服务器的默认预算（毫秒）。 */
export const DEFAULT_MCP_STARTUP_TIMEOUT_MS = 15_000;

/**
 * 把「我们的 MCP 服务器清单」翻译成 **dsh 管理面的登记**。
 *
 * ⚠️ **语义不变**（agent.yaml 的 `mcpServers` 怎么写，这里就怎么理解）：
 *    - `exposure: hidden` ⇒ **不挂**（模型不该看到它）；
 *    - 其余暴露方式在 dsh 形状里都等价于「直接给模型看」。
 *
 * @param servers 要挂的服务器（**可以 0 / 1 / N 个**）。
 */
export function buildDshMcpServerRegistrations(
	servers: readonly McpServerSpec[],
): DshMcpServerRegistration[] {
	const registrations: DshMcpServerRegistration[] = [];
	for (const server of servers) {
		if ((server.exposure ?? "direct") === "hidden") {
			// ⚠️ **hidden ⇒ 不挂**（模型不该看到它）。
			continue;
		}
		registrations.push({
			name: server.name,
			entry: {
				transport: "streamable-http",
				url: server.url,
				// ⚠️ **token 只在内存里**（绝不落盘、绝不进日志）
				headers:
					server.token === undefined
						? {}
						: { Authorization: `Bearer ${server.token}` },
				toolCallTimeoutMs: DEFAULT_MCP_TOOL_CALL_TIMEOUT_MS,
				startupTimeoutMs: DEFAULT_MCP_STARTUP_TIMEOUT_MS,
			},
		});
	}
	return registrations;
}
