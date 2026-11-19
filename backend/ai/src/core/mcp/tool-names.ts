/**
 * MCP 工具名 —— **归一化的唯一出处**。
 *
 * ## 为什么要有它
 *
 * MCP 的工具在模型侧叫 **`mcp__<服务器名>__<工具名>`**（dsh 与 pi 同款命名）
 * ⇒ 但**产品可见的地方**（界面上的命令卡片、待确认卡片、审计表）要显示
 * **我们自己的命令名**（`create_task`）⇒ 有一处统一的规则，别处都调它。
 *
 * ## 规则
 *
 * | 形状 | 含义 |
 * | ---- | ---- |
 * | `mcp__aiadmin__create_task` | MCP 工具（原始名） |
 * | `create_task` | **我们的命令名**（归一化之后） |
 *
 * ⚠️ **服务器名里不许有下划线**（智能体配置的 `mcpServers.name` 只许
 *    小写字母 / 数字 / 连字符）⇒ `mcp__[^_]+__` 这个规则**不会误伤**别的名字。
 *
 * ⚠️ **模型侧看到的名字不变**（还是 `mcp__aiadmin__create_task`）
 *    ⇒ **技能正文里写的工具名依然对得上**（技能是提示词 ⇒ 不许改）。
 *    归一化只发生在**给人看的地方**。
 */

/** MCP 工具名的前缀规则（`mcp__<服务器名>__`）。 */
export const MCP_TOOL_PREFIX_PATTERN = /^mcp__[^_]+__/;

/**
 * 去掉 MCP 前缀 ⇒ **我们的命令名**。
 *
 * @param toolName 工具名（可能带 `mcp__<server>__` 前缀）。
 */
export function bareToolName(toolName: string): string {
	return toolName.replace(MCP_TOOL_PREFIX_PATTERN, "");
}

/**
 * MCP 工具名的**服务器前缀**（`mcp__<server>__`；非法字符换成 `_`）。
 *
 * @param serverName 服务器名。
 */
export function mcpToolPrefix(serverName: string): string {
	return `mcp__${serverName.replace(/[^A-Za-z0-9_]/g, "_")}__`;
}

/**
 * 去掉 MCP 工具名的服务器前缀 ⇒ **工具本名**（如 `update_task`）。
 *
 * ⚠️ **按已知的服务器名算**（不是正则猜）⇒ 多服务器 / 名字带连字符都不会认错。
 *
 * @param toolName 工具名（`mcp__<server>__<tool>`）。
 * @param prefixes 这个会话用到的服务器前缀（**认得准** ⇒ 不会认错服务器）。
 */
export function stripMcpToolPrefix(
	toolName: string,
	prefixes: readonly string[],
): string {
	for (const prefix of prefixes) {
		if (toolName.startsWith(prefix)) {
			return toolName.slice(prefix.length);
		}
	}
	// 兜底：按通用规则（非贪婪）
	return bareToolName(toolName);
}
