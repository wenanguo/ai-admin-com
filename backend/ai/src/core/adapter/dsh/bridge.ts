/**
 * **命令桥** —— dsh 侧插件回调我们执行命令的内部端点。
 *
 * ## 为什么需要它
 *
 * dsh 是**子进程** ⇒ 真正跑 agent loop 的是它 ⇒ 工具必须注册在**它**的 tool registry 里。
 * 但我们的命令（`create_task` 等）要数据库、要审计、要用户的 token ⇒ **不能**在 dsh 进程里跑。
 * ⇒ dsh 侧插件把调用**回调**到这个端点 ⇒ 命令本体、审计、参数收窄**全在我们这边**
 *    ⇒ 两个 runner 的行为一致。
 *
 * ## 安全性
 *
 * - **只给 loopback 用**（dsh 进程是**我们自己的子进程** ⇒ 走 127.0.0.1）；
 * - **进程内随机密钥**（`x-dsh-bridge-secret` 头）⇒ 别的进程调不动；
 * - ⚠️ **不在 `core/routes/contract.ts` 里** ⇒ **对外契约不变**（前端零改动）。
 */

import { timingSafeEqual } from "node:crypto";
import { Router, type Request, type Response } from "express";

/** 命令桥需要的依赖。 */
export interface DshBridgeOptions {
	/** 进程内随机密钥（**与起 dsh 进程时传的那个一致**）。 */
	secret: string;
	/** 执行一条命令（**运行时给**）。 */
	execute: (input: {
		conversationId: string;
		tool: string;
		args: Record<string, unknown>;
	}) => Promise<{ ok: boolean; summary: string; details?: unknown }>;
}

/** 造命令桥的路由（**挂在 `/internal/dsh` 下**）。 */
export function createDshBridgeRouter(options: DshBridgeOptions): Router {
	const router = Router();
	router.post("/commands", async (req: Request, res: Response) => {
		if (!sameSecret(req.get("x-dsh-bridge-secret"), options.secret)) {
			res.status(401).json({ ok: false, summary: "命令桥的密钥不对" });
			return;
		}
		const body = (req.body ?? {}) as {
			conversationId?: unknown;
			tool?: unknown;
			args?: unknown;
		};
		const conversationId = typeof body.conversationId === "string" ? body.conversationId : "";
		const tool = typeof body.tool === "string" ? body.tool : "";
		const args =
			typeof body.args === "object" && body.args !== null && !Array.isArray(body.args)
				? (body.args as Record<string, unknown>)
				: {};
		if (conversationId.length === 0 || tool.length === 0) {
			res.status(400).json({ ok: false, summary: "命令桥的载荷不完整" });
			return;
		}
		try {
			const result = await options.execute({ conversationId, tool, args });
			res.json(result);
		} catch (error) {
			res.status(500).json({
				ok: false,
				summary: `命令执行失败：${error instanceof Error ? error.message : String(error)}`,
			});
		}
	});
	return router;
}

/** 定长比较（**不泄露长度**）。 */
function sameSecret(given: string | undefined, expected: string): boolean {
	if (given === undefined) {
		return false;
	}
	const a = Buffer.from(given);
	const b = Buffer.from(expected);
	if (a.length !== b.length) {
		return false;
	}
	return timingSafeEqual(a, b);
}
