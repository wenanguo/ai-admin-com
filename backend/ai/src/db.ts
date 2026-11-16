import { PrismaClient } from "@prisma/client";
import { env } from "./env.ts";

/**
 * PrismaClient 单例。
 * dev 热重载会反复重新求值模块，把实例挂到 `globalThis` 上，
 * 免得每次热重载都新建一个连接池（连接泄漏）。
 */

// ⚠️ **本服务自己的库优先**（`AI_DATABASE_URL`）。
//
// Prisma 的 datasource 只能写死**一个环境变量名**（`env("DATABASE_URL")`）⇒
// 「换库只改配置」就得在**建客户端之前**把 `DATABASE_URL` 对齐成实际要用的那个。
//
// ⚠️ 只在**两者不同**时写 ⇒ 不配 `AI_DATABASE_URL` 时 `process.env` 原样不动
//    （今天的部署一个字不用改）。
if (process.env.DATABASE_URL !== env.databaseUrl) {
	process.env.DATABASE_URL = env.databaseUrl;
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
	globalForPrisma.prisma = prisma;
}
