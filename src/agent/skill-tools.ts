/**
 * `load_skill` —— 让模型按名字加载技能文件（`SKILL.md` 及其附属文件）。
 *
 * ## 为什么自己做一个工具，而不是放开 pi 的 `read`
 *
 * 我们的进程持有 `.env`（模型 key）与数据库口令 ⇒ 放开 `read` 等于把整个仓库
 * 与密钥交给模型。而技能文件是**我们自己放进去的、公开的配方** ⇒ 只读它们。
 *
 * ## 越界防护
 *
 * 模型只传**技能名**（+ 可选的相对路径）⇒ 绝对路径由我们从技能表里查出来，
 * 模型碰不到。相对路径必须落在**该技能的目录内**（`../` 一律拒绝）。
 *
 * ## 为什么失败时返回结果而不是抛异常
 *
 * 抛异常 ⇒ pi 会把它当成工具崩溃，模型看到的是一段噪音；
 * 返回 `isError` 的结果 ⇒ 模型看到的是一句人话（「没有叫 xxx 的技能」）。
 */

import { readFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import type { Skill } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { CommandTool } from "../tools/types";

/** 工具名（模型用它调用）。 */
export const LOAD_SKILL_TOOL_NAME = "load_skill";

/** 读一个技能文件的大小上限（字节）。 */
export const MAX_SKILL_BYTES = 64 * 1024;

/** 参数 schema。 */
export const LoadSkillParameters = Type.Object({
	name: Type.String({
		description: "技能名（available_skills 里列出的 name）",
	}),
	path: Type.Optional(
		Type.String({
			description: "技能目录内的相对路径（读附属文件时用）；缺省读 SKILL.md",
		}),
	),
});

/** 造一个失败结果（不抛异常 ⇒ 模型看到的是一段可读的说明）。 */
function failure(message: string): {
	content: { type: "text"; text: string }[];
	details: { ok: false };
	isError: true;
} {
	return {
		content: [{ type: "text", text: message }],
		details: { ok: false },
		isError: true,
	};
}

/** 造一个成功结果。 */
function success(text: string): {
	content: { type: "text"; text: string }[];
	details: { ok: true };
} {
	return { content: [{ type: "text", text }], details: { ok: true } };
}

/**
 * 这个目标有没有落在 baseDir 之内。
 *
 * ⚠️ 末尾补 `sep` ⇒ 目录**本身**不算在里面（`/a/skills` 不许读 `/a/skills-evil/x`）。
 */
function inside(baseDir: string, target: string): boolean {
	const root = resolve(baseDir) + sep;
	return resolve(target).startsWith(root);
}

/**
 * 造 `load_skill` 工具。
 *
 * @param skills pi 发现的技能（名字 → 文件位置）。
 */
export function createLoadSkillTool(
	skills: readonly Skill[],
): CommandTool<typeof LoadSkillParameters> {
	const byName = new Map(skills.map((skill) => [skill.name, skill]));
	return {
		name: LOAD_SKILL_TOOL_NAME,
		label: "加载技能",
		description:
			"加载一个技能（SKILL.md）的完整说明。技能名在系统提示的 available_skills 里。" +
			"当任务与某个技能的描述吻合时，先加载它再动手。",
		parameters: LoadSkillParameters,
		annotations: {
			readOnlyHint: true,
			destructiveHint: false,
			idempotentHint: true,
		},
		execute: async (_toolCallId, params) => {
			const skill = byName.get(params.name);
			if (skill === undefined) {
				const available = [...byName.keys()].join("、") || "（一个都没有）";
				return failure(`没有叫「${params.name}」的技能。可用的技能：${available}`);
			}
			const target =
				params.path === undefined
					? resolve(skill.filePath)
					: resolve(join(skill.baseDir, params.path));
			if (!inside(skill.baseDir, target)) {
				return failure(`「${params.path}」不在技能 ${skill.name} 的目录里，读不了。`);
			}
			let raw: string;
			try {
				raw = readFileSync(target, "utf8");
			} catch {
				return failure(`读不到技能文件（${skill.name}）。`);
			}
			if (Buffer.byteLength(raw, "utf8") > MAX_SKILL_BYTES) {
				const truncated = Buffer.from(raw, "utf8")
					.subarray(0, MAX_SKILL_BYTES)
					.toString("utf8");
				return success(`${truncated}\n\n（内容过长，已截断。）`);
			}
			return success(raw);
		},
	};
}
