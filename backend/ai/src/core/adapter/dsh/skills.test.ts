/**
 * 技能清单 —— **按智能体的目录**返回（读的是真文件，不是缓存）。
 *
 * 为什么单测要自己造目录：技能目录来自**智能体配置**（可以是任意路径），
 * 不能在测试里依赖开发机的目录 ⇒ 用临时目录注入。
 *
 * ⚠️ **规则与 dsh 的发现规则对齐**（issue #153：技能退给 dsh · issue #169 · S2：清单挪进适配层）
 *    ⇒ 这里的断言就是「界面看到的 = 模型看到的」的护栏。
 */
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listSkillSummaries } from "./skills.ts";

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

/** 造一个只放一个文件的目录。 */
function makeDirWithFile(prefix: string, file: string, content: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	writeFileSync(join(dir, file), content, "utf8");
	return dir;
}

describe("技能清单", () => {
	it("列出每个技能的名字与说明", async () => {
		const summaries = await listSkillSummaries([
			makeSkillsDir("skills-catalog-", ["create-task", "list-tasks"]),
		]);
		expect(summaries.map((s) => s.name).sort()).toEqual(["create-task", "list-tasks"]);
		expect(summaries.find((s) => s.name === "create-task")?.description).toContain(
			"create-task",
		);
	});

	it("目录不存在 ⇒ 空列表（不许炸）", async () => {
		expect(
			await listSkillSummaries([join(tmpdir(), "definitely-not-here-skill-dir")]),
		).toEqual([]);
	});

	it("**没配技能** ⇒ 空列表（不是异常）", async () => {
		expect(await listSkillSummaries([])).toEqual([]);
	});

	it("多个目录 ⇒ 合起来（各自只看到自己的那一份）", async () => {
		const a = makeSkillsDir("skills-a-", ["create-task"]);
		const b = makeSkillsDir("skills-b-", ["search-docs"]);

		expect((await listSkillSummaries([a])).map((s) => s.name)).toEqual(["create-task"]);
		expect((await listSkillSummaries([b])).map((s) => s.name)).toEqual(["search-docs"]);
		expect((await listSkillSummaries([a, b])).map((s) => s.name).sort()).toEqual([
			"create-task",
			"search-docs",
		]);
	});

	it("改了说明 ⇒ 读出来就是新的（不缓存）", async () => {
		const dir = makeSkillsDir("skills-catalog-", ["list-tasks"]);
		const before = (await listSkillSummaries([dir])).find((s) => s.name === "list-tasks");
		expect(before?.description).toBe("list-tasks 的说明。");

		writeFileSync(
			join(dir, "list-tasks", "SKILL.md"),
			"---\nname: list-tasks\ndescription: 列出任务（改过了）。\n---\n",
			"utf8",
		);
		const after = (await listSkillSummaries([dir])).find((s) => s.name === "list-tasks");
		expect(after?.description).toBe("列出任务（改过了）。");
	});

	// ⚠️ 下面几条 = **与 dsh 的发现规则对齐**（issue #153）
	//    ⇒ 界面列出来的 = 模型能加载的（不多不少）。

	it("扁平的 `<名字>.md` 也算技能（dsh 的第二种形态）", async () => {
		const dir = makeDirWithFile(
			"skills-flat-",
			"search-docs.md",
			"---\nname: search-docs\ndescription: 搜文档。\n---\n正文。\n",
		);
		expect((await listSkillSummaries([dir])).map((s) => s.name)).toEqual(["search-docs"]);
	});

	it("**只一层**：再往里一层的 `SKILL.md` 不算数（dsh 也不找）", async () => {
		const dir = mkdtempSync(join(tmpdir(), "skills-nested-"));
		mkdirSync(join(dir, "outer", "inner"), { recursive: true });
		writeFileSync(
			join(dir, "outer", "inner", "SKILL.md"),
			"---\nname: inner\ndescription: 里面的。\n---\n",
			"utf8",
		);
		expect(await listSkillSummaries([dir])).toEqual([]);
	});

	it("名字不是 kebab-case ⇒ 不算技能（模型也加载不了）", async () => {
		const dir = makeDirWithFile(
			"skills-badname-",
			"Bad_Name.md",
			"---\nname: Bad_Name\ndescription: 名字不合法。\n---\n",
		);
		expect(await listSkillSummaries([dir])).toEqual([]);
	});

	it("缺 description ⇒ 不算技能（dsh 的硬要求）", async () => {
		const dir = makeDirWithFile(
			"skills-nodesc-",
			"no-desc.md",
			"---\nname: no-desc\n---\n",
		);
		expect(await listSkillSummaries([dir])).toEqual([]);
	});

	it("没有 frontmatter ⇒ 不算技能", async () => {
		const dir = makeDirWithFile("skills-nofm-", "plain.md", "# 就是个说明文档\n");
		expect(await listSkillSummaries([dir])).toEqual([]);
	});

	it("同名 ⇒ 先来的赢（目录按配置顺序 ⇒ 与 dsh 的 rank 一致）", async () => {
		const a = makeDirWithFile(
			"skills-dup-a-",
			"same.md",
			"---\nname: same\ndescription: A 那份。\n---\n",
		);
		const b = makeDirWithFile(
			"skills-dup-b-",
			"same.md",
			"---\nname: same\ndescription: B 那份。\n---\n",
		);
		expect((await listSkillSummaries([a, b])).map((s) => s.description)).toEqual(["A 那份。"]);
		expect((await listSkillSummaries([b, a])).map((s) => s.description)).toEqual(["B 那份。"]);
	});
});
