import { describe, expect, it } from "vitest";
import {
	parseAuditFilters,
	queryAuditLog,
	type AuditCountArgs,
	type AuditFindArgs,
	type AuditLogReader,
	type AuditRow,
} from "./audit-query";

/**
 * 审计只读查询 —— 用**注入的假 prisma** 测（不连库）。
 *
 * ⚠️ 共享库里 `ai_audit_log` 有真实行 ⇒ 测试**绝不**碰数据库。
 */

/** 假读侧：把调用记下来，断言「传进 prisma 的 where」。 */
interface FakeReader {
	reader: AuditLogReader;
	findCalls: AuditFindArgs[];
	countCalls: AuditCountArgs[];
}

/** 造一个假读侧。 */
function fakeReader(rows: AuditRow[], total?: number): FakeReader {
	const findCalls: AuditFindArgs[] = [];
	const countCalls: AuditCountArgs[] = [];
	return {
		findCalls,
		countCalls,
		reader: {
			findMany: async (args: AuditFindArgs): Promise<AuditRow[]> => {
				findCalls.push(args);
				return rows;
			},
			count: async (args: AuditCountArgs): Promise<number> => {
				countCalls.push(args);
				return total ?? rows.length;
			},
		},
	};
}

/** 造一行审计（默认值取自契约里的示例）。 */
function row(overrides: Partial<AuditRow> = {}): AuditRow {
	return {
		id: "7",
		userId: "42",
		actorType: "AI",
		command: "create_task",
		args: { project_key: "PRJ-2026-Q3-001", title: "AIPM 冒烟验证任务" },
		beforeSnapshot: null,
		afterSnapshot: { id: 104, title: "AIPM 冒烟验证任务", status: "BACKLOG", priority: "P1" },
		undoOf: null,
		undoneAt: null,
		adopted: null,
		model: "minimax-cn/MiniMax-M3.1-Flash",
		tokens: null,
		latencyMs: 1234,
		traceId: null,
		error: null,
		createdAt: new Date("2026-11-04T15:43:04.152Z"),
		...overrides,
	};
}

