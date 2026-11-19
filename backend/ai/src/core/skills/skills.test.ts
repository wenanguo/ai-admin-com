/**
 * 技能提示词段 —— **两个 runner 共用**的那一段。
 *
 * ⚠️ **技能正文一个字不改**（它是提示词 ⇒ 走 git 评审）⇒
 *    这里只断言**提示词的形状**（XML 段 + 指向 `load_skill` 的措辞）。
 */
import { describe, expect, it } from "vitest";
import { buildSystemPrompt, renderSkillsSection } from "./skills.ts";
import type { SkillEntry } from "./skill-loader.ts";

/** 造一个技能条目（只填我们用到的字段）。 */
function skill(overrides: Partial<SkillEntry> = {}): SkillEntry {
	return {
		name: "create-task",
		description: "在 AiAdmin 里建任务。",
		filePath: "/repo/.pi/skills/create-task/SKILL.md",
		baseDir: "/repo/.pi/skills/create-task",
		disableModelInvocation: false,
		...overrides,
	};
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

	it("XML 里的尖括号被转义（技能说明里带尖括号也不破结构）", () => {
		const section = renderSkillsSection([
			skill({ description: "带 <尖括号> & 符号" }),
		]);
		expect(section).toContain("&lt;尖括号&gt; &amp; 符号");
	});
});
