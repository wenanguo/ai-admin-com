/**
 * 健康检查的**真实自检**（生产用）。
 *
 * ⚠️ 这里是**唯一**碰外部世界的地方（`health.ts` 只管形状与口径）⇒
 *   测试可以拿假的探针替换本文件（见 `health.test.ts`）。
 *
 * ## 三条自检的取舍
 *
 * | 依赖 | 怎么探 | 为什么这么探 |
 * | ---- | ------ | ------------ |
 * | 数据库 | **TCP 连通性**（`node:net`） | 不跑 SQL ⇒ 不碰 prisma 引擎、不堆积连接；探针不该有副作用 |
 * | AiAdmin | 一个普通 HTTP GET | 只要**连得上**就算 up（4xx/5xx 也算可达 ⇒ 说明网络与服务在） |
 * | 模型 | 只看 key 在不在 | **不调模型 API** ⇒ 模型慢/额度不足不该拖垮探针 |
 *
 * ⚠️ 探针**绝不抛错**（异常 ⇒ `down` + 一行说明）⇒ 探针挂了也只影响 `status` 字段，
 *   HTTP 码仍是 200。
 */

import { connect } from "node:net";
import { env } from "../env.ts";
import type { DependencyCheck } from "./health.ts";

/** 探针超时（毫秒）。 */
export const PROBE_TIMEOUT_MS = 2_000;

/** 数据库的默认端口（`mysql://` 协议）。 */
const DEFAULT_MYSQL_PORT = 3306;

/** 数据库探针：TCP 连通性。 */
export async function probeDatabase(): Promise<DependencyCheck> {
	const target = parseMysqlTarget(env.DATABASE_URL);
	if (target === undefined) {
		return { status: "skipped", detail: "DATABASE_URL 解析不出主机名" };
	}
	const reachable = await tcpReachable(target.host, target.port, PROBE_TIMEOUT_MS);
	return reachable
		? { status: "up", detail: `${target.host}:${target.port} 可达` }
		: { status: "down", detail: `${target.host}:${target.port} 连不上` };
}

/** AiAdmin 探针：连得上就算 up。 */
export async function probeAiAdmin(): Promise<DependencyCheck> {
	try {
		const response = await fetch(env.AIADMIN_BASE_URL, {
			signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
		});
		return { status: "up", detail: `可达（HTTP ${response.status}）` };
	} catch (error) {
		return { status: "down", detail: `连不上：${describe(error)}` };
	}
}

/** 模型探针：只查 key 在不在（**不调模型**）。 */
export async function probeModel(): Promise<DependencyCheck> {
	const configured = env.MINIMAX_CN_API_KEY.trim().length > 0;
	return configured
		? { status: "up", detail: "模型凭据已配置" }
		: { status: "down", detail: "模型凭据没配" };
}

/** 从 `mysql://user:pass@host:port/db` 里取出主机与端口。 */
export function parseMysqlTarget(
	url: string,
): { host: string; port: number } | undefined {
	try {
		const parsed = new URL(url);
		const host = parsed.hostname;
		if (host.length === 0) {
			return undefined;
		}
		const port = parsed.port.length > 0 ? Number(parsed.port) : DEFAULT_MYSQL_PORT;
		return { host, port: Number.isFinite(port) ? port : DEFAULT_MYSQL_PORT };
	} catch {
		return undefined;
	}
}

/** TCP 能不能连上（超时 ⇒ false）。 */
export function tcpReachable(host: string, port: number, timeoutMs: number): Promise<boolean> {
	return new Promise<boolean>((resolve) => {
		const socket = connect({ host, port });
		const settle = (reachable: boolean): void => {
			socket.destroy();
			resolve(reachable);
		};
		socket.setTimeout(timeoutMs, () => settle(false));
		socket.once("connect", () => settle(true));
		socket.once("error", () => settle(false));
	});
}

/** 错误 ⇒ 一行人话。 */
function describe(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	return String(error);
}
