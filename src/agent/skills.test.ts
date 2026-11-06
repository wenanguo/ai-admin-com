import { describe, expect, it } from "vitest";
import type { Skill } from "@earendil-works/pi-coding-agent";
import { buildSystemPrompt, renderSkillsSection } from "./skills";

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