describe("审计只读查询", () => {
	it("只返回当前用户的行（userId 过滤永远带上）", async () => {
		const fake = fakeReader([row()]);
		await queryAuditLog(fake.reader, { userId: "42" });

		expect(fake.findCalls).toHaveLength(1);
		expect(fake.findCalls[0]?.where.userId).toBe("42");
		// count 用的是同一个 where ⇒ total 与列表口径一致
		expect(fake.countCalls[0]?.where.userId).toBe("42");
	});

	it("actor 筛选传进 where", async () => {
		const fake = fakeReader([row({ actorType: "USER" })]);
		await queryAuditLog(fake.reader, { userId: "42", actor: "USER" });

		expect(fake.findCalls[0]?.where.actorType).toBe("USER");
	});

	it("command 筛选传进 where", async () => {
		const fake = fakeReader([row()]);
		await queryAuditLog(fake.reader, { userId: "42", command: "create_task" });

		expect(fake.findCalls[0]?.where.command).toBe("create_task");
	});

	it("undone=true ⇒ 只看已撤销的（undoneAt 非空）", async () => {
		const fake = fakeReader([row({ undoneAt: new Date("2026-11-04T16:00:00.000Z") })]);
		await queryAuditLog(fake.reader, { userId: "42", undone: true });

		expect(fake.findCalls[0]?.where.undoneAt).toEqual({ not: null });
	});

	it("undone 省略 ⇒ 全部（不按撤销状态筛）", async () => {
		const fake = fakeReader([row()]);
		await queryAuditLog(fake.reader, { userId: "42" });

		expect(fake.findCalls[0]?.where.undoneAt).toBeUndefined();
	});

	it("limit 缺省 50、上限 200", async () => {
		const fake = fakeReader([row()]);
		await queryAuditLog(fake.reader, { userId: "42" });
		expect(fake.findCalls[0]?.take).toBe(50);

		const capped = fakeReader([row()]);
		await queryAuditLog(capped.reader, { userId: "42", limit: 999 });
		expect(capped.findCalls[0]?.take).toBe(200);

		const normal = fakeReader([row()]);
		await queryAuditLog(normal.reader, { userId: "42", limit: 10 });
		expect(normal.findCalls[0]?.take).toBe(10);
	});

	it("offset 传进 skip（缺省 0）", async () => {
		const fake = fakeReader([row()]);
		await queryAuditLog(fake.reader, { userId: "42", offset: 20 });
		expect(fake.findCalls[0]?.skip).toBe(20);

		const none = fakeReader([row()]);
		await queryAuditLog(none.reader, { userId: "42" });
		expect(none.findCalls[0]?.skip).toBe(0);
	});

	it("最新的排在前面（createdAt 倒序）", async () => {
		const fake = fakeReader([row()]);
		await queryAuditLog(fake.reader, { userId: "42" });

		expect(fake.findCalls[0]?.orderBy).toEqual({ createdAt: "desc" });
	});

	it("args 里的凭据被脱敏（不带 token / 口令）", async () => {
		const fake = fakeReader([
			row({
				args: {
					project_key: "PRJ-2026-Q3-001",
					title: "AIPM 冒烟验证任务",
					token: "secret-token-must-not-leak",
					password: "secret-password",
				},
			}),
		]);
		const page = await queryAuditLog(fake.reader, { userId: "42" });

		const args = page.items[0]?.args;
		expect(args?.["token"]).toBe("[已脱敏]");
		expect(args?.["password"]).toBe("[已脱敏]");
		// 形状不变：普通参数原样透出
		expect(args?.["project_key"]).toBe("PRJ-2026-Q3-001");
		// ⚠️ 整个响应里都不能出现明文凭据
		expect(JSON.stringify(page)).not.toContain("secret-token-must-not-leak");
		expect(JSON.stringify(page)).not.toContain("secret-password");
	});

	it("before / after 原样透出（没有就是 null）", async () => {
		const fake = fakeReader([
			row({ beforeSnapshot: { status: "TODO" }, afterSnapshot: { status: "BACKLOG" } }),
			row({ id: "8", beforeSnapshot: null, afterSnapshot: null }),
		]);
		const page = await queryAuditLog(fake.reader, { userId: "42" });

		expect(page.items[0]?.before).toEqual({ status: "TODO" });
		expect(page.items[0]?.after).toEqual({ status: "BACKLOG" });
		expect(page.items[1]?.before).toBeNull();
		expect(page.items[1]?.after).toBeNull();
	});

	it("total 用 count 的结果（不是本页条数）", async () => {
		const fake = fakeReader([row(), row({ id: "8" })], 42);
		const page = await queryAuditLog(fake.reader, { userId: "42" });

		expect(page.total).toBe(42);
		expect(page.items).toHaveLength(2);
		expect(fake.countCalls).toHaveLength(1);
		// count 与列表用同一个 where
		expect(fake.countCalls[0]?.where).toEqual(fake.findCalls[0]?.where);
	});

	it("返回的形状与前端契约一致（id 是字符串、时间是 ISO）", async () => {
		const fake = fakeReader([
			row({ undoneAt: new Date("2026-11-04T16:00:00.000Z"), undoOf: "6", adopted: true }),
		]);
		const page = await queryAuditLog(fake.reader, { userId: "42", actorName: "管理员" });

		const item = page.items[0];
		expect(item?.id).toBe("7");
		expect(item?.command).toBe("create_task");
		expect(item?.actorType).toBe("AI");
		expect(item?.actorName).toBe("管理员");
		expect(item?.model).toBe("minimax-cn/MiniMax-M3.1-Flash");
		expect(item?.tokens).toBeNull();
		expect(item?.latencyMs).toBe(1234);
		expect(item?.traceId).toBeNull();
		expect(item?.error).toBeNull();
		expect(item?.undoOf).toBe("6");
		expect(item?.adopted).toBe(true);
		expect(item?.undoneAt).toBe("2026-11-04T16:00:00.000Z");
		expect(item?.createdAt).toBe("2026-11-04T15:43:04.152Z");
	});

	it("取不到发起方名字 ⇒ 用 userId 顶上", async () => {
		const fake = fakeReader([row()]);
		const page = await queryAuditLog(fake.reader, { userId: "42" });

		expect(page.items[0]?.actorName).toBe("42");
	});
});

describe("审计查询参数解析", () => {
	it("认得 actor / command / limit / offset / undone", () => {
		const filters = parseAuditFilters(
			new URLSearchParams("actor=USER&command=create_task&limit=10&offset=5&undone=true"),
		);

		expect(filters.actor).toBe("USER");
		expect(filters.command).toBe("create_task");
		expect(filters.limit).toBe(10);
		expect(filters.offset).toBe(5);
		expect(filters.undone).toBe(true);
	});

	it("不认识的参数（from / to 等）静默忽略，不报错", () => {
		const filters = parseAuditFilters(
			new URLSearchParams("from=2026-11-01&to=2026-11-05&actor=AI&weird=1"),
		);

		expect(filters.actor).toBe("AI");
		expect(Object.keys(filters)).not.toContain("from");
		expect(Object.keys(filters)).not.toContain("to");
	});

	it("空值 / 非法值当作没传（不报错）", () => {
		const filters = parseAuditFilters(
			new URLSearchParams("actor=&command=&limit=abc&offset=&undone="),
		);

		expect(filters.actor).toBeUndefined();
		expect(filters.command).toBeUndefined();
		expect(filters.limit).toBeUndefined();
		expect(filters.offset).toBeUndefined();
		expect(filters.undone).toBe(false);
	});

	it("limit 的上限在解析这一层就压住（200）", async () => {
		const filters = parseAuditFilters(new URLSearchParams("limit=9999"));
		expect(filters.limit).toBe(9999); // 解析层不裁剪，取数层裁（见上面的 take）

		const fake = fakeReader([row()]);
		await queryAuditLog(fake.reader, { userId: "42", ...filters });
		expect(fake.findCalls[0]?.take).toBe(200);
	});
});
