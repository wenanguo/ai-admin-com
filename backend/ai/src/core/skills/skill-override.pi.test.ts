/**
 * pi 路径的技能过滤钩子（**pi 专有** ⇒ 单独一个测试文件）。
 *
 * ⚠️ **拔 pi（#123）时这个文件整个删掉**。
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	DefaultResourceLoader,
	loadSkillsFromDir,
	type Skill,
} from "@earendil-works/pi-coding-agent";
import { createProjectSkillsOverride } from "./skill-override.pi.ts";

describe("技能来源限定（pi 路径）", () => {
	it("样板技能都能被 pi 的 loader 加载，且有 name 与 description", () => {
		const result = loadSkillsFromDir({
			dir: join(process.cwd(), ".pi", "skills"),
			source: "project",
		});
		const names = result.skills.map((skill) => skill.name).sort();
		expect(names).toEqual(["create-task", "list-tasks", "update-task"]);
		for (const skill of result.skills) {
			expect(skill.description.length).toBeGreaterThan(0);
			expect(skill.description.length).toBeLessThanOrEqual(1024);
		}
	});

	it("同名技能 ⇒ loader 只留一个并给诊断（我们只信 loader，不自己再扫一遍）", async () => {
		const root = mkdtempSync(join(tmpdir(), "skills-dup-"));
		const skillsDir = join(root, ".pi", "skills");
		mkdirSync(join(skillsDir, "a"), { recursive: true });
		mkdirSync(join(skillsDir, "b"), { recursive: true });
		writeFileSync(
			join(skillsDir, "a", "SKILL.md"),
			"---\nname: same\ndescription: 甲\n---\n",
			"utf8",
		);
		writeFileSync(
			join(skillsDir, "b", "SKILL.md"),
			"---\nname: same\ndescription: 乙\n---\n",
			"utf8",
		);
		const agentDir = join(root, ".ai", "agent");
		mkdirSync(agentDir, { recursive: true });

		const loader = new DefaultResourceLoader({
			cwd: root,
			agentDir,
			noSkills: false,
			skillsOverride: createProjectSkillsOverride(skillsDir),
		});
		await loader.reload();

		const result = loader.getSkills();
		expect(result.skills.filter((skill) => skill.name === "same")).toHaveLength(1);
		expect(result.diagnostics.length).toBeGreaterThan(0);
	});

	it("只保留项目技能目录里的技能（用户家目录的不进）", () => {
		const root = mkdtempSync(join(tmpdir(), "skills-src-"));
		const projectDir = join(root, "proj");
		const userDir = join(root, "user");
		mkdirSync(projectDir, { recursive: true });
		mkdirSync(userDir, { recursive: true });

		const override = createProjectSkillsOverride<{
			skills: Skill[];
			diagnostics: { path?: string; message: string }[];
		}>(projectDir);
		const result = override({
			skills: [
				{
					name: "proj-skill",
					description: "项目里的技能。",
					filePath: join(projectDir, "SKILL.md"),
					baseDir: projectDir,
					disableModelInvocation: false,
				} as Skill,
				{
					name: "user-skill",
					description: "用户家目录里的技能。",
					filePath: join(userDir, "SKILL.md"),
					baseDir: userDir,
					disableModelInvocation: false,
				} as Skill,
			],
			diagnostics: [],
		});

		expect(result.skills.map((skill) => skill.name)).toEqual(["proj-skill"]);
	});

	it("⭐ 真的 loader：只发现项目目录里的技能（用户家目录的那一堆不进）", async () => {
		const root = mkdtempSync(join(tmpdir(), "skills-loader-"));
		const projectDir = join(root, ".pi", "skills");
		mkdirSync(join(projectDir, "demo"), { recursive: true });
		writeFileSync(
			join(projectDir, "demo", "SKILL.md"),
			"---\nname: demo\ndescription: 演示技能。\n---\n",
			"utf8",
		);
		const agentDir = join(root, ".ai", "agent");
		mkdirSync(agentDir, { recursive: true });

		const loader = new DefaultResourceLoader({
			cwd: root,
			agentDir,
			noSkills: false,
			skillsOverride: createProjectSkillsOverride(projectDir),
		});
		await loader.reload();

		const names = loader.getSkills().skills.map((skill) => skill.name);
		expect(names).toEqual(["demo"]);
	});
});
