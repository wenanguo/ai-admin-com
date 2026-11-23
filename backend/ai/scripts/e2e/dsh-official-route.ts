/**
 * 端到端验收（issue #124 · **D3：官方 DeepSeek 路由**）。
 *
 * ## 它与 `dsh-runner.ts` 的区别
 *
 * `dsh-runner.ts` 起一个**假模型服务** ⇒ 验的是「我们的 provider 与闸门接线」
 * （不花钱、不外网）。本脚本**不造假的** ⇒ 真的打 `https://api.deepseek.com/v1`
 * ⇒ 验的是**官方路由 + 官方 key 下的整条链路**。
 *
 * ## 它证明什么（六条）
 *
 * ① **模型回话**：官方路由真的被调用、回了内容；
 * ② **工具调用翻译对**：官方 API 的 `tool_calls` ⇒ 我们的事件词汇里的工具事件；
 * ③ **工具执行**：工具真的被调到（`tool_execution_end` 且不是错误）；
 * ④ **事件词汇照旧**：只有 `agent-event.ts` 里那几个类型（对外 SSE 契约不变）；
 * ⑤ **命令桥被叫**：dsh 侧的插件回调**我们**执行命令（命令本体在我们这边）；
 * ⑥ **会话闲置**：这一轮跑完有 `agent_settled`。
 *
 * ## ⚠️ 那个坑：dsh 的工具参数是 **DSL 形状**，不是 JSON Schema
 *
 * dsh 只认 `{ tz: { type: "string", required: true } }` 这种**DSL**；
 * 写成 JSON Schema（`{ type: "object", properties: { … } }`）会被 dsh **静默丢掉**
 * ⇒ **模型看不到那个工具** ⇒ 模型永远不调它 ⇒ 验收看似「模型没调工具」。
 * ⇒ 下面的 `DSH_TOOLS_DSL` 照 DSL 形状写（**别「顺手改成标准 schema」**）。
 *
 * ## 没有 key ⇒ **跳过**（exit 0）
 *
 * CI 里没有 `DEEPSEEK_API_KEY` ⇒ 打印「跳过」并退出 0 ⇒ **CI 安全**。
 *
 * ## 前置
 *
 * - Node ≥ 24.9（dsh 的 engines 要求）；
 * - pnpm（dsh 的 profile 是 pnpm 工程 ⇒ 我们的插件要装进去）；
 * - `backend/ai` 里依赖装好（`npm ci`）。
 *
 * 用法（**在仓根跑**）：`node scripts/e2e/dsh-official-route.cjs`
 */

import { createServer } from "node:http";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { Type } from "typebox";
import { DshSession } from "../../src/core/adapter/dsh/session.ts";
import { ensureDshProfile } from "../../src/core/adapter/dsh/profile.ts";
import { PendingWaiterRegistry } from "../../src/core/gate/pending-waiters.ts";
import type { AgentEvent, AgentEventType } from "../../src/core/session/agent-event.ts";
import type { CommandTool } from "../../src/core/tools/types.ts";

const requireFromHere = createRequire(import.meta.url);

/** dsh 的 profile 名（与服务的缺省一致）。 */
const PROFILE = "sdk";
/** 我们 provider 的路由名。 */
const PROVIDER = "deepseek-direct";
/** 模型 id（官方）。 */
const MODEL = process.env.AI_DSH_MODEL ?? "deepseek-chat";
/** 官方路由（**不是兼容网关**）。 */
const BASE_URL = process.env.AI_DSH_BASE_URL ?? "https://api.deepseek.com/v1";

/** 我们自己的事件词汇（`agent-event.ts` 的联合类型）—— ④ 就钉这个。 */
const EVENT_VOCABULARY = new Set<AgentEventType>([
	"agent_start",
	"agent_settled",
	"message_start",
	"message_update",
	"message_end",
	"tool_execution_start",
	"tool_execution_end",
]);

/** 失败信息（收集起来 ⇒ 一次性报）。 */
const failures: string[] = [];

/**
 * 断言。
 *
 * @param label 断言说什么。
 * @param ok 过没过。
 * @param detail 没过时的补充（事件序列之类）。
 */
function check(label: string, ok: boolean, detail?: string): void {
	console.log(`  ${ok ? "✓" : "✗"} ${label}${ok || detail === undefined ? "" : ` —— ${detail}`}`);
	if (!ok) {
		failures.push(detail === undefined ? label : `${label} —— ${detail}`);
	}
}

/**
 * 读 key：**先看环境变量，再看 `backend/ai/.env`**。
 *
 * ⚠️ **不打印 key**（一律只说「有没有」）。
 */
