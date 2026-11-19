/**
 * MCP 工具名 —— **归一化的唯一出处**。
 *
 * ⚠️ **模型侧的名字不变**（还是 `mcp__<server>__<tool>` ⇒ 技能正文依然对得上）
 *    ⇒ 归一化只发生在**给人看的地方**（界面 / 待确认 / 审计）。
 */
import { describe, expect, it } from "vitest";
import { bareToolName, mcpToolPrefix, stripMcpToolPrefix } from "./tool-names.ts";

describe("MCP 工具名的前缀", () => {
	it("前缀是 `mcp__<服务器名>__`", () => {
		expect(mcpToolPrefix("aiadmin")).toBe("mcp__aiadmin__");
		expect(mcpToolPrefix("docs")).toBe("mcp__docs__");
	});

	it("名字里的非法字符按 pi 的规则变成 `_`（要和 pi 一致）", () => {
		expect(mcpToolPrefix("my-server")).toBe("mcp__my_server__");
	});

	it("按已知前缀剥掉服务器名（多服务器也不会认错）", () => {
		const prefixes = [mcpToolPrefix("aiadmin"), mcpToolPrefix("docs")];
		expect(stripMcpToolPrefix("mcp__aiadmin__update_task", prefixes)).toBe(
			"update_task",
		);
		expect(stripMcpToolPrefix("mcp__docs__search", prefixes)).toBe("search");
	});

	it("认不出来的前缀 ⇒ 按通用规则兜底", () => {
		expect(stripMcpToolPrefix("mcp__unknown__tool", [])).toBe("tool");
		// 不是 MCP 工具 ⇒ 原样返回
		expect(stripMcpToolPrefix("create_task", [])).toBe("create_task");
	});
});

describe("工具名归一化", () => {
	it("MCP 工具 ⇒ 我们的命令名", () => {
		expect(bareToolName("mcp__aiadmin__create_task")).toBe("create_task");
		expect(bareToolName("mcp__docs__search")).toBe("search");
	});

	it("我们自己的命令名 ⇒ 原样（不重复剥）", () => {
		expect(bareToolName("create_task")).toBe("create_task");
		expect(bareToolName("load_skill")).toBe("load_skill");
	});

	it("服务器名里有下划线时**不乱剥**（配置里不许出现 ⇒ 不该有这种情况）", () => {
		expect(bareToolName("mcp__a_b__tool")).toBe("mcp__a_b__tool");
	});
});
