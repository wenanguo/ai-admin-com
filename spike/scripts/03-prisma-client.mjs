#!/usr/bin/env node
/**
 * 尖峰 ③ 辅助：用真的 Prisma Client 连上目标 MySQL，对那张一次性表做增删查。
 * 跑法：node --env-file=.env spike/scripts/03-prisma-client.mjs
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

try {
	const created = await prisma.spikeProbe.create({ data: { label: "hello-from-prisma" } });
	console.log("create ->", JSON.stringify(created));

	const found = await prisma.spikeProbe.findUnique({ where: { id: created.id } });
	console.log("findUnique ->", JSON.stringify(found));

	const count = await prisma.spikeProbe.count();
	console.log("count ->", count);

	const deleted = await prisma.spikeProbe.delete({ where: { id: created.id } });
	console.log("delete ->", JSON.stringify(deleted));

	console.log("结论：Prisma Client 能连上这个 MySQL 并正常读写。");
} catch (error) {
	console.error("失败：", error?.constructor?.name, "-", String(error?.message ?? error).slice(0, 500));
	process.exitCode = 1;
} finally {
	await prisma.$disconnect();
}
