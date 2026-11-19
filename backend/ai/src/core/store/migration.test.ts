/**
 * 迁移脚本的单测 —— **空库跑通** 与 **已有库跑通**。
 *
 * ## 为什么用「迷你执行器」而不是真库
 *
 * CI 里**没有 MySQL**（`.github/workflows/ci.yml` 没有数据库服务）⇒ 真跑迁移的测试在 CI 里跑不了。
 * ⇒ 这里用一个**只认我们迁移用到的 SQL 子集**的迷你执行器，在内存里模拟一个库：
 * 表 = 列定义 + 行；迁移 = 一条条语句往上加。
 *
 * ⚠️ **它不是完整的 SQL 引擎** ⇒ 只认：
 * - `CREATE TABLE`（列定义 + `INDEX` / `PRIMARY KEY` / `UNIQUE INDEX`）；
 * - `ALTER TABLE … ADD COLUMN`；
 * - `ALTER TABLE … ADD CONSTRAINT`（外键 ⇒ 只记下来）。
 *
 * ⚠️ **遇到不认的语句 / 危险的语句 ⇒ 直接报错**（⇒ 迁移里混进 `DROP` 之类会红）。
 *
 * ## 覆盖的两条验收
 *
 * | 用例 | 断言 |
 * | ---- | ---- |
 * | **空库跑通** | 从空状态按序执行 `0_init` → `1_add_conversation_agent_id` → `2_add_dsh_session_storage` ⇒ 表与列都在 |
 * | **已有库跑通** | 先有旧库与旧数据 ⇒ 执行 `2` 后旧行**一条不少、一字不改**，旧会话的新列是 `NULL`（⇒ 老数据可读） |
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/* ------------------------------------------------------------ 迷你库 */

/** 一列。 */
interface FakeColumn {
	/** 列类型（`VARCHAR(64)` 那样）。 */
	type: string;
	/** 可空吗。 */
	nullable: boolean;
}

/** 一张表。 */
interface FakeTable {
	/** 表名。 */
	name: string;
	/** 列（名字 ⇒ 定义）。 */
	columns: Map<string, FakeColumn>;
	/** 行（**老数据不能丢** ⇒ 迁移前后要能比）。 */
	rows: Record<string, unknown>[];
	/** 外键（只记，不校验）。 */
	foreignKeys: string[];
}

/** 一个库（表名 ⇒ 表）。 */
type FakeDb = Map<string, FakeTable>;

/** 危险语句的判据（**删表 / 改列 / 删数据**）。 */
const DANGEROUS_STATEMENT =
	/\b(DROP|TRUNCATE|RENAME|MODIFY)\b|\bDELETE\s+FROM\b|\bCHANGE\s+COLUMN\b|\bALTER\s+COLUMN\b/i;

/** 迁移目录（本文件在 `src/core/store/` ⇒ 上三层是 `backend/ai/`）。 */
const MIGRATIONS_DIR = fileURLToPath(new URL("../../../prisma/migrations", import.meta.url));

/** 迁移目录里的迁移（**按目录名排序** ⇒ 数字前缀就是顺序）。 */
function migrationFiles(): { name: string; sql: string }[] {
	return readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.sort()
		.map((name) => ({
			name,
			sql: readFileSync(join(MIGRATIONS_DIR, name, "migration.sql"), "utf8"),
		}));
}

/** 去掉注释行与空行。 */
function statementsOf(sql: string): string[] {
	return sql
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0 && !line.startsWith("--"));
}

/** 把一条语句按 `;` 切开（**我们的迁移里没有字符串里的分号**）。 */
function splitStatements(sql: string): string[] {
	return statementsOf(sql)
		.join("\n")
		.split(";")
		.map((statement) => statement.trim())
		.filter((statement) => statement.length > 0);
}

/**
 * 执行一条语句（**只认我们迁移里用到的那几种**）。
 *
 * @param db 库（就地改）。
 * @param statement 语句。
 */
