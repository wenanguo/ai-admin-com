/**
 * `GET /api/agent/[conversationId]/state` —— 会话快照。
 *
 * 响应：`{ conversationId, messages[], isStreaming, model }`
 *
 * ## 为什么要有它
 *
 * **「快照才是真相」**：SSE 是**增量**的，断线、刷新、晚连都会丢帧。
 * 客户端随时可以拿这个快照重建整个界面（回放缓冲超限时丢掉的 `text_delta`
 * 也靠它补回来）。
 */

import { agentRuntime } from "../../../../../agent/runtime.ts";
import { extractBearerToken } from "../../../../../http/auth.ts";
import { errorResponse } from "../../../../../http/errors.ts";
import { errorEnvelope, okEnvelope, preflightResponse } from "../../../../../http/respond.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 缺 token 的统一说法。 */
const MISSING_TOKEN = "缺少 Authorization: Bearer <token>（token 由调用方提供，本服务只做透传）";

/** CORS 预检。 */
export async function OPTIONS(request: Request): Promise<Response> {
	return preflightResponse(request);
}

/** 会话状态。 */
export async function GET(
	request: Request,
	{ params }: { params: Promise<{ conversationId: string }> },
): Promise<Response> {
	const token = extractBearerToken(request.headers.get("authorization") ?? undefined);
	if (token === undefined) {
		return errorEnvelope(request, 401, MISSING_TOKEN, 401);
	}
	const { conversationId } = await params;
	try {
		// AiAdmin 是权威：token 认不出用户 ⇒ 401
		const user = await agentRuntime.resolveCurrentUser(token);
		const state = await agentRuntime.readState(conversationId, String(user.id));
		return okEnvelope(request, {
			conversationId: state.conversationId,
			messages: state.messages.map((message) => ({
				id: message.id,
				role: message.role,
				content: message.content,
				seq: message.seq,
				createdAt: message.createdAt.toISOString(),
			})),
			isStreaming: state.isStreaming,
			model: state.model,
		});
	} catch (error) {
		return errorResponse(request, error);
	}
}
