/**
 * 示例插件的验收 —— **业务能力与身份**。
 *
 * ⚠️ 这条测试证明的是「示例系统的业务在自己的插件里、内核不插手」。
 */

import { beforeEach, describe, expect, it } from "vitest";
import { AgentError, type CommandContext } from "../../src/core/index.ts";
import {
	ADD_NOTE_TOOL_NAME,
	DemoCurrentUserResolver,
	LIST_NOTES_TOOL_NAME,
	NOTES_PLUGIN_ID,
	createNotesPlugin,
} from "./plugin.ts";
import { listNotes, resetNotes } from "./store.ts";

/** 造一个假的命令上下文（内核给的那几样）。 */
function fakeContext(): CommandContext {
	return {
		currentToken: () => "demo-reader",
		currentUserId: async () => 1,
		audit: {
			write: async () => {
				// 测试里不落库
			},
		},
		model: "test-model",
	};
}

describe("读书笔记插件（示例系统的业务）", () => {
	beforeEach(() => {
		resetNotes();
	});

	it("插件有自己的 id 与两条命令", () => {
		const plugin = createNotesPlugin();
		expect(plugin.id).toBe(NOTES_PLUGIN_ID);
		expect(plugin.commands?.map((command) => command.name)).toEqual([
			ADD_NOTE_TOOL_NAME,
			LIST_NOTES_TOOL_NAME,
		]);
	});

	it("`add_note` 真的记下一条笔记", async () => {
		const plugin = createNotesPlugin();
		const command = plugin.commands?.find((item) => item.name === ADD_NOTE_TOOL_NAME);
		const tool = command?.build(fakeContext());
		const result = await tool?.execute("call-1", { title: "活着", author: "余华" });
		expect(result?.isError).toBeFalsy();
		expect(listNotes()).toHaveLength(1);
		expect(listNotes()[0]?.title).toBe("活着");
		expect(listNotes()[0]?.author).toBe("余华");
	});

	it("`add_note` 书名为空 ⇒ 失败（不记）", async () => {
		const plugin = createNotesPlugin();
		const command = plugin.commands?.find((item) => item.name === ADD_NOTE_TOOL_NAME);
		const tool = command?.build(fakeContext());
		const result = await tool?.execute("call-1", { title: "   " });
		expect(result?.isError).toBe(true);
		expect(listNotes()).toHaveLength(0);
	});

	it("`list_notes` 列出已记的笔记", async () => {
		const plugin = createNotesPlugin();
		const context = fakeContext();
		const add = plugin.commands
			?.find((item) => item.name === ADD_NOTE_TOOL_NAME)
			?.build(context);
		await add?.execute("call-1", { title: "活着" });
		const list = plugin.commands
			?.find((item) => item.name === LIST_NOTES_TOOL_NAME)
			?.build(context);
		const result = await list?.execute("call-2", {});
		expect(result?.isError).toBeFalsy();
		expect(listNotes()).toHaveLength(1);
	});

	it("身份：`demo-` 开头的 token 认得出人，其它 ⇒ 401 的那种错", async () => {
		const resolver = new DemoCurrentUserResolver();
		await expect(resolver.resolve("demo-reader")).resolves.toMatchObject({ id: 1 });
		await expect(resolver.resolve("nope")).rejects.toBeInstanceOf(AgentError);
	});
});
