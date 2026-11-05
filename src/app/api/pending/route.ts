/**
 * `GET /api/pending` —— 待确认列表（**只读**）。
 *
 * 响应：`data` 是**数组**（形状见 `src/pending-query.ts` 的 `PendingItem`）。
 *
 * ## 鉴权
 *
 * 和会话那几套接口一样：要 `Authorization: Bearer <token>`。
 * token 交给 AiAdmin 判（本服务**不解析**它）—— 顺带就把「当前用户」问出来了：
 * `agentRuntime.resolveCurrentUser` 走的是 `src/agent/identity.ts` 的
 * `CurrentUserResolver`（按 token 指纹缓存 ⇒ 同一会话不用反复问后端）。
 *
 * ## 作用域
 *
 * **只看调用方自己的行**（`userId` 过滤）—— 别人的待确认行一条都不返回。
 *
 * ## 查询参数
 *
 * `status`（缺省 `PENDING`）、`limit`（缺省 50，上限 200）。
 * **不认识的参数静默忽略**（前端会多传 `from` / `to`，本轮不做时间区间，
 * 但不能因此报错）。
 *
 * ## 诚实说明
 *
 * 当前切片里**没有任何命令会进待确认**（唯一的 `create_task` 是非破坏性的，
 * 不需要确认）⇒ 这个列表**现在是空的**。
 * 但端点是**真的读表**的（不是写死空数组）⇒ 前端的空态是真的，
 * 完整版的确认流程落地后前端立刻就有数据。
 */

import { agentRuntime } from "../../../agent/runtime";
import { prisma } from "../../../db";
import { extractBearerToken } from "../../../http/auth";
import { errorResponse } from "../../../http/errors";
import { errorEnvelope, okEnvelope, preflightResponse } from "../../../http/respond";
import { parsePendingFilters, prismaPendingReader, queryPendingActions } from "../../../pending-query";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 缺 token 的统一说法（不泄露任何凭据信息）。 */
const MISSING_TOKEN = "缺少 Authorization: Bearer <token>（token 由调用方提供，本服务只做透传）";

/** CORS 预检。 */
export async function OPTIONS(request: Request): Promise<Response> {
	return preflightResponse(request);
}

/** 待确认列表（当前用户的，新的在前）。 */
export async function GET(request: Request): Promise<Response> {
	const token = extractBearerToken(request);
	if (token === undefined) {
		return errorEnvelope(request, 401, MISSING_TOKEN, 401);
	}
	try {
		// AiAdmin 是权威：token 认不出用户 ⇒ 401（错误由 errorResponse 映射）
		const user = await agentRuntime.resolveCurrentUser(token);
		const userId = String(user.id);
		const filters = parsePendingFilters(new URL(request.url).searchParams);
		const items = await queryPendingActions(prismaPendingReader(prisma), {
			...filters,
			userId,
		});
		return okEnvelope(request, items);
	} catch (error) {
		return errorResponse(request, error);
	}
}
