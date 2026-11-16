/**
 * 智能体配置的装载与校验 —— 「**非法配置启动即报错**」是这一层的全部意义。
 *
 * 测试都在**临时目录**里造配置（不碰仓里的真配置）⇒ 互不干扰。
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentConfigError } from "./errors.ts";
import { loadAgentConfig, loadAgentConfigs } from "./loader.ts";

let root: string;

/** 造一个智能体目录（`agents/<id>/`）。 */
function makeAgentDir(id: string, files: Record<string, string>): string {
	const dir = join(root, id);
	mkdirSync(dir, { recursive: true });
	for (const [name, content] of Object.entries(files)) {
		writeFileSync(join(dir, name), content, "utf8");
	}
	return dir;
}

/** 造一个配置目录并返回它的 `agent.yaml` 路径。 */
function makeConfig(id: string, yaml: string, extra: Record<string, string> = {}): string {
	const dir = makeAgentDir(id, { "agent.yaml": yaml, ...extra });
	return join(dir, "agent.yaml");
}

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "ai-agents-"));
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

describe("loadAgentConfigs", () => {
	it("根目录不存在 ⇒ 空列表（不是故障）", () => {
		expect(loadAgentConfigs(join(root, "nope"))).toEqual([]);
	});

	it("没有 agent.yaml 的子目录 ⇒ 跳过", () => {
		mkdirSync(join(root, "not-an-agent"), { recursive: true });
		expect(loadAgentConfigs(root)).toEqual([]);
	});

	it("合法配置 ⇒ 装得出字段（路径解析成绝对路径）", () => {
		const dir = join(root, "pm");
		mkdirSync(join(dir, "skills"), { recursive: true });
		writeFileSync(
			join(dir, "agent.yaml"),
			[
				"id: pm",
				"name: PM 助手",
				"description: 拆需求、管里程碑",
				"model: minimax-cn/MiniMax-M3.1-Flash",
				"systemPrompt: 你是 PM 助手",
				"skills:",
				"  - ./skills",
				"mcpServers:",
				"  - name: aiadmin",
				"    url: http://aiadmin.test/mcp",
				"tools:",
				"  - create_task",
			].join("\n"),
			"utf8",
		);

		const configs = loadAgentConfigs(root);
		expect(configs).toHaveLength(1);
		const config = configs[0];
		expect(config?.id).toBe("pm");
		expect(config?.name).toBe("PM 助手");
		expect(config?.description).toBe("拆需求、管里程碑");
		expect(config?.model).toBe("minimax-cn/MiniMax-M3.1-Flash");
		expect(config?.systemPrompt).toBe("你是 PM 助手");
		expect(config?.skills).toEqual([join(dir, "skills")]);
		expect(config?.mcpServers).toEqual([
			{ name: "aiadmin", url: "http://aiadmin.test/mcp" },
		]);
		expect(config?.tools).toEqual(["create_task"]);
	});

	it("systemPromptFile ⇒ 读文件内容（相对配置目录）", () => {
		const configPath = makeConfig(
			"pm",
			["id: pm", "name: PM", "description: 说明", "systemPromptFile: prompt.md"].join("\n"),
			{ "prompt.md": "文件里的提示词" },
		);

		const config = loadAgentConfig(configPath, join(root, "pm"));
		expect(config.systemPrompt).toBe("文件里的提示词");
	});

	it("清单按 id 排序（顺序稳定）", () => {
		makeConfig("b", ["id: b", "name: B", "description: 说明", "systemPrompt: x"].join("\n"));
		makeConfig("a", ["id: a", "name: A", "description: 说明", "systemPrompt: x"].join("\n"));
		expect(loadAgentConfigs(root).map((config) => config.id)).toEqual(["a", "b"]);
	});
});

