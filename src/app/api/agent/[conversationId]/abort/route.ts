/**
 * `POST /api/agent/[conversationId]/abort` —— **停掉当前正在跑的那一轮**。
 *
 * 响应：`{ conversationId, aborted: true }`
 *
 * ## 为什么要有它
 *
 * 模型跑飞时（工具卡住、模型陷入长思考），用户只能干等 —— 界面上的「发送」
 * 按钮被禁用了（`streaming` 状态），但没有出口。
 *
 * pi 的 SDK 有 `session.abort()`：停掉当前操作并等到会话空闲，
 * 随后 pi 自己会发 `agent_settled` ⇒ 前端的输入框解禁。
 *
 * ⚠️ **中止不是回滚**：这一轮里已经落库的消息（用户那句话、助手已写出的部分）
 *    都还在。已经建出来的任务也不会被撤销（撤销是另一件事，见审计的 `undoOf`）。
 *
 * 鉴权：必须带 `Authorization: Bearer <token>`；会话必须是当前用户的。
 */

import { agentRuntime } from "../../../../../agent/runtime";
import { extractBearerToken } from "../../../../../http/auth";
import { errorResponse } from "../../../../../http/errors";
import { errorEnvelope, okEnvelope, preflightResponse } from "../../../../../http/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 缺 token 的统一说法。 */
const MISSING_TOKEN = "缺少 Authorization: Bearer <token>（token 由调用方提供，本服务只做透传）";

/** CORS 预检。 */
export async function OPTIONS(request: Request): Promise<Response> {
	return preflightResponse(request);
}

/** 中止当前那一轮。 */
export async function POST(
	request: Request,
	{ params }: { params: Promise<{ conversationId: string }> },
): Promise<Response> {
	const token = extractBearerToken(request.headers.get("authorization") ?? undefined);
	if (token === undefined) {
		return errorEnvelope(request, 401, MISSING_TOKEN, 401);
	}
	const { conversationId } = await params;

	try {
		// AiAdmin 是权威：它认这个 token，我们才知道「这是谁」
		const user = await agentRuntime.resolveCurrentUser(token);
		await agentRuntime.abort(conversationId, String(user.id));
		return okEnvelope(request, { conversationId, aborted: true });
	} catch (error) {
		return errorResponse(request, error);
	}
}
