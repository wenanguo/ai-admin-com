/**
 * 仓里**真的那几份**智能体配置 —— 「PM 助手必须等价复现原来的行为」。
 *
 * ⚠️ 这份测试钉的是**产品口径**，不是实现细节：
 *    原来的 PM 助手是写死的提示词 + 写死的工具 + 写死的 MCP；
 *    现在这些都在配置里 ⇒ 配置写错了 ⇒ 这个服务的行为就变了
 *    ⇒ 用测试把「等价」钉住。
 */

import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadAgentConfigs } from "./loader.ts";

/** 仓里的智能体配置目录（**cwd 相对** ⇒ 测试要在这个包里跑）。 */
const AGENTS_DIR = "agents";

describe("仓里的智能体配置", () => {
	it("PM 助手：工具 / MCP / 技能 / 提示词都与原来一样", () => {
		const configs = loadAgentConfigs(AGENTS_DIR);
		const pm = configs.find((config) => config.id === "pm");
		expect(pm).toBeDefined();

		// ① 工具：原来就只有一个 `create_task`
		expect(pm?.tools).toEqual(["create_task"]);

		// ② MCP：一台 `aiadmin`（地址不写 ⇒ 用全局默认，与原来一样）
		expect(pm?.mcpServers).toEqual([
			{ name: "aiadmin", url: undefined, type: "http", exposure: "direct" },
		]);

		// ③ 技能：还是本服务自己的 `.pi/skills`（相对配置目录解析）
		expect(pm?.skills).toEqual([join(process.cwd(), ".pi", "skills")]);

		// ④ 模型：不写 ⇒ 用全局默认 `env.AI_MODEL`（与原来一样）
		expect(pm?.model).toBeUndefined();

		// ⑤ 提示词：原来写死在 `src/agent/prompt.ts` ⇒ 现在搬到了 `agents/pm/prompt.md`
		//    （内容一字未改 ⇒ 行为不变）
		expect(pm?.systemPrompt).toContain(
			"你是 AiAdmin 项目管理系统里的 AI 助手",
		);
		expect(pm?.systemPrompt).toContain("建任务用 create_task");
		expect(pm?.systemPrompt).toContain("绝不编造项目编码");
	});

	it("通用问答：没有工具、没有 MCP、没有技能（与 PM 助手明显不同）", () => {
		const configs = loadAgentConfigs(AGENTS_DIR);
		const qa = configs.find((config) => config.id === "qa");
		expect(qa).toBeDefined();
		expect(qa?.tools).toEqual([]);
		expect(qa?.mcpServers).toEqual([]);
		expect(qa?.skills).toEqual([]);
		expect(qa?.systemPrompt).toContain("通用问答助手");
	});

	it("两个智能体的提示词不一样（否则换智能体等于没换）", () => {
		const configs = loadAgentConfigs(AGENTS_DIR);
		const pm = configs.find((config) => config.id === "pm");
		const qa = configs.find((config) => config.id === "qa");
		expect(pm?.systemPrompt).not.toBe(qa?.systemPrompt);
	});
});
