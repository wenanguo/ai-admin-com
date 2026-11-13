/**
 * 技能清单 —— **读的是真文件**（不是缓存）。
 *
 * 为什么单测要自己造目录：技能目录是 cwd 相对的（`.pi/skills`），
 * 不能在测试里依赖开发机的目录 ⇒ 用临时目录注入。
 */
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listSkillSummaries } from "./skill-catalog.ts";

/** 造一个技能目录。 */
function makeSkillsDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "skills-catalog-"));
	mkdirSync(join(dir, "create-task"), { recursive: true });
	writeFileSync(
		join(dir, "create-task", "SKILL.md"),
		"---\nname: create-task\ndescription: 在 AiAdmin 里建任务。\n---\n\n# 建任务\n",
		"utf8",
	);
	mkdirSync(join(dir, "list-tasks"), { recursive: true });
	writeFileSync(
		join(dir, "list-tasks", "SKILL.md"),
		"---\nname: list-tasks\ndescription: 列出任务。\n---\n",
		"utf8",
	);
	return dir;
}

describe("技能清单", () => {
	it("列出每个技能的���字与说明", () => {
		const summaries = listSkillSummaries(makeSkillsDir());
		expect(summaries.map((s) => s.name).sort()).toEqual(["create-task", "list-tasks"]);
		expect(summaries.find((s) => s.name === "create-task")?.description).toContain("建任务");
	});

	it("目录不存在 ⇒ 空列表（不许炸）", () => {
		expect(listSkillSummaries(join(tmpdir(), "definitely-not-here-skill-dir"))).toEqual([]);
	});

	it("改了说明 ⇒ 读出来就是新的（不缓存）", () => {
		const dir = makeSkillsDir();
		const before = listSkillSummaries(dir).find((s) => s.name === "list-tasks");
		expect(before?.description).toBe("列出任务。");

		writeFileSync(
			join(dir, "list-tasks", "SKILL.md"),
			"---\nname: list-tasks\ndescription: 列出任务（改过了）。\n---\n",
			"utf8",
		);
		const after = listSkillSummaries(dir).find((s) => s.name === "list-tasks");
		expect(after?.description).toBe("列出任务（改过了）。");
	});
});
