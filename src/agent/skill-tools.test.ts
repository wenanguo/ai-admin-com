import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Skill } from "@earendil-works/pi-coding-agent";
import { createLoadSkillTool, LOAD_SKILL_TOOL_NAME } from "./skill-tools";

/** 造一个技能目录（SKILL.md + 一个附属文件）。 */
function makeSkill(): Skill {
	const baseDir = mkdtempSync(join(tmpdir(), "skill-"));
	mkdirSync(join(baseDir, "references"));
	writeFileSync(join(baseDir, "SKILL.md"), "# 建任务\n\n先查项目。\n", "utf8");
	writeFileSync(join(baseDir, "references", "fields.md"), "字段说明：project_key。\n", "utf8");
	return {
		name: "create-task",
		description: "在 AiAdmin 里建任务。",
		filePath: join(baseDir, "SKILL.md"),
		baseDir,
		disableModelInvocation: false,
	} as Skill;
}

/** 从工具结果里取文本。 */
function textOf(result: { content: { type: string; text?: string }[] }): string {
	return result.content.map((part) => part.text ?? "").join("");
}

describe("load_skill 工具", () => {
	it("按名字读到 SKILL.md 全文", async () => {
		const tool = createLoadSkillTool([makeSkill()]);
		const result = await tool.execute("call-1", { name: "create-task" });
		expect(textOf(result)).toContain("# 建任务");
		expect(result.isError).toBeFalsy();
	});

	it("能读技能目录内的附属文件（相对路径）", async () => {
		const tool = createLoadSkillTool([makeSkill()]);
		const result = await tool.execute("call-1", {
			name: "create-task",
			path: "references/fields.md",
		});
		expect(textOf(result)).toContain("字段说明");
	});

	it("越界的相对路径被拒绝（../ 逃出技能目录）", async () => {
		const tool = createLoadSkillTool([makeSkill()]);
		const result = await tool.execute("call-1", {
			name: "create-task",
			path: "../../../etc/passwd",
		});
		expect(result.isError).toBe(true);
		expect(textOf(result)).not.toContain("root:");
	});

	it("名字不存在 ⇒ 失败并列出可用技能", async () => {
		const tool = createLoadSkillTool([makeSkill()]);
		const result = await tool.execute("call-1", { name: "nope" });
		expect(result.isError).toBe(true);
		expect(textOf(result)).toContain("create-task");
	});

	it("文件读不到 ⇒ 失败得是人话，不带堆栈", async () => {
		const skill = makeSkill();
		const broken = { ...skill, filePath: join(skill.baseDir, "gone.md") } as Skill;
		const brokenTool = createLoadSkillTool([broken]);
		const result = await brokenTool.execute("call-1", { name: "create-task" });
		expect(result.isError).toBe(true);
		expect(textOf(result)).not.toContain("at Object");
	});

	it("工具名是 load_skill", () => {
		expect(LOAD_SKILL_TOOL_NAME).toBe("load_skill");
		expect(createLoadSkillTool([]).name).toBe("load_skill");
	});

	it("文件过大 ⇒ 截断并**告诉模型被截断了**", async () => {
		const baseDir = mkdtempSync(join(tmpdir(), "skill-big-"));
		writeFileSync(join(baseDir, "SKILL.md"), "x".repeat(70 * 1024), "utf8");
		const skill = {
			name: "big",
			description: "很大的技能。",
			filePath: join(baseDir, "SKILL.md"),
			baseDir,
			disableModelInvocation: false,
		} as Skill;
		const tool = createLoadSkillTool([skill]);
		const result = await tool.execute("call-1", { name: "big" });
		expect(textOf(result)).toContain("已截断");
		expect(textOf(result).length).toBeLessThan(70 * 1024);
	});
});
