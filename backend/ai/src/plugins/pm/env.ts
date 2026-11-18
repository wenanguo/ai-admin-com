/**
 * PM 插件的**环境变量**（**插件声明自己要什么** ⇒ 内核的 env 不认识业务变量）。
 *
 * ## 为什么在插件侧
 *
 * 内核的 env 只该有**通用**变量（模型、默认智能体、允许的源、库连接串……）⇒
 * `AIADMIN_*` 是**业务系统**的变量 ⇒ 归插件（设计 §12.3）。
 *
 * ## 校验时机
 *
 * ⚠️ **import 即校验**（与内核的 env 一样）⇒ 缺变量 ⇒ **启动即失败**
 *    （不等到第一个请求打进来才炸）。
 *
 * ## 变量名一个字没改
 *
 * `AIADMIN_BASE_URL` / `AIADMIN_MCP_URL` **还是这两个名字** ⇒
 * 现有部署（.env / compose / k8s）**一个字都不用改** ✓。
 */

import { z } from "zod";

/** 环境变量来源（测试里传假值，生产传 `process.env`）。 */
export type EnvSource = Record<string, string | undefined>;

/** PM 插件要的环境变量。 */
export interface PmEnv {
	/** AiAdmin 后端地址（base 里已含 `/api/v1`）。 */
	AIADMIN_BASE_URL: string;
	/**
	 * AiAdmin 的 MCP 地址（**工具的来源**）。
	 *
	 * ⚠️ **缺省** ⇒ 用 `${AIADMIN_BASE_URL}/mcp`（一般不用单独配）。
	 */
	AIADMIN_MCP_URL?: string;
}

const pmEnvSchema = z.object({
	AIADMIN_BASE_URL: z
		.string()
		.min(1, "不能为空")
		.refine((value) => /^https?:\/\/\S+$/.test(value), "必须是 http(s) 开头的 URL"),
	AIADMIN_MCP_URL: z.string().optional(),
});

/**
 * 校验插件的环境变量。
 *
 * @throws 校验不过时抛错，消息里写清缺哪个/哪个不合法。
 */
export function parsePmEnv(source: EnvSource): PmEnv {
	const parsed = pmEnvSchema.safeParse(source);
	if (parsed.success) {
		return parsed.data;
	}

	const missing: string[] = [];
	const invalid: string[] = [];
	for (const issue of parsed.error.issues) {
		const key = issue.path.join(".");
		const isMissing = issue.path.length === 1 && source[key] === undefined;
		if (isMissing) {
			missing.push(key);
		} else {
			invalid.push(`${key}（${issue.message}）`);
		}
	}

	const detail = [
		missing.length > 0 ? `缺少必填环境变量：${missing.join("、")}` : "",
		invalid.length > 0 ? `环境变量不合法：${invalid.join("；")}` : "",
	]
		.filter((part) => part.length > 0)
		.join("；");

	throw new Error(`环境变量校验失败 —— ${detail}`);
}

/** 进程级的插件环境变量（import 本模块即校验，缺变量直接抛错 ⇒ 启动即失败）。 */
export const pmEnv: PmEnv = parsePmEnv(process.env);
