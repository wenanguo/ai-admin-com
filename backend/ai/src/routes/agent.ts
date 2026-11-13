/**
 * 会话与命令相关的端点（挂在 `/api/agent` 下）。
 *
 * | 方法 | 路径 | 作用 |
 * |---|---|---|
 * | GET | `/conversations` | 会话列表 |
 * | GET | `/skills` | 可用技能清单（`.pi/skills` 下的 SKILL.md）|
 * | POST | `/conversations` | 新建会话 |
 * | POST | `/pending/:id/approve` | 批准一条待确认 |
 * | POST | `/pending/:id/reject` | 拒绝一条待确认 |
 * | POST | `/:conversationId/command` | 发一条命令 |
 * | GET | `/:conversationId/state` | 读会话快照 |
 * | POST | `/:conversationId/abort` | 中止当前生成 |
 * | GET | `/:conversationId/events` | SSE 事件流（见 `events.ts`） |
 *
 * ⚠️ **注册顺序敏感**：具体的路径必须先于 `/:conversationId/*`。
 */

import { join } from "node:path";
import { Router } from "express";
import { agentRuntime } from "../agent/runtime.ts";
import { listSkillSummaries } from "../agent/skill-catalog.ts";
import { pendingWaiters } from "../agent/pending-waiters.ts";
import { readJsonBody } from "../http/body.ts";
import { errorBody, okBody } from "../http/respond.ts";
import { resolvePendingAction } from "../pending-write.ts";
import { requireToken, sendError } from "./support.ts";

/** 命令类型（与迁移前一字不差）。 */
const SUPPORTED_COMMAND_TYPES = ["prompt", "prompt-followup", "prompt-steer"] as const;

/** 命令类型。 */
type CommandType = (typeof SUPPORTED_COMMAND_TYPES)[number];

/** 技能目录（**cwd 相对** —— 与 pi-session.ts 的发现逻辑一致）。 */
function skillsDir(): string {
	return join(process.cwd(), ".pi", "skills");
}

/** 会话与命令的路由。 */
export const agentRouter = Router();

/* ------------------------------------------------------------ 技能 */

/**
 * 可用技能清单。
 *
 * ⚠️ **要 token**：这是 AI 能力的一部分 ⇒ 只给登录用户看。
 * ⚠️ **读真文件**（不缓存）⇒ 改完 SKILL.md 重启就能看到新说明。
 */
agentRouter.get("/skills", async (req, res) => {
	const token = requireToken(req, res);
	if (token === undefined) {
		return;
	}
	try {
		// ⚠️ **身份要验**（与 /conversations 等端点一致）：token 认不出用户 ⇒ 401。
		//    技能清单本身不敏感，但口径要统一（别开一个「随便传个 token 就能用」的口子）。
		await agentRuntime.resolveCurrentUser(token);
		res.json(okBody(listSkillSummaries(skillsDir())));
	} catch (error) {
		sendError(res, error);
	}
});

/* ------------------------------------------------------------ 会话 */

/** 列会话（当前用户的，最近更新的在前）。 */
agentRouter.get("/conversations", async (req, res) => {
	const token = requireToken(req, res);
	if (token === undefined) {
		return;
	}
	try {
		// AiAdmin 是权威：它认这个 token，我们才知道「这是谁」
		const user = await agentRuntime.resolveCurrentUser(token);
		const conversations = await agentRuntime.listConversations(String(user.id));
		res.json(
			okBody(
				conversations.map((conversation) => ({
					conversationId: conversation.conversationId,
					title: conversation.title,
					updatedAt: conversation.updatedAt.toISOString(),
				})),
			),
		);
	} catch (error) {
		sendError(res, error);
	}
});

/** 新建会话。 */
agentRouter.post("/conversations", async (req, res) => {
	const token = requireToken(req, res);
	if (token === undefined) {
		return;
	}
	try {
		const user = await agentRuntime.resolveCurrentUser(token);
		// 没有请求体也行（标题后面再补）⇒ 解析失败**不报错**
		let title: string | undefined;
		const parsed = await readJsonBody(req);
		if (parsed.ok && typeof parsed.value === "object" && parsed.value !== null) {
			const raw = (parsed.value as Record<string, unknown>)["title"];
			if (typeof raw === "string" && raw.trim().length > 0) {
				title = raw.trim();
			}
		}
		const conversation = await agentRuntime.createConversation(String(user.id), title);
		res.json(
			okBody({
				conversationId: conversation.conversationId,
				title: conversation.title,
				createdAt: conversation.createdAt.toISOString(),
			}),
		);
	} catch (error) {
		sendError(res, error);
	}
});

/* ------------------------------------------------------------ 待确认 */

