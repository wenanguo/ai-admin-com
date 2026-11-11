/**
 * SSE 事件流（挂在 `/api/agent/:conversationId/events`）。
 *
 * 帧的顺序：
 * 1. `connected`（第一帧，告诉客户端连上了、当前有没有在跑）；
 * 2. **回放**：这个会话之前发生过的帧（按缓冲里还留着多少）；
 * 3. **增量**：往后实时推。
 *
 * 心跳：每 15 秒一个 SSE 注释行（标准的 SSE 客户端会忽略它，
 * 但它能证明连接还活着，也能防代理把连接判成空闲超时）。
 *
 * ⚠️ **前端不能用浏览器的原生 `EventSource`**：它不能自定义请求头，
 * 而这个端点必须要 `Authorization: Bearer <token>`（缺了就 401）
 * ⇒ 前端要用 `fetch` + `ReadableStream`（读 `response.body`）自己解析 SSE 帧。
 */

import { Router } from "express";
import { agentRuntime } from "../agent/runtime";
import type { StreamFrame } from "../agent/frame-buffer";
import { buildCorsHeaders, originOf } from "../http/cors";
import { allowedOrigins } from "../http/respond";
import { frameToSse, sseComment, sseFrame, SSE_HEADERS } from "../http/sse";
import { requireToken, sendError } from "./support";

/** 心跳间隔（毫秒）。 */
const HEARTBEAT_INTERVAL_MS = 15_000;

/** 事件流的路由。 */
export const eventsRouter = Router();

/** 事件流。 */
eventsRouter.get("/:conversationId/events", async (req, res) => {
	const token = requireToken(req, res);
	if (token === undefined) {
		return;
	}
	const conversationId = req.params.conversationId;

	// token 交给 AiAdmin 判一下（它是权威）；顺带把这个 token 记在通道上，
	// 工具执行时要用它去 AiAdmin 建数据。
	let userId: string;
	try {
		userId = String((await agentRuntime.resolveCurrentUser(token)).id);
	} catch (error) {
		sendError(res, error);
		return;
	}

	// 会话必须存在且属于当前用户（不存在就回 404 信封，而不是开一条永远没消息的流）
	try {
		await agentRuntime.readState(conversationId, userId);
	} catch (error) {
		sendError(res, error);
		return;
	}

	res.writeHead(200, {
		...SSE_HEADERS,
		...buildCorsHeaders(originOf(req.get("origin")), allowedOrigins()),
	});
	res.flushHeaders?.();

	let closed = false;
	let heartbeat: ReturnType<typeof setInterval> | undefined;
	let unsubscribe: (() => void) | undefined;

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
			res.end();
		} catch {
			// 已经断了
		}
	};

	const write = (chunk: string): void => {
		if (closed) {
			return;
		}
		try {
			res.write(chunk);
		} catch {
			// 客户端大概已经断了 —— 安静收摊
			finish("写失败（客户端已断开）");
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

	req.on("close", () => {
		finish("客户端断开 (request closed)");
	});
});
