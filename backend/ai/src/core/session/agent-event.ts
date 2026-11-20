/**
 * **我们自己的运行时事件词汇**（issue #123：拔掉 pi）。
 *
 * ## 为什么要有这个文件
 *
 * 以前运行时的事件类型是 pi SDK 的 `AgentSessionEvent` ⇒ 内核的每一层
 * （事件映射器 / 会话注册表 / 运行时 / dsh 适配层）都 import 了 pi 的类型
 * ⇒ **pi 一拔，整条链都要改**。
 *
 * ⇒ 现在**事件词汇是我们自己的**（这个文件）⇒
 * - **内核不依赖任何 SDK 的类型**（拔 pi 只改这一个文件 + 它的引用点）；
 * - dsh 适配层**把自己的事件翻译成我们的词汇**（见 `adapter/dsh/events.ts`）
 *   ⇒ 运行时只认这一套 ⇒ **对外契约（9 个端点 + SSE 事件）一字不改**。
 *
 * ## 词汇表
 *
 * | 事件 | 什么时候 |
 * | ---- | -------- |
 * | `agent_start` | 一轮开始（模型开始干活） |
 * | `message_start` | 助手的一条消息开始（**正文可能还没有**） |
 * | `message_update` | 增量（文本 / 思考） |
 * | `message_end` | 助手的一条消息结束（带完整正文） |
 * | `tool_execution_start` | 模型要调工具了 |
 * | `tool_execution_end` | 工具执行完了 |
 * | `agent_settled` | 一轮结束（模型闲置了） |
 *
 * ⚠️ **形状与 pi 的事件一一对应**（不是重写）⇒ 迁移只是换类型名。
 */

/** 助手消息里的一段内容（**我们只认文本**）。 */
export interface AgentContentPart {
	/** 段类型（`text` = 正文；其它类型我们不关心）。 */
	type: string;
	/** 正文。 */
	text?: string;
}

/** 一条消息（**运行时只读 `role` 与 `content`**）。 */
export interface AgentMessage {
	/** 谁说的。 */
	role: "user" | "assistant" | "tool" | "system";
	/** 内容（段数组）。 */
	content: AgentContentPart[] | unknown;
}

/** 助手的增量（**文本**或**思考**）。 */
export type AssistantMessageEvent =
	| { type: "text_delta"; delta: string }
	| { type: "thinking_delta"; delta: string };

/** 工具的执行结果（**形状是我们定的** ⇒ 宿主无关）。 */
export interface AgentToolResult {
	/** 回给模型的内容（文本段）。 */
	content: { type: "text"; text: string }[];
	/** 结构化详情（给界面 / 审计用）。 */
	details?: unknown;
	/** 这次执行是不是失败了。 */
	isError?: boolean;
}

/** 运行时的事件（**联合类型** ⇒ 穷举 switch 有类型保护）。 */
export type AgentEvent =
	| { type: "agent_start" }
	| { type: "agent_settled"; aborted?: boolean }
	| { type: "message_start"; message: AgentMessage }
	| {
			type: "message_update";
			message: AgentMessage;
			assistantMessageEvent: AssistantMessageEvent;
	  }
	| { type: "message_end"; message: AgentMessage }
	| {
			type: "tool_execution_start";
			toolCallId: string;
			toolName: string;
			args?: unknown;
	  }
	| {
			type: "tool_execution_end";
			toolCallId: string;
			toolName: string;
			result?: unknown;
			isError?: boolean;
	  };

/** 事件名（**联合类型**）。 */
export type AgentEventType = AgentEvent["type"];
