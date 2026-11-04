/**
 * `GET/POST /api/agent/conversations` —— 会话列表 / 新建会话。
 *
 * - `POST` → `{ conversationId, title, createdAt }`
 * - `GET`  → `[{ conversationId, title, updatedAt }]`
 *
 * 鉴权：两��接口都要 `Authorization: Bearer <token>`；
 * token 交给 AiAdmin 判（本服务不解析它）—— 顺带就把「当前用户」问出来了。
 */

import { agentRuntime } from "../../../../agent/runtime";
import { extractBearerToken } from "../../../../http/auth";
import { errorResponse } from "../../../../http/errors";
import { errorEnvelope, okEnvelope, preflightResponse } from "../../../../http/respond";

// Route Handler 必须跑在 Node 运行时（pi SDK 依赖 node:fs / jiti / wasm）。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 缺 token 的统一说法（不泄露任何凭据信息）。 */
const MISSING_TOKEN = "缺少 Authorization: Bearer <token>（token 由调用方提供，本服务只做透传）";

/** CORS 预检。 */
export async function OPTIONS(request: Request): Promise<Response> {
	return preflightResponse(request);
}

/** 新建会话。 */
export async function POST(request: Request): Promise<Response> {
	const token = extractBearerToken(request);
	if (token === undefined) {
		return errorEnvelope(request, 401, MISSING_TOKEN, 401);
	}
	try {
		// AiAdmin 是权威：它认这个 token，我们才知道「这是谁」
		const user = await agentRuntime.resolveCurrentUser(token);
		let title: string | undefined;
		try {
			const body: unknown = await request.json();
			if (typeof body === "object" && body !== null) {
				const raw = (body as Record<string, unknown>)["title"];
				if (typeof raw === "string" && raw.trim().length > 0) {
					title = raw.trim();
				}
			}
		} catch {
			// 没有请求体也行（标题后面再补）
		}
		const conversation = await agentRuntime.createConversation(String(user.id), title);
		return okEnvelope(request, {
			conversationId: conversation.conversationId,
			title: conversation.title,
			createdAt: conversation.createdAt.toISOString(),
		});
	} catch (error) {
		return errorResponse(request, error);
	}
}

/** 列会话（当前用户的，最近更新的在前）。 */
export async function GET(request: Request): Promise<Response> {
	const token = extractBearerToken(request);
	if (token === undefined) {
		return errorEnvelope(request, 401, MISSING_TOKEN, 401);
	}
	try {
		const user = await agentRuntime.resolveCurrentUser(token);
		const conversations = await agentRuntime.listConversations(String(user.id));
		return okEnvelope(
			request,
			conversations.map((conversation) => ({
				conversationId: conversation.conversationId,
				title: conversation.title,
				updatedAt: conversation.updatedAt.toISOString(),
			})),
		);
	} catch (error) {
		return errorResponse(request, error);
	}
}
