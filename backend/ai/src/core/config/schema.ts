/**
 * 智能体配置的**形状校验**（纯结构 ⇒ 不碰文件系统）。
 *
 * ## 分工
 *
 * - `schema.ts`（本文件）：**字段有没有、类型对不对**（纯结构）；
 * - `loader.ts`：**引用的目录/文件在不在**（要碰文件系统）。
 *
 * ## 口径：**不静默忽略**
 *
 * - 未知字段 ⇒ 报错（`strictObject`）⇒ 拼错字段名不会被悄悄丢掉；
 * - 字段类型错 ⇒ 报错并点名**是哪个字段**；
 * - `systemPrompt` 与 `systemPromptFile` **二选一**（两个都给 ⇒ 报错）。
 */

import { z } from "zod";
import { AgentConfigError, formatFieldPath } from "./errors.ts";

/** 一个 MCP 服务器条目。 */
const mcpServerSchema = z.strictObject({
	name: z.string({ error: "必填且是非空字符串" }).min(1, { error: "必填且是非空字符串" }),
	url: z.string({ error: "必须是非空字符串" }).min(1, { error: "必须是非空字符串" }).optional(),
});

/** 智能体配置的形状。 */
export const agentConfigSchema = z
	.strictObject({
		/** 智能体 id（= 目录名）。 */
		id: z.string({ error: "必填且是非空字符串" }).min(1, { error: "必填且是非空字符串" }),
		/** 显示名。 */
		name: z.string({ error: "必填且是非空字符串" }).min(1, { error: "必填且是非空字符串" }),
		/** 一句话说明。 */
		description: z
			.string({ error: "必填且是非空字符串" })
			.min(1, { error: "必填且是非空字符串" }),
		/** 模型（可省 ⇒ 用全局默认）。 */
		model: z.string({ error: "必须是非空字符串" }).min(1, { error: "必须是非空字符串" }).optional(),
		/** 系统提示词（与 `systemPromptFile` 二选一）。 */
		systemPrompt: z
			.string({ error: "必须是非空字符串" })
			.min(1, { error: "必须是非空字符串" })
			.optional(),
		/** 系统提示词文件（相对配置目录；与 `systemPrompt` 二选一）。 */
		systemPromptFile: z
			.string({ error: "必须是非空字符串" })
			.min(1, { error: "必须是非空字符串" })
			.optional(),
		/** 技能目录（相对配置目录）。 */
		skills: z.array(z.string({ error: "必须是字符串" }), { error: "必须是字符串数组" }).default([]),
		/** MCP 服务器清单。 */
		mcpServers: z.array(mcpServerSchema, { error: "必须是数组" }).default([]),
		/** 工具白名单。 */
		tools: z.array(z.string({ error: "必须是字符串" }), { error: "必须是字符串数组" }).default([]),
	})
	// ⚠️ 二选一：`systemPrompt` 与 `systemPromptFile` 同时给 ⇒ 不知道该用哪个
	.superRefine((value, ctx) => {
		if (value.systemPrompt !== undefined && value.systemPromptFile !== undefined) {
			ctx.addIssue({
				code: "custom",
				path: ["systemPromptFile"],
				message: "与 systemPrompt 二选一（两个都写了，不知道该用哪个）",
			});
		}
		if (value.systemPrompt === undefined && value.systemPromptFile === undefined) {
			ctx.addIssue({
				code: "custom",
				path: ["systemPrompt"],
				message: "必填：systemPrompt 与 systemPromptFile 二选一",
			});
		}
	});

/** 校验过的配置（**形状**层面；路径还没解析成绝对路径）。 */
export type RawAgentConfig = z.infer<typeof agentConfigSchema>;

/**
 * 校验配置形状。
 *
 * @param raw YAML 解析出来的原始值。
 * @param configPath 配置文件路径（报错时指给用户看）。
 * @throws {AgentConfigError} 形状不合法（消息里点名是哪个字段）。
 */
export function parseAgentConfig(raw: unknown, configPath: string): RawAgentConfig {
	const parsed = agentConfigSchema.safeParse(raw);
	if (parsed.success) {
		return parsed.data;
	}

	const lines: string[] = [];
	for (const issue of parsed.error.issues) {
		if (issue.code === "unrecognized_keys") {
			lines.push(`整个配置：有未知字段 ${issue.keys.join("、")}`);
			continue;
		}
		const field = issue.path.length === 0 ? "整个配置" : `字段 ${formatFieldPath(issue.path)}`;
		lines.push(`${field}：${issue.message}`);
	}

	throw new AgentConfigError(`智能体配置不合法 —— ${lines.join("；")}`, configPath);
}
