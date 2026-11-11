/**
 * 假 MCP 服务器 —— **测试专用的传输层**。
 *
 * ## 为什么要有它
 *
 * MCP 的真实对手方是后端（还没部署）⇒ 但「模型能看到 MCP 工具、调用它时参数原样传过去」
 * 这条链路必须**现在**就能验证，不能等部署。
 *
 * pi 的 MCP 扩展接受 `createTransport` 钩子 ⇒ 我们注入一个假的传输层，
 * 它按 JSON-RPC 应答 `initialize` / `tools/list` / `tools/call`。
 *
 * ⚠️ 这个文件**只给测试用**，不进生产代码路径。
 */

import type { McpTransport } from "@earendil-works/pi-mcp";

/** 假服务器提供的工具。 */
export interface FakeMcpTool {
	name: string;
	description?: string;
	inputSchema?: object;
}

/** 假服务器的配置。 */
export interface FakeMcpServerOptions {
	/** 服务器提供的工具（缺省有一个 `list_tasks`）。 */
	tools?: FakeMcpTool[];
	/** 调用工具时的返回值。 */
	onCallTool?: (
		name: string,
		args: Record<string, unknown>,
	) => { content: Array<{ type: "text"; text: string }>; isError?: boolean };
}

/** 假服务器（及其传输层工厂）。 */
export interface FakeMcpServer {
	/** 注入给 `createMcpExtension({ createTransport })`。 */
	createTransport: () => McpTransport;
	/** 连了几次（用来验「token 变了会不会重建连接」）。 */
	connectionCount: () => number;
	/** 被调用过的工具与参数。 */
	calls: Array<{ name: string; args: Record<string, unknown> }>;
}

/** 消息监听器的类型（从 `McpTransport` 上取，免得重复定义）。 */
type MessageListener = Parameters<McpTransport["onMessage"]>[0];

/** JSON-RPC 请求的形状。 */
interface JsonRpcRequest {
	jsonrpc: "2.0";
	id?: string | number;
	method: string;
	params?: Record<string, unknown>;
}

/** 造一个假 MCP 服务器。 */
export function createFakeMcpServer(
	options: FakeMcpServerOptions = {},
): FakeMcpServer {
	const tools: FakeMcpTool[] = options.tools ?? [
		{
			name: "list_tasks",
			description: "列出任务",
			inputSchema: { type: "object", properties: {} },
		},
	];
	const calls: FakeMcpServer["calls"] = [];
	let connections = 0;

	const createTransport = (): McpTransport => {
		connections += 1;
		const messageListeners: Array<MessageListener> = [];
		const errorListeners: Array<(error: Error) => void> = [];
		const closeListeners: Array<() => void> = [];

		const reply = (id: string | number, result: unknown): void => {
			const response = { jsonrpc: "2.0" as const, id, result };
			for (const listener of messageListeners) {
				listener(response);
			}
		};

		return {
			async start(): Promise<void> {
				// 真实的传输层在 start 里握手；这里由 send 应答 initialize
			},
			async send(message: unknown): Promise<void> {
				const request = message as JsonRpcRequest;
				if (request === null || typeof request !== "object") {
					return;
				}
				switch (request.method) {
					case "initialize":
						reply(request.id as string | number, {
							protocolVersion: "2024-11-05",
							capabilities: { tools: {} },
							serverInfo: { name: "fake-aipm", version: "1.0.0" },
						});
						return;
					case "tools/list":
						reply(request.id as string | number, { tools });
						return;
					case "tools/call": {
						const name = String(request.params?.["name"] ?? "");
						const args = (request.params?.["arguments"] ?? {}) as Record<
							string,
							unknown
						>;
						calls.push({ name, args });
						const result = options.onCallTool?.(name, args) ?? {
							content: [{ type: "text" as const, text: `called ${name}` }],
						};
						reply(request.id as string | number, result);
						return;
					}
					default:
						// 通知（没有 id）不需要回复
						if (request.id === undefined) {
							return;
						}
						reply(request.id, {});
				}
			},
			async close(): Promise<void> {
				for (const listener of closeListeners) {
					listener();
				}
			},
			onMessage(listener: MessageListener): () => void {
				messageListeners.push(listener);
				return () => {
					const index = messageListeners.indexOf(listener);
					if (index >= 0) {
						messageListeners.splice(index, 1);
					}
				};
			},
			onError(listener: (error: Error) => void): () => void {
				errorListeners.push(listener);
				return () => {
					const index = errorListeners.indexOf(listener);
					if (index >= 0) {
						errorListeners.splice(index, 1);
					}
				};
			},
			onClose(listener: () => void): () => void {
				closeListeners.push(listener);
				return () => {
					const index = closeListeners.indexOf(listener);
					if (index >= 0) {
						closeListeners.splice(index, 1);
					}
				};
			},
		};
	};

	return { createTransport, connectionCount: () => connections, calls };
}
