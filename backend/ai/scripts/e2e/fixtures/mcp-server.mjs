/**
 * **真的 MCP 服务器**（验收用）—— 标准 MCP 协议（stdio）。
 *
 * ## 它是什么
 *
 * 用**官方 SDK**（`@modelcontextprotocol/sdk`）起一个 MCP 服务器 ⇒
 * 说的是**标准 MCP 协议** ⇒ dsh 自带的 `dsh-mcp-client` 能挂上它。
 *
 * ⚠️ **这是 AiAdmin 那个 MCP 的同构玩具版**：
 *    AiAdmin 那边是 streamable-http + Bearer 头；这里走 stdio（本地起进程 ⇒ 简单）。
 *    协议层是同一套（`initialize` / `tools/list` / `tools/call`）。
 *
 * ## 它证明什么
 *
 * - dsh 能挂上一个**真的** MCP 服务器（不是模拟）；
 * - 模型**真的调**了它的工具（服务端能收到 `tools/call`）；
 * - 工具名在模型侧是 `mcp__aiadmin__create_task`（dsh 限定出来的）。
 *
 * 用法：`node scripts/e2e/fixtures/mcp-server.mjs`
 * （工具 `create_task` ⇒ 回一句「建好了：<标题>」；并把调用记到 stderr。）
 */
import { appendFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "ai-admin-e2e-mcp", version: "0.0.1" });

server.registerTool(
	"create_task",
	{
		title: "Create Task",
		description: "在项目下新建一条任务（验收用的 MCP 工具）",
		inputSchema: { title: z.string().describe("任务标题") },
	},
	async ({ title }) => {
		// ⚠️ **记到 stderr**（stdout 是 MCP 的通道 ⇒ 不能写别的东西）。
		process.stderr.write(`[mcp-server] tools/call create_task ${title}\n`);
		record("create_task", title);
		return {
			content: [{ type: "text", text: `建好了：${title}` }],
		};
	},
);

server.registerTool(
	"update_task",
	{
		title: "Update Task",
		description: "修改已有任务（验收用的 MCP 写工具 ⇒ 要人点头）",
		inputSchema: { title: z.string().describe("新的标题") },
	},
	async ({ title }) => {
		process.stderr.write(`[mcp-server] tools/call update_task ${title}\n`);
		record("update_task", title);
		return {
			content: [{ type: "text", text: `改好了：${title}` }],
		};
	},
);

/**
 * 记一次调用（**写到文件** ⇒ 验收脚本能读到）。
 *
 * ⚠️ stdout 是 MCP 的通道 ⇒ 只能写 stderr 或文件。
 *
 * @param {string} tool 工具名。
 * @param {string} title 参数。
 */
function record(tool, title) {
	const target = process.env.DSH_E2E_MCP_LOG
	if (target === undefined || target.length === 0) {
		return
	}
	try {
		appendFileSync(target, `tools/call ${tool} ${title}\n`)
	} catch {
		/* 写不了就算了 */
	}
}

await server.connect(new StdioServerTransport());
process.stderr.write("[mcp-server] 已就绪\n");
