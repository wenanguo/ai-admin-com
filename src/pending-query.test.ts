import { describe, expect, it } from "vitest";
import {
	parsePendingFilters,
	queryPendingActions,
	type PendingActionReader,
	type PendingFindArgs,
	type PendingRow,
} from "./pending-query";

/**
 * 待确认只读查询 —— 用**注入的假 prisma** 测（不连库）。
 *
 * ⚠️ `ai_pending_action` 在**共享生产库**里 ⇒ 测试**绝不**碰数据库，
 * 只用假读侧（把调用记下来，断言「传进 prisma 的 where」）。
 */

/** 假读侧：把调用记下来，断言「传进 prisma 的 where」。 */
interface FakeReader {
	reader: PendingActionReader;
	findCalls: PendingFindArgs[];
}

/** 造一个假读侧。 */
function fakeReader(rows: PendingRow[]): FakeReader {
	const findCalls: PendingFindArgs[] = [];
	return {
		findCalls,
		reader: {
			findMany: async (args: PendingFindArgs): Promise<PendingRow[]> => {
				findCalls.push(args);
				return rows;
			},
		},
	};
}

/** 造一行待确认（默认值取自契约里的示例）。 */
function row(overrides: Partial<PendingRow> = {}): PendingRow {
	return {
		id: "act_1",
		conversationId: "cmw2xxxxxxxxxxxxxxxxxxxxxxxxxx",
		userId: "42",
		command: "batch_update_tasks",
		args: {
			filter: { priorities: ["P0"], due_before: "2026-07-04" },
			set: { due_date: "2026-07-13" },
		},
		preview: {
			title: "批量顺延本周 P0 任务截止日",
			hits: [
				{
					title: "对账引擎 V2 性能压测",
					from: "2026-07-02",
					to: "2026-07-13",
					owner: "赵磊",
				},
			],
			warning: "顺延后仍无法解锁关键路径：「合规审批材料补充」为外部依赖",
		},
		status: "PENDING",
		expiresAt: new Date("2026-11-04T16:13:04.152Z"),
		createdAt: new Date("2026-11-04T15:43:04.152Z"),
		...overrides,
	};
}

