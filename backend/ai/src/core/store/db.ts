/**
 * PrismaClient 单例。
 *
 * ## 库连接串由配置决定
 *
 * Prisma 的 datasource 只能写死**一个**环境变量名（`env("DATABASE_URL")`）⇒
 * 「换库只改配置」这件事得在**建客户端之前**把那个变量指向真正要用的连接串。
 *
 * ⚠️ **只在两者不同的时候写** ⇒ 不配 `AI_DATABASE_URL` 时 `process.env` 原样不动
 *    （今天的部署一个字都不用改）。
 */

import { PrismaClient } from "@prisma/client";
import { env } from "../env/env.ts";

/**
 * 把「实际要用的连接串」对齐到 Prisma 认的那个变量名。
 *
 * ⚠️ **可注入**（`target`）⇒ 单测不必真的改 `process.env`。
 *
 * @param databaseUrl 实际要用的连接串（`env.databaseUrl`）。
 * @param target 要写入的环境变量表（默认 `process.env`）。
 * @returns 有没有改（没改 ⇒ 原来的值已经是对的）。
 */
export function alignDatabaseUrl(
	databaseUrl: string,
	target: Record<string, string | undefined> = process.env,
): boolean {
	if (target["DATABASE_URL"] === databaseUrl) {
		return false;
	}
	target["DATABASE_URL"] = databaseUrl;
	return true;
}

// ⚠️ **必须在建 PrismaClient 之前**对齐（客户端一创建就把连接串读走了）。
alignDatabaseUrl(env.databaseUrl);

/**
 * dev 热重载会反复重新求值模块，把实例挂到 `globalThis` 上，
 * 免得每次热重载都新建一个连接池（连接泄漏）。
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
	globalForPrisma.prisma = prisma;
}
