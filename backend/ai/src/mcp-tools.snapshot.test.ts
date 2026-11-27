/**
 * **MCP 工具快照 ⇄ 我们的命令目录**（issue #182 · C18-1 / C18-4）。
 *
 * ## 钉住的三件事
 *
 * 1. **同名两义不许发生** —— 我们自研的命令名 **不能**和 MCP 的工具裸名撞车
 *    （撞了 ⇒ 模型看到两个都叫「建任务」的工具 ⇒ 会挑错、会混参数）。
 * 2. **闸门口径不变** —— 快照里每个 MCP 工具**要不要人点头**，
 *    与「新增放行、修改要点头」这条口径**逐个对得上**
 *    ⇒ 以后谁改闸门，这里会红。
 * 3. **快照本身是活的** —— 文件在、格式对、工具不为空。
 *
 * ⚠️ **口径只有一份**（`core/gate/gate.ts` 的 `requiresConfirmation`）⇒
 *    这里**不重写**口径，只**拿它来核对**快照里每个工具的结论。
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { requiresConfirmation } from "./core/gate/gate.ts";
import { bareToolName } from "./core/mcp/tool-names.ts";
// ⚠️ **从入口侧拿插件**（`src/plugins.ts` 是唯一 import 业务插件的地方 ⇒ 别绕开它）
import { plugins } from "./plugins.ts";

/** 快照文件（**cwd 相对** ⇒ 测试要在这个包里跑）。 */
const SNAPSHOT_PATH = join("mcp", "aiadmin-tools.snapshot.json");

/** 快照里的一个工具。 */
interface SnapshotTool {
	name: string;
	description: string;
	inputSchema: {
		type?: string;
		properties?: Record<string, { type?: string; description?: string }>;
		required?: string[];
	};
}

/** 快照文件（读 + 解析）。 */
function readSnapshot(): { server: string; capturedAt: string; tools: SnapshotTool[] } {
	return JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8"));
}

/** 我们自研的命令（**从入口侧的插件注册表拿**）。 */
function ownCommands(): { name: string }[] {
	return plugins.flatMap((plugin) => plugin.commands ?? []);
}

describe("MCP 工具快照", () => {
	it("快照在、格式对、工具不为空", () => {
		const snapshot = readSnapshot();
		expect(snapshot.server).toBe("aiadmin");
		expect(snapshot.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		expect(snapshot.tools.length).toBeGreaterThan(0);
		for (const tool of snapshot.tools) {
			expect(tool.name).not.toBe("");
			expect(tool.inputSchema.type).toBe("object");
		}
	});

	it("⚠️ **同名两义不许有**：我们自研的命令名 ∩ MCP 工具裸名 = ∅", () => {
		const snapshot = readSnapshot();
		const mcpNames = new Set(snapshot.tools.map((tool) => tool.name));
		const ourNames = ownCommands().map((command) => command.name);
		expect(ourNames.length).toBeGreaterThan(0);

		for (const name of ourNames) {
			expect(mcpNames.has(name)).toBe(false);
		}
		// ⚠️ 反过来也看一眼：我们的名字不许**看起来像** MCP 的裸名
		//    （`pm_` 前缀是我们自研命令的约定 ⇒ 别把自研命令改成裸名）
		for (const name of ourNames) {
			expect(name.startsWith("pm_")).toBe(true);
		}
	});

	it("⚠️ **闸门口径不变**：新增放行、修改要点头（逐个 MCP 工具核对）", () => {
		const snapshot = readSnapshot();
		// 快照里现在有的工具 ⇒ 各自的结论
		const expected: Record<string, boolean> = {
			create_task: false,
			list_tasks: false,
			get_task_detail: false,
			update_task: true,
			patch_task_status: true,
		};
		for (const tool of snapshot.tools) {
			expect(expected[tool.name]).toBe(requiresConfirmation(tool.name));
			// ⚠️ **带前缀也一样**（模型侧看到的是带前缀的完整名）
			expect(expected[tool.name]).toBe(
				requiresConfirmation(`mcp__aiadmin__${tool.name}`),
			);
		}
		// ⚠️ 快照里**不许**出现没登记过的工具（新增工具 ⇒ 这里会红 ⇒ 顺手把口径补上）
		for (const tool of snapshot.tools) {
			expect(Object.keys(expected)).toContain(tool.name);
		}
	});

	it("我们自研的建任务命令**不触发**确认（新增放行 ⇒ 闸门口径不变）", () => {
		for (const command of ownCommands()) {
			expect(requiresConfirmation(command.name)).toBe(false);
		}
	});

	it("MCP 的裸名归一化后仍是裸名（界面 / 待确认 / 审计看到的就是它）", () => {
		const snapshot = readSnapshot();
		for (const tool of snapshot.tools) {
			expect(bareToolName(`mcp__aiadmin__${tool.name}`)).toBe(tool.name);
		}
	});
});
