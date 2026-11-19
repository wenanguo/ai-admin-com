/**
 * 技能发现 —— **我们自己的 loader**（不依赖 pi）。
 *
 * ## 为什么自己写
 *
 * `SKILL.md` 是 **Anthropic Agent Skills 标准格式**（不是 pi 私有）
 * ⇒ 我们**可以**自己扫、自己解析 ⇒ **技能资产不绑在 pi 上**（拔 pi 是另一条，#123）。
 *
 * ⚠️ **技能正文一个字都不改**（它是提示词 ⇒ 走 git 评审 ⇒ 见 `AGENTS.md`）
 *    ⇒ 本文件**只读** frontmatter（`name` / `description` / `disable-model-invocation`）
 *    ⇒ 正文原样留给 `load_skill` 工具去读。
 *
 * ## 规则（与 Agent Skills 规范一致）
 *
 * | 规则 | 说明 |
 * | ---- | ---- |
 * | 发现 | 目录里有 `SKILL.md` ⇒ 它**就是**一个技能（不再往里递归）；否则往子目录里找 |
 * | 名字 | frontmatter 的 `name`；没有 ⇒ 用**父目录名** |
 * | 说明 | frontmatter 的 `description`（**必填** ⇒ 没有就不算技能） |
 * | 隐藏 | frontmatter 的 `disable-model-invocation: true` ⇒ 不进提示词（只能显式调用） |
 * | 去重 | 同名 ⇒ **先来的赢**（后来的记一条碰撞诊断） |
 *
 * ⚠️ **与 pi 的 loader 口径一致**（`skills.test.ts` 有一条对照测试）
 *    ⇒ 两个 runner 看到的技能**一模一样** ⇒ 切 runner 不会换技能。
 */

import { readdir, readFile, stat } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";

/** 技能名最长多少字符（规范的上限）。 */
export const MAX_SKILL_NAME_LENGTH = 64;

/** 技能说明最长多少字符（规范的上限）。 */
export const MAX_SKILL_DESCRIPTION_LENGTH = 1024;

/** 一个技能（**我们自己声明的形状** ⇒ 不 import pi 的类型）。 */
export interface SkillEntry {
	/** 技能名（frontmatter 的 `name`；没有 ⇒ 父目录名）。 */
	name: string;
	/** 技能说明（frontmatter 的 `description`）—— 模型靠它决定要不要加载。 */
	description: string;
	/** `SKILL.md` 的**绝对路径**。 */
	filePath: string;
	/** 技能目录（`SKILL.md` 所在目录）—— 附属文件都在它下面。 */
	baseDir: string;
	/** 不进模型上下文（frontmatter 的 `disable-model-invocation: true`）。 */
	disableModelInvocation: boolean;
}

/** 技能加载的诊断（**不是异常** ⇒ 坏的技能只是不加载）。 */
export interface SkillDiagnostic {
	/** 出问题的文件（或目录）。 */
	path: string;
	/** 人话说明。 */
	message: string;
	/** 严重程度：`warning` = 警告 · `collision` = 同名撞车。 */
	severity: "warning" | "collision";
}

/** 技能加载的结果。 */
export interface SkillLoadResult {
	/** 找到的技能（**按发现顺序**）。 */
	skills: SkillEntry[];
	/** 诊断（坏的 / 撞名的）。 */
	diagnostics: SkillDiagnostic[];
}

/** 加载技能的参数。 */
export interface LoadSkillsOptions {
	/** 相对路径按它解析（缺省 `process.cwd()`）。 */
	cwd?: string;
}

/**
 * 加载若干目录里的技能。
 *
 * ⚠️ **目录不存在不是异常**（技能是可选的）⇒ 记一条诊断，继续。
 *
 * @param dirs 技能目录（可以 0 / 1 / N 个）。
 * @param options 解析相对路径用的 cwd。
 */
export async function loadSkills(
	dirs: readonly string[],
	options: LoadSkillsOptions = {},
): Promise<SkillLoadResult> {
	const cwd = options.cwd ?? process.cwd();
	const skills: SkillEntry[] = [];
	const diagnostics: SkillDiagnostic[] = [];
	/** 名字 ⇒ 技能（**先来的赢**）。 */
	const byName = new Map<string, SkillEntry>();

	for (const raw of dirs) {
		const dir = isAbsolute(raw) ? resolve(raw) : resolve(cwd, raw);
		let info: Awaited<ReturnType<typeof stat>>;
		try {
			info = await stat(dir);
		} catch {
			diagnostics.push({
				path: dir,
				message: "技能目录不存在",
				severity: "warning",
			});
			continue;
		}
		if (info.isDirectory()) {
			await scanDirectory(dir, true, skills, diagnostics);
			continue;
		}
		if (info.isFile() && dir.endsWith(".md")) {
			const loaded = await loadSkillFromFile(dir, diagnostics);
			if (loaded !== undefined) {
				skills.push(loaded);
			}
			continue;
		}
		diagnostics.push({
			path: dir,
			message: "技能路径不是目录，也不是 markdown 文件",
			severity: "warning",
		});
	}

	// ⚠️ **去重在最后做**（跨目录）⇒ 同名时「先来的赢」。
	const unique: SkillEntry[] = [];
	for (const skill of skills) {
		const existing = byName.get(skill.name);
		if (existing !== undefined) {
			diagnostics.push({
				path: skill.filePath,
				message: `技能名「${skill.name}」撞车了（先来的那份：${existing.filePath}）`,
				severity: "collision",
			});
			continue;
		}
		byName.set(skill.name, skill);
		unique.push(skill);
	}

	return { skills: unique, diagnostics };
}

