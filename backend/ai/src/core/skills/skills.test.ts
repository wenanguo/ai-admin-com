import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	DefaultResourceLoader,
	loadSkillsFromDir,
	type Skill,
} from "@earendil-works/pi-coding-agent";
import {
	buildSystemPrompt,
	createProjectSkillsOverride,
	renderSkillsSection,
} from "./skills.ts";

/** 造一个技能条目（只填我们用到的字段）。 */
function skill(overrides: Partial<Skill> = {}): Skill {
	return {
		name: "create-task",
		description: "在 AiAdmin 里建任务。",
		filePath: "/repo/.pi/skills/create-task/SKILL.md",
		baseDir: "/repo/.pi/skills/create-task",
		disableModelInvocation: false,
		...overrides,
	} as Skill;
}

describe("技能提示词段", () => {
	it("有技能时给出 <available_skills> 与 name/description/location", () => {
		const section = renderSkillsSection([skill()]);
		expect(section).toContain("<available_skills>");
		expect(section).toContain("<name>create-task</name>");
		expect(section).toContain("<description>在 AiAdmin 里建任务。</description>");
		expect(section).toContain("<location>/repo/.pi/skills/create-task/SKILL.md</location>");
	});

	it("提示词里说清用 load_skill 工具加载（不是 read/bash）", () => {
		expect(renderSkillsSection([skill()])).toContain("load_skill");
	});

	it("没有技能 ⇒ 空串（提示词里不留空段）", () => {
		expect(renderSkillsSection([])).toBe("");
	});

	it("disableModelInvocation 的技能不进提示词", () => {
		expect(renderSkillsSection([skill({ disableModelInvocation: true })])).toBe("");
	});

	it("buildSystemPrompt 把技能段接在 base 后面", () => {
		const prompt = buildSystemPrompt("你是助手。", [skill()]);
		expect(prompt.startsWith("你是助手。")).toBe(true);
		expect(prompt).toContain("<available_skills>");
	});

	it("没有技能时 buildSystemPrompt 原样返回 base", () => {
		expect(buildSystemPrompt("你是助手。", [])).toBe("你是助手。");
	});
});

describe("样板技能", () => {
	it("三个样板都能被 pi 的 loader 加载，且有 name 与 description", () => {
		const result = loadSkillsFromDir({
			dir: join(process.cwd(), ".pi", "skills"),
			source: "project",
		});
		const names = result.skills.map((skill) => skill.name).sort();
		// ⚠️ 三个样板都对应**真实存在的** MCP 工具：
		//    create_task / list_tasks / update_task（后端「任务模块」白名单里的五个之一）
		expect(names).toEqual(["create-task", "list-tasks", "update-task"]);
		for (const skill of result.skills) {
			expect(skill.description.length).toBeGreaterThan(0);
			expect(skill.description.length).toBeLessThanOrEqual(1024);
		}
	});

	it("同名技能 ⇒ loader 只留一个并给诊断（我们只信 loader，不自己再扫一遍）", async () => {
		// ⚠️ 去重发生在 **loader**（`loadSkills` 用 Map + 碰撞诊断），
		//    `loadSkillsFromDir` 只是扫目录、不去重 ⇒ 这条用真 loader 验。
		const root = mkdtempSync(join(tmpdir(), "skills-dup-"));
		// ⚠️ 放在 `.pi/skills` 下 ⇒ loader 才会发现它（项目级技能目录）
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
});

describe("技能来源限定", () => {
	it("只保留项目技能目录里的技能（用户家目录的不进）", () => {
		const root = mkdtempSync(join(tmpdir(), "skills-src-"));
		const projectDir = join(root, "proj");
		const userDir = join(root, "user");
		mkdirSync(projectDir, { recursive: true });
		mkdirSync(userDir, { recursive: true });

		const override = createProjectSkillsOverride(projectDir);
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