/** 批准。 */
agentRouter.post("/pending/:id/approve", async (req, res) => {
	const token = requireToken(req, res);
	if (token === undefined) {
		return;
	}
	const id = req.params.id;
	try {
		const user = await agentRuntime.resolveCurrentUser(token);
		const resolved = await resolvePendingAction(id, "CONFIRMED", String(user.id));
		if (!resolved) {
			// 已经落定过（重复点）或压根不存在 ⇒ 不能重复执行
			res.status(409).json(errorBody(409, "这条待确认已经处理过了（或不存在）"));
			return;
		}
		// 唤醒 hook ⇒ 放行原工具调用
		pendingWaiters.decide(id, "approved");
		res.json(okBody({ id, status: "CONFIRMED" }));
	} catch (error) {
		sendError(res, error);
	}
});

/** 拒绝。 */
agentRouter.post("/pending/:id/reject", async (req, res) => {
	const token = requireToken(req, res);
	if (token === undefined) {
		return;
	}
	const id = req.params.id;
	try {
		const user = await agentRuntime.resolveCurrentUser(token);
		const resolved = await resolvePendingAction(id, "REJECTED", String(user.id));
		if (!resolved) {
			res.status(409).json(errorBody(409, "这条待确认已经处理过了（或不存在）"));
			return;
		}
		// 唤醒 hook ⇒ 它会 block ⇒ 模型知道这次没做成
		pendingWaiters.decide(id, "rejected");
		res.json(okBody({ id, status: "REJECTED" }));
	} catch (error) {
		sendError(res, error);
	}
});

/* ------------------------------------------------------------ 命令 */

/** 提交命令。 */
agentRouter.post("/:conversationId/command", async (req, res) => {
	const token = requireToken(req, res);
	if (token === undefined) {
		return;
	}
	const conversationId = req.params.conversationId;

	const parsed = await readJsonBody(req);
	if (!parsed.ok) {
		res.status(400).json(errorBody(400, "请求体不是合法的 JSON"));
		return;
	}
	const body = parsed.value;
	if (typeof body !== "object" || body === null) {
		res.status(400).json(errorBody(400, "请求体必须是对象"));
		return;
	}
	const record = body as Record<string, unknown>;
	const id = typeof record["id"] === "string" ? record["id"] : "";
	const type = typeof record["type"] === "string" ? record["type"] : "";
	const message = typeof record["message"] === "string" ? record["message"] : "";
	// ⚠️ **上下文**（当前讨论的是哪条任务）: 可选。
	//    解析与校验在 `agent/context.ts` 里做 ⇒ 这里只负责**原样带过去**。
	const context = record["context"];

	if (id.length === 0) {
		res.status(400).json(errorBody(400, "命令 id 不能为空"));
		return;
	}
	if (type.length === 0) {
		res.status(400).json(errorBody(400, "命令类型不能为空"));
		return;
	}
	if (!(SUPPORTED_COMMAND_TYPES as readonly string[]).includes(type)) {
		res.status(400).json(
			errorBody(
				400,
				`暂不支持的命令类型「${type}」（支持：${SUPPORTED_COMMAND_TYPES.join(" / ")}）`,
			),
		);
		return;
	}
	if (message.trim().length === 0) {
		res.status(400).json(errorBody(400, "消息不能为空"));
		return;
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
		res.json(okBody(ack));
	} catch (error) {
		sendError(res, error);
	}
});

/* ------------------------------------------------------------ 快照与中止 */

/** 会话快照。 */
agentRouter.get("/:conversationId/state", async (req, res) => {
	const token = requireToken(req, res);
	if (token === undefined) {
		return;
	}
	const conversationId = req.params.conversationId;
	try {
		const user = await agentRuntime.resolveCurrentUser(token);
		const state = await agentRuntime.readState(conversationId, String(user.id));
		res.json(
			okBody({
				conversationId: state.conversationId,
				messages: state.messages.map((message) => ({
					id: message.id,
					role: message.role,
					content: message.content,
					seq: message.seq,
					createdAt: message.createdAt.toISOString(),
				})),
				isStreaming: state.isStreaming,
				model: state.model,
			}),
		);
	} catch (error) {
		sendError(res, error);
	}
});

/** 中止当前生成。 */
agentRouter.post("/:conversationId/abort", async (req, res) => {
	const token = requireToken(req, res);
	if (token === undefined) {
		return;
	}
	const conversationId = req.params.conversationId;
	try {
		const user = await agentRuntime.resolveCurrentUser(token);
		await agentRuntime.abort(conversationId, String(user.id));
		res.json(okBody({ conversationId, aborted: true }));
	} catch (error) {
		sendError(res, error);
	}
});
