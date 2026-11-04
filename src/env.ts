import { z } from "zod";

/** 本服务需要的全部环境变量（单租户，没有租户维度）。 */
export interface Env {
	/** minimax-cn 的 api key；pi SDK 只靠这个环境变量鉴权。 */
	MINIMAX_CN_API_KEY: string;
	/** 模型标识，形如 `minimax-cn/MiniMax-M3.1-Flash`。 */
	AI_MODEL: string;
	/** AiAdmin 后端地址（base 里已含 `/api/v1`）。 */
	AIADMIN_BASE_URL: string;
	/** AiAdmin 的 MySQL 连接串（`ai_*` 元数据表与业务表同库）。 */
	DATABASE_URL: string;
	/** 允许跨域的前端源（至少一个），回具体的源，不用 `*`。 */
	ALLOWED_ORIGINS: string[];
}

/** 把 `"a, b ,c"` 切成 `["a", "b", "c"]`。 */
function splitOrigins(value: string): string[] {
	return value
		.split(",")
		.map((item) => item.trim())
		.filter((item) => item.length > 0);
}

const envSchema = z.object({
	MINIMAX_CN_API_KEY: z.string().min(1, "不能为空"),
	AI_MODEL: z.string().min(1, "不能为空"),
	AIADMIN_BASE_URL: z
		.string()
		.min(1, "不能为空")
		.refine((value) => /^https?:\/\/\S+$/.test(value), "必须是 http(s) 开头的 URL"),
	DATABASE_URL: z.string().min(1, "不能为空"),
	// 校验放在「切完之后」：空串、纯空白、只有空段，切完都是 [] —— 全算没配，启动即失败，
	// 不能只挡空串（一个空格能过 min(1)，却会静默变成空的白名单）
	ALLOWED_ORIGINS: z
		.string()
		.transform(splitOrigins)
		.pipe(z.array(z.string()).min(1, "至少要有一个源")),
});

/** 环境变量来源。用 `Record` 而不是 `NodeJS.ProcessEnv`：后者被 Next.js 的全局类型加上了必填的 `NODE_ENV`，测试里造假环境变量会碍事。 */
export type EnvSource = Record<string, string | undefined>;

/**
 * 校验环境变量。缺哪个就点名哪个，不给含糊的报错。
 * @param source 待校验的环境变量来源（测试里传假值，生产传 `process.env`）。
 * @throws 校验不过时抛错，消息里写清缺哪个/哪个不合法。
 */
export function parseEnv(source: EnvSource): Env {
	const parsed = envSchema.safeParse(source);
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
	].filter((part) => part.length > 0);

	throw new Error(`环境变量校验失败 —— ${detail.join("；")}`);
}

/**
 * 进程级环境变量。import 本模块即校验，缺变量直接抛错 —— 启动即失败，
 * 不等到第一个请求打进来才炸。
 */
export const env: Env = parseEnv(process.env);