function resolveKey(): string {
	const fromEnv = process.env.DEEPSEEK_API_KEY;
	if (fromEnv !== undefined && fromEnv.trim().length > 0) {
		return fromEnv.trim();
	}
	try {
		const text = readFileSync(join(process.cwd(), ".env"), "utf8");
		for (const line of text.split(/\r?\n/)) {
			const match = /^\s*DEEPSEEK_API_KEY\s*=\s*(.*)$/.exec(line);
			if (match?.[1] !== undefined) {
				return match[1].trim().replace(/^["']|["']$/g, "");
			}
		}
	} catch {
		// 没有 .env ⇒ 当没配
	}
	return "";
}

const apiKey = resolveKey();
if (apiKey.length === 0) {
	console.log("⚠️ 没有 DEEPSEEK_API_KEY（环境变量与 backend/ai/.env 都没有）⇒ 跳过 D3 验收");
	console.log("   （这是**有意为之**：CI 里没有 key ⇒ 跳过并 exit 0）");
	process.exit(0);
}

/* ------------------------------------------------------------------ *
 * 命令桥（**我们这边真的执行命令**的地方）
 * ------------------------------------------------------------------ */

/** 命令桥收到的请求（⇒ ③⑤ 断言「真的被执行了」）。 */
const bridgeCalls: { tool: string; ok: boolean }[] = [];

const bridgeServer = createServer((req, res) => {
	let body = "";
	req.on("data", (chunk) => {
		body += chunk;
	});
	req.on("end", () => {
		let tool = "";
		try {
			tool = String((JSON.parse(body) as { tool?: unknown }).tool ?? "");
		} catch {
			// 解析不了就记空名（断言会失败 ⇒ 不会静默通过）
		}
		bridgeCalls.push({ tool, ok: true });
		res.writeHead(200, { "content-type": "application/json" });
		res.end(JSON.stringify({ ok: true, summary: `现在时间：${new Date().toISOString()}` }));
	});
});
await new Promise<void>((resolve) => bridgeServer.listen(0, "127.0.0.1", resolve));
const bridgePort = (bridgeServer.address() as { port: number }).port;
const bridgeUrl = `http://127.0.0.1:${bridgePort}/internal/dsh/commands`;

/* ------------------------------------------------------------------ *
 * 我们的工具（**只读** ⇒ 闸门会直接放行）
 * ------------------------------------------------------------------ */

/**
 * 我们的工具定义。
 *
 * ⚠️ **它的 `execute` 这次跑不到**：dsh 侧执行工具时会**回调命令桥**
 * （= 我们服务里的 `agentRuntime.executeDshCommand`）⇒ 真正执行在我们的服务进程里，
 * 而本脚本起的是**一个独立进程**（没有起服务）⇒ 所以这里用**假的命令桥**接住。
 * ⇒ ③ 的断言看的是「命令桥收到了这次调用」，不是 `execute`（那条在 `dsh-runner.ts` 里验）。
 */
const tool: CommandTool = {
	name: "get_time",
	label: "看时间",
	description: "返回当前时间（验收用）",
	parameters: Type.Object({ tz: Type.String({ description: "时区" }) }),
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
	execute: async (_toolCallId, params) => ({
		content: [{ type: "text", text: `现在时间是 ${new Date().toISOString()}` }],
		details: { tz: (params as { tz?: string }).tz ?? "" },
	}),
};

/**
 * 给 dsh 侧插件的工具目录 —— ⚠️ **dsh 的 DSL 形状**（不是 JSON Schema）。
 *
 * 写成 JSON Schema 会被 dsh 静默丢掉 ⇒ 模型看不见这个工具（见文件头）。
 */
const DSH_TOOLS_DSL = [
	{
		name: "get_time",
		description: "返回当前时间（验收用）",
		parameters: { tz: { type: "string", required: true } },
		// ⚠️ **只读** ⇒ 不设 `confirm`（设了就要人点头 ⇒ 验收会卡在闸门上）
	},
];

/* ------------------------------------------------------------------ *
 * 起一轮会话 ⇒ 打官方路由
 * ------------------------------------------------------------------ */

const dshBin = requireFromHere.resolve("@deepseek-ai/dsh/lib/bin.js");
const pluginPath = join(process.cwd(), "dsh-plugin");
const dshHome = mkdtempSync(join(tmpdir(), "dsh-d3-"));
const conversationId = `conv-d3-${Date.now().toString(36)}`;

console.log(`① 准备 dsh profile（装我们的插件）… dshHome=${dshHome}`);
await ensureDshProfile({ dshHome, profile: PROFILE, dshBin, pluginPath });

console.log(`② 起会话 ⇒ 打官方路由（${BASE_URL} · ${MODEL}）…`);
const waiters = new PendingWaiterRegistry();
const frames: AgentEventType[] = [];
const texts: string[] = [];
const toolNames: string[] = [];
let toolError = false;

const session = new DshSession({
	conversationId,
	tools: [tool],
	systemPrompt: "你是验收用的助手，只用一两句话回答。",
	provider: PROVIDER,
	model: MODEL,
	cwd: process.cwd(),
	dshHome,
	profile: PROFILE,
	patches: [join(pluginPath, "profile.patch.yml")],
	dshBin,
	env: {
		...process.env,
		// ⚠️ **dsh 自己认的名字**照原名进**子进程环境**（进程环境是合法的，只有 `.env` 文件被禁）
		DSH_HOME: dshHome,
		// ⚠️ 我们插件读的一律 `AI_DSH_*`（见 `core/adapter/dsh/runner.ts` 文件头）
		AI_DSH_PROVIDER: PROVIDER,
		AI_DSH_MODEL: MODEL,
		AI_DSH_BASE_URL: BASE_URL,
		AI_DSH_API_KEY: apiKey,
		AI_DSH_SYSTEM_PROMPT: Buffer.from("你是验收用的助手，只用一两句话回答。", "utf8").toString(
			"base64",
		),
		AI_DSH_TOOLS: Buffer.from(JSON.stringify(DSH_TOOLS_DSL), "utf8").toString("base64"),
		AI_DSH_BRIDGE_URL: bridgeUrl,
		AI_DSH_BRIDGE_SECRET: "d3-e2e",
		AI_DSH_CONVERSATION_ID: conversationId,
	},
	gate: () => ({
		conversationId,
		userId: "1",
		anchor: undefined,
		writeRules: [],
		onPending: (row) => {
			// ⚠️ 验收用**只读**工具 ⇒ 正常走不到这里；真走到就放行（别把验收卡死）。
			waiters.decide(row.id, "approved");
		},
		waiters,
		createPending: async () => ({ id: "pending-d3" }),
		timeoutMs: 10_000,
	}),
});

session.subscribe((event: AgentEvent) => {
	frames.push(event.type);
	if (event.type === "message_update") {
		const delta = event.assistantMessageEvent;
		if (delta.type === "text_delta") {
			texts.push(delta.delta);
		}
	}
	if (event.type === "tool_execution_start") {
		toolNames.push(event.toolName);
	}
	if (event.type === "tool_execution_end" && event.isError === true) {
		toolError = true;
	}
});

// ⚠️ **必须明说「先调工具」**（否则模型可能直接凭记忆回答 ⇒ ③ 验不到）。
await session.prompt(
	"**必须先调用 get_time 工具**（不要凭记忆回答时间），拿到结果后用一句话总结。",
);

const deadline = Date.now() + 120_000;
while (Date.now() < deadline) {
	if (frames.includes("agent_settled") && frames.includes("message_end")) {
		break;
	}
	await new Promise((resolve) => setTimeout(resolve, 300));
}
// 收尾的帧（`agent_settled` 之后可能还有一点）
await new Promise((resolve) => setTimeout(resolve, 1000));
session.dispose();
bridgeServer.close();

/* ------------------------------------------------------------------ *
 * 断言
 * ------------------------------------------------------------------ */

console.log("\n③ 断言");
const sequence = [...new Set(frames)].join(" · ");
check("① 模型回话了（message_end）", frames.includes("message_end"), sequence);
check(
	"① 模型回了内容（有 text_delta）",
	texts.join("").trim().length > 0,
	`文本帧 ${texts.length} 个`,
);
check(
	"② 工具调用翻译对了（tool_execution_start）",
	frames.includes("tool_execution_start"),
	sequence,
);
check("② 翻译出来的工具名是我们的工具", toolNames.includes("get_time"), toolNames.join(","));
check("③ 工具执行完成且没报错（tool_execution_end）", frames.includes("tool_execution_end") && !toolError, sequence);
check(
	"③ **工具真的被执行了**（命令桥收到了 get_time 且回了 ok）",
	bridgeCalls.some((call) => call.tool === "get_time" && call.ok),
	`bridgeCalls=${JSON.stringify(bridgeCalls)}`,
);
check(
	"④ 事件词汇照旧（只有 agent-event.ts 里那几个）",
	frames.every((type) => EVENT_VOCABULARY.has(type)),
	frames.filter((type) => !EVENT_VOCABULARY.has(type)).join(","),
);
check(
	"⑤ 命令桥被叫了（dsh 侧插件回调我们执行）",
	bridgeCalls.some((call) => call.tool === "get_time"),
	`bridgeCalls=${JSON.stringify(bridgeCalls)}`,
);
check("⑥ 会话闲置了（agent_settled）", frames.includes("agent_settled"), sequence);

console.log(`\n事件序列：${sequence}`);

if (failures.length > 0) {
	console.error(`\n❌ D3 失败 ${failures.length} 条：`);
	for (const failure of failures) {
		console.error(`   - ${failure}`);
	}
	process.exit(1);
}
console.log("\n✅ D3：官方 DeepSeek 路由在我们的 dsh runner 上跑通了（六条断言全过）");
process.exit(0);
