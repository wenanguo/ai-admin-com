import { z } from "zod";

/**
 * 思考级别（与 pi SDK 的 `ThinkingLevel` 一致）。
 *
 * ⚠️ **默认 `off`**：思考内容会让用户等更久（要先想再写），
 *    而且现在的前端还没接「思考中」的展示 ⇒ 默认不开。
 *    要开就把环境变量设成 `low` / `medium` / `high`。
 */
export const THINKING_LEVELS = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
] as const;

/** 思考级别。 */
export type ThinkingLevelSetting = (typeof THINKING_LEVELS)[number];

/** 本服务需要的全部环境变量（单租户，没有租户维度）。 */
export interface Env {
	/** minimax-cn 的 api key；pi SDK 只靠这个环境变量鉴权。 */
	MINIMAX_CN_API_KEY: string;
	/** 模型标识，形如 `minimax-cn/MiniMax-M3.1-Flash`。 */
	AI_MODEL: string;
	/** 思考级别（缺省 `off`）。 */
	AI_THINKING_LEVEL: ThinkingLevelSetting;
	/**
	 * 默认智能体 id（**配置文件**里的那个，缺省 `pm`）。
	 *
	 * ⚠️ 调用方没指定智能体时用它 ⇒ 「现有 PM 助手的行为不变」靠这条。
	 */
	AI_DEFAULT_AGENT: string;
	/**
	 * AiAdmin 的 MySQL 连接串（`ai_*` 元数据表与业务表同库）。
	 *
	 * ⚠️ **可省**：若配了 `AI_DATABASE_URL` ⇒ 本服务的表在自己的库里
	 *    ⇒ 复用到别的系统时**不需要** AiAdmin 的库。
	 */
	DATABASE_URL?: string;
	/**
	 * 本服务**自己**的库（`ai_*` 那 5 张表住这儿）。
	 *
	 * ⚠️ **缺省** ⇒ 用共享库的 `DATABASE_URL`（今天的行为，一个字不变）。
	 * ⚠️ 配了 ⇒ `ai_*` 表在**自己的库**里 ⇒ 换系统只改这一条配置。
	 */
	AI_DATABASE_URL?: string;
	/**
	 * **实际用的**连接串（`AI_DATABASE_URL` 优先，否则 `DATABASE_URL`）。
	 *
	 * ⚠️ 两个都没配 ⇒ 启动即失败（见 `parseEnv`）。
	 */
	databaseUrl: string;
	/** 允许跨域的前端源（至少一个），回具体的源，不用 `*`。 */
	ALLOWED_ORIGINS: string[];
	/**
	 * 要不要**恢复 dsh 侧的历史**（`session/resume` ⇒ dsh 的会话持久化）。
	 *
	 * ⚠️ **默认关**：开了之后，进程重启再聊同一个会话，模型能接着上次的说
	 *    （**行为变化** ⇒ 由部署决定，不由代码悄悄改）。
	 * ⚠️ 恢复回来的**只有对话内容**（工具 / MCP / 提示词都是进程级挂上去的）。
	 */
	AI_DSH_RESUME: boolean;
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
	// ⚠️ **缺省 `off`**：思考会让用户等更久，而现在的前端还没接「思考中」展示。
	AI_THINKING_LEVEL: z
		.string()
		.optional()
		.transform((value) => value ?? "off")
		.pipe(z.enum(THINKING_LEVELS)),
	// ⚠️ **缺省 `pm`**：PM 助手是这个服务的老身份 ⇒ 不配也得能用。
	AI_DEFAULT_AGENT: z
		.string()
		.optional()
		.transform((value) => value ?? "pm")
		.pipe(z.string().min(1, "不能为空")),
	// ⚠️ **两个库连接串至少要有一个**（见 parseEnv 的检查）
	//    空串（compose 里未设置时就是这个）⇒ 当没配
	DATABASE_URL: z
		.string()
		.optional()
		.transform((value) => (value === undefined || value.trim() === "" ? undefined : value)),
	AI_DATABASE_URL: z
		.string()
		.optional()
		.transform((value) => (value === undefined || value.trim() === "" ? undefined : value)),
	// 校验放在「切完之后」：空串、纯空白、只有空段，切完都是 [] —— 全算没配，启动即失败，
	// 不能只挡空串（一个空格能过 min(1)，却会静默变成空的白名单）
	ALLOWED_ORIGINS: z
		.string()
		.transform(splitOrigins)
		.pipe(z.array(z.string()).min(1, "至少要有一个源")),
	// ⚠️ **默认关**（issue #175 · S4）：恢复 dsh 侧的历史会**改变行为**
	//    （进程重启后模型接着上次的会话聊）⇒ 由部署显式打开。
	AI_DSH_RESUME: z
		.string()
		.optional()
		.transform((value) => value === "1" || value === "true"),
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
		// ⚠️ **两个库连接串至少要有一个**（本服务自己的库优先）
		const databaseUrl = parsed.data.AI_DATABASE_URL ?? parsed.data.DATABASE_URL;
		if (databaseUrl === undefined) {
			throw new Error(
				"环境变量校验失败 —— 缺少必填环境变量：DATABASE_URL（或 AI_DATABASE_URL）",
			);
		}
		return { ...parsed.data, databaseUrl };
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
