#!/usr/bin/env node
/**
 * 尖峰 ① 附：把两个「看起来显然、其实要量」的点矩阵化。
 *
 * A. 鉴权：只给环境变量 MINIMAX_CN_API_KEY，ModelRuntime 认不认？
 * B. 工具激活：想让「只有我们那一个自定义工具、没有内置工具」，
 *    到底该传 tools: [] / tools: ["echo"] / noTools: "all" / noTools: "builtin"？
 *
 * 跑法：node --env-file=.env spike/scripts/01b-probe-matrix.mjs
 */

import {
	createAgentSession,
	DefaultResourceLoader,
	defineTool,
	ModelRuntime,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const PROVIDER = "minimax-cn";
const MODEL_ID = "MiniMax-M3.1-Flash";

const echoTool = defineTool({
	name: "echo",
	label: "Echo",
	description: "回显参数",
	parameters: Type.Object({ text: Type.String() }),
	execute: async (_id, params) => ({ content: [{ type: "text", text: `echo: ${params.text}` }], details: {} }),
});

// ---------------------------------------------------------------------------
// A. 鉴权矩阵
// ---------------------------------------------------------------------------
console.log("=== A. 鉴权：只有环境变量 MINIMAX_CN_API_KEY ===");
const runtimeEnvOnly = await ModelRuntime.create({
	authPath: "D:/project/ai-admin-ai/spike/scripts/no-such-auth.json",
});
console.log("A1 hasConfiguredAuth (仅 env):", runtimeEnvOnly.hasConfiguredAuth(PROVIDER));
console.log("A2 getProviderAuthStatus:", JSON.stringify(runtimeEnvOnly.getProviderAuthStatus(PROVIDER)));
const authEnvOnly = await runtimeEnvOnly.getAuth(PROVIDER);
console.log("A3 getAuth 结果:", authEnvOnly ? `type=${authEnvOnly.type} 有 key=${Boolean(authEnvOnly.auth?.key)}` : "undefined");

// 真调一次模型：如果 env 变量够用，这里就能出文本。
const modelEnvOnly = runtimeEnvOnly.getModel(PROVIDER, MODEL_ID);
const { session: sEnv } = await createAgentSession({
	model: modelEnvOnly,
	thinkingLevel: "off",
	modelRuntime: runtimeEnvOnly,
	tools: [],
	customTools: [echoTool],
	sessionManager: SessionManager.inMemory(),
});
try {
	await sEnv.prompt("回一句 pong");
	console.log("A4 仅 env 调模型成功，回复:", JSON.stringify(sEnv.getLastAssistantText()));
} catch (err) {
	console.log("A4 仅 env 调模型失败:", err?.constructor?.name, "-", String(err?.message ?? err).slice(0, 300));
} finally {
	sEnv.dispose();
}

// ---------------------------------------------------------------------------
// B. 工具激活矩阵（不调模型，只看 getActiveToolNames）
// ---------------------------------------------------------------------------
console.log("");
console.log("=== B. 工具激活矩阵 ===");

const resourceLoader = new DefaultResourceLoader({
	cwd: process.cwd(),
	agentDir: "D:/project/ai-admin-ai/spike/scripts/no-such-agent-dir",
	noExtensions: true,
	noSkills: true,
	noPromptTemplates: true,
	noThemes: true,
	noContextFiles: true,
});
await resourceLoader.reload();

const runtime = await ModelRuntime.create({
	authPath: "D:/project/ai-admin-ai/spike/scripts/no-such-auth.json",
});
await runtime.setRuntimeApiKey(PROVIDER, process.env.MINIMAX_CN_API_KEY);
const model = runtime.getModel(PROVIDER, MODEL_ID);

async function probe(label, options) {
	try {
		const { session } = await createAgentSession({
			model,
			thinkingLevel: "off",
			modelRuntime: runtime,
			resourceLoader,
			sessionManager: SessionManager.inMemory(),
			...options,
		});
		console.log(`${label.padEnd(52)} -> ${JSON.stringify(session.getActiveToolNames())}`);
		session.dispose();
	} catch (err) {
		console.log(`${label.padEnd(52)} -> 抛错: ${String(err?.message ?? err).slice(0, 200)}`);
	}
}

await probe("tools: [] + customTools", { tools: [], customTools: [echoTool] });
await probe("tools: ['echo'] + customTools", { tools: ["echo"], customTools: [echoTool] });
await probe("noTools: 'all' + customTools", { noTools: "all", customTools: [echoTool] });
await probe("noTools: 'builtin' + customTools", { noTools: "builtin", customTools: [echoTool] });
await probe("(不给 tools) + customTools", { customTools: [echoTool] });
await probe("tools: [] + 无 customTools", { tools: [] });

// 走扩展工厂注册（pi.registerTool）的路子
const extFactory = (pi) => {
	pi.registerTool(echoTool);
};
const extLoader = new DefaultResourceLoader({
	cwd: process.cwd(),
	agentDir: "D:/project/ai-admin-ai/spike/scripts/no-such-agent-dir",
	noExtensions: true,
	noSkills: true,
	noPromptTemplates: true,
	noThemes: true,
	noContextFiles: true,
	extensionFactories: [extFactory],
});
await extLoader.reload();

async function probeExt(label, options) {
	try {
		const { session } = await createAgentSession({
			model,
			thinkingLevel: "off",
			modelRuntime: runtime,
			resourceLoader: extLoader,
			sessionManager: SessionManager.inMemory(),
			...options,
		});
		console.log(`${label.padEnd(52)} -> ${JSON.stringify(session.getActiveToolNames())}`);
		session.dispose();
	} catch (err) {
		console.log(`${label.padEnd(52)} -> 抛错: ${String(err?.message ?? err).slice(0, 200)}`);
	}
}

await probeExt("扩展工厂 registerTool + tools: []", { tools: [] });
await probeExt("扩展工厂 registerTool + tools: ['echo']", { tools: ["echo"] });
await probeExt("扩展工厂 registerTool + noTools: 'all'", { noTools: "all" });
await probeExt("扩展工厂 registerTool + noTools: 'builtin'", { noTools: "builtin" });
await probeExt("扩展工厂 registerTool + (不给 tools)", {});
