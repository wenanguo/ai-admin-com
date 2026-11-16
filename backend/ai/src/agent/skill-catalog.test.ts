/**
 * 技能清单 —— **按智能体的目录**返回（读的是真文件，不是缓存）。
 *
 * 为什么单测要自己造目录：技能目录来自**智能体配置**（可以是任意路径），
 * 不能在测试里依赖开发机的目录 ⇒ 用临时目录注入。
 */
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listSkillSummaries } from "./skill-catalog.ts";

/** 造一个技能目录（里面放几个技能）。 */
function makeSkillsDir(prefix: string, names: string[]): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	for (const name of names) {
		mkdirSync(join(dir, name), { recursive: true });
		writeFileSync(
			join(dir, name, "SKILL.md"),
			`---\nname: ${name}\ndescription: ${name} 的说明。\n---\n`,
			"utf8",
		);
	}
	return dir;
}

describe("技能清单", () => {
	it("列出每个技能的名字与说明", () => {
		const summaries = listSkillSummaries([
			makeSkillsDir("skills-catalog-", ["create-task", "list-tasks"]),
		]);
		expect(summaries.map((s) => s.name).sort()).toEqual(["create-task", "list-tasks"]);
		expect(summaries.find((s) => s.name === "create-task")?.description).toContain(
			"create-task",
		);
	});

	it("目录不存在 ⇒ 空列表（不许炸）", () => {
		expect(
			listSkillSummaries([join(tmpdir(), "definitely-not-here-skill-dir")]),
		).toEqual([]);
	});

	it("**没配技能** ⇒ 空列表（不是异常）", () => {
		expect(listSkillSummaries([])).toEqual([]);
	});

	it("多个目录 ⇒ 合起来（各自只看到自己的那一份）", () => {
		const a = makeSkillsDir("skills-a-", ["create-task"]);
		const b = makeSkillsDir("skills-b-", ["search-docs"]);

		expect(listSkillSummaries([a]).map((s) => s.name)).toEqual(["create-task"]);
		expect(listSkillSummaries([b]).map((s) => s.name)).toEqual(["search-docs"]);
		expect(listSkillSummaries([a, b]).map((s) => s.name).sort()).toEqual([
			"create-task",
			"search-docs",
		]);
	});

	it("改了说明 ⇒ 读出来就是新的（不缓存）", () => {
		const dir = makeSkillsDir("skills-catalog-", ["list-tasks"]);
		const before = listSkillSummaries([dir]).find((s) => s.name === "list-tasks");
		expect(before?.description).toBe("list-tasks 的说明。");

		writeFileSync(
			join(dir, "list-tasks", "SKILL.md"),
			"---\nname: list-tasks\ndescription: 列出任务（改过了）。\n---\n",
			"utf8",
		);
		const after = listSkillSummaries([dir]).find((s) => s.name === "list-tasks");
		expect(after?.description).toBe("列出任务（改过了）。");
	});
});