function applyStatement(db: FakeDb, statement: string): void {
	const upper = statement.toUpperCase();
	// ⚠️ `ON DELETE CASCADE` 是**外键的删除规则**（不是删数据）⇒ 不算危险。
	if (DANGEROUS_STATEMENT.test(upper)) {
		throw new Error(`迁移里有危险语句：${statement}`);
	}
	if (upper.startsWith("CREATE TABLE")) {
		createTable(db, statement);
		return;
	}
	if (upper.startsWith("ALTER TABLE")) {
		alterTable(db, statement);
		return;
	}
	throw new Error(`不认的语句：${statement}`);
}

/** `CREATE TABLE` ⇒ 建表。 */
function createTable(db: FakeDb, statement: string): void {
	const match = /CREATE TABLE\s+`([^`]+)`\s*\(([\s\S]*)\)\s*(DEFAULT[^;]*)?$/i.exec(statement);
	if (match === null) {
		throw new Error(`看不懂的建表语句：${statement}`);
	}
	const name = match[1] ?? "";
	const body = match[2] ?? "";
	const table: FakeTable = { name, columns: new Map(), rows: [], foreignKeys: [] };
	for (const rawLine of body.split("\n")) {
		const line = rawLine.trim().replace(/,$/, "");
		if (line.length === 0) {
			continue;
		}
		if (/^(PRIMARY KEY|INDEX|UNIQUE INDEX|KEY)\b/i.test(line)) {
			// 索引 ⇒ 不进列集合（我们只关心列与数据）
			continue;
		}
		const column = parseColumn(line);
		table.columns.set(column.name, { type: column.type, nullable: column.nullable });
	}
	db.set(name, table);
}

/** `ALTER TABLE` ⇒ 加列 / 加外键。 */
function alterTable(db: FakeDb, statement: string): void {
	const addColumn = /ALTER TABLE\s+`([^`]+)`\s+ADD COLUMN\s+`([^`]+)`\s+([A-Za-z]+(?:\([0-9]+\))?)\s*(NOT NULL|NULL)?/i.exec(
		statement,
	);
	if (addColumn !== null) {
		const table = db.get(addColumn[1] ?? "");
		if (table === undefined) {
			throw new Error(`加列的表不存在：${statement}`);
		}
		const nullable = (addColumn[4] ?? "NULL").toUpperCase() !== "NOT NULL";
		table.columns.set(addColumn[2] ?? "", { type: addColumn[3] ?? "", nullable });
		return;
	}
	const addConstraint = /ALTER TABLE\s+`([^`]+)`\s+ADD CONSTRAINT\s+`([^`]+)`\s+FOREIGN KEY/i.exec(
		statement,
	);
	if (addConstraint !== null) {
		const table = db.get(addConstraint[1] ?? "");
		if (table === undefined) {
			throw new Error(`加外键的表不存在：${statement}`);
		}
		table.foreignKeys.push(addConstraint[2] ?? "");
		return;
	}
	throw new Error(`看不懂的改表语句：${statement}`);
}

/** 一行列定义 ⇒ 列。 */
function parseColumn(line: string): { name: string; type: string; nullable: boolean } {
	const tokens = line.split(/\s+/);
	const name = (tokens[0] ?? "").replace(/`/g, "");
	const type = tokens[1] ?? "";
	const nullable = !tokens.includes("NOT NULL");
	return { name, type, nullable };
}

/** 执行一个迁移目录里的全部语句。 */
function applyMigration(db: FakeDb, sql: string): void {
	for (const statement of splitStatements(sql)) {
		applyStatement(db, statement);
	}
}

/* ------------------------------------------------------------ 用例 */

