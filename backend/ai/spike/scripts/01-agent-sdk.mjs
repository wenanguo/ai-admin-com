#!/usr/bin/env node
/**
 * 尖峰 ①：pi SDK 在 Node 进程里能不能跑？—— 最小可运行范例（真调模型）。
 *
 * 这是被搬进 src/app/api/spike/agent/route.ts 的同一套调用。
 *
 * 跑法（必须带 .env，否则没有 key）：
 *   node --env-file=.env spike/scripts/01-agent-sdk.mjs
 */

import {
	createAgentSession,
	DefaultResourceLoader,
	defineTool,
	ModelRuntime,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { readFileSync } from "node:fs";

const piPkg = JSON.parse(
	readFileSync(new URL("../../node_modules/@earendil-works/pi-coding-agent/package.json", import.meta.url), "utf8"),
);

const PROVIDER = "minimax-cn";
const MODEL_ID = "MiniMax-M3.1-Flash";
// 用一个不存在的 authPath：这样能成功 = 只靠环境变量，与 ~/.pi/agent/auth.json 无关。
const NO_AUTH_FILE = new URL("./no-such-auth.json", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

console.log("=== [0] 环境 ===");
console.log("node:", process.version);
console.log("pi SDK:", piPkg.version);
console.log("MINIMAX_CN_API_KEY 是否存在:", Boolean(process.env.MINIMAX_CN_API_KEY), "(长度", process.env.MINIMAX_CN_API_KEY?.length ?? 0, ")");

// ---------------------------------------------------------------------------
// [1] ModelRuntime：只靠环境变量鉴权
// ---------------------------------------------------------------------------
console.log("=== [1] ModelRuntime ===");
const modelRuntime = await ModelRuntime.create({ authPath: NO_AUTH_FILE });
console.log("hasConfiguredAuth('minimax-cn'):", modelRuntime.hasConfiguredAuth(PROVIDER));
console.log("getProviderAuthStatus:", JSON.stringify(modelRuntime.getProviderAuthStatus(PROVIDER)));

const model = modelRuntime.getModel(PROVIDER, MODEL_ID);
console.log("getModel ->", `${model.provider}/${model.id} api=${model.api} baseUrl=${model.baseUrl}`);

// ---------------------------------------------------------------------------
// [2] 自定义工具：只回显参数
// ---------------------------------------------------------------------------
console.log("=== [2] 自定义工具 ===");
const echoTool = defineTool({
	name: "echo",
	label: "Echo",
	description: "把收到的 text 参数原样回显。用于验证 tool-calling 链路。",
	parameters: Type.Object({
		text: Type.String({ description: "要回显的文本" }),
	}),
	execute: async (toolCallId, params, signal, onUpdate, ctx) => {
		console.log("  [tool] execute 被调用");
		console.log("    toolCallId =", JSON.stringify(toolCallId));
		console.log("    params     =", JSON.stringify(params));
		console.log("    signal     =", signal === undefined ? "undefined" : signal.constructor.name);
		console.log("    onUpdate   =", typeof onUpdate);
		console.log("    ctx 类型   =", ctx?.constructor?.name ?? "undefined", "| ctx 字段:", ctx ? Object.keys(ctx).join(",") : "-");
		return {
			content: [{ type: "text", text: `echo: ${params.text}` }],
			details: { echoed: params },
		};
	},
});
console.log("defineTool() ->", typeof echoTool, "name =", echoTool.name);

// ---------------------------------------------------------------------------
// [3] 资源加载器：关掉内置工具发现 + 自定义 system prompt
// ---------------------------------------------------------------------------
console.log("=== [3] ResourceLoader ===");
const resourceLoader = new DefaultResourceLoader({
	cwd: process.cwd(),
	agentDir: NO_AUTH_FILE.replace(/[^/\\]+$/, "no-such-agent-dir"),
	noExtensions: true,
	noSkills: true,
	noPromptTemplates: true,
	noThemes: true,
	noContextFiles: true,
	systemPrompt: "你是一个只做回显的测试助手。",
});
await resourceLoader.reload();

// ---------------------------------------------------------------------------
// [4] 建会话
// ---------------------------------------------------------------------------
console.log("=== [4] createAgentSession ===");
const { session } = await createAgentSession({
	model, // 注意：model 是对象，不是 "provider/model" 字符串
	thinkingLevel: "off",
	modelRuntime,
	resourceLoader,
	noTools: "builtin", // 关掉 read/bash/edit/write，保留自定义工具
	customTools: [echoTool],
	sessionManager: SessionManager.inMemory(),
});
console.log("session.model:", `${session.model.provider}/${session.model.id}`);
console.log("session.getActiveToolNames():", JSON.stringify(session.getActiveToolNames()));
console.log("session.systemPrompt:", JSON.stringify(session.systemPrompt));

// ---------------------------------------------------------------------------
// [5] 订阅事件 + 真的调一次模型（并强制它调工具）
// ---------------------------------------------------------------------------
console.log("=== [5] 真调一次模型（强制走 tool-calling）===");
const seen = [];
const unsubscribe = session.subscribe((event) => {
	seen.push(event.type);
	if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
		process.stdout.write(event.assistantMessageEvent.delta);
	}
});

const t0 = Date.now();
try {
	await session.prompt("请调用 echo 工具，把 text 参数设为「pong」，然后把工具结果原样告诉我。");
} catch (err) {
	console.error("prompt 抛错:", err);
	process.exitCode = 1;
} finally {
	unsubscribe();
}
console.log("");
console.log("耗时 ms:", Date.now() - t0);
console.log("事件类型（去重后按出现顺序）:", JSON.stringify([...new Set(seen)]));
console.log("事件总条数:", seen.length);
console.log("session.getLastAssistantText():", JSON.stringify(session.getLastAssistantText()));
console.log(
	"消息摘要:",
	JSON.stringify(
		session.messages.map((m) => ({ role: m.role, content: JSON.stringify(m.content).slice(0, 220) })),
		null,
		1,
	),
);
session.dispose();
console.log("=== [5] 完成 ===");
