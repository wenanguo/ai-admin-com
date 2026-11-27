/**
 * 抓 AiAdmin 的 **MCP 工具清单** ⇒ 写成**入库快照**（issue #182 · C18-4）。
 *
 * ## 为什么要有它
 *
 * 技能正文（`backend/ai/.pi/skills/<名字>/SKILL.md`）里写的是 **MCP 工具的真实
 * 参数名**（`project_id` / `type_code` / `status_code` ……）⇒ 后端改了工具，
 * 技能就**悄悄失配** ⇒ 没人知道 ⇒ 模型拿着旧参数名去调 ⇒ 422。
 *
 * ⇒ 所以把工具清单**快照进仓**（名字 + 参数 schema）⇒ 再用一个**离线守卫**
 *    （`scripts/e2e/mcp-tools-snapshot.static.cjs`）比对「技能 ⇄ 快照」
 *    ⇒ 漂移在 CI 里就红。
 *
 * ## ⚠️ 这个脚本**要联网**（守卫不要联网）
 *
 * - **抓快照**（本脚本）：要连真 MCP ⇒ **人工跑**，跑完提交快照。
 * - **守卫**（`scripts/e2e/mcp-tools-snapshot.static.cjs`）：**纯离线** ⇒ CI 里能跑。
 *
 * ## 用法
 *
 * ```bash
 * # 默认地址 = 生产 AiAdmin（只读 tools/list ⇒ 不改任何数据）
 * node scripts/mcp/snapshot-aiadmin-tools.cjs
 *
 * # 换地址 / 换输出
 * node scripts/mcp/snapshot-aiadmin-tools.cjs --url http://127.0.0.1:8000/api/v1/mcp \
 *   --out backend/ai/mcp/aiadmin-tools.snapshot.json
 * ```
 *
 * ⚠️ **token 只在内存里**（`--token` / `MCP_TOKEN`）⇒ 绝不写进快照、绝不打印。
 */
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..", "..");

/** 默认的 MCP 地址（生产 AiAdmin 的任务模块 MCP）。 */
const DEFAULT_URL = "https://www.pmdict.cn/api/v1/mcp";
/** 默认的快照落点（相对仓根）。 */
const DEFAULT_OUT = path.join("backend", "ai", "mcp", "aiadmin-tools.snapshot.json");
/** 服务器名（工具名前缀 `mcp__<server>__`）。 */
const DEFAULT_SERVER = "aiadmin";

/**
 * 解析命令行参数。
 *
 * @param {string[]} argv 参数数组。
 * @returns {{url: string, out: string, server: string, token: string | undefined}} 参数。
 */
function parseArgs(argv) {
	const options = { url: DEFAULT_URL, out: DEFAULT_OUT, server: DEFAULT_SERVER };
	for (let index = 0; index < argv.length; index += 1) {
		const flag = argv[index];
		const value = argv[index + 1];
		if (flag === "--url" && value !== undefined) {
			options.url = value;
			index += 1;
		} else if (flag === "--out" && value !== undefined) {
			options.out = value;
			index += 1;
		} else if (flag === "--server" && value !== undefined) {
			options.server = value;
			index += 1;
		} else if (flag === "--token" && value !== undefined) {
			options.token = value;
			index += 1;
		}
	}
	// ⚠️ 环境变量兜底（**token 绝不进快照**）。
	if (options.token === undefined) {
		const fromEnv = process.env.MCP_TOKEN;
		if (fromEnv !== undefined && fromEnv.length > 0) {
			options.token = fromEnv;
		}
	}
	return options;
}

/**
 * 发一次 JSON-RPC。
 *
 * @param {string} url MCP 地址。
 * @param {object} payload JSON-RPC 载荷。
 * @param {string | undefined} sessionId 会话 id（第一次没有）。
 * @param {string | undefined} token 调用方 token（可选）。
 * @returns {Promise<{status: number, sessionId: string | undefined, body: string}>} 响应。
 */
async function rpc(url, payload, sessionId, token) {
	const headers = {
		"Content-Type": "application/json",
		Accept: "application/json, text/event-stream",
	};
	if (sessionId !== undefined) {
		headers["mcp-session-id"] = sessionId;
	}
	if (token !== undefined) {
		headers.Authorization = `Bearer ${token}`;
	}
	const response = await fetch(url, {
		method: "POST",
		headers,
		body: JSON.stringify(payload),
	});
	return {
		status: response.status,
		sessionId: response.headers.get("mcp-session-id") ?? undefined,
		body: await response.text(),
	};
}

