/**
 * 技能清单 —— 「现在有哪些技能可用」。
 *
 * ## 为什么要有它
 *
 * 技能（`backend/ai/.pi/skills` 下的 SKILL.md）是**业务同学自己写的**
 * ⇒ 写完要能看见「我写的技能生效了」⇒ 界面要能列出技能清单。
 *
 * ## 读的是真文件
 *
 * ⚠️ **不缓存**：每次请求都重新读 ⇒ 改完 `SKILL.md` 重启服务就能看到新说明
 * （验收标准就是这条）。
 */

import { loadSkillsFromDir } from "@earendil-works/pi-coding-agent";

/** 一个技能的摘要（给界面看的那两项）。 */
export interface SkillSummary {
	/** 技能名（frontmatter 的 `name`）。 */
	name: string;
	/** 技能说明（frontmatter 的 `description`）—— 模型靠它决定要不要加载。 */
	description: string;
}

/**
 * 列出技能目录下的技能。
 *
 * @param skillsDir 技能目录（通常是 `<cwd>/.pi/skills`）。
 * @returns 目录不存在或没有技能 ⇒ 空列表（**不许炸**：技能是可选的）。
 */
export function listSkillSummaries(skillsDir: string): SkillSummary[] {
	const result = loadSkillsFromDir({ dir: skillsDir, source: "project" });
	return result.skills.map((skill) => ({
		name: skill.name,
		description: skill.description,
	}));
}
