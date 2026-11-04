#!/usr/bin/env node
/**
 * 尖峰 ① 附二：两个后面任务一定会撞上的点，先量掉。
 *
 * C. ctx.hasUI / ctx.ui —— Route Handler 里没有 TUI，待确认（extension_ui 桥）还能不能用？
 * D. session.prompt() 在流式进行中再调一次会怎样？（AIPM 01 §4.2 的「启动锁」）
 *
 * 跑法：node --env-file=.env spike/scripts/01c-probe-ctx-and-concurrency.mjs
 */
import { createAgentSession, DefaultResourceLoader, defineTool, ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const PROVIDER = "minimax-cn";
const MODEL_ID = "MiniMax-M3.1-Flash";

const modelRuntime = await ModelRuntime.create({ authPath: "D:/project/ai-admin-ai/spike/scripts/no-such-auth.json" });
const model = modelRuntime.getModel(PROVIDER, MODEL_ID);

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

let capturedCtx = null;
const probeTool = defineTool({
	name: "ctx_probe",
	label: "Ctx Probe",
	description: "把 ctx 的形态报回来",
	parameters: Type.Object({}),
	execute: async (_id, _params, _signal, _onUpdate, ctx) => {
		capturedCtx = ctx;
		return { content: [{ type: "text", text: "ok" }], details: {} };
	},
});

const { session } = await createAgentSession({
	model,
	thinkingLevel: "off",
	modelRuntime,
	resourceLoader,
	noTools: "builtin",
	customTools: [probeTool],
	sessionManager: SessionManager.inMemory(),
});

// --- C. ctx 的形态 -----------------------------------------------------------
console.log("=== C. tool execute 收到的 ctx ===");
await session.prompt("请调用 ctx_probe 工具。");
const ctx = capturedCtx;
console.log("ctx.hasUI      =", ctx?.hasUI);
console.log("ctx.mode       =", ctx?.mode);
console.log("ctx.ui 的方法  =", ctx?.ui ? Object.keys(ctx.ui).join(",") : "-");
console.log("ctx.ui 类型    =", ctx?.ui?.constructor?.name);
console.log("ctx.isProjectTrusted =", ctx?.isProjectTrusted);
console.log("结论：Route Handler 里没有 TUI，ctx.hasUI =", ctx?.hasUI);

// --- D. 流式中再 prompt ------------------------------------------------------
console.log("");
console.log("=== D. 流式进行中再调 prompt() ===");
const long = session;
await long.abort?.().catch?.(() => {});
const p1 = long.prompt("请写 200 字讲讲从前有座山。");
await new Promise((r) => setTimeout(r, 300));
try {
	await long.prompt("第二条");
	console.log("D: 第二次 prompt 被接受了");
} catch (error) {
	console.log("D: 第二次 prompt 抛错 ->", error?.constructor?.name, "-", String(error?.message ?? error).slice(0, 300));
}
await p1.catch(() => {});
session.dispose();
