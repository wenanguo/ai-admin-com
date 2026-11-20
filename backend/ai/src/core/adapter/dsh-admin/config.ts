/**
 * AI 管理面的**配置**（4 个环境变量）。
 *
 * | 变量 | 缺省 | 干什么 |
 * | ---- | ---- | ------ |
 * | `DSH_ADMIN_ENABLED` | `0` | 总开关（**缺省关** ⇒ 不配就不起 dsh web）|
 * | `DSH_ADMIN_PORT` | `8399` | dsh web 监听端口（**只绑 loopback**）|
 * | `DSH_ADMIN_HOME` | `<DSH_HOME>/dsh-admin` | dsh 的 home（⚠️ **必须在可写目录** ⇒ 容器里要挂卷）|
 * | `DSH_ADMIN_TRUSTED_HOST` | `127.0.0.1:<服务端口>` | `--trusted-host` 的值（⚠️ **必须等于浏览器看到的 host[:port]**）|
 *
 * ⚠️ **总开关缺省是关的** ⇒ 不配就**不起** dsh web、不挂 `/dsh-admin` 路由
 *    （管理面是**可选能力**，不是服务的必需件）。
 */

import { join } from "node:path";

/** AI 管理面的配置。 */
export interface DshAdminConfig {
	/** 总开关（缺省关）。 */
	enabled: boolean;
	/** dsh web 监听端口（**只绑 loopback**）。 */
	port: number;
	/** dsh 的 home（**独立目录** ⇒ 不与服务的 `sdk` profile 混）。 */
	home: string;
	/** 浏览器可见的 authority（`--trusted-host` 的值）。 */
	trustedHost: string;
}

/**
 * 读 AI 管理面的配置。
 *
 * @param source 环境变量来源（测试可注入假值）。
 */
export function dshAdminConfig(source: NodeJS.ProcessEnv = process.env): DshAdminConfig {
	const servicePort = source.PORT ?? "3100";
	// ⚠️ **独立的 home** ⇒ 别跟服务的 `sdk` profile 混（配置文件 / 会话 / 插件目录都要分开）
	const dshHome = source.DSH_HOME ?? join(process.cwd(), ".dsh-home");
	return {
		enabled: isEnabled(source.DSH_ADMIN_ENABLED),
		port: numberOf(source.DSH_ADMIN_PORT, 8399),
		home: source.DSH_ADMIN_HOME ?? join(dshHome, "dsh-admin"),
		// ⚠️ 缺省 = 我们自己对外的 authority（栅栏会比对 ⇒ 不对就全 403）
		trustedHost: source.DSH_ADMIN_TRUSTED_HOST ?? `127.0.0.1:${servicePort}`,
	};
}

/** 环境变量里的开关（`1` / `true` / `yes` / `on` ⇒ 开）。 */
function isEnabled(raw: string | undefined): boolean {
	if (raw === undefined) {
		return false;
	}
	const value = raw.trim().toLowerCase();
	return value === "1" || value === "true" || value === "yes" || value === "on";
}

/** 环境变量里的端口（坏了就用缺省值）。 */
function numberOf(raw: string | undefined, fallback: number): number {
	if (raw === undefined) {
		return fallback;
	}
	const value = Number(raw);
	return Number.isInteger(value) && value > 0 && value < 65536 ? value : fallback;
}
