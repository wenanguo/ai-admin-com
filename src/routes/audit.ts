/**
 * 审计流水（挂在 `/api/audit` 下）。
 *
 * - `GET /` ⇒ `{ total, items[] }`（**只看调用方自己的行**）
 */

import { Router } from "express";
import { parseAuditFilters, prismaAuditReader, queryAuditLog } from "../audit-query";
import { agentRuntime } from "../agent/runtime";
import { prisma } from "../db";
import { okBody } from "../http/respond";
import { queryToSearchParams, requireToken, sendError } from "./support";

/** 审计的路由。 */
export const auditRouter = Router();

/** 审计流水（当前用户的，新的在前）。 */
auditRouter.get("/", async (req, res) => {
	const token = requireToken(req, res);
	if (token === undefined) {
		return;
	}
	try {
		const user = await agentRuntime.resolveCurrentUser(token);
		const userId = String(user.id);
		const filters = parseAuditFilters(queryToSearchParams(req.query));
		const page = await queryAuditLog(prismaAuditReader(prisma), {
			...filters,
			userId,
			// 审计行里只有 userId、没有名字 ⇒ 用**调用方自己的**名字（只查这一次）
			actorName: user.name ?? userId,
		});
		res.json(okBody(page));
	} catch (error) {
		sendError(res, error);
	}
});
