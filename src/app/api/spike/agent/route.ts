import { NextResponse } from "next/server";
import { join } from "node:path";
import {
	createAgentSession,
	DefaultResourceLoader,
	defineTool,
	ModelRuntime,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

// Route Handler 必须跑在 Node 运行时（pi SDK 依赖 node:fs / jiti / wasm）。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROVIDER = "minimax-cn";
const MODEL_ID = "MiniMax-M3.1-Flash";

/** 唯一的自定义工具：把参数原样回显。 */
const echoTool = defineTool({
	name: "echo",
	label: "Echo",
	description: "把收到的 text 参数原样回显。用于验证 tool-calling 链路。",
	parameters: Type.Object({
		text: Type.String({ description: "要回显的文本" }),
	}),
	// 实测签名：execute(toolCallId, params, signal, onUpdate, ctx)
	execute: async (toolCallId, params, signal, onUpdate, ctx) => {
		console.log("[spike:agent] tool execute", {
			toolCallId,
			params,
			hasSignal: signal !== undefined,
			onUpdateType: typeof onUpdate,
			ctxKeys: ctx ? Object.keys(ctx) : [],
		});
		return {
			content: [{ type: "text", text: `echo: ${params.text}` }],
			details: { echoed: params },
		};
	},
});

export async function GET(request: Request) {
	const url = new URL(request.url);
	const prompt = url.searchParams.get("prompt") ?? "请调用 echo 工具，把 text 参数设为「pong」，然后把工具结果原样告诉我。";

	try {
		// authPath 指向一个不存在的文件：证明只靠环境变量 MINIMAX_CN_API_KEY 就能鉴权。
		const modelRuntime = await ModelRuntime.create({
			authPath: join(process.cwd(), "spike", ".spike-auth.json"),
		});
		const authStatus = modelRuntime.getProviderAuthStatus(PROVIDER);
		const model = modelRuntime.getModel(PROVIDER, MODEL_ID);
		if (!model) {
			return NextResponse.json({ ok: false, error: `找不到模型 ${PROVIDER}/${MODEL_ID}` }, { status: 500 });
		}

		const resourceLoader = new DefaultResourceLoader({
			cwd: process.cwd(),
			agentDir: join(process.cwd(), "spike", ".spike-agent-dir"),
			noExtensions: true,
			noSkills: true,
			noPromptTemplates: true,
			noThemes: true,
			noContextFiles: true,
			systemPrompt: "你是一个只做回显的测试助手。",
		});
		await resourceLoader.reload();

		const { session } = await createAgentSession({
			model, // model 是对象，不是 "provider/model" 字符串
			thinkingLevel: "off",
			modelRuntime,
			resourceLoader,
			noTools: "builtin", // 关掉 read/bash/edit/write；tools: [] 会连自定义工具一起关掉
			customTools: [echoTool],
			sessionManager: SessionManager.inMemory(),
		});

		const events: string[] = [];
		const unsubscribe = session.subscribe((event) => {
			events.push(event.type);
		});

		const startedAt = Date.now();
		let text: string | undefined;
		try {
			await session.prompt(prompt);
			text = session.getLastAssistantText();
		} finally {
			unsubscribe();
			session.dispose();
		}

		return NextResponse.json({
			ok: true,
			prompt,
			text,
			latencyMs: Date.now() - startedAt,
			authStatus,
			model: `${model.provider}/${model.id}`,
			events: [...new Set(events)],
		});
	} catch (error) {
		return NextResponse.json(
			{ ok: false, error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) },
			{ status: 500 },
		);
	}
}
