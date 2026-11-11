/**
 * `POST /api/agent/pending/[id]/approve` —— **批准**一次挂起的修改。
 *
 * 响应：`{ id, status: "CONFIRMED" }`
 *
 * ## 它做了什么
 *
 * 1. 校验**当前用户**（token 透传给 AiAdmin 校验）⇒ 只有发起这次对话的人能批；
 * 2. 把 `ai_pending_action` 那行落定成 CONFIRMED（**只改 PENDING 的行**
 *    ⇒ 重复点不会重复执行）；
 * 3. **唤醒**挂在 `tool_call` hook 上的等待者 ⇒ hook 放行 ⇒
 *    **pi 照常执行原来的工具调用** ⇒ 模型拿到正常结果、那一轮不中断。
 *
 * ⚠️ **顺序很重要**：先落库再唤醒 ⇒ hook 放行时 DB 里已经是 CONFIRMED。
 */

import { agentRuntime } from "../../../../../../agent/runtime.ts";
import { pendingWaiters } from "../../../../../../agent/pending-waiters.ts";
import { resolvePendingAction } from "../../../../../../pending-write.ts";
import { extractBearerToken } from "../../../../../../http/auth.ts";
import { errorResponse } from "../../../../../../http/errors.ts";
import { errorEnvelope, okEnvelope, preflightResponse } from "../../../../../../http/respond.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 缺 token 的统一说法。 */
const MISSING_TOKEN = "缺少 Authorization: Bearer <token>（token 由调用方提供，本服务只做透传）";

/** CORS 预检。 */
export async function OPTIONS(request: Request): Promise<Response> {
	return preflightResponse(request);
}

/** 批准。 */
export async function POST(
	request: Request,
	{ params }: { params: Promise<{ id: string }> },
): Promise<Response> {
	const token = extractBearerToken(request.headers.get("authorization") ?? undefined);
	if (token === undefined) {
		return errorEnvelope(request, 401, MISSING_TOKEN, 401);
	}
	const { id } = await params;

	try {
		// AiAdmin 是权威：它认这个 token，我们才知道「这是谁」
		const user = await agentRuntime.resolveCurrentUser(token);
		const resolved = await resolvePendingAction(id, "CONFIRMED", String(user.id));
		if (!resolved) {
			// 已经落定过（重复点）或压根不存在 ⇒ 不能重复执行
			return errorEnvelope(request, 409, "这条待确认已经处理过了（或不存在）", 409);
		}
		// 唤醒 hook ⇒ 放行原工具调用
		pendingWaiters.decide(id, "approved");
		return okEnvelope(request, { id, status: "CONFIRMED" });
	} catch (error) {
		return errorResponse(request, error);
	}
}
