/**
 * 技能提示词段 —— 把 pi 发现的技能（`SKILL.md`）渲染进系统提示词。
 *
 * ## 为什么自己渲染，不直接用 pi 的 `formatSkillsForPrompt`
 *
 * pi 只在模型声明了 `read` 或 `bash` 工具时，才把技能段写进系统提示
 * （`dist/core/system-prompt.js`）⇒ 我们必须放行其中一个工具才能用上它。
 *
 * ⚠️ **但我们不能放行**：这个进程持有 `.env`（模型 key）与数据库口令 ⇒
 * 放开 `read` 等于把整个仓库与密钥交给模型。而技能文件是**我们自己放进去的、
 * 公开的配方** ⇒ 只读它们（见 `skill-tools.ts` 的 `load_skill`）。
 *
 * ⇒ 提示词段自己拼：格式照 Agent Skills 规范的 XML（与 pi 的输出一致，
 * 别的 Agent 宿主也能认），措辞指向 `load_skill`。
 */

import { resolve, sep } from "node:path";
import type { ResourceDiagnostic, Skill } from "@earendil-works/pi-coding-agent";

/** 技能表的形状（pi 的 `loadSkills` 的返回）。 */
export interface SkillsResult {
	skills: Skill[];
	diagnostics: ResourceDiagnostic[];
}

/** XML 转义（与 pi 的实现一致）。 */
function escapeXml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

/**
 * 渲染技能提示词段。
 *
 * @param skills pi 发现的技能（**只认 loader 给的那份**，我们自己不再扫目录）。
 * @returns 没有可见技能时返回空串（提示词里不留空段）。
 */
export function renderSkillsSection(skills: readonly Skill[]): string {
	const visible = skills.filter((skill) => !skill.disableModelInvocation);
	if (visible.length === 0) {
		return "";
	}
	const lines = [
		"",
		"The following skills provide specialized instructions for specific tasks.",
		// ⚠️ 措辞必须指向 `load_skill`（我们没有 read / bash 工具）
		"Use the load_skill tool to load a skill's file when the task matches its description.",
		"Resolve relative paths against the skill's directory (parent of SKILL.md). Use absolute paths in tool calls.",
		"",
		"<available_skills>",
	];
	for (const skill of visible) {
		lines.push(
			"  <skill>",
			`    <name>${escapeXml(skill.name)}</name>`,
			`    <description>${escapeXml(skill.description)}</description>`,
			`    <location>${escapeXml(skill.filePath)}</location>`,
			"  </skill>",
		);
	}
	lines.push("</available_skills>");
	return lines.join("\n");
}

/**
 * 把技能表**限定在项目的技能目录内**。
 *
 * ## 为什么需要它
 *
 * pi 的 loader 除了项目的 `.pi/skills/`，**还会扫用户家目录的 `~/.agents/skills/`**
 * （Agent Skills 的标准位置）—— 实测：开发机上它会把用户自己的二十多个技能
 * 一并带进来。
 *
 * ⇒ 那些技能与本服务无关，却会占系统提示词，还可能让模型去读用户目录里的文件
 * ⇒ 用 pi 的官方钩子 `skillsOverride` 把技能**过滤到我们自己的目录**。
 * （钩子在 loader 内部生效 ⇒ 去重与诊断仍然是 pi 做的，我们只做最后一道过滤。）
 *
 * @param rootDir 项目技能目录（通常是 `<cwd>/.pi/skills`）。
 */
export function createProjectSkillsOverride(
	rootDir: string,
): (base: SkillsResult) => SkillsResult {
	const root = resolve(rootDir) + sep;
	const inside = (path: string): boolean => resolve(path).startsWith(root);
	return (base) => ({
		skills: base.skills.filter((skill) => inside(skill.filePath)),
		// 诊断也只留我们目录里的（别人的技能撞名与本服务无关）
		diagnostics: base.diagnostics.filter((diagnostic) =>
			diagnostic.path === undefined ? false : inside(diagnostic.path),
		),
	});
}

/**
 * 把技能段接到系统提示词后面。
 *
 * @param base 基础系统提示词。
 * @param skills pi 发现的技能。
 */
export function buildSystemPrompt(base: string, skills: readonly Skill[]): string {
	const section = renderSkillsSection(skills);
	return section.length === 0 ? base : `${base}\n${section}`;
}
