/**
 * 端到端验收（issue #120）：**dsh runner 下的会话与闸门**。
 *
 * ## 它证明什么
 *
 * 1. **会话**：我们的自写 provider（dsh-llm seam，**不依赖 pi-ai**）能真的被 dsh 调用，
 *    dsh 的事件能翻译成**我们的事件词汇**（对外契约不变）；
 * 2. **闸门**：`approval/request` **走到我们的进程** ⇒ 等人点头 ⇒
 *    - 批准 ⇒ 工具**真的执行**（走命令桥）；
 *    - 拒绝 ⇒ 工具**没有执行**（命令桥一次都没被叫）。
 *
 * ## 为什么不需要模型凭据
 *
 * ⚠️ 脚本自己起一个**假模型服务**（OpenAI 兼容的 SSE）⇒
 *    测的是「**我们的 provider 与闸门接线**」⇒ **不花钱、不外网**。
 *
 * ## 前置
 *
 * - **Node ≥ 24.9**（dsh 的 engines 要求）；
 * - **pnpm**（dsh 的 profile 是 pnpm 工程 ⇒ 我们的插件要装进去）。
 *
 * 用法：`node scripts/e2e/dsh-runner.cjs`（在仓根跑）。
 */

import { createServer } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { DshSession } from "../../src/core/adapter/dsh/session.ts";
import { ensureDshProfile } from "../../src/core/adapter/dsh/profile.ts";
import { PendingWaiterRegistry } from "../../src/core/gate/pending-waiters.ts";
import type { CommandTool } from "../../src/core/tools/types.ts";
import { Type } from "typebox";

const requireFromHere = createRequire(import.meta.url);
const dshBin = requireFromHere.resolve("@deepseek-ai/dsh/lib/bin.js");
const pluginPath = join(process.cwd(), "dsh-plugin");
const dshHome = mkdtempSync(join(tmpdir(), "dsh-e2e-"));

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

/** 已经服务了几次请求（⇒ 决定这次回「调工具」还是回「一句话」）。 */
let modelCalls = 0;
/** 模型看到的工具名（记下来 ⇒ 断言模型真的看见了我们的工具）。 */
const seenTools: string[] = [];
/** 模型看到的系统提示词（记下来 ⇒ 断言我们的提示词真的进了模型上下文）。 */
const seenSystem: string[] = [];

const model = createServer((req, res) => {
	let body = "";
	req.on("data", (chunk) => {
		body += chunk;
	});
	req.on("end", () => {
		modelCalls += 1;
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
		// 奇数次 ⇒ 调工具；偶数次 ⇒ 回一句话。
		if (modelCalls % 2 === 1) {
			send({
				choices: [
					{
						delta: {
							tool_calls: [
								{
									index: 0,
									id: `call-${modelCalls}`,
									function: { name: "update_task", arguments: '{"title":"写文档"}' },
								},
							],
						},
						finish_reason: "tool_calls",
					},
				],
			});
		} else {
			send({ choices: [{ delta: { content: "任务建好了" } }] });
			send({ choices: [{ delta: {}, finish_reason: "stop" }] });
		}
		res.end();
	});
});
await new Promise<void>((resolve) => model.listen(0, resolve));
const modelPort = (model.address() as { port: number }).port;
const baseURL = `http://127.0.0.1:${modelPort}/v1`;

/* ------------------------------------------------------------------ *
 * 我们这边的假命令桥（工具真正执行的地方）
 * ------------------------------------------------------------------ */

/** 桥被叫了几次（⇒ 断言「拒绝 ⇒ 没执行」）。 */
let bridgeCalls = 0;

const tool: CommandTool = {
	name: "update_task",
	label: "建任务",
	description: "建一条任务（验收用）",
	parameters: Type.Object({ title: Type.String({ description: "标题" }) }),
	annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
	execute: async () => {
		bridgeCalls += 1;
		return { content: [{ type: "text", text: "建好了" }], details: { ok: true } };
	},
};

/* ------------------------------------------------------------------ *
 * 跑一轮：批准 ⇒ 执行；拒绝 ⇒ 不执行
 * ------------------------------------------------------------------ */

/**
 * 跑一轮对话。
 *
 * @param decision 人的答复（`approved` / `rejected`）。
 */
