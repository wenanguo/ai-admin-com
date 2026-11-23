/**
 * 端到端验收（issue #122）：**技能 / MCP / 插件三层在 dsh 上的形状**。
 *
 * ## 它证明什么
 *
 * 1. **技能**：我们的 loader（`core/skills/skill-loader.ts`）发现的技能
 *    **照旧进模型上下文**（系统提示词里有 `<available_skills>` 段）；
 * 2. **MCP**：dsh 自带的 `@deepseek-ai/dsh-mcp-client` **挂上一个真的 MCP 服务器**
 *    ⇒ **模型真的调了它的工具**（服务端收到了 `tools/call`）；
 * 3. **工具名归一化**：模型侧叫 `mcp__aiadmin__create_task` ⇒
 *    **给人看的名字**是 `create_task`（spec §5.3）；
 * 4. **闸门**：MCP 的**写**操作也要人点头（`update_task` ⇒ 挂起待确认 ⇒
 *    拒绝 ⇒ **服务端一次都没被叫**）；
 * 5. **插件**：我们自己的命令（业务插件给的）**照旧挂进 dsh 的工具表**
 *    ⇒ 模型看得见它。
 *
 * ## 为什么不需要模型凭据
 *
 * ⚠️ 脚本自己起一个**假模型服务**（OpenAI 兼容的 SSE）⇒
 *    测的是「**MCP 挂载 / 闸门 / 技能段 / 工具名**」⇒ **不花钱、不外网**。
 *
 * ## 前置
 *
 * - **Node ≥ 24.9**（dsh 的 engines 要求）；
 * - **pnpm**（dsh 的 profile 是 pnpm 工程 ⇒ 我们的插件要装进去）。
 *
 * 用法：`npx tsx scripts/e2e/dsh-skills-mcp-plugins.ts`（在 `backend/ai` 下跑）。
 */

// ⚠️ **先加载假环境变量**（内核的 env 校验在模块加载时就跑）。
import "./fixtures/env.ts";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { DshSession } from "../../src/core/adapter/dsh/session.ts";
import { ensureDshProfile } from "../../src/core/adapter/dsh/profile.ts";
import { buildDshMcpClientConfigs } from "../../src/core/mcp/mcp.ts";
import { stripMcpToolPrefix } from "../../src/core/mcp/tool-names.ts";
import { AgentEventMapper } from "../../src/core/session/event-mapper.ts";
import { PendingWaiterRegistry } from "../../src/core/gate/pending-waiters.ts";
import { loadSkills } from "../../src/core/skills/skill-loader.ts";
import { buildSystemPrompt } from "../../src/core/skills/skills.ts";
import type { CommandTool } from "../../src/core/tools/types.ts";
import { Type } from "typebox";

const requireFromHere = createRequire(import.meta.url);
const dshBin = requireFromHere.resolve("@deepseek-ai/dsh/lib/bin.js");
const pluginPath = join(process.cwd(), "dsh-plugin");
const dshHome = mkdtempSync(join(tmpdir(), "dsh-e2e-mcp-"));
/** MCP 服务器的调用记录（那个服务器写到这个文件里）。 */
const mcpLogPath = join(dshHome, "mcp-calls.log");
writeFileSync(mcpLogPath, "", "utf8");

/** 失败信息（收集起来 ⇒ 一次性报）。 */
const failures: string[] = [];
/** 断言。 */
function check(label: string, ok: boolean, detail?: string): void {
	console.log(`  ${ok ? "✓" : "✗"} ${label}${ok || !detail ? "" : ` —— ${detail}`}`);
	if (!ok) {
		failures.push(detail === undefined ? label : `${label} —— ${detail}`);
	}
}

/* ------------------------------------------------------------------ *
 * 假模型服务（OpenAI 兼容的 SSE）
 * ------------------------------------------------------------------ */

