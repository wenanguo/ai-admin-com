/**
 * 内核的 **HTTP 装配** —— 把内核的路由装成一个 Express app。
 *
 * ## 为什么这个文件存在（issue #116：内核可复用的验收）
 *
 * 阶段 5 造了 `core/index.ts`（**唯一公开入口**）⇒ 外部系统只从这里 import。
 * 但那时**还缺一块**：HTTP 装配（挂路由、CORS、404、错误信封）留在入口侧
 * （`src/server.ts`）⇒ 外部系统拿不到「装好的服务」⇒ 「换个业务系统照样能用」
 * 只能停在「能用几个零件」，**装不成一个服务**。
 *
 * ⇒ 这里把**与业务无关**的装配搬进内核，并做成**可注入**的：
 * 外部系统传自己的插件（健康检查的探针从插件来）+ 自己的智能体配置目录
 * ⇒ 得到的还是一个行为一致的服务。
 *
 * ## 这一层只管「壳」
 *
 * - CORS 中间件：挂 CORS 头；预检直接 204；
 * - 404：JSON 404（不是 Express 默认的 HTML）；
 * - 错误中间件：把异常变成统一信封；
 * - `createCoreApp()` 只装配、**不监听**（测试可以随便起停）。
 *
 * ⚠️ **内核不认识业务** ⇒ 路由全在 `core/routes/**`（会话 / 命令 / 事件流 /
 * 智能体清单 / 待确认 / 审计），业务命令来自**插件**（见 `core/plugins.ts`）。
 */

import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { buildCorsHeaders, isPreflightRequest, originOf } from "./http/cors.ts";
import { toErrorEnvelope } from "./http/errors.ts";
import { MISSING_TOKEN_MESSAGE, allowedOrigins, errorBody } from "./http/respond.ts";
import { agentRuntime } from "./session/runtime.ts";
import { listAgentSummaries } from "./config/catalog.ts";
import { agentsRoot as cwdAgentsRoot, loadAgentConfigs } from "./config/loader.ts";
import { agentRouter } from "./routes/agent.ts";
import { createAgentsRouter } from "./routes/agents.ts";
import { auditRouter } from "./routes/audit.ts";
import { eventsRouter } from "./routes/events.ts";
import { HEALTH_CACHE_TTL_MS, createHealthRouter } from "./routes/health.ts";
import { probeDatabase, probeModel } from "./routes/health-probes.ts";
import { pendingRouter } from "./routes/pending.ts";
import {
	DSH_ADMIN_MOUNT_PATH,
	type DshAdminProxyHandler,
} from "./adapter/dsh-admin/proxy.ts";
import type { AiPlugin } from "./plugins.ts";

export { MISSING_TOKEN_MESSAGE };

/** 未知路径的提示。 */
export const NOT_FOUND_MESSAGE = "接口不存在";

/**
 * 装配时的可选项。
 *
 * ⚠️ **全都有合理的缺省** ⇒ 只传插件也能跑起来（缺省值 = 本进程 / cwd 相对的默认）。
 */
export interface CoreAppOptions {
	/**
	 * 本进程用的**插件**（健康检查的探针从它们来）。
	 *
	 * ⚠️ 缺省 = **没有插件探针**（内核自己探库与模型）⇒ 外部系统不注册插件也能起。
	 */
	plugins?: readonly AiPlugin[];
	/**
	 * 智能体配置的根目录（缺省 = **cwd 相对**的 `agents/`）。
	 *
	 * ⚠️ 只影响「智能体清单」那个端点读哪个目录；会话用的智能体由
	 *    **运行时**决定（运行时的来源在它构造时定好 ⇒ cwd 相对）。
	 */
	agentsRoot?: string;
	/**
	 * 挂**自己的**端点（业务系统自己的接口）。
	 *
	 * ⚠️ 回调在**内核的 404 / 错误处理之前**执行 ⇒ 挂上去的端点才够得着。
	 */
	configure?: (app: Express) => void;
	/**
	 * AI 管理面（**dsh 自带的 Web UI** 的反代）。
	 *
	 * ⚠️ **不给就不挂** ⇒ 缺省没有 `/dsh-admin` 路由（管理面是**可选能力**）。
	 */
	dshAdmin?: DshAdminProxyHandler;
}

