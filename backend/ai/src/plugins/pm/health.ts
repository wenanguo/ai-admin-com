/**
 * 健康检查的**业务探针**（插件侧）—— 探 AiAdmin 能不能连上。
 *
 * ## 为什么在插件侧
 *
 * 「上游是谁」是**业务**知识 ⇒ 内核不认识 ⇒ 探针由**插件**提供
 * （内核的 `core/routes/health-probes.ts` 只探**自己**的依赖：数据库、模型）。
 *
 * ## 口径
 *
 * 一个普通 HTTP GET ⇒ 只要**连得上**就算 up（4xx/5xx 也算可达 ⇒ 说明网络与服务在）。
 * ⚠️ 探针**绝不抛错**（异常 ⇒ `down` + 一行说明）⇒ 探针挂了也只影响 `status` 字段。
 */

import type { DependencyCheck } from "../../core/routes/health.ts";
import { pmEnv } from "./env.ts";

/** 探针超时（毫秒）。 */
export const PROBE_TIMEOUT_MS = 2_000;

/** AiAdmin 探针：连得上就算 up。 */
export async function probeAiAdmin(): Promise<DependencyCheck> {
	try {
		const response = await fetch(pmEnv.AIADMIN_BASE_URL, {
			signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
		});
		return { status: "up", detail: `可达（HTTP ${response.status}）` };
	} catch (error) {
		return { status: "down", detail: `连不上：${describe(error)}` };
	}
}

/** 错误 ⇒ 一行人话。 */
function describe(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	return String(error);
}