/** 当前阶段（决定模型这轮调哪个工具）。 */
type Phase = "create" | "update";
let phase: Phase = "create";
/** 这一阶段里模型被叫了几次（第一次 ⇒ 调工具；之后 ⇒ 回话）。 */
let callsInPhase = 0;
/** 模型看到的工具名（⇒ 断言模型真的看见了 MCP 的工具）。 */
const seenTools: string[] = [];
/** 模型看到的系统提示词（⇒ 断言技能段进了模型上下文）。 */
const seenSystem: string[] = [];

const model = createServer((req, res) => {
	let body = "";
	req.on("data", (chunk) => {
		body += chunk;
	});
	req.on("end", () => {
		callsInPhase += 1;
		try {
			const parsed = JSON.parse(body) as {
				tools?: { function?: { name?: string } }[];
				messages?: { role?: string; content?: unknown }[];
			};
			seenTools.push((parsed.tools ?? []).map((tool) => tool.function?.name ?? "").join(","));
			for (const message of parsed.messages ?? []) {
				if (message.role === "system" && typeof message.content === "string") {
					seenSystem.push(message.content);
				}
			}
		} catch {
			// 解析不了就当没看见（断言会失败 ⇒ 不会静默通过）
		}
		res.writeHead(200, { "content-type": "text/event-stream" });
		const send = (payload: unknown) => {
			res.write(`data: ${JSON.stringify(payload)}\n\n`);
		};
		if (callsInPhase % 2 === 1) {
			const name = phase === "create" ? "mcp__aiadmin__create_task" : "mcp__aiadmin__update_task";
			send({
				choices: [
					{
						delta: {
							tool_calls: [
								{
									index: 0,
									id: `call-${callsInPhase}`,
									function: { name, arguments: '{"title":"写文档"}' },
								},
							],
						},
						finish_reason: "tool_calls",
					},
				],
			});
		} else {
			send({ choices: [{ delta: { content: "干完了" } }] });
			send({ choices: [{ delta: {}, finish_reason: "stop" }] });
		}
		res.end();
	});
});
await new Promise<void>((resolve) => model.listen(0, resolve));
const modelPort = (model.address() as { port: number }).port;
const baseURL = `http://127.0.0.1:${modelPort}/v1`;

/* ------------------------------------------------------------------ *
 * 我们的命令（**业务插件给的那一条** ⇒ 插件层的「挂上去」）
 * ------------------------------------------------------------------ */

/** 我们的命令被调用了几次（⇒ 断言命令桥那条路还通）。 */
let localToolCalls = 0;

const localTool: CommandTool = {
	name: "create_task",
	label: "建任务",
	description: "我们自己的命令（业务插件给的）",
	parameters: Type.Object({ title: Type.String({ description: "标题" }) }),
	annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
	execute: async () => {
		localToolCalls += 1;
		return { content: [{ type: "text", text: "建好了" }], details: { ok: true } };
	},
};

/* ------------------------------------------------------------------ *
 * MCP 服务器（**真的**：官方 SDK + 标准协议）
 * ------------------------------------------------------------------ */

/**
 * dsh 侧的 MCP 配置。
 *
 * ⚠️ **stdio**（本地起一个子进程）⇒ 简单；
 *    生产走 **streamable-http**（同一个客户端，配置由 `buildDshMcpClientConfigs` 给）。
 * ⚠️ **服务器名来自我们的 builder**（⇒ 工具名前缀 `mcp__aiadmin__` 是我们的规则）。
 */
function mcpConfigForE2E(): Record<string, unknown> {
	const [httpConfig] = buildDshMcpClientConfigs([
		{ name: "aiadmin", url: "http://127.0.0.1:1/mcp", token: "e2e-token" },
	]);
	return {
		transport: "stdio",
		serverName: httpConfig?.serverName ?? "aiadmin",
		command: process.execPath,
		args: [join(process.cwd(), "scripts", "e2e", "fixtures", "mcp-server.mjs")],
		env: { DSH_E2E_MCP_LOG: mcpLogPath },
	};
}

/** MCP 服务器被调用过吗（读它写的日志）。 */
function mcpCalls(): string[] {
	if (!existsSync(mcpLogPath)) {
		return [];
	}
	return readFileSync(mcpLogPath, "utf8")
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
}

