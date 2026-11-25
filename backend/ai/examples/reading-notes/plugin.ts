/**
 * 「读书笔记」插件 —— **示例系统的业务能力**（内核里一个业务词都没有）。
 *
 * ## 这是「换个业务系统照样能用」的证据
 *
 * 整个插件**只从 `core/index.ts`（内核的公开入口）import**：
 * 插件契约（`AiPlugin`）、命令契约（**MCP 工具形状**：`McpToolDefinition`）、
 * 身份契约（`CachedCurrentUserResolver`）、错误（`AgentError`）。
 *
 * ⚠️ **不许 import 内核内部路径**（`core/session/...` 之类）⇒
 *    `scripts/check-core-reuse.cjs` 会把这条钉死（进 CI）。
 *
 * ## 两条命令
 *
 * | 命令 | 干什么 |
 * | ---- | ------ |
 * | `add_note` | 记一条读书笔记 |
 * | `list_notes` | 列已有的读书笔记 |
 *
 * ## 身份：示例系统自己认 token
 *
 * 内核不解析 token（那是**权威系统**的事）⇒ 这里演示「自己的身份系统」：
 * `demo-` 开头的 token ⇒ 读者 1；其它 ⇒ 401。
 */

import {
	AgentError,
	CachedCurrentUserResolver,
	type AiPlugin,
	type JsonSchema,
	type McpToolContext,
	type McpToolDefinition,
} from "../../src/core/index.ts";
import { addNote, listNotes } from "./store.ts";

/** 插件 id（智能体配置里 `plugin:` 写它）。 */
export const NOTES_PLUGIN_ID = "notes";

/** `add_note` 的工具名。 */
export const ADD_NOTE_TOOL_NAME = "add_note";

/** `list_notes` 的工具名。 */
export const LIST_NOTES_TOOL_NAME = "list_notes";

/** `add_note` 的参数（**JSON Schema** —— MCP 的形状）。 */
export const AddNoteInputSchema: JsonSchema = {
	type: "object",
	properties: {
		title: {
			type: "string",
			description: "书名（必填）。例如「活着」。",
		},
		author: {
			type: "string",
			description: "作者（可省）。例如「余华」。",
		},
		thought: {
			type: "string",
			description: "读后感或摘录（可省）。",
		},
	},
	required: ["title"],
};

/** `add_note` 的参数类型。 */
export interface AddNoteParams {
	title?: string;
	author?: string;
	thought?: string;
}

/** `add_note` 的工具结果细节。 */
export interface AddNoteDetails {
	/** 一句话结论。 */
	summary: string;
	/** 成功与否。 */
	ok: boolean;
	/** 记好的那条笔记。 */
	note?: unknown;
	/** 失败时的错误种类。 */
	errorKind?: string;
}

/** `list_notes` 的工具结果细节。 */
export interface ListNotesDetails {
	/** 一句话结论。 */
	summary: string;
	/** 成功与否。 */
	ok: boolean;
	/** 笔记条数。 */
	count?: number;
	/** 失败时的错误种类。 */
	errorKind?: string;
}

/** `add_note` 的描述 —— **模型全靠这段话决定用不用这个工具**。 */
export const ADD_NOTE_DESCRIPTION = `记一条**读书笔记**（命令名 add_note）。

【什么时候用这个工具】
- 用户说「记一下」「记条笔记」「帮我记下这本书」；
- 用户提到某本书并希望把它记下来。

【什么时候不要用这个工具】
- 用户只是想**问**已经记了哪些书 —— 那是 list_notes；
- 用户只是聊天、问书的内容 —— 不要顺手记笔记。

【参数】
- title（必填）：书名。
- author（可省）：作者。
- thought（可省）：读后感或摘录。

【注意】
- 一次只记一条；用户一次说多本时，逐条调用。
- 记错了可以再记一条覆盖不了旧的那条 —— 记之前先问清楚书名。`;

/** `list_notes` 的描述。 */
export const LIST_NOTES_DESCRIPTION = `列出**已经记下的读书笔记**（命令名 list_notes）。

【什么时候用这个工具】
- 用户问「我记了哪些书」「有哪些笔记」「列一下笔记」。

【什么时候不要用这个工具】
- 用户只是想记一条新的 —— 那是 add_note。

【参数】
- 无。`;

/** `list_notes` 的参数（**JSON Schema**）。 */
export const ListNotesInputSchema: JsonSchema = { type: "object", properties: {} };

