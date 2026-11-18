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

// ⚠️ **必须排在所有 import 之前**：运行时是**模块级单例**（import 时就构造）
//    ⇒ 插件必须**先注册**，否则构造时会认为「配置里的插件没注册」。
import "./plugins.ts";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { buildCorsHeaders, isPreflightRequest, originOf } from "./core/http/cors.ts";
import { toErrorEnvelope } from "./core/http/errors.ts";
import { MISSING_TOKEN_MESSAGE, allowedOrigins, errorBody } from "./core/http/respond.ts";
import { agentRuntime } from "./core/session/runtime.ts";
import { listAgentSummaries } from "./core/config/catalog.ts";
import { agentsRoot, loadAgentConfigs } from "./core/config/loader.ts";
import { agentRouter } from "./core/routes/agent.ts";
import { createAgentsRouter } from "./core/routes/agents.ts";
import { auditRouter } from "./core/routes/audit.ts";
import { eventsRouter } from "./core/routes/events.ts";
import { HEALTH_CACHE_TTL_MS, createHealthRouter } from "./core/routes/health.ts";
import { probeAiAdmin, probeDatabase, probeModel } from "./core/routes/health-probes.ts";
import { pendingRouter } from "./core/routes/pending.ts";

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
	// ⚠️ **智能体清单**（`/api/agents`）是「配置」那条线 ⇒ 独立前缀
	app.use(
		"/api/agents",
		createAgentsRouter({
			listAgents: () => listAgentSummaries(agentsRoot()),
			resolveUser: (token) => agentRuntime.resolveCurrentUser(token),
		}),
	);
	app.use("/api/pending", pendingRouter);
	app.use("/api/audit", auditRouter);
	app.use(notFoundHandler);
	app.use(errorHandler);
	return app;
}

/** 启动服务（监听 `PORT`，缺省 3100）。 */
export function start(): void {
	// ⚠️ **启动即校验智能体配置**：配置坏了就别跑起来（否则用户看到的是「少了个智能体」，
	//    却查不到原因）⇒ 这里直接退出，让人看到是哪个字段坏了。
	try {
		loadAgentConfigs(agentsRoot());
	} catch (error) {
		console.error(
			`[ai-service] 智能体配置不合法，已退出：${error instanceof Error ? error.message : String(error)}`,
		);
		process.exit(1);
	}

	// ⚠️ **配置里写的插件必须已注册** ⇒ 拼错名字**服务起不来**（不等到建会话才发现）。
	try {
		agentRuntime.validatePlugins();
	} catch (error) {
		console.error(
			`[ai-service] 插件配置不合法，已退出：${error instanceof Error ? error.message : String(error)}`,
		);
		process.exit(1);
	}

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
