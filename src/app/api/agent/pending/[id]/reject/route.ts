/**
 * `POST /api/agent/pending/[id]/reject` —— **拒绝**一次挂起的修改。
 *
 * 响应：`{ id, status: "REJECTED" }`
 *
 * ⚠️ 拒绝 ⇒ 唤醒 hook ⇒ hook 返回 `{block:true, reason}` ⇒
 * **模型收到一个错误工具结果** ⇒ 它会自己告诉用户「这次没改成」。
 *
 * （拒绝**不会**执行任何工具调用 ⇒ 没有副作用。）
 */

import { agentRuntime } from "../../../../../../agent/runtime";
import { pendingWaiters } from "../../../../../../agent/pending-waiters";
import { resolvePendingAction } from "../../../../../../pending-write";
import { extractBearerToken } from "../../../../../../http/auth";
import { errorResponse } from "../../../../../../http/errors";
import { errorEnvelope, okEnvelope, preflightResponse } from "../../../../../../http/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 缺 token 的统一说法。 */
const MISSING_TOKEN = "缺少 Authorization: Bearer <token>（token 由调用方提供，本服务只做透传）";

/** CORS 预检。 */
export async function OPTIONS(request: Request): Promise<Response> {
	return preflightResponse(request);
}

/** 拒绝。 */
export async function POST(
	request: Request,
	{ params }: { params: Promise<{ id: string }> },
): Promise<Response> {
	const token = extractBearerToken(request);
	if (token === undefined) {
		return errorEnvelope(request, 401, MISSING_TOKEN, 401);
	}
	const { id } = await params;

	try {
		const user = await agentRuntime.resolveCurrentUser(token);
		const resolved = await resolvePendingAction(id, "REJECTED", String(user.id));
		if (!resolved) {
			return errorEnvelope(request, 409, "这条待确认已经处理过了（或不存在）", 409);
		}
		// 唤醒 hook ⇒ 它会 block ⇒ 模型知道这次没做成
		pendingWaiters.decide(id, "rejected");
		return okEnvelope(request, { id, status: "REJECTED" });
	} catch (error) {
		return errorResponse(request, error);
	}
}
