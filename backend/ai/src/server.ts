/**
 * Express 骨架 —— 装配、中间件、404、优雅退出。
 *
 * ## 这一层只管「壳」
 *
 * - CORS 中间件：挂 CORS 头；预检直接 204；
 * - 404：JSON 404（不是 Express 默认的 HTML）；
 * - 错误中间件：把异常变成统一信封；
 * - `createApp()` 只装配、**不监听**（测试可以随便起停）。
 *
 * 路由本身在 `src/routes/**`（Task 4/5）。
 */

import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { buildCorsHeaders, isPreflightRequest, originOf } from "./http/cors.ts";
import { toErrorEnvelope } from "./http/errors.ts";
import { MISSING_TOKEN_MESSAGE, allowedOrigins, errorBody } from "./http/respond.ts";
import { agentRouter } from "./routes/agent.ts";
import { auditRouter } from "./routes/audit.ts";
import { eventsRouter } from "./routes/events.ts";
import { HEALTH_CACHE_TTL_MS, createHealthRouter } from "./routes/health.ts";
import { probeAiAdmin, probeDatabase, probeModel } from "./routes/health-probes.ts";
import { pendingRouter } from "./routes/pending.ts";

export { MISSING_TOKEN_MESSAGE };

/** 未知路径的提示。 */
export const NOT_FOUND_MESSAGE = "接口不存在";

/**
 * CORS 中间件。
 *
 * - 挂 CORS 头（源在白名单里才回具体源）；
 * - `OPTIONS` 直接 204（预检不需要 body）。
 */
export function corsMiddleware(req: Request, res: Response, next: NextFunction): void {
	const origin = originOf(req.get("origin"));
	const preflight = isPreflightRequest(req.method, req.get("origin"));
	const headers = buildCorsHeaders(origin, allowedOrigins(), preflight);
	for (const [name, value] of Object.entries(headers)) {
		res.setHeader(name, value);
	}
	if (req.method === "OPTIONS") {
		res.status(204).end();
		return;
	}
	next();
}

/** 未知路径 ⇒ JSON 404。 */
export function notFoundHandler(_req: Request, res: Response): void {
	res.status(404).json(errorBody(404, NOT_FOUND_MESSAGE));
}

/** 统一错误信封（Express 靠 4 个参数认出它是错误中间件）。 */
export function errorHandler(
	error: unknown,
	_req: Request,
	res: Response,
	_next: NextFunction,
): void {
	const { status, body } = toErrorEnvelope(error);
	res.status(status).json(body);
}

/**
 * 健康检查路由（**真实自检**）。
 *
 * ⚠️ **恒回 200**（依赖挂了也 200）⇒ 编排系统不会把还活着的容器杀掉重启。
 * ⚠️ **不要 token**：这是基础设施端点，不是业务端点 ⇒ 不进 `contract.ts`。
 */
export const healthRouter = createHealthRouter({
	probes: {
		database: probeDatabase,
		aiadmin: probeAiAdmin,
		model: probeModel,
	},
	now: () => Date.now(),
	startedAt: Date.now(),
	ttlMs: HEALTH_CACHE_TTL_MS,
});

/**
 * 装配 app（**不监听**）。
 *
 * 中间件顺序：预检/CORS → 路由 → 404 → 错误处理。
 */
export function createApp(): Express {
	const app = express();
	// 别让外部看到框架名（也少一条信息泄露）
	app.disable("x-powered-by");
	app.use(corsMiddleware);
	// 健康检查**先挂**（探针不该被业务路由的任何前置逻辑影响）
	app.use("/health", healthRouter);
	// ⚠️ **不挂 `express.json()`**：body 由各路由自己读（`readJsonBody`），
	//    这样「没有 body」「body 坏了」「这个路由不关心 body」三种情况的
	//    语义与迁移前逐字一致。
	// 路由挂载（顺序：具体的先于带参数的，router 内部已经排好）
	app.use("/api/agent", agentRouter);
	app.use("/api/agent", eventsRouter);
	app.use("/api/pending", pendingRouter);
	app.use("/api/audit", auditRouter);
	app.use(notFoundHandler);
	app.use(errorHandler);
	return app;
}

/** 启动服务（监听 `PORT`，缺省 3100）。 */
export function start(): void {
	const port = Number(process.env.PORT ?? 3100);
	const app = createApp();
	const server = app.listen(port, () => {
		console.log(`[ai-service] 已启动：http://localhost:${port}`);
	});

	// 优雅退出：先停止接新连接，再退出
	for (const signal of ["SIGTERM", "SIGINT"] as const) {
		process.on(signal, () => {
			console.log(`[ai-service] 收到 ${signal}，正在关闭…`);
			server.close(() => process.exit(0));
			// 兜底：SSE 长连接可能挂着 ⇒ 最多等 5 秒
			setTimeout(() => process.exit(0), 5000).unref();
		});
	}
}
