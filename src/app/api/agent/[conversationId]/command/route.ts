/**
 * `POST /api/agent/[conversationId]/command` —— 提交一条命令。
 *
 * 请求体：`{ id, type, message }`
 * 响应：`{ id, type: "response", success: true }`
 *
 * ## 命令类型
 *
 * | type | 含义 |
 * | ---- | ---- |
 * | `prompt` | 说一句话（默认）。当前没有轮次在跑 ⇒ 立刻开始跑；在跑 ⇒ 排队（不打断） |
 * | `prompt-followup` | 明确排队：当前轮干完活再处理这句 |
 * | `prompt-steer` | 打断：插到当前助手轮次（及其工具调用）之后 |
 *
 * ⚠️ **响应里的 `success: true` 的含义是「已受理并排队」**，不是「这一轮已经跑完」。
 * 这一轮的结果走 SSE（`/events`）：`message_start` → `text_delta`* → `tool_call` →
 * `tool_result` → `message_end` → `agent_settled`。
 *
 * 鉴权：必须带 `Authorization: Bearer <token>`；token 会被透传给 AiAdmin
 * （工具要在 AiAdmin 上真的建出东西，缺了它就没法干活）。
 */

import { agentRuntime } from "../../../../../agent/runtime.ts";
import { extractBearerToken } from "../../../../../http/auth.ts";
import { errorResponse } from "../../../../../http/errors.ts";
import { errorEnvelope, okEnvelope, preflightResponse } from "../../../../../http/respond.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 缺 token 的统一说法。 */
const MISSING_TOKEN = "缺少 Authorization: Bearer <token>（token 由调用方提供，本服务只做透传）";

/** 支持的命令类型。 */
const SUPPORTED_COMMAND_TYPES = ["prompt", "prompt-followup", "prompt-steer"] as const;

/** 命令类型。 */
type CommandType = (typeof SUPPORTED_COMMAND_TYPES)[number];

/** CORS 预检。 */
export async function OPTIONS(request: Request): Promise<Response> {
	return preflightResponse(request);
}

/** 提交命令。 */
export async function POST(
	request: Request,
	{ params }: { params: Promise<{ conversationId: string }> },
): Promise<Response> {
	const token = extractBearerToken(request.headers.get("authorization") ?? undefined);
	if (token === undefined) {
		return errorEnvelope(request, 401, MISSING_TOKEN, 401);
	}
	const { conversationId } = await params;

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return errorEnvelope(request, 400, "请求体不是合法的 JSON", 400);
	}
	if (typeof body !== "object" || body === null) {
		return errorEnvelope(request, 400, "请求体必须是对象", 400);
	}
	const record = body as Record<string, unknown>;
	const id = typeof record["id"] === "string" ? record["id"] : "";
	const type = typeof record["type"] === "string" ? record["type"] : "";
	const message = typeof record["message"] === "string" ? record["message"] : "";
	// ⚠️ **上下文**（当前讨论的是哪条任务）: 可选。
	//    解析与校验在 `agent/context.ts` 里做 ⇒ 这里只负责**原样带过去**。
	const context = record["context"];

	if (id.length === 0) {
		return errorEnvelope(request, 400, "命令 id 不能为空", 400);
	}
	if (type.length === 0) {
		return errorEnvelope(request, 400, "命令类型不能为空", 400);
	}
	if (!(SUPPORTED_COMMAND_TYPES as readonly string[]).includes(type)) {
		return errorEnvelope(
			request,
			400,
			`暂不支持的命令类型「${type}」（支持：${SUPPORTED_COMMAND_TYPES.join(" / ")}）`,
			400,
		);
	}
	if (message.trim().length === 0) {
		return errorEnvelope(request, 400, "消息不能为空", 400);
	}

	try {
		// AiAdmin 是权威：它认这个 token，我们才知道「这是谁」
		const user = await agentRuntime.resolveCurrentUser(token);
		const ack = await agentRuntime.submitCommand({
			conversationId,
			token,
			message,
			commandId: id,
			userId: String(user.id),
			type: type as CommandType,
			context,
		});
		return okEnvelope(request, ack);
	} catch (error) {
		return errorResponse(request, error);
	}
}
