/**
 * 会话历史 → **pi 的 session entries**。
 *
 * ## 为什么需要这个模块
 *
 * pi 的 SDK 文档说得很直白：
 *
 * > **SessionManager is authoritative for finalized model context.**
 * > Restore external history by constructing the session with a manager containing those entries.
 * > Assigning `session.agent.state.messages` **does not** replace persisted context.
 *
 * 我们把对话历史存在自己的 `ai_message` 表里（`store.ts`），而 pi 会话是
 * **懒创建 + 内存态**（`SessionManager.inMemory()`，进程重启就没了；
 * 通道空闲 30 分钟也会被回收，见 `session-registry.ts`）。
 *
 * ⇒ 后果：**会话重建后，模型不记得之前聊过什么** ——
 * 而前端看得到历史（快照来自 DB），用户只会觉得「AI 明明看得到，却像第一次见我」。
 *
 * ⇒ 修法：**建 pi 会话时把 DB 里的历史还原成 pi 的 entries**，
 * 交给 `SessionManager.inMemory(cwd, { id }, entries)`。
 * 这正是 SDK 文档说的「constructing the session with a manager containing those entries」。
 *
 * ## 为什么不是 `session.agent.state.messages = ...`
 *
 * 那条路**不生效**（SDK 文档明说：不会替换已持久化的上下文）。
 * 上下文只有一条权威来源：**SessionManager**。
 *
 * ## 还原的是「对话」，不是「事件」
 *
 * 落库的只有**用户说的话**与**助手的回答**（工具结果不进 `ai_message`，
 * 见 `runtime.ts` 的 `#handleEvent`）。所以还原出来的上下文也只包含这两类。
 *
 * ⚠️ 这意味着模型看不到「上一次它调了哪个工具、工具返回了什么」。
 * 代价是：模型可能重复问已经问过的事。
 * 好过另一种代价（上下文整个没了）。
 */

import type {
	FileEntry,
	SessionHeader,
	SessionMessageEntry,
} from "@earendil-works/pi-coding-agent";
import type { MessageRecord } from "./store.ts";

/** 造 entries 需要的参数。 */
export interface BuildSessionEntriesOptions {
	/** 会话 id（同时用作 pi 的 session id）。 */
	conversationId: string;
	/** 工作目录（pi 用它做项目资源发现；本服务不读项目文件，但要如实填）。 */
	cwd: string;
	/** 历史消息（按 seq 升序）。 */
	history: MessageRecord[];
	/** 模型标识（形如 `minimax-cn/MiniMax-M3.1-Flash`）。 */
	model?: string;
}

/** 空的 usage（还原出来的助手消息没有用量数据 —— 我们不存 token 统计）。 */
function emptyUsage(): {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	totalTokens: number;
	cost: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		total: number;
	};
} {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

/** 从 `provider/model` 里拆出 provider（拆不开就整串当 provider）。 */
function providerOf(model: string | undefined): string {
	if (model === undefined || model.length === 0) {
		return "unknown";
	}
	const separator = model.indexOf("/");
	return separator > 0 ? model.slice(0, separator) : model;
}

/** 从 `provider/model` 里拆出模型名（拆不开就用整串）。 */
function modelNameOf(model: string | undefined): string {
	if (model === undefined || model.length === 0) {
		return "unknown";
	}
	const separator = model.indexOf("/");
	return separator > 0 && separator < model.length - 1
		? model.slice(separator + 1)
		: model;
}

/**
 * 把历史消息还原成 pi 的 session entries。
 *
 * @param options 会话 id / 工作目录 / 历史 / 模型标识。
 * @returns 一个 `FileEntry[]`：第一个是 session 头，后面每条消息一个 entry。
 */
export function buildSessionEntries(
	options: BuildSessionEntriesOptions,
): FileEntry[] {
	const header: SessionHeader = {
		type: "session",
		id: options.conversationId,
		cwd: options.cwd,
		timestamp: new Date().toISOString(),
	};

	const entries: FileEntry[] = [header];
	const provider = providerOf(options.model);
	const model = modelNameOf(options.model);

	// entry 是**树**（parentId 指向前一个）⇒ 用链式 parentId 串起来。
	let parentId: string | null = null;

	for (const row of options.history) {
		// ⚠️ SYSTEM 消息不进上下文：系统提示词是另外给的（`systemPrompt`），
		//    把它当对话塞进去会让模型看到「自己说过的话」，prompt 会被污染。
		if (row.role === "SYSTEM") {
			continue;
		}

		const timestamp =
			row.createdAt instanceof Date ? row.createdAt.getTime() : Date.now();

		const message: SessionMessageEntry["message"] =
			row.role === "USER"
				? { role: "user", content: row.content, timestamp }
				: {
						role: "assistant",
						content: [{ type: "text", text: row.content }],
						api: "",
						provider,
						model,
						usage: emptyUsage(),
						stopReason: "stop",
						timestamp,
					};

		const entry: SessionMessageEntry = {
			type: "message",
			// id 必须唯一且稳定（同一段历史两次还原出来的 id 要一样 ⇒ 重启不串味）
			id: `m-${row.id}`,
			parentId,
			timestamp: new Date(timestamp).toISOString(),
			message,
		};
		parentId = entry.id;
		entries.push(entry);
	}

	return entries;
}