/**
 * 解析 JSON-RPC 响应（**兼容 SSE 包裹**：`text/event-stream` 的响应体是 `data: {...}`）。
 *
 * @param {string} body 响应体。
 * @returns {object} 解析出来的 JSON。
 */
function parseRpcBody(body) {
	const trimmed = body.trim();
	if (trimmed.startsWith("{")) {
		return JSON.parse(trimmed);
	}
	// ⚠️ SSE 形态：取最后一条 `data:` 行。
	const dataLines = trimmed
		.split(/\r?\n/)
		.filter((line) => line.startsWith("data:"))
		.map((line) => line.slice(5).trim());
	if (dataLines.length === 0) {
		throw new Error(`响应不是 JSON，也不是 SSE：${trimmed.slice(0, 200)}`);
	}
	return JSON.parse(dataLines[dataLines.length - 1]);
}

/**
 * 抓工具清单。
 *
 * @param {{url: string, server: string, token: string | undefined}} options 参数。
 * @returns {Promise<{protocolVersion: string, serverName: string, tools: object[]}>} 清单。
 */
async function fetchTools(options) {
	const init = await rpc(
		options.url,
		{
			jsonrpc: "2.0",
			id: 1,
			method: "initialize",
			params: {
				protocolVersion: "2025-06-18",
				capabilities: {},
				clientInfo: { name: "ai-admin-com-snapshot", version: "1.0.0" },
			},
		},
		undefined,
		options.token,
	);
	if (init.status >= 400) {
		throw new Error(`initialize 失败（HTTP ${init.status}）：${init.body.slice(0, 300)}`);
	}
	const initResult = parseRpcBody(init.body).result ?? {};
	const sessionId = init.sessionId;

	// ⚠️ `notifications/initialized` 是协议要求的握手尾巴（202 / 204 都算成功）。
	await rpc(
		options.url,
		{ jsonrpc: "2.0", method: "notifications/initialized", params: {} },
		sessionId,
		options.token,
	).catch(() => undefined);

	const listed = await rpc(
		options.url,
		{ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
		sessionId,
		options.token,
	);
	if (listed.status >= 400) {
		throw new Error(`tools/list 失败（HTTP ${listed.status}）：${listed.body.slice(0, 300)}`);
	}
	const result = parseRpcBody(listed.body).result ?? {};
	const tools = Array.isArray(result.tools) ? result.tools : [];
	return {
		protocolVersion: initResult.protocolVersion ?? "2025-06-18",
		serverName: initResult.serverInfo?.name ?? "AiAdmin PM API",
		tools: tools
			.map((tool) => ({
				name: tool.name,
				description: tool.description ?? "",
				inputSchema: tool.inputSchema ?? { type: "object", properties: {} },
			}))
			.sort((left, right) => left.name.localeCompare(right.name)),
	};
}

/**
 * 主流程。
 *
 * @returns {Promise<void>} 结束。
 */
async function main() {
	const options = parseArgs(process.argv.slice(2));
	console.log(`→ 抓 MCP 工具清单：${options.url}`);
	const fetched = await fetchTools(options);
	if (fetched.tools.length === 0) {
		throw new Error("一个工具都没抓到 ⇒ 不写快照（避免把空清单写进仓）");
	}
	const snapshot = {
		/** 服务器名（工具名前缀：`mcp__<server>__`）。 */
		server: options.server,
		/** 快照的来源（人看得懂 ⇒ 便于判断「这份快照是什么时候的」）。 */
		source: options.url,
		/** 抓取日期（**人工刷新时才变** ⇒ 提交里的 diff 就是「后端改了工具」的证据）。 */
		capturedAt: new Date().toISOString().slice(0, 10),
		/** MCP 协议版本。 */
		protocolVersion: fetched.protocolVersion,
		/** 服务器自报的名字。 */
		serverInfo: fetched.serverName,
		/** 工具清单（名字 + 参数 schema）。 */
		tools: fetched.tools,
	};
	const target = path.resolve(repoRoot, options.out);
	fs.mkdirSync(path.dirname(target), { recursive: true });
	fs.writeFileSync(target, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
	console.log(`✅ 写了 ${path.relative(repoRoot, target).split(path.sep).join("/")}`);
	for (const tool of fetched.tools) {
		const required = tool.inputSchema?.required ?? [];
		console.log(
			`   - ${tool.name}（必填 ${required.length > 0 ? required.join(", ") : "无"}）`,
		);
	}
	console.log(
		"\n⚠️ 抓完记得跑守卫：node scripts/e2e/mcp-tools-snapshot.static.cjs（它会告诉你哪些技能要跟着改）",
	);
}

main().catch((error) => {
	console.error(`❌ 抓取失败：${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
});