/* ------------------------------------------------------------------ *
 * 跑一轮
 * ------------------------------------------------------------------ */

/** 一轮的结果。 */
interface TurnResult {
	/** 给前端看的工具名（**归一化之后**）。 */
	toolNames: string[];
	/** 挂起的待确认（命令名 / 参数）。 */
	pending: { id: string; command: string; args: Record<string, unknown> }[];
}

/**
 * 跑一轮对话。
 *
 * @param currentPhase 这一轮干什么（`create` = 新建 · `update` = 修改）。
 * @param decision 人的答复（`approved` / `rejected`；只对 `update` 有意义）。
 */
async function runTurn(currentPhase: Phase, decision: "approved" | "rejected"): Promise<TurnResult> {
	phase = currentPhase;
	callsInPhase = 0;
	const waiters = new PendingWaiterRegistry();
	const pending: TurnResult["pending"] = [];
	const toolNames: string[] = [];
	const prefixes = ["mcp__aiadmin__"];
	// ⚠️ **与运行时同一套归一化**（spec §5.3）⇒ 界面看到的是我们的命令名。
	const mapper = new AgentEventMapper({
		normalizeToolName: (name) => stripMcpToolPrefix(name, prefixes),
	});

	const session = new DshSession({
		conversationId: `conv-${currentPhase}-${decision}`,
		tools: [localTool],
		systemPrompt: "你是验收用的助手",
		provider: "deepseek-direct",
		model: "deepseek-chat",
		cwd: process.cwd(),
		dshHome,
		profile: "sdk",
		patches: [join(pluginPath, "profile.patch.yml")],
		dshBin,
		env: {
			...process.env,
			DSH_HOME: dshHome,
			AI_DSH_PROVIDER: "deepseek-direct",
			AI_DSH_MODEL: "deepseek-chat",
			AI_DSH_BASE_URL: baseURL,
			AI_DSH_API_KEY: "fake-key",
			AI_DSH_SYSTEM_PROMPT: Buffer.from("你是验收用的助手", "utf8").toString("base64"),
			AI_DSH_TOOLS: Buffer.from(
				JSON.stringify([
					{
						name: "create_task",
						description: "我们自己的命令（业务插件给的）",
						parameters: { title: { type: "string", required: true } },
						confirm: false,
					},
				]),
				"utf8",
			).toString("base64"),
			AI_DSH_MCP_SERVERS: Buffer.from(JSON.stringify([mcpConfigForE2E()]), "utf8").toString(
				"base64",
			),
			AI_DSH_BRIDGE_URL: "http://127.0.0.1:1/internal/dsh/commands",
			AI_DSH_BRIDGE_SECRET: "e2e",
			AI_DSH_CONVERSATION_ID: `conv-${currentPhase}-${decision}`,
			AI_DSH_DEBUG_LOG: join(dshHome, "plugin-debug.log"),
		},
		gate: () => ({
			conversationId: `conv-${currentPhase}-${decision}`,
			userId: "1",
			anchor: undefined,
			writeRules: [],
			onPending: (row) => {
				pending.push(row);
				// ⚠️ **模拟人点「同意 / 拒绝」**
				waiters.decide(row.id, decision);
			},
			waiters,
			createPending: async (input) => ({ id: `pending-${input.command}` }),
			timeoutMs: 20_000,
		}),
	});

	const frames: string[] = [];
	session.subscribe((event) => {
		frames.push(event.type);
		if (event.type === "tool_execution_start" || event.type === "tool_execution_end") {
			// ⚠️ **记一下**（调试用：看得见工具被调了谁、结果是什么）。
			console.log(
				`    [事件] ${event.type} ${(event as { toolName?: string }).toolName ?? ""}`,
			);
		}
		for (const mapped of mapper.map(`conv-${currentPhase}-${decision}`, event)) {
			if (mapped.event === "tool_call") {
				toolNames.push(String((mapped.payload as { toolName?: string }).toolName ?? ""));
			}
		}
	});
	await session.prompt("帮我建一条任务");
	const deadline = Date.now() + 90_000;
	while (Date.now() < deadline) {
		if (frames.includes("agent_settled") && frames.includes("message_end")) {
			break;
		}
		await new Promise((resolve) => setTimeout(resolve, 200));
	}
	await new Promise((resolve) => setTimeout(resolve, 800));
	session.dispose();
	return { toolNames, pending };
}

