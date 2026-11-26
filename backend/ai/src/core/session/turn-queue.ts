/**
 * 发起一轮对话 + **排队语义**（issue #175 · S4）。
 *
 * ## ⚠️ 为什么**没退给 dsh**
 *
 * dsh 的 SDK 协议里**没有 followUp / steer**（只有 prompt / query / resume）
 * ⇒ 这两条路今天走不通 ⇒ 落回**启动锁**（同会话串行）。
 * ⇒ 哪天 dsh 把这两个能力放上协议 ⇒ 这里自动走原生语义（**一个字都不用改**）。
 */

import type { AgentSessionLike } from "../adapter/dsh/session.ts";
import type { ConversationChannel } from "./session-registry.ts";
import type { StartupLock } from "./startup-lock.ts";

// 命令类型。
// | 类型 | 含义 |
// | ---- | ---- |
// | `prompt` | 说一句话（**默认**）。当前没有轮次在跑 ⇒ 立刻开始跑；在跑 ⇒ 当成 followUp（排队，不打断） |
// | `prompt-followup` | 明确排队：当前轮干完活再处理这句 |
// | `prompt-steer` | 打断：插到当前助手轮次（及其工具调用）之后 |
// ⚠️ 后两种是会话宿主的**原生**排队语义（`session.followUp()` / `session.steer()`）
// ⇒ 自己造队列只能做到「等整轮跑完」⇒ 能用原生的就用原生的。
export type CommandType = "prompt" | "prompt-followup" | "prompt-steer";

// 发起一轮对话（**排队语义用会话宿主的原生能力**）。
// - 当前**没有**轮次在跑 ⇒ 直接 `prompt()`；
// - 当前**有**轮次在跑 ⇒ `prompt-steer` ⇒ `session.steer()`（插到当前轮之后）；
//   其它 ⇒ `session.followUp()`（当前轮干完活再处理这句 ⇒ **不打断**）。
export async function dispatchTurn(input: {
	/** 会话通道。 */
	channel: ConversationChannel;
	/** 用户说的那句话。 */
	message: string;
	/** 命令类型。 */
	type: CommandType;
	/** 取（必要时懒创建）dsh 会话。 */
	ensureSession: () => Promise<AgentSessionLike>;
	/** 启动锁（同会话串行）。 */
	lock: StartupLock;
}): Promise<void> {
	const session = await input.ensureSession();

	// 已经有轮次在跑 ⇒ 走会话原生的排队语义
	if (session.isStreaming && (await queueInto(session, input.message, input.type))) {
		return;
	}

	await input.lock.run(input.channel.conversationId, async () => {
		// 拿到锁后再看一眼（可能刚被别人起了一轮）
		if (session.isStreaming && (await queueInto(session, input.message, input.type))) {
			return;
		}
		await session.prompt(input.message, { expandPromptTemplates: false });
	});
}

/** 把这句话排进当前正在跑的那一轮。 ·  */
export async function queueInto(
	session: AgentSessionLike,
	message: string,
	type: CommandType,
): Promise<boolean> {
	try {
		if (type === "prompt-steer" && session.steer !== undefined) {
			await session.steer(message);
			return true;
		}
		if (type !== "prompt-steer" && session.followUp !== undefined) {
			await session.followUp(message);
			return true;
		}
	} catch (error) {
		// ⚠️ 会话不接受这句话（比如它被当成了扩展命令）⇒ 落回普通排队。
		//    不当错误报出去：那句话本身没毛病，只是排队的路子走不通。
		console.warn("[agent] 排队进当前轮没成，改成正常排队", error);
	}
	return false;
}
