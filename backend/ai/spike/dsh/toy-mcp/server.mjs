/**
 * 玩具 MCP server（stdio）—— 一个工具 `toy_echo`。
 *
 * 存在的意义：**证明 dsh 能挂标准 MCP server**（`@deepseek-ai/dsh-mcp-client`），
 * 且工具名会被服务端限定成 `mcp__<serverName>__<toolName>`（这里是 `mcp__toy__toy_echo`）。
 *
 * ⚠️ 这就是 AiAdmin 那个 MCP（`AIADMIN_MCP_URL`）的同构玩具版：
 *    AiAdmin 那边是 streamable-http + Bearer 头，dsh-mcp-client 同样支持（见 spec §2.6）。
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const server = new McpServer({ name: 'ai-admin-toy-mcp', version: '0.0.1' })

server.registerTool(
	'toy_echo',
	{
		title: 'Toy Echo',
		description: '回显传入的文本（玩具 MCP 工具）',
		inputSchema: { text: z.string().describe('要回显的文本') },
	},
	async ({ text }) => ({
		content: [{ type: 'text', text: `MCP-TOY-ECHO:${text}` }],
	}),
)

await server.connect(new StdioServerTransport())