describe("待确认只读查询", () => {
	it("只返回当前用户的行（userId 过滤永远带上）", async () => {
		const fake = fakeReader([row()]);
		await queryPendingActions(fake.reader, { userId: "42" });

		expect(fake.findCalls).toHaveLength(1);
		expect(fake.findCalls[0]?.where.userId).toBe("42");
	});

	it("status 缺省 PENDING（只看待确认）", async () => {
		const fake = fakeReader([row()]);
		await queryPendingActions(fake.reader, { userId: "42" });

		expect(fake.findCalls[0]?.where.status).toBe("PENDING");
	});

	it("status 参数传合法值 ⇒ 进 where", async () => {
		const fake = fakeReader([row({ status: "CONFIRMED" })]);
		const filters = parsePendingFilters(new URLSearchParams("status=CONFIRMED"));
		await queryPendingActions(fake.reader, { userId: "42", ...filters });

		expect(filters.status).toBe("CONFIRMED");
		expect(fake.findCalls[0]?.where.status).toBe("CONFIRMED");
	});

	it("非法 status ⇒ 当没传（仍用缺省 PENDING，不报错）", async () => {
		const filters = parsePendingFilters(new URLSearchParams("status=whatever"));
		expect(filters.status).toBeUndefined();

		const fake = fakeReader([row()]);
		await queryPendingActions(fake.reader, { userId: "42", ...filters });
		expect(fake.findCalls[0]?.where.status).toBe("PENDING");
	});

	it("preview 原样透出（JSON 列不加工）", async () => {
		const fake = fakeReader([row()]);
		const items = await queryPendingActions(fake.reader, { userId: "42" });

		const preview = items[0]?.preview as {
			title?: string;
			hits?: { title?: string; from?: string; to?: string; owner?: string }[];
			warning?: string;
		};
		expect(preview.title).toBe("批量顺延本周 P0 任务截止日");
		expect(preview.hits?.[0]?.title).toBe("对账引擎 V2 性能压测");
		expect(preview.hits?.[0]?.from).toBe("2026-07-02");
		expect(preview.hits?.[0]?.to).toBe("2026-07-13");
		expect(preview.hits?.[0]?.owner).toBe("赵磊");
		expect(preview.warning).toBe("顺延后仍无法解锁关键路径：「合规审批材料补充」为外部依赖");
	});

	it("args 里的凭据被脱敏（与审计读侧同一份实现）", async () => {
		const fake = fakeReader([
			row({
				args: {
					filter: { priorities: ["P0"] },
					token: "secret-token-must-not-leak",
					password: "secret-password",
				},
			}),
		]);
		const items = await queryPendingActions(fake.reader, { userId: "42" });

		const args = items[0]?.args;
		expect(args["token"]).toBe("[已脱敏]");
		expect(args["password"]).toBe("[已脱敏]");
		// 形状不变：普通参数原样透出
		expect(args["filter"]).toEqual({ priorities: ["P0"] });
		// ⚠️ 整个响应里都不能出现明文凭据
		expect(JSON.stringify(items)).not.toContain("secret-token-must-not-leak");
		expect(JSON.stringify(items)).not.toContain("secret-password");
	});

	it("返回的形状与前端契约一致（id 是字符串、时间是 ISO）", async () => {
		const fake = fakeReader([row()]);
		const items = await queryPendingActions(fake.reader, { userId: "42" });

		const item = items[0];
		expect(item?.id).toBe("act_1");
		expect(item?.conversationId).toBe("cmw2xxxxxxxxxxxxxxxxxxxxxxxxxx");
		expect(item?.command).toBe("batch_update_tasks");
		expect(item?.status).toBe("PENDING");
		expect(item?.expiresAt).toBe("2026-11-04T16:13:04.152Z");
		expect(item?.createdAt).toBe("2026-11-04T15:43:04.152Z");
	});

	it("库里是整数 id ⇒ 响应里也是字符串（前端当不透明 key 用）", async () => {
		const fake = fakeReader([row({ id: 7 })]);
		const items = await queryPendingActions(fake.reader, { userId: "42" });

		expect(items[0]?.id).toBe("7");
	});

	it("没有会话的行 ⇒ conversationId 是 null", async () => {
		const fake = fakeReader([row({ conversationId: null })]);
		const items = await queryPendingActions(fake.reader, { userId: "42" });

		expect(items[0]?.conversationId).toBeNull();
	});

	it("最新的排在前面（createdAt 倒序）", async () => {
		const fake = fakeReader([row()]);
		await queryPendingActions(fake.reader, { userId: "42" });

		expect(fake.findCalls[0]?.orderBy).toEqual({ createdAt: "desc" });
	});

	it("limit 缺省 50、上限 200", async () => {
		const fake = fakeReader([row()]);
		await queryPendingActions(fake.reader, { userId: "42" });
		expect(fake.findCalls[0]?.take).toBe(50);

		const capped = fakeReader([row()]);
		await queryPendingActions(capped.reader, { userId: "42", limit: 999 });
		expect(capped.findCalls[0]?.take).toBe(200);

		const normal = fakeReader([row()]);
		await queryPendingActions(normal.reader, { userId: "42", limit: 10 });
		expect(normal.findCalls[0]?.take).toBe(10);
	});
});

describe("待确认查询参数解析", () => {
	it("认得 status / limit", () => {
		const filters = parsePendingFilters(new URLSearchParams("status=PENDING&limit=10"));

		expect(filters.status).toBe("PENDING");
		expect(filters.limit).toBe(10);
	});

	it("不认识的参数（from / to 等）静默忽略，不报错", () => {
		const filters = parsePendingFilters(
			new URLSearchParams("from=2026-11-01&to=2026-11-05&status=PENDING&weird=1"),
		);

		expect(filters.status).toBe("PENDING");
		expect(Object.keys(filters)).not.toContain("from");
		expect(Object.keys(filters)).not.toContain("to");
		expect(Object.keys(filters)).not.toContain("weird");
	});

	it("空值 / 非法值当作没传（不报错）", () => {
		const filters = parsePendingFilters(new URLSearchParams("status=&limit=abc"));

		expect(filters.status).toBeUndefined();
		expect(filters.limit).toBeUndefined();
	});

	it("limit 的上限在取数层压住（200）", async () => {
		const filters = parsePendingFilters(new URLSearchParams("limit=9999"));
		expect(filters.limit).toBe(9999); // 解析层不裁剪，取数层裁（见上面的 take）

		const fake = fakeReader([row()]);
		await queryPendingActions(fake.reader, { userId: "42", ...filters });
		expect(fake.findCalls[0]?.take).toBe(200);
	});
});
