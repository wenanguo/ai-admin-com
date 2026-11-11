/**
 * 待确认列表（挂在 `/api/pending` 下）。
 *
 * - `GET /` ⇒ 列表（**只看调用方自己的行**）
 *
 * 批准/拒绝在 `/api/agent/pending/:id/*`（见 `agent.ts`）。
 */

import { Router } from "express";
import { agentRuntime } from "../agent/runtime.ts";
import { prisma } from "../db.ts";
import { okBody } from "../http/respond.ts";
import { parsePendingFilters, prismaPendingReader, queryPendingActions } from "../pending-query.ts";
import { queryToSearchParams, requireToken, sendError } from "./support.ts";

/** 待确认的路由。 */
export const pendingRouter = Router();

/** 待确认列表（当前用户的，新的在前）。 */
pendingRouter.get("/", async (req, res) => {
	const token = requireToken(req, res);
	if (token === undefined) {
		return;
	}
	try {
		// AiAdmin 是权威：token 认不出用户 ⇒ 401（错误由 sendError 映射）
		const user = await agentRuntime.resolveCurrentUser(token);
		const userId = String(user.id);
		const filters = parsePendingFilters(queryToSearchParams(req.query));
		const items = await queryPendingActions(prismaPendingReader(prisma), {
			...filters,
			userId,
		});
		res.json(okBody(items));
	} catch (error) {
		sendError(res, error);
	}
});
