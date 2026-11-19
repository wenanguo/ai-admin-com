/**
 * **我们自己的**技能 loader（不依赖 pi）。
 *
 * ## 它证明什么
 *
 * 1. **发现**：目录里有 `SKILL.md` ⇒ 它就是一个技能；否则往子目录里找；
 * 2. **frontmatter**：`name` / `description` / `disable-model-invocation` 读得对；
 * 3. **去重**：同名 ⇒ 先来的赢 + 一条碰撞诊断；
 * 4. **坏文件不许炸**（技能是可选的 ⇒ 只是不加载 + 一条诊断）。
 *
 * ⚠️ issue #123 拔掉 pi 之后，**没有「与 pi 的 loader 对照」这一条**了
 *    （对照对象没了 ⇒ 对照测试也一起删；口径本身由下面的用例钉住）。
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadSkills } from "./skill-loader.ts";

/** 造一个技能目录（`<dir>/<name>/SKILL.md`）。 */
function makeSkillDir(root: string, name: string, description = `${name} 的说明。`): string {
	mkdirSync(join(root, name), { recursive: true });
	writeFileSync(
		join(root, name, "SKILL.md"),
		`---\nname: ${name}\ndescription: ${description}\n---\n\n正文。\n`,
		"utf8",
	);
	return root;
}

describe("技能 loader", () => {
	it("发现目录里的技能（name 与 description 来自 frontmatter）", async () => {
		const root = mkdtempSync(join(tmpdir(), "skills-load-"));
		makeSkillDir(root, "create-task", "建一条任务。");
		const result = await loadSkills([root]);
		expect(result.skills.map((skill) => skill.name)).toEqual(["create-task"]);
		expect(result.skills[0]?.description).toBe("建一条任务。");
		expect(result.skills[0]?.filePath).toBe(join(root, "create-task", "SKILL.md"));
		expect(result.skills[0]?.baseDir).toBe(join(root, "create-task"));
	});

	it("目录不存在 ⇒ 空列表 + 一条诊断（**不许炸**）", async () => {
		const result = await loadSkills([join(tmpdir(), "definitely-not-here")]);
		expect(result.skills).toEqual([]);
		expect(result.diagnostics.length).toBe(1);
	});

	it("**没配技能** ⇒ 空列表（不是异常）", async () => {
		expect((await loadSkills([])).skills).toEqual([]);
	});

	it("没有 description ⇒ 不算技能（有诊断）", async () => {
		const root = mkdtempSync(join(tmpdir(), "skills-nodesc-"));
		mkdirSync(join(root, "broken"), { recursive: true });
		writeFileSync(join(root, "broken", "SKILL.md"), "---\nname: broken\n---\n", "utf8");
		const result = await loadSkills([root]);
		expect(result.skills).toEqual([]);
		expect(result.diagnostics.length).toBeGreaterThan(0);
	});

	it("disable-model-invocation ⇒ 标记出来（不进提示词）", async () => {
		const root = mkdtempSync(join(tmpdir(), "skills-hidden-"));
		mkdirSync(join(root, "hidden"), { recursive: true });
		writeFileSync(
			join(root, "hidden", "SKILL.md"),
			"---\nname: hidden\ndescription: 不进提示词。\ndisable-model-invocation: true\n---\n",
			"utf8",
		);
		const result = await loadSkills([root]);
		expect(result.skills[0]?.disableModelInvocation).toBe(true);
	});

	it("同名技能 ⇒ 先来的赢 + 一条碰撞诊断", async () => {
		const a = mkdtempSync(join(tmpdir(), "skills-a-"));
		const b = mkdtempSync(join(tmpdir(), "skills-b-"));
		makeSkillDir(a, "same", "甲");
		makeSkillDir(b, "same", "乙");
		const result = await loadSkills([a, b]);
		expect(result.skills).toHaveLength(1);
		expect(result.skills[0]?.description).toBe("甲");
		expect(result.diagnostics.some((item) => item.severity === "collision")).toBe(true);
	});

	it("子目录里的技能也能被发现（目录本身不是技能根）", async () => {
		const root = mkdtempSync(join(tmpdir(), "skills-nested-"));
		makeSkillDir(join(root, "group"), "nested-skill");
		const result = await loadSkills([root]);
		expect(result.skills.map((skill) => skill.name)).toEqual(["nested-skill"]);
	});

	it("⭐ 仓里的三个样板技能：loader 能发现它们", async () => {
		const dir = join(process.cwd(), ".pi", "skills");
		const ours = await loadSkills([dir]);
		expect(ours.skills.map((skill) => skill.name).sort()).toEqual([
			"create-task",
			"list-tasks",
			"update-task",
		]);
	});
});
