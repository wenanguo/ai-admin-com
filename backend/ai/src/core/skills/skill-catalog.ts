/**
 * 技能清单 —— 「这个智能体现在有哪些技能可用」。
 *
 * ## 为什么还有它（技能都退给 dsh 了，issue #153）
 *
 * ⚠️ **这一小块退不回去**：dsh 的技能登记表住在**运行时进程里**
 *    （每个会话一个 dsh 子进程）⇒ 我们的 HTTP 层**问不到它**
 *    ⇒ `GET /api/agent/skills`（界面给业务同学看「我写的技能生效了」）
 *    只能自己读一遍文件。
 *
 * ⇒ 所以这里**只留最小的一份**：**读 frontmatter 的 `name` / `description`**，
 *    **规则与 dsh 的发现规则对齐**（见下）⇒ 界面看到的 = 模型看到的。
 *    ⇒ 正文、加载、工具、目录**全是 dsh 的事**（我们一个字都不管）。
 *
 * ## 规则（与 dsh 的 `dsh-skill-filesystem` 对齐）
 *
 * | 规则 | 说明 |
 * | ---- | ---- |
 * | 发现 | **只一层**：`<目录>/<名字>/SKILL.md` 或 `<目录>/<名字>.md`（**不往里递归**） |
 * | 名字 | frontmatter 的 `name`（**必填**；kebab-case：`^[a-z0-9]+(?:-[a-z0-9]+)*$`） |
 * | 说明 | frontmatter 的 `description`（**必填**） |
 * | 去重 | 同名 ⇒ **先来的赢**（目录按配置顺序 ⇒ 与 dsh 的 rank 一致） |
 *
 * ⚠️ **坏技能只是不出现**（不是异常）⇒ 界面不会因为一个写坏的 `SKILL.md` 整个挂掉。
 *
 * ## 技能是**按智能体**的
 *
 * 每个智能体在配置里列自己的技能目录 ⇒ 清单**按智能体**返回
 * ⇒ 智能体 A 看不到智能体 B 的技能（列表里不出现、模型也拿不到）。
 *
 * ## 读的是真文件
 *
 * ⚠️ **不缓存**：每次请求都重新读 ⇒ 改完 `SKILL.md` 重启服务就能看到新说明。
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

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
	const summaries: SkillSummary[] = [];
	// ⚠️ **同名 ⇒ 先来的赢**（目录按配置顺序 ⇒ 与 dsh 的 rank 一致）。
	const seen = new Set<string>();
	for (const dir of skillDirs) {
		for (const summary of await listDirectory(dir)) {
			if (seen.has(summary.name)) {
				continue;
			}
			seen.add(summary.name);
			summaries.push(summary);
		}
	}
	return summaries.sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * 列一个目录里的技能（**只一层**：`<名字>/SKILL.md` 或 `<名字>.md`）。
 *
 * @param dir 技能目录。
 */
async function listDirectory(dir: string): Promise<SkillSummary[]> {
	// ⚠️ **目录不存在不是异常**（技能是可选的）。
	const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
	const summaries: SkillSummary[] = [];
	for (const entry of entries) {
		const path = join(dir, entry.name);
		let file: string;
		if (entry.isDirectory()) {
			file = join(path, "SKILL.md");
		} else if (entry.isFile() && entry.name.endsWith(".md")) {
			file = path;
		} else {
			continue;
		}
		const summary = await readSummary(file);
		if (summary !== undefined) {
			summaries.push(summary);
		}
	}
	return summaries;
}

/**
 * 读一个技能文件的摘要（**只读 frontmatter** ⇒ 不碰正文）。
 *
 * @param file 技能文件（`SKILL.md` 或 `<名字>.md`）。
 * @returns 不是技能 / 写坏了 ⇒ `undefined`（**不抛**）。
 */
async function readSummary(file: string): Promise<SkillSummary | undefined> {
	let raw: string;
	try {
		raw = await readFile(file, "utf8");
	} catch {
		return undefined;
	}
	const frontmatter = parseFrontmatter(raw);
	if (frontmatter === undefined) {
		return undefined;
	}
	const name = frontmatter.name;
	const description = frontmatter.description;
	if (name === undefined || description === undefined) {
		// ⚠️ **name / description 缺一就不算技能**（与 dsh 一致）。
		return undefined;
	}
	if (!isSkillName(name)) {
		// ⚠️ **名字必须是 kebab-case**（与 dsh 一致 ⇒ 界面不列模型也看不到的技能）。
		return undefined;
	}
	return { name, description };
}

/** frontmatter 里读出来的两个字段。 */
interface Frontmatter {
	/** 技能名。 */
	name: string | undefined;
	/** 技能说明。 */
	description: string | undefined;
}

/**
 * 解析 frontmatter（**只取 name / description** ⇒ 正文一个字都不读）。
 *
 * ⚠️ 规则与 dsh 的 `dsh-skill-filesystem` 一致：文件必须以 `---` 开头，
 *    有一段独占一行的 `---` 收尾 ⇒ 中间那截按 YAML 解析。
 *
 * @param raw 文件全文。
 */
function parseFrontmatter(raw: string): Frontmatter | undefined {
	const firstLineEnd = raw.indexOf("\n");
	if (firstLineEnd < 0) {
		return undefined;
	}
	if (raw.slice(0, firstLineEnd).replace(/\r$/, "") !== "---") {
		return undefined;
	}
	const start = firstLineEnd + 1;
	const closing = findClosingFrontmatter(raw, start);
	if (closing === undefined) {
		return undefined;
	}
	let parsed: unknown;
	try {
		parsed = parseYaml(raw.slice(start, closing.start));
	} catch {
		// ⚠️ **YAML 坏了 ⇒ 这个技能不算数**（不是异常）。
		return undefined;
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		return undefined;
	}
	const data = parsed as Record<string, unknown>;
	return { name: stringField(data, "name"), description: stringField(data, "description") };
}

/**
 * 找收尾的 `---`（**必须独占一行**）。
 *
 * @param raw 文件全文。
 * @param start 从哪儿开始找。
 * @returns 收尾那行的起点；没有 ⇒ `undefined`。
 */
function findClosingFrontmatter(
	raw: string,
	start: number,
): { start: number } | undefined {
	let lineStart = start;
	while (lineStart <= raw.length) {
		const nextNewline = raw.indexOf("\n", lineStart);
		const lineEnd = nextNewline < 0 ? raw.length : nextNewline;
		if (raw.slice(lineStart, lineEnd).replace(/\r$/, "") === "---") {
			return { start: lineStart };
		}
		if (nextNewline < 0) {
			return undefined;
		}
		lineStart = nextNewline + 1;
	}
	return undefined;
}

/** frontmatter 的字符串字段（**空字符串当作没写** ⇒ 与 dsh 一致）。 */
function stringField(
	data: Record<string, unknown>,
	key: string,
): string | undefined {
	const value = data[key];
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * 技能名合不合法（**kebab-case** ⇒ 与 dsh 的 `isSkillName` 一致）。
 *
 * ⚠️ dsh 的规则：`^[a-z0-9]+(?:-[a-z0-9]+)*$`（不许大写、不许下划线、
 *    不许连续连字符、不许以连字符开头/结尾）。
 *
 * @param name 技能名。
 */
export function isSkillName(name: string): boolean {
	return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name);
}
