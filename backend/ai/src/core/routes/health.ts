/**
 * 健康检查（挂在 `/health`）—— **给容器探针与编排系统看的**。
 *
 * ## 为什么不在 `/api/agent` 下
 *
 * 业务路由都要 token（那是「谁能调这个接口」的问题），
 * 而健康检查是**基础设施**问题：编排系统（compose / k8s）在问「这个容器还活着吗」，
 * 它没有用户 token，也不该有。
 * ⇒ 挂在根路径 `/health`，**不要 token**，也不进 `src/routes/contract.ts`
 *   （那张表锁的是「业务端点的对外行为」，健康检查不是业务端点）。
 *
 * ## 口径：**永远 200**
 *
 * ⚠️ **依赖挂了也回 200**：数据库连不上、AiAdmin 挂了、模型没配 —— 这些都是
 * 「服务起不来」之外的故障，探针若因此回非 200 ⇒ 编排系统会把**正在服务的容器**
 * 当成坏的杀掉重启（雪崩）。
 * ⇒ 依赖状态写在 `checks` 里（自检结果），`status` 字段汇总成
 *   `ok`（全好）/ `degraded`（有依赖不可用），**但 HTTP 状态码恒为 200**。
 *
 * ## 自检怎么做
 *
 * - **不查模型**（不调模型 API）：模型慢不该拖垮探针；
 * - **数据库**：只做 **TCP 连通性**（不跑 SQL）⇒ 不依赖 mysql2/prisma 引擎，
 *   也不会在探针里堆积连接；
 * - **AiAdmin**：发一个普通 HTTP 请求，**只要连得上**就算 up（4xx/5xx 也算可达）。
 *
 * 每个探针都有超时（默认 2 秒）且**并行**跑 ⇒ 最坏 ~2 秒返回。
 * 结果**缓存 5 秒**（`ttlMs`）⇒ 探针高频调用不会把依赖刷爆。
 */

import { Router } from "express";

/** 单个依赖的自检结果。 */
export interface DependencyCheck {
	/** `up` = 可用；`down` = 不可用；`skipped` = 没配 / 没法自检。 */
	status: "up" | "down" | "skipped";
	/** 人话说明（不含凭据）。 */
	detail: string;
}

/** 健康检查的报告。 */
export interface HealthReport {
	/** `ok` = 全好；`degraded` = 有依赖不可用（**HTTP 码仍是 200**）。 */
	status: "ok" | "degraded";
	/** 进程跑了多少秒。 */
	uptimeSeconds: number;
	/** 逐个依赖的自检结果。 */
	checks: Record<string, DependencyCheck>;
}

/**
 * 汇总自检结果 ⇒ 报告。
 *
 * ⚠️ **`skipped` 不算 degraded**：没配某个依赖（例如没配 MCP）不是故障。
 * 只有 `down` 才降级。
 */
export function buildHealthReport(
	checks: Record<string, DependencyCheck>,
	uptimeSeconds: number,
): HealthReport {
	const degraded = Object.values(checks).some((check) => check.status === "down");
	return {
		status: degraded ? "degraded" : "ok",
		uptimeSeconds,
		checks,
	};
}

/** 自检结果的缓存。 */
export interface HealthCache {
	get: () => { at: number; report: HealthReport } | undefined;
	set: (value: { at: number; report: HealthReport }) => void;
}

/** 造健康检查路由要用的东西（**可注入** ⇒ 测试不用真连数据库）。 */
export interface HealthDeps {
	/** 逐个依赖的自检函数。 */
	probes: Record<string, () => Promise<DependencyCheck>>;
	/** 现在的时刻（毫秒）—— 注入它 ⇒ 测试能控制缓存。 */
	now: () => number;
	/** 进程启动时刻（毫秒）—— 用来算 uptime。 */
	startedAt: number;
	/** 自检结果的缓存时长（毫秒）；`0` = 不缓存。 */
	ttlMs: number;
}

/** 默认缓存时长（毫秒）：探针别把依赖刷爆。 */
export const HEALTH_CACHE_TTL_MS = 5_000;

/** 造一个空缓存（每次都真跑探针）。 */
export function createHealthCache(): HealthCache {
	let last: { at: number; report: HealthReport } | undefined;
	return {
		get: () => last,
		set: (value) => {
			last = value;
		},
	};
}

/**
 * 跑一遍自检（带缓存）。
 *
 * ⚠️ **单个探针抛异常不许把整个请求搞挂** ⇒ 记成 `down` 继续。
 */
export async function collectHealthReport(
	deps: HealthDeps,
	cache: HealthCache = createHealthCache(),
): Promise<HealthReport> {
	const now = deps.now();
	const cached = cache.get();
	if (deps.ttlMs > 0 && cached !== undefined && now - cached.at < deps.ttlMs) {
		return cached.report;
	}

	const entries = await Promise.all(
		Object.entries(deps.probes).map(async ([name, probe]): Promise<[string, DependencyCheck]> => {
			try {
				return [name, await probe()];
			} catch (error) {
				return [name, { status: "down", detail: `自检异常：${describe(error)}` }];
			}
		}),
	);

	const report = buildHealthReport(Object.fromEntries(entries), (now - deps.startedAt) / 1000);
	cache.set({ at: now, report });
	return report;
}

/** 错误 ⇒ 一行人话（不带堆栈）。 */
function describe(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	return String(error);
}

/**
 * 造健康检查路由。
 *
 * ⚠️ **恒回 200**：见文件头的口径。
 */
export function createHealthRouter(deps: HealthDeps): Router {
	const cache = createHealthCache();
	const router = Router();
	router.get("/", async (_req, res) => {
		const report = await collectHealthReport(deps, cache);
		res.status(200).json(report);
	});
	return router;
}