describe("迁移脚本", () => {
	it("**空库跑通**：按序执行 0 → 1 → 2 ⇒ 表与列都在", () => {
		const db: FakeDb = new Map();
		for (const migration of migrationFiles()) {
			applyMigration(db, migration.sql);
		}
		// 旧表还在
		for (const name of [
			"ai_conversation",
			"ai_message",
			"ai_pending_action",
			"ai_audit_log",
			"ai_entity_ref",
		]) {
			expect(db.has(name)).toBe(true);
		}
		// 新表在
		expect(db.has("ai_session_event")).toBe(true);
		const conversation = db.get("ai_conversation");
		expect(conversation?.columns.has("agent_id")).toBe(true);
		expect(conversation?.columns.has("dsh_session_id")).toBe(true);
		// ⚠️ **新列可空** ⇒ 迁移前的旧会话不用回填
		expect(conversation?.columns.get("dsh_session_id")?.nullable).toBe(true);
		const events = db.get("ai_session_event");
		expect(events?.columns.has("conversation_id")).toBe(true);
		expect(events?.columns.has("seq")).toBe(true);
		expect(events?.columns.has("kind")).toBe(true);
		expect(events?.columns.has("event_name")).toBe(true);
		expect(events?.columns.has("payload")).toBe(true);
	});

	it("**已有库跑通**：旧数据一条不少、一字不改", () => {
		const db: FakeDb = new Map();
		const migrations = migrationFiles();
		// 先只有基线与上一个增量（= 线上库的样子）
		applyMigration(db, migrations[0]?.sql ?? "");
		applyMigration(db, migrations[1]?.sql ?? "");
		const conversation = db.get("ai_conversation");
		conversation?.rows.push({
			id: "old-conv",
			user_id: "2",
			title: "老会话",
			agent_id: null,
			created_at: "2026-01-01 00:00:00.000",
		});
		const audit = db.get("ai_audit_log");
		audit?.rows.push({
			id: "old-audit",
			user_id: "2",
			actor_type: "AI",
			command: "create_x",
		});

		// 本条的迁移
		applyMigration(db, migrations[2]?.sql ?? "");

		// ⚠️ **老数据还在**（一条不少、一字不改）
		expect(conversation?.rows).toHaveLength(1);
		expect(conversation?.rows[0]?.["id"]).toBe("old-conv");
		expect(conversation?.rows[0]?.["title"]).toBe("老会话");
		expect(audit?.rows).toHaveLength(1);
		expect(audit?.rows[0]?.["id"]).toBe("old-audit");
		// ⚠️ **旧会话读得到**（新列是空的 ⇒ 不用回填）
		expect(conversation?.rows[0]?.["dsh_session_id"]).toBeUndefined();
		expect(conversation?.columns.get("dsh_session_id")?.nullable).toBe(true);
		// 新表是空的
		expect(db.get("ai_session_event")?.rows).toHaveLength(0);
	});

	it("**只增不改**：迁移里没有删表 / 改列 / 删数据", () => {
		for (const migration of migrationFiles()) {
			const dangerous = splitStatements(migration.sql).filter((statement) =>
				DANGEROUS_STATEMENT.test(statement),
			);
			expect(dangerous).toEqual([]);
		}
	});

	it("危险语句会被执行器**当场拒绝**（安全阀不是摆设）", () => {
		const db: FakeDb = new Map();
		expect(() => applyStatement(db, "DROP TABLE `ai_conversation`")).toThrow(/危险/);
		expect(() => applyStatement(db, "DELETE FROM `ai_audit_log`")).toThrow(/危险/);
	});

	it("schema 与迁移**对得上**（列与表都在）", () => {
		const schema = readFileSync(
			fileURLToPath(new URL("../../../prisma/schema.prisma", import.meta.url)),
			"utf8",
		);
		expect(schema).toContain("dshSessionId");
		expect(schema).toContain('@map("dsh_session_id")');
		expect(schema).toContain("model AiSessionEvent");
		expect(schema).toContain('@map("ai_session_event")');
	});
});