/**
 * CORS 中间件。
 *
 * - 挂 CORS 头（源在白名单里才回具体的源）；
 * - `OPTIONS` 直接 204（预检不需要 body）。
 */
export function corsMiddleware(req: Request, res: Response, next: NextFunction): void {
	const origin = originOf(req.get("origin"));
	const isPreflight = isPreflightRequest(req.method, req.get("origin"));
	const headers = buildCorsHeaders(origin, allowedOrigins(), isPreflight);
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
 * 造健康检查路由（**真实自检**）。
 *
 * ⚠️ **恒回 200**（依赖挂了也 200）⇒ 编排系统不会把还活着的容器杀掉重启。
 * ⚠️ **不要 token**：这是基础设施端点，不是业务端点 ⇒ 不进 `contract.ts`。
 *
 * @param plugins 本进程的插件（它们的探针并进来）。
 */
export function createCoreHealthRouter(plugins: readonly AiPlugin[] = []) {
	return createHealthRouter({
		probes: {
			// ⚠️ 内核只探**自己**的依赖（库、模型）
			database: probeDatabase,
			model: probeModel,
			// ⚠️ **上游的探针由插件给**（内核不认识上游是谁 ⇒ 键名也由插件定）
			...Object.fromEntries(
				plugins.flatMap((plugin) => Object.entries(plugin.health ?? {})),
			),
		},
		now: () => Date.now(),
		startedAt: Date.now(),
		ttlMs: HEALTH_CACHE_TTL_MS,
	});
}

/**
 * 装配 app（**不监听**）。
 *
 * 中间件顺序：预检/CORS → 路由 → 404 → 错误处理。
 *
 * @param options 装配选项（见 `CoreAppOptions`）。
 */
export function createCoreApp(options: CoreAppOptions = {}): Express {
	const plugins = options.plugins ?? [];
	const root = options.agentsRoot ?? cwdAgentsRoot();

	const app = express();
	// 别让外部看到框架名（也少一条信息泄露）
	app.disable("x-powered-by");
	app.use(corsMiddleware);
	// 健康检查**先挂**（探针不该被业务路由的任何前置逻辑影响）
	app.use("/health", createCoreHealthRouter(plugins));
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
			listAgents: () => listAgentSummaries(root),
			resolveUser: (token) => agentRuntime.resolveCurrentUser(token),
		}),
	);
	app.use("/api/pending", pendingRouter);
	app.use("/api/audit", auditRouter);
	// ⚠️ **AI 管理面**（dsh 自带的 Web UI 的反代）⇒ 给了才挂（缺省没有这条路由）
	//    `app.use('/dsh-admin', proxy)` ⇒ **Express 自己剥前缀** ⇒ 代理里不用改路径
	if (options.dshAdmin !== undefined) {
		app.use(DSH_ADMIN_MOUNT_PATH, options.dshAdmin);
	}
	// ⚠️ **外部系统自己的端点**（业务接口）⇒ 在 404 之前挂
	options.configure?.(app);
	app.use(notFoundHandler);
	app.use(errorHandler);
	return app;
}

/**
 * **启动前的自检**（不合法 ⇒ 抛错，调用方退出）。
 *
 * - 智能体配置读得到（配置坏了就别跑起来，否则用户只看到「少了个智能体」）；
 * - 配置里写的插件都注册了（拼错名字 ⇒ 服务起不来，不等到建会话才发现）。
 *
 * @param options 智能体配置根目录（缺省 = cwd 相对）。
 */
export function assertCoreReady(options: { agentsRoot?: string } = {}): void {
	loadAgentConfigs(options.agentsRoot ?? cwdAgentsRoot());
	agentRuntime.validatePlugins();
}
