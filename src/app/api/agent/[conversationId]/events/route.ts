/**
 * `GET /api/agent/[conversationId]/events` —— SSE 事件流。
 *
 * 帧的顺序：
 * 1. `connected`（第一帧，告诉客户端连上了、当前有没有在跑）；
 * 2. **回放**：这个会话之前发生过的帧（按缓冲里还留着多少）；
 * 3. **增量**：往后实时推。
 *
 * 事件（前端按这几种写）：
 * | 事件 | 载荷 |
 * |---|---|
 * | `connected` | `{ conversationId, isStreaming }` |
 * | `message_start` / `text_delta` / `message_end` | 助手说的话 |
 * | `tool_call` | `{ toolName, args }` |
 * | `tool_result` | `{ toolName, status, summary, details }` |
 * | `agent_settled` | — |
 *
 * 心跳：每 15 秒一个 SSE 注释行（标准的 SSE 客户端会忽略它，
 * 但它能证明连接还活着，也能防代理把连接判成空闲超时）。
 *
 * ⚠️ **前端不能用浏览器的原生 `EventSource`**：它不能自定义请求头，
 * 而这个端点必须要 `Authorization: Bearer <token>`（缺了就 401）
 * ⇒ 前端要用 `fetch` + `ReadableStream`（读 `response.body`）自己解析 SSE 帧。
 */

import { agentRuntime } from "../../../../../agent/runtime.ts";
import type { StreamFrame } from "../../../../../agent/frame-buffer.ts";
import { extractBearerToken } from "../../../../../http/auth.ts";
import { errorResponse } from "../../../../../http/errors.ts";
import { errorEnvelope, preflightResponse } from "../../../../../http/respond.ts";
import { buildCorsHeaders, originOf } from "../../../../../http/cors.ts";
import { allowedOrigins } from "../../../../../http/respond.ts";
import { frameToSse, sseComment, sseFrame, SSE_HEADERS } from "../../../../../http/sse.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 心跳间隔（毫秒）。 */
const HEARTBEAT_INTERVAL_MS = 15_000;

/** 缺 token 的统一说法。 */
const MISSING_TOKEN = "缺少 Authorization: Bearer <token>（token 由调用方提供，本服务只做透传）";

/** CORS 预检。 */
export async function OPTIONS(request: Request): Promise<Response> {
	return preflightResponse(request);
}

/** 事件流。 */
export async function GET(
	request: Request,
	{ params }: { params: Promise<{ conversationId: string }> },
): Promise<Response> {
	const token = extractBearerToken(request.headers.get("authorization") ?? undefined);
	if (token === undefined) {
		return errorEnvelope(request, 401, MISSING_TOKEN, 401);
	}
	const { conversationId } = await params;

	// token 交给 AiAdmin 判一下（它是权威）；顺带把这个 token 记在通道上，
	// 工具执行时要用它去 AiAdmin 建数据。
	let userId: string;
	try {
		userId = String((await agentRuntime.resolveCurrentUser(token)).id);
	} catch (error) {
		return errorResponse(request, error);
	}

	// 会话必须存在且属于当前用户（不存在就回 404 信封，而不是开一条永远没消息的流）
	try {
		await agentRuntime.readState(conversationId, userId);
	} catch (error) {
		return errorResponse(request, error);
	}

	const encoder = new TextEncoder();
	let closed = false;
	let heartbeat: ReturnType<typeof setInterval> | undefined;
	let unsubscribe: (() => void) | undefined;

	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			const write = (chunk: string): void => {
				if (closed) {
					return;
				}
				try {
					controller.enqueue(encoder.encode(chunk));
				} catch {
					// 客户端大概已经断了 —— 安静收摊
					finish("写失败（客户端已断开）");
				}
			};

			const finish = (reason: string): void => {
				if (closed) {
					return;
				}
				closed = true;
				if (heartbeat !== undefined) {
					clearInterval(heartbeat);
					heartbeat = undefined;
				}
				unsubscribe?.();
				unsubscribe = undefined;
				console.log(`[agent:sse] 关闭 ${conversationId}：${reason}`);
				try {
					controller.close();
				} catch {
					// 已经断了
				}
			};

			// ① 先取回放快照，② 再订阅增量 —— 顺序反了会漏帧
			const channel = agentRuntime.getChannel(conversationId);
			const snapshot: StreamFrame[] = channel?.backlog.list() ?? [];
			const snapshotMaxSeq = snapshot.length > 0 ? snapshot[snapshot.length - 1].seq : 0;

			unsubscribe = agentRuntime.subscribe(conversationId, (frame) => {
				// 快照里已经有的帧不再重复发
				if (frame.seq <= snapshotMaxSeq) {
					return;
				}
				write(frameToSse(frame));
			});

			// 首帧：connected
			write(
				sseFrame("connected", {
					conversationId,
					isStreaming: channel?.isStreaming ?? false,
				}),
			);

			// 回放
			for (const frame of snapshot) {
				write(frameToSse(frame));
			}

			heartbeat = setInterval(() => {
				write(sseComment("heartbeat"));
			}, HEARTBEAT_INTERVAL_MS);

			request.signal.addEventListener("abort", () => {
				finish("收到客户端断开信号 (request.signal abort)");
			});
		},
		cancel() {
			closed = true;
			if (heartbeat !== undefined) {
				clearInterval(heartbeat);
				heartbeat = undefined;
			}
			unsubscribe?.();
			unsubscribe = undefined;
		},
	});

	return new Response(stream, {
		headers: {
			...SSE_HEADERS,
			...buildCorsHeaders(originOf(request.headers.get("origin") ?? undefined), allowedOrigins()),
		},
	});
}
