/**
 * 系统提示词 —— **给 dsh 用**的那一份（含技能段）。
 *
 * ## 为什么单独一份
 *
 * 提示词里的技能段**我们自己拼**（`skills/skills.ts`）⇒ 用**我们自己的 loader**
 * （`skills/skill-loader.ts`）发现技能 ⇒ **不依赖任何宿主**（issue #123 拔 pi）。
 *
 * ⚠️ 技能目录来自**智能体配置** ⇒ 不跨智能体串味。
 */

import { join } from "node:path";
import { buildSystemPrompt } from "../../skills/skills.ts";
import { loadSkills, type SkillEntry } from "../../skills/skill-loader.ts";

/** 拼提示词的结果。 */
export interface DshSystemPrompt {
	/** 最终的系统提示词（基础提示词 + 技能段）。 */
	systemPrompt: string;
	/** 发现的技能（**没技能就是空数组** ⇒ 不注册 `load_skill`）。 */
	skills: SkillEntry[];
}

/**
 * 拼 dsh 的系统提示词。
 *
 * @param base 基础提示词（来自智能体配置）。
 * @param skillDirs 技能目录（**绝对路径**；来自智能体配置）。
 *   ⚠️ **空数组 ⇒ 一个技能都没有**（**不回落**到项目目录 ⇒ 不跨智能体串味）。
 * @param cwd 工作目录（缺省 `process.cwd()`）。
 */
export async function buildDshSystemPrompt(
	base: string,
	skillDirs: readonly string[] | undefined,
	cwd: string = process.cwd(),
): Promise<DshSystemPrompt> {
	// ⚠️ **只认配置里列的目录**（不扫用户家目录 ⇒ 不跨智能体串味）。
	//    **没给**（undefined）⇒ 回落项目目录（老口径）；**给了空数组** ⇒ 一个都没有。
	const dirs = skillDirs ?? [join(cwd, ".pi", "skills")];
	const result = await loadSkills(dirs, { cwd });
	return {
		systemPrompt: buildSystemPrompt(base, result.skills),
		skills: result.skills,
	};
}