async function runTurn(
	decision: "approved" | "rejected",
): Promise<{ frames: string[]; pending: { id: string; command: string; args: Record<string, unknown> }[] }> {
	const waiters = new PendingWaiterRegistry();
	const pending: { id: string; command: string; args: Record<string, unknown> }[] = [];
	const frames: string[] = [];
	let pendingCounter = 0;

	const session = new DshSession({
		conversationId: `conv-${decision}`,
		tools: [tool],
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
			DSH_AI_PROVIDER: "deepseek-direct",
			DSH_AI_MODEL: "deepseek-chat",
			DSH_AI_BASE_URL: baseURL,
			DSH_AI_API_KEY: "fake-key",
			DSH_AI_SYSTEM_PROMPT: Buffer.from("你是验收用的助手", "utf8").toString("base64"),
			DSH_AI_TOOLS: Buffer.from(
				JSON.stringify([
					{
						name: "update_task",
						description: "建一条任务（验收用）",
						parameters: { title: { type: "string", required: true } },
						// ⚠️ **修改类工具要点头**（验收闸门）
						confirm: true,
					},
				]),
				"utf8",
			).toString("base64"),
			DSH_AI_BRIDGE_URL: "http://127.0.0.1:1/internal/dsh/commands",
			DSH_AI_BRIDGE_SECRET: "e2e",
			DSH_AI_CONVERSATION_ID: `conv-${decision}`,
			DSH_AI_DEBUG_LOG: join(dshHome, "plugin-debug.log"),
		},
		gate: () => ({
			conversationId: `conv-${decision}`,
			userId: "1",
			anchor: undefined,
			writeRules: [],
			onPending: (row) => {
				pending.push(row);
				// ⚠️ **模拟人点「同意 / 拒绝」**
				waiters.decide(row.id, decision);
			},
			waiters,
			createPending: async (input) => {
				pendingCounter += 1;
				return { id: `pending-${pendingCounter}` };
			},
			timeoutMs: 10_000,
		}),
	});

	session.subscribe((event) => {
		frames.push(event.type);
	});
	await session.prompt("帮我建一条任务");
	// ⚠️ 等这一轮跑完（模型两轮：调工具 ⇒ 回话）。
	const deadline = Date.now() + 60_000;
	while (Date.now() < deadline) {
		if (frames.includes("agent_settled") && frames.includes("message_end")) {
			break;
		}
		await new Promise((resolve) => setTimeout(resolve, 200));
	}
	await new Promise((resolve) => setTimeout(resolve, 500));
	session.dispose();
	return { frames, pending };
}

/* ------------------------------------------------------------------ *
 * 跑起来
 * ------------------------------------------------------------------ */

console.log("① 准备 dsh profile（装我们的插件）…");
ensureDshProfile({ dshHome, profile: "sdk", dshBin, pluginPath });

console.log("② 批准 ⇒ 工具真的执行");
const approved = await runTurn("approved");
check("模型被调用了", modelCalls >= 2, `modelCalls=${modelCalls}`);
check("模型看见了我们的工具", seenTools.some((names) => names.includes("update_task")));
check("出现了工具开始事件", approved.frames.includes("tool_execution_start"));
check("出现了助手消息结束事件", approved.frames.includes("message_end"));
check("出现了会话闲置事件", approved.frames.includes("agent_settled"));
check("挂起了待确认（闸门问了我们）", approved.pending.length === 1, `pending=${approved.pending.length}`);
check("待确认的命令名是我们自己的命令", approved.pending[0]?.command === "update_task");
check("待确认带上了参数", approved.pending[0]?.args?.["title"] === "写文档");
check(
	"我们的系统提示词进了模型上下文（技能段就靠它）",
	seenSystem.some((text) => text.includes("你是验收用的助手")),
	`系统提示词片段数：${seenSystem.length}`,
);

console.log("③ 拒绝 ⇒ 工具**没有**执行");
const callsBefore = bridgeCalls;
const rejected = await runTurn("rejected");
check("同样挂起了待确认", rejected.pending.length === 1, `pending=${rejected.pending.length}`);
check(
	"命令桥没有被调用（工具没执行）",
	bridgeCalls === callsBefore,
	`bridgeCalls ${callsBefore} → ${bridgeCalls}`,
);

model.close();

if (failures.length > 0) {
	console.error(`\n❌ 失败 ${failures.length} 条：`);
	for (const failure of failures) {
		console.error(`   - ${failure}`);
	}
	process.exit(1);
}
console.log("\n✅ dsh runner 的会话与闸门：全部通过");
process.exit(0);
