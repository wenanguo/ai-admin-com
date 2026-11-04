import { PrismaClient } from "@prisma/client";

/**
 * PrismaClient 单例。
 * dev 热重载会反复重新求值模块，把实例挂到 `globalThis` 上，
 * 免得每次热重载都新建一个连接池（连接泄漏）。
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
	globalForPrisma.prisma = prisma;
}
