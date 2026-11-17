/**
 * 智能体清单端点（挂在 `/api/agents` 下）。
 *
 * | 方法 | 路径 | 作用 |
 * |---|---|---|
 * | GET | `/api/agents` | 可用智能体清单（`id` / `name` / `description` / 能力摘要）|
 *
 * ## 为什么单独一个前缀（不是 `/api/agent/agents`）
 *
 * `/api/agent/**` 是**会话**那条线（会话 / 命令 / 事件流 / 技能）；
 * 智能体清单是**配置**那条线 ⇒ 独立前缀 `/api/agents`，
 * 将来「按配置装配会话」时也挂在同一前缀下（`POST /api/agents/:id/sessions`）。
 *
 * ## 口径
 *
 * - ⚠️ **要 token**：这是 AI 能力的一部分 ⇒ 只给登录用户看（与 `/api/agent/skills` 一致）；
 * - ⚠️ **读真文件**（不缓存）⇒ 改完 `agent.yaml` 重启就能看到；
 * - 非法配置在**启动时**就报错（见 `src/core/config/loader.ts`）⇒ 这里读到的都是合法的。
 */

import { Router } from "express";
import type { AgentSummary } from "../config/types.ts";
import { okBody } from "../http/respond.ts";
import { requireToken, sendError } from "./support.ts";

/** 这个端点要用的东西（**可注入** ⇒ 测试不用真读文件）。 */
export interface AgentsDeps {
	/** 列智能体。 */
	listAgents: () => AgentSummary[];
	/** 解析当前用户（token 认不出人 ⇒ 401）。 */
	resolveUser: (token: string) => Promise<unknown>;
}

/**
 * 造智能体清单路由。
 *
 * @param deps 依赖（注入 ⇒ 测试可控）。
 */
export function createAgentsRouter(deps: AgentsDeps): Router {
	const router = Router();

	router.get("/", async (req, res) => {
		const token = requireToken(req, res);
		if (token === undefined) {
			return;
		}
		try {
			// ⚠️ **身份要验**（与其它业务端点一致）：token 认不出用户 ⇒ 401。
			await deps.resolveUser(token);
			res.json(okBody(deps.listAgents()));
		} catch (error) {
			sendError(res, error);
		}
	});

	return router;
}