describe("非法配置 ⇒ 报错并点名字段", () => {
	it("缺 id ⇒ 点名 id", () => {
		const configPath = makeConfig("pm", ["name: PM", "description: 说明", "systemPrompt: x"].join("\n"));
		expect(() => loadAgentConfig(configPath, join(root, "pm"))).toThrowError(/字段 id/);
	});

	it("类型错 ⇒ 点名 skills", () => {
		const configPath = makeConfig(
			"pm",
			["id: pm", "name: PM", "description: 说明", "systemPrompt: x", "skills: 不是数组"].join("\n"),
		);
		expect(() => loadAgentConfig(configPath, join(root, "pm"))).toThrowError(/字段 skills/);
	});

	it("数组里的元素类型错 ⇒ 点名 skills[1]", () => {
		const configPath = makeConfig(
			"pm",
			["id: pm", "name: PM", "description: 说明", "systemPrompt: x", "skills:", "  - ok", "  - 42"].join(
				"\n",
			),
		);
		expect(() => loadAgentConfig(configPath, join(root, "pm"))).toThrowError(/字段 skills\[1\]/);
	});

	it("未知字段 ⇒ 报错（不静默忽略）", () => {
		const configPath = makeConfig(
			"pm",
			["id: pm", "name: PM", "description: 说明", "systemPrompt: x", "sysPrompt: 拼错了"].join("\n"),
		);
		expect(() => loadAgentConfig(configPath, join(root, "pm"))).toThrowError(/未知字段/);
	});

	it("文件是空的 ⇒ 报错（不是「一个空智能体」）", () => {
		const configPath = makeConfig("pm", "");
		expect(() => loadAgentConfig(configPath, join(root, "pm"))).toThrowError(/整个配置/);
	});

	it("systemPrompt 与 systemPromptFile 都给 ⇒ 报错", () => {
		const configPath = makeConfig(
			"pm",
			[
				"id: pm",
				"name: PM",
				"description: 说明",
				"systemPrompt: x",
				"systemPromptFile: prompt.md",
			].join("\n"),
			{ "prompt.md": "文件里的提示词" },
		);
		expect(() => loadAgentConfig(configPath, join(root, "pm"))).toThrowError(/二选一/);
	});

	it("两个都不给 ⇒ 报错", () => {
		const configPath = makeConfig("pm", ["id: pm", "name: PM", "description: 说明"].join("\n"));
		expect(() => loadAgentConfig(configPath, join(root, "pm"))).toThrowError(/二选一/);
	});

	it("技能目录不存在 ⇒ 点名 skills[0]", () => {
		const configPath = makeConfig(
			"pm",
			["id: pm", "name: PM", "description: 说明", "systemPrompt: x", "skills:", "  - ./skills"].join(
				"\n",
			),
		);
		expect(() => loadAgentConfig(configPath, join(root, "pm"))).toThrowError(/字段 skills\[0\]/);
	});

	it("systemPromptFile 指向的文件不存在 ⇒ 点名 systemPromptFile", () => {
		const configPath = makeConfig(
			"pm",
			["id: pm", "name: PM", "description: 说明", "systemPromptFile: missing.md"].join("\n"),
		);
		expect(() => loadAgentConfig(configPath, join(root, "pm"))).toThrowError(
			/字段 systemPromptFile/,
		);
	});

	it("id 与目录名不一致 ⇒ 报错", () => {
		const configPath = makeConfig(
			"pm",
			["id: other", "name: PM", "description: 说明", "systemPrompt: x"].join("\n"),
		);
		expect(() => loadAgentConfig(configPath, join(root, "pm"))).toThrowError(/字段 id/);
	});

	it("YAML 语法错 ⇒ 报错（并说是哪个文件）", () => {
		const configPath = makeConfig("pm", "id: pm\n  name: 缩进坏了\n");
		expect(() => loadAgentConfig(configPath, join(root, "pm"))).toThrowError(/无法解析/);
	});

	it("错误类型是 AgentConfigError（带配置文件路径）", () => {
		const configPath = makeConfig("pm", ["name: PM"].join("\n"));
		try {
			loadAgentConfig(configPath, join(root, "pm"));
			throw new Error("本该抛错");
		} catch (error) {
			expect(error).toBeInstanceOf(AgentConfigError);
			expect((error as AgentConfigError).configPath).toBe(configPath);
		}
	});

	it("装载**整个目录**时也报错（不是只跳过坏的那个）", () => {
		makeConfig("good", ["id: good", "name: G", "description: 说明", "systemPrompt: x"].join("\n"));
		makeConfig("bad", ["name: B", "description: 说明", "systemPrompt: x"].join("\n"));
		expect(() => loadAgentConfigs(root)).toThrowError(/字段 id/);
	});
});
