#!/usr/bin/env node
/**
 * 尖峰 ③ 辅助：只读地看一眼目标 MySQL。
 * 用法：node --env-file=.env spike/scripts/02-db-inspect.mjs
 * 注意：绝��打印连接串里的密码。
 */
import mysql from "mysql2/promise";

const url = new URL(process.env.DATABASE_URL);
const conn = await mysql.createConnection({
	host: url.hostname,
	port: Number(url.port || 3306),
	user: decodeURIComponent(url.username),
	password: decodeURIComponent(url.password),
	database: url.pathname.replace(/^\//, ""),
});

const [versionRows] = await conn.query("SELECT VERSION() AS version, @@version_comment AS c");
console.log("MySQL 版本:", versionRows[0].version, "|", versionRows[0].c);

const [charsetRows] = await conn.query(
	"SELECT @@character_set_database AS cs, @@collation_database AS coll, @@sql_mode AS sql_mode, @@character_set_server AS cs_server",
);
console.log("库字符集:", JSON.stringify(charsetRows[0]));

const [tables] = await conn.query("SHOW TABLES");
const names = tables.map((t) => Object.values(t)[0]);
console.log("库里的表数量:", names.length);
console.log("表清单:", JSON.stringify(names));
console.log("_prisma_migrations 存在？:", names.includes("_prisma_migrations"));

const [dbs] = await conn.query("SHOW DATABASES");
console.log("同实例的库:", JSON.stringify(dbs.map((d) => Object.values(d)[0])));

await conn.end();
