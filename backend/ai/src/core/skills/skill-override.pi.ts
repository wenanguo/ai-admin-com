/**
 * pi 路径的**技能过滤钩子**（**pi 专有** ⇒ 单独一个文件）。
 *
 * ## 为什么单独放
 *
 * `skills.ts`（提示词段）是**两个 runner 共用**的 ⇒ 它不许 import pi。
 * 而 pi 的 loader 除了项目的 `.pi/skills/`，**还会扫用户家目录的 `~/.agents/skills/`**
 * （Agent Skills 的标准位置）—— 实测：开发机上它会把用户自己的二十多个技能
 * 一并带进来。
 *
 * ⇒ 那些技能与本服务无关，却会占系统提示词，还可能让模型去读用户目录里的文件
 * ⇒ 用 pi 的官方钩子 `skillsOverride` 把技能**过滤到我们自己的目录**。
 * （钩子在 loader 内部生效 ⇒ 去重与诊断仍然是 pi 做的，我们只做最后一道过滤。）
 *
 * ⚠️ **过滤的目标是智能体配置里写的技能目录**（可以有好几个，也可以是空
 *    ⇒ 一个技能都没有）⇒ 不跨智能体串味。
 *
 * ⚠️ **拔 pi（#123）时这个文件整个删掉**（pi 路径一起走）。
 */

import { resolve, sep } from "node:path";

/**
 * 技能表的**最小形状**（只用到文件位置）。
 *
 * ⚠️ **泛型**：pi 的技能类型比这多（`sourceInfo`）⇒ 过滤时**原样保留**类型
 *    ⇒ 我们的钩子不会把 pi 的类型弄坏。
 */
export interface FilterableSkills<T> {
	skills: T[];
	diagnostics: { path?: string; message: string }[];
}

/**
 * 把技能表**限定在指定的技能目录内**。
 *
 * ⚠️ **泛型保留整个结果形状**（技能 + 诊断）⇒ 传给 pi 时类型**一字不差**。
 *
 * @param dirs 技能目录（绝对路径）。
 */
export function createSkillsOverride<
	R extends { skills: { filePath: string }[]; diagnostics: { path?: string }[] },
>(dirs: readonly string[]): (base: R) => R {
	const roots = dirs.map((dir) => resolve(dir) + sep);
	const inside = (path: string): boolean => {
		const resolved = resolve(path);
		return roots.some((root) => resolved.startsWith(root));
	};
	return (base) =>
		({
			skills: base.skills.filter((skill) => inside(skill.filePath)),
			// 诊断也只留我们目录里的（别人的技能撞名与本服务无关）
			diagnostics: base.diagnostics.filter((diagnostic) =>
				diagnostic.path === undefined ? false : inside(diagnostic.path),
			),
		}) as R;
}

/**
 * 把技能表限定在**项目技能目录**内（老口径：只有 `<cwd>/.pi/skills` 算数）。
 *
 * @param rootDir 项目技能目录（通常是 `<cwd>/.pi/skills`）。
 */
export function createProjectSkillsOverride<
	R extends { skills: { filePath: string }[]; diagnostics: { path?: string }[] },
>(rootDir: string): (base: R) => R {
	return createSkillsOverride<R>([rootDir]);
}