/* ------------------------------------------------------------------ *
 * 跑起来
 * ------------------------------------------------------------------ */

console.log("① 技能段：我们自己的 loader 发现的技能 ⇒ 进了系统提示词");
const skills = await loadSkills([join(process.cwd(), ".pi", "skills")]);
const systemPrompt = buildSystemPrompt("你是验收用的助手", skills.skills);
check("我们的 loader 发现了三个样板技能", skills.skills.length === 3, `找到 ${skills.skills.length} 个`);
check(
	"提示词里有 <available_skills> 段（技能照旧进模型上下文）",
	systemPrompt.includes("<available_skills>") && systemPrompt.includes("<name>create-task</name>"),
);

console.log("② 准备 dsh profile（装我们的插件）…");
await ensureDshProfile({ dshHome, profile: "sdk", dshBin, pluginPath });

console.log("③ MCP：模型真的调了一个真的 MCP 服务器的工具（新建 ⇒ 不用点头）");
const created = await runTurn("create", "approved");
check(
	"模型看见了 MCP 的工具（dsh 限定成 mcp__<server>__<tool>）",
	seenTools.some((names) => names.includes("mcp__aiadmin__create_task")),
	`模型看到的工具：${seenTools[0] ?? "（没有）"}`,
);
check(
	"模型看见了**我们自己的**命令（业务插件挂上去的那一条）",
	seenTools.some((names) => names.includes("create_task")),
);
check(
	"**真的 MCP 服务器**被调用了（服务端收到了 tools/call）",
	mcpCalls().some((line) => line.includes("tools/call create_task")),
	`MCP 服务器的记录：${JSON.stringify(mcpCalls())}`,
);
check(
	"给人看的工具名**归一化**成我们的命令名（spec §5.3）",
	created.toolNames.includes("create_task"),
	`看到的工具名：${JSON.stringify(created.toolNames)}`,
);
check("新建**不用**点头（口径：新增放行）", created.pending.length === 0);

console.log("④ MCP 的写操作也要点头（修改 ⇒ 挂起待确认 ⇒ 拒绝 ⇒ 服务端没被叫）");
const beforeReject = mcpCalls().length;
const rejected = await runTurn("update", "rejected");
check("挂起了待确认（闸门问了我们）", rejected.pending.length === 1, `pending=${rejected.pending.length}`);
check(
	"待确认的命令名**归一化**成我们的命令名",
	rejected.pending[0]?.command === "update_task",
	`command=${rejected.pending[0]?.command}`,
);
check(
	"拒绝 ⇒ **MCP 服务器一次都没被叫**（写操作被拦住了）",
	mcpCalls().length === beforeReject,
	`调用次数 ${beforeReject} → ${mcpCalls().length}`,
);

console.log("⑤ 批准 ⇒ 真的执行了");
const beforeApprove = mcpCalls().length;
const approved = await runTurn("update", "approved");
check("同样挂起了待确认", approved.pending.length === 1, `pending=${approved.pending.length}`);
check(
	"批准 ⇒ MCP 服务器收到了写调用",
	mcpCalls().length > beforeApprove,
	`调用次数 ${beforeApprove} → ${mcpCalls().length}`,
);

model.close();

if (failures.length > 0) {
	console.error(`\n❌ 失败 ${failures.length} 条：`);
	for (const failure of failures) {
		console.error(`   - ${failure}`);
	}
	process.exit(1);
}
console.log("\n✅ 技能 / MCP / 插件三层：全部通过");
process.exit(0);
