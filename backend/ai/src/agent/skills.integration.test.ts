/**
 * 技能的**真链路**（真 SDK）—— 「智能体 A 看不到智能体 B 的技能」。
 *
 * ## 为什么要有它
 *
 * 技能隔离靠两层：
 * 1. **loader 入参**：只把配置里列的目录交给 pi（`additionalSkillPaths`）；
 * 2. **过滤器**：pi 默认还会扫 `<cwd>/.pi/skills` 与用户家目录（实测有三十多个）
 *    ⇒ 我们把它们**滤掉**（`skillsOverride`）。
 *
 * ⚠️ 第 2 层是关键 ⇒ 光看配置不够 ⇒ 得**真跑一遍 pi**看模型拿到什么。
 *
 * ## 怎么观察
 *
 * 有技能 ⇒ pi 才注册 `load_skill` 工具（见 `pi-session.ts`）⇒
 * **看工具在不在、能不能加载**，就知道模型拿到了哪些技能。
 */

import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createPiSession } from "./pi-session.ts";

/** 造一个技能目录（放一个技能）。 */
function makeSkillsDir(name: string): string {
	const dir = mkdtempSync(join(tmpdir(), "agent-skills-"));
	mkdirSync(join(dir, name), { recursive: true });
	writeFileSync(
		join(dir, name, "SKILL.md"),
		`---\nname: ${name}\ndescription: ${name} 的说明。\n---\n\n# ${name}\n`,
		"utf8",
	);
	return dir;
}

/** 一个真会话（不 mock SDK）。 */
interface PiSessionLike {
	bindExtensions: (options: { mode: string }) => Promise<void>;
	dispose: () => void;
	agent: {
		state: {
			tools: {
				name: string;
				execute: (id: string, params: object) => Promise<unknown>;
			}[];
		};
	};
}

/** 建一个真会话。 */
async function session(skillsDirs: string[]): Promise<PiSessionLike> {
	const pi = (await createPiSession({
		tools: [],
		systemPrompt: "你是助手。",
		conversationId: "conv-1",
		history: [],
		model: "minimax-cn/MiniMax-M3.1-Flash",
		skillsDirs,
	})) as unknown as PiSessionLike;
	// ⚠️ **必须 bindExtensions**（它才发 session_start ⇒ 工具才注册上）
	await pi.bindExtensions({ mode: "print" });
	return pi;
}

/** 会话里的工具名。 */
function toolNames(pi: PiSessionLike): string[] {
	return pi.agent.state.tools.map((tool) => tool.name);
}

/**
 * 这个会话**能不能加载**某个技能。
 *
 * ⚠️ 走 `load_skill` 工具：它只认**会话自己的技能表**
 *    ⇒ 别的智能体的技能**根本不在表里** ⇒ 调用会失败。
 *
 * @param pi 会话。
 * @param name 技能名。
 */
async function canLoad(pi: PiSessionLike, name: string): Promise<boolean> {
	const tool = pi.agent.state.tools.find(
		(candidate) => candidate.name === "load_skill",
	);
	if (tool === undefined) {
		return false;
	}
	const result = await tool.execute("call-1", { name });
	return !JSON.stringify(result).includes("没有叫");
}

describe("技能的隔离（真 SDK）", () => {
	it("配置里列了目录 ⇒ 模型能拿到那些技能（注册 load_skill）", async () => {
		const dir = makeSkillsDir("create-task");
		const pi = await session([dir]);
		try {
			// ⚠️ 工具是**异步注册**的 ⇒ 等一下（别一上来就断言）
			await vi.waitFor(() => {
				expect(toolNames(pi)).toContain("load_skill");
			});
			expect(await canLoad(pi, "create-task")).toBe(true);
		} finally {
			pi.dispose();
		}
	});

	it("⚠️ **没配技能 ⇒ 一个技能都没有**（连 `<cwd>/.pi/skills` 也不算数）", async () => {
		const pi = await session([]);
		try {
			// ⚠️ 本仓的 `<cwd>/.pi/skills` 里**确实有**技能
			//    （create-task / list-tasks / update-task）⇒ 这里连 load_skill 都没有
			//    ⇒ 证明「没配就是没有」，不是「恰好没扫到」。
			expect(toolNames(pi)).not.toContain("load_skill");
		} finally {
			pi.dispose();
		}
	});

	it("⚠️ **智能体 A 看不到智能体 B 的技能**（只给 A 自己的目录）", async () => {
		const a = makeSkillsDir("skill-a");
		const b = makeSkillsDir("skill-b");
		const pi = await session([a]);
		try {
			expect(await canLoad(pi, "skill-a")).toBe(true);
			// ⚠️ B 的技能**不在**可加载的范围里
			expect(await canLoad(pi, "skill-b")).toBe(false);
		} finally {
			pi.dispose();
		}
	});
});
