/**
 * 配置出错 —— **启动即失败**的那一类。
 *
 * ## 为什么不静默忽略
 *
 * 配置写错了却照常启动 ⇒ 用户在界面上看到「智能体少了一个 / 技能没生效」，
 * 却查不到原因 ⇒ 排查成本极高。
 *
 * ⇒ 配置有问题就**抛错**，消息里必须点名**哪个字段**错了。
 */

/** 智能体配置不合法（字段缺失 / 类型错 / 引用的目录不存在 / 重复 id …）。 */
export class AgentConfigError extends Error {
	/** 出问题的配置文件（绝对路径）；没有具体文件时为空串。 */
	readonly configPath: string;

	constructor(message: string, configPath = "") {
		super(configPath === "" ? message : `${message}（${configPath}）`);
		this.name = "AgentConfigError";
		this.configPath = configPath;
	}
}

/**
 * 把字段路径拼成人话：`skills[1]`、`mcpServers[0].name`。
 *
 * @param path zod 给的路径片段。
 */
export function formatFieldPath(path: readonly PropertyKey[]): string {
	if (path.length === 0) {
		return "配置";
	}
	let out = "";
	for (const segment of path) {
		if (typeof segment === "number") {
			out += `[${segment}]`;
		} else {
			out += out === "" ? String(segment) : `.${String(segment)}`;
		}
	}
	return out;
}