/** 造一个失败结果（细节类型由调用方定）。 */
function failure<T extends { summary: string; ok: boolean; errorKind?: string }>(
	message: string,
	errorKind?: string,
): { content: { type: "text"; text: string }[]; details: T; isError: true } {
	return {
		content: [{ type: "text", text: message }],
		// ⚠️ 失败结果只有「结论 + 错误种类」⇒ 这里断言成调用方的细节类型
		details: {
			summary: message,
			ok: false,
			...(errorKind === undefined ? {} : { errorKind }),
		} as T,
		isError: true,
	};
}

/** 造 `add_note` 工具。 */
export function createAddNoteTool(): McpToolDefinition<AddNoteDetails> {
	return {
		name: ADD_NOTE_TOOL_NAME,
		label: "记一条读书笔记",
		description: ADD_NOTE_DESCRIPTION,
		inputSchema: AddNoteInputSchema,
		annotations: {
			// 只新建、不改已有数据 ⇒ 可补偿 ⇒ 不是破坏性操作（不需要先问人）。
			readOnlyHint: false,
			destructiveHint: false,
			idempotentHint: false,
		},
		execute: async (rawArgs, context: McpToolContext) => {
			const params = rawArgs as AddNoteParams;
			const token = context.currentToken();
			if (token === undefined || token.length === 0) {
				return failure("拿不到调用方的登录凭证，没法记笔记");
			}
			const title = (params.title ?? "").trim();
			if (title.length === 0) {
				return failure("title 不能为空", "VALIDATION");
			}
			const author = params.author?.trim();
			const thought = params.thought?.trim();

			const note = addNote({
				title,
				...(author === undefined || author.length === 0 ? {} : { author }),
				...(thought === undefined || thought.length === 0 ? {} : { thought }),
			});

			// ⚠️ **写审计**：内核给了去处（`context.audit`）⇒ 谁记的、什么时候记的都留痕。
			//    失败只记日志，不把已经记好的笔记弄丢。
			try {
				const userId = await context.currentUserId(token);
				await context.audit.write({
					actorType: "AI",
					command: ADD_NOTE_TOOL_NAME,
					args: { title, author, thought },
					before: null,
					after: note,
					userId: String(userId),
					model: context.model,
				});
			} catch (error) {
				console.error("[audit] 写审计失败（笔记已记下，不要重试）", error);
			}

			const summary = `已记下《${note.title}》${note.author === undefined ? "" : `（${note.author}）`}`;
			return {
				content: [{ type: "text", text: summary }],
				details: { summary, ok: true, note },
			};
		},
	};
}

/** 造 `list_notes` 工具。 */
export function createListNotesTool(): McpToolDefinition<ListNotesDetails> {
	return {
		name: LIST_NOTES_TOOL_NAME,
		label: "列读书笔记",
		description: LIST_NOTES_DESCRIPTION,
		inputSchema: ListNotesInputSchema,
		annotations: {
			readOnlyHint: true,
			destructiveHint: false,
			idempotentHint: true,
		},
		execute: async () => {
			const notes = listNotes();
			const summary =
				notes.length === 0
					? "还没有记过任何笔记"
					: `已记 ${notes.length} 条：` +
						notes.map((note) => `《${note.title}》`).join("、");
			return {
				content: [{ type: "text", text: summary }],
				details: { summary, ok: true, count: notes.length },
			};
		},
	};
}

/** 示例系统的命令目录。 */
export function createNotesCommands(): readonly McpToolDefinition[] {
	return [createAddNoteTool(), createListNotesTool()];
}

/**
 * 示例系统的身份解析器 —— **自己认自己的 token**。
 *
 * ⚠️ `demo-` 开头的 token ⇒ 读者 1；其它 ⇒ 抛 `AgentError("AUTH_EXPIRED")`
 *    ⇒ 内核的路由把它翻成 **401**（不用改内核）。
 */
export class DemoCurrentUserResolver {
	async resolve(token: string): Promise<{ id: number; username: string; name: string }> {
		if (!token.startsWith("demo-")) {
			throw new AgentError("AUTH_EXPIRED", "令牌无效");
		}
		return { id: 1, username: "reader", name: "示例读者" };
	}
}

/** 造「读书笔记」插件。 */
export function createNotesPlugin(): AiPlugin {
	return {
		id: NOTES_PLUGIN_ID,
		label: "读书笔记插件",
		commands: createNotesCommands(),
		// ⚠️ 内核只认「怎么问当前用户」这个契约 ⇒ 实现归业务系统。
		currentUser: new CachedCurrentUserResolver(new DemoCurrentUserResolver()),
		// ⚠️ 这个示例**没有上游系统** ⇒ 不给 health 探针（内核探自己的库与模型就够了）。
	};
}
