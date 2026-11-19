/**
 * 系统提示词 —— **给 dsh 用**的那一份（含技能段）。
 *
 * ## 为什么单独一份
 *
 * pi 路径在 `pi-session.ts` 里用 pi 的 loader 拼提示词；
 * dsh 路径**没有 pi 的 loader** ⇒ 我们在这里**用同一套技能表**（同一个 `loadSkills`）
 * 拼出**同样的提示词** ⇒ **技能语义保住**（issue #120 的验收项）。
 *
 * ⚠️ 技能目录来自**智能体配置**（不给 ⇒ `<cwd>/.pi/skills`）⇒ 不跨智能体串味。
 */

import { join } from "node:path";
import { loadSkills, type Skill } from "@earendil-works/pi-coding-agent";
import { buildSystemPrompt } from "../../skills/skills.ts";

/** 拼提示词的结果。 */
export interface DshSystemPrompt {
	/** 最终的系统提示词（基础提示词 + 技能段）。 */
	systemPrompt: string;
	/** 发现的技能（**没技能就是空数组** ⇒ 不注册 `load_skill`）。 */
	skills: Skill[];
}

/**
 * 拼 dsh 的系统提示词。
 *
 * @param base 基础系统提示词（来自智能体配置）。
 * @param skillDirs 技能目录（**绝对路径**；来自智能体配置）。
 * @param cwd 工作目录（缺省 `process.cwd()`）。
 */
export function buildDshSystemPrompt(
	base: string,
	skillDirs: readonly string[],
	cwd: string = process.cwd(),
): DshSystemPrompt {
	const dirs = skillDirs.length > 0 ? skillDirs : [join(cwd, ".pi", "skills")];
	const result = loadSkills({
		cwd,
		agentDir: join(cwd, ".ai", "agent"),
		skillPaths: [...dirs],
		// ⚠️ **只认配置里列的目录**（不扫用户家目录 ⇒ 不跨智能体串味）
		includeDefaults: false,
	});
	return {
		systemPrompt: buildSystemPrompt(base, result.skills),
		skills: result.skills,
	};
}
