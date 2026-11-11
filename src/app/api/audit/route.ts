/**
 * `GET /api/audit` —— 审计流水（**只读**）。
 *
 * 响应：`{ total, items[] }`（`items` 的形状见 `src/audit-query.ts` 的 `AuditItem`）。
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
 * **只看调用方自己的行**（`userId` 过滤）—— 别人的审计流水一条都不返回。
 *
 * ## 查询参数
 *
 * `actor`（`AI`/`USER`）、`command`、`limit`（缺省 50，上限 200）、`offset`、
 * `undone`（`true` = 只看已撤销的）。**不认识的参数静默忽略**（前端会多传
 * `from` / `to`，本轮不做时间区间，但不能因此报错）。
 */

import { agentRuntime } from "../../../agent/runtime.ts";
import { parseAuditFilters, prismaAuditReader, queryAuditLog } from "../../../audit-query.ts";
import { prisma } from "../../../db.ts";
import { extractBearerToken } from "../../../http/auth.ts";
import { errorResponse } from "../../../http/errors.ts";
import { errorEnvelope, okEnvelope, preflightResponse } from "../../../http/respond.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 缺 token 的统一说法（不泄露任何凭据信息）。 */
const MISSING_TOKEN = "缺少 Authorization: Bearer <token>（token 由调用方提供，本服务只做透传）";

/** CORS 预检。 */
export async function OPTIONS(request: Request): Promise<Response> {
	return preflightResponse(request);
}

/** 审计流水（当前用户的，新的在前）。 */
export async function GET(request: Request): Promise<Response> {
	const token = extractBearerToken(request.headers.get("authorization") ?? undefined);
	if (token === undefined) {
		return errorEnvelope(request, 401, MISSING_TOKEN, 401);
	}
	try {
		// AiAdmin 是权威：token 认不出用户 ⇒ 401（错误由 errorResponse 映射）
		const user = await agentRuntime.resolveCurrentUser(token);
		const userId = String(user.id);
		const filters = parseAuditFilters(new URL(request.url).searchParams);
		const page = await queryAuditLog(prismaAuditReader(prisma), {
			...filters,
			userId,
			// 审计行里只有 userId、没有名字 ⇒ 用**调用方自己的**名字（只查这一次）
			actorName: user.name ?? userId,
		});
		return okEnvelope(request, page);
	} catch (error) {
		return errorResponse(request, error);
	}
}
