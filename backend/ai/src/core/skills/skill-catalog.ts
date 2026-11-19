/**
 * 技能清单 —— 「这个智能体现在有哪些技能可用」。
 *
 * ## 为什么要有它
 *
 * 技能（`SKILL.md`）是**业务同学自己写的** ⇒ 写完要能看见「我写的技能生效了」
 * ⇒ 界面要能列出技能清单。
 *
 * ## 技能是**按智能体**的
 *
 * 每个智能体在配置里列自己的技能目录 ⇒ 清单**按智能体**返回
 * ⇒ 智能体 A 看不到智能体 B 的技能（列表里不出现、模型也拿不到）。
 *
 * ## 读的是真文件
 *
 * ⚠️ **不缓存**：每次请求都重新读 ⇒ 改完 `SKILL.md` 重启服务就能看到新说明
 * （验收标准就是这条）。
 *
 * ⚠️ **走我们自己的 loader**（`skill-loader.ts`）⇒ **不依赖 pi**
 *    ⇒ 技能是 **Agent Skills 标准格式**（不是 pi 私有）⇒ 拔 pi 不会伤到技能。
 */

import { loadSkills } from "./skill-loader.ts";

/** 一个技能的摘要（给界面看的那两项）。 */
export interface SkillSummary {
	/** 技能名（frontmatter 的 `name`）。 */
	name: string;
	/** 技能说明（frontmatter 的 `description`）—— 模型靠它决定要不要加载。 */
	description: string;
}

/**
 * 列出若干技能目录里的技能。
 *
 * @param skillDirs 技能目录（**绝对路径**；来自智能体配置的 `skills`）。
 * @returns 目录不存在或没有技能 ⇒ 空列表（**不许炸**：技能是可选的）。
 */
export async function listSkillSummaries(
	skillDirs: readonly string[],
): Promise<SkillSummary[]> {
	if (skillDirs.length === 0) {
		return [];
	}
	// ⚠️ **只认配置里列的目录**（不扫 `<cwd>/.pi/skills`、也不扫用户家目录
	//    ⇒ 不跨智能体串味）。
	const result = await loadSkills(skillDirs);
	return result.skills.map((skill) => ({
		name: skill.name,
		description: skill.description,
	}));
}