/**
 * 扫一个目录找技能。
 *
 * ⚠️ **目录里有 `SKILL.md` ⇒ 它就是技能根**（不再往里递归）
 *    ⇒ 否则往子目录里找（子目录里的 `.md` **不算**技能）。
 *
 * @param dir 要扫的目录。
 * @param includeRootFiles 根目录里的 `.md` 文件算不算技能（只有技能路径的第一层算）。
 * @param skills 收集到的技能。
 * @param diagnostics 收集到的诊断。
 */
async function scanDirectory(
	dir: string,
	includeRootFiles: boolean,
	skills: SkillEntry[],
	diagnostics: SkillDiagnostic[],
): Promise<void> {
	let entries: Dirent[];
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		diagnostics.push({ path: dir, message: "技能目录读不了", severity: "warning" });
		return;
	}
	// ⚠️ **先看自己是不是技能根**（有 SKILL.md 就不递归了）。
	if (entries.some((entry) => entry.isFile() && entry.name === "SKILL.md")) {
		const loaded = await loadSkillFromFile(join(dir, "SKILL.md"), diagnostics);
		if (loaded !== undefined) {
			skills.push(loaded);
		}
		return;
	}
	for (const entry of entries) {
		// ⚠️ 隐藏目录与依赖目录**不看**（与 pi 的 loader 一致）。
		if (entry.name.startsWith(".") || entry.name === "node_modules") {
			continue;
		}
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			await scanDirectory(full, false, skills, diagnostics);
			continue;
		}
		if (!entry.isFile() || !includeRootFiles || !entry.name.endsWith(".md")) {
			continue;
		}
		const loaded = await loadSkillFromFile(full, diagnostics);
		if (loaded !== undefined) {
			skills.push(loaded);
		}
	}
}

/**
 * 读一个技能文件（`SKILL.md` 或根目录里的 `.md`）。
 *
 * @param filePath 文件路径。
 * @param diagnostics 收集到的诊断。
 * @returns 不是一个技能 ⇒ undefined（**不抛异常**）。
 */
async function loadSkillFromFile(
	filePath: string,
	diagnostics: SkillDiagnostic[],
): Promise<SkillEntry | undefined> {
	const isDeclaredSkill = basename(filePath) === "SKILL.md";
	let raw: string;
	try {
		raw = await readFile(filePath, "utf8");
	} catch {
		diagnostics.push({ path: filePath, message: "技能文件读不了", severity: "warning" });
		return undefined;
	}
	let frontmatter: Record<string, unknown>;
	try {
		frontmatter = parseFrontmatter(raw);
	} catch {
		diagnostics.push({ path: filePath, message: "技能文件的 frontmatter 解析不了", severity: "warning" });
		return undefined;
	}
	const description = frontmatter["description"];
	const hasDescription = typeof description === "string" && description.trim() !== "";
	if (!isDeclaredSkill && !hasDescription) {
		// ⚠️ **不是 `SKILL.md` 又没有说明** ⇒ 不算技能（与 pi 的 loader 一致）。
		return undefined;
	}
	const skillDir = dirname(filePath);
	// ⚠️ **名字**：frontmatter 的 `name`；没有 ⇒ 父目录名。
	const declared = frontmatter["name"];
	const name = typeof declared === "string" && declared.length > 0 ? declared : basename(skillDir);
	for (const problem of validateName(name)) {
		diagnostics.push({ path: filePath, message: problem, severity: "warning" });
	}
	if (!hasDescription) {
		diagnostics.push({ path: filePath, message: "description 是必填的", severity: "warning" });
		return undefined;
	}
	for (const problem of validateDescription(description)) {
		diagnostics.push({ path: filePath, message: problem, severity: "warning" });
	}
	return {
		name,
		description,
		filePath,
		baseDir: skillDir,
		disableModelInvocation: frontmatter["disable-model-invocation"] === true,
	};
}

/**
 * 拆出 frontmatter（`---` 包起来的 YAML）。
 *
 * ⚠️ **正文一个字不动**（我们只取 frontmatter ⇒ 技能正文仍然是原样的）。
 *
 * @param content 文件全文。
 */
export function parseFrontmatter(content: string): Record<string, unknown> {
	const normalized = content.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
	if (!normalized.startsWith("---")) {
		return {};
	}
	const end = normalized.indexOf("\n---", 3);
	if (end === -1) {
		return {};
	}
	const parsed: unknown = parseYaml(normalized.slice(4, end));
	return parsed !== null && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
}

/**
 * 校验技能名（规范：小写字母 / 数字 / 连字符；≤ 64 字符；首尾不许是连字符）。
 *
 * @param name 技能名。
 * @returns 问题清单（空 = 没问题）。
 */
export function validateName(name: string): string[] {
	const problems: string[] = [];
	if (name.length > MAX_SKILL_NAME_LENGTH) {
		problems.push(`name 超过 ${MAX_SKILL_NAME_LENGTH} 个字符（${name.length}）`);
	}
	if (!/^[a-z0-9-]+$/.test(name)) {
		problems.push("name 只能是小写字母、数字与连字符");
	}
	if (name.startsWith("-") || name.endsWith("-")) {
		problems.push("name 不能以连字符开头或结尾");
	}
	if (name.includes("--")) {
		problems.push("name 不能有连续的连字符");
	}
	return problems;
}

/**
 * 校验技能说明（规范：必填；≤ 1024 字符）。
 *
 * @param description 技能说明。
 * @returns 问题清单（空 = 没问题）。
 */
export function validateDescription(description: string): string[] {
	const problems: string[] = [];
	if (description.trim().length === 0) {
		problems.push("description 是必填的");
	}
	if (description.length > MAX_SKILL_DESCRIPTION_LENGTH) {
		problems.push(`description 超过 ${MAX_SKILL_DESCRIPTION_LENGTH} 个字符（${description.length}）`);
	}
	return problems;
}
