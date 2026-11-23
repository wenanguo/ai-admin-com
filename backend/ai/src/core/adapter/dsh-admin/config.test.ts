/**
 * AI 管理面的配置（**环境变量名**）。
 *
 * ⚠️ issue #124 阶段三的真 bug：dsh 的 app-boot 拒收**任何 `.env` 文件**里的 `DSH_*`
 *    （`BOOTSTRAP_PREFIXES`）⇒ 用户照着 `.env.example` 配 `DSH_ADMIN_ENABLED` 就会被
 *    dsh 拒绝启动（管理面虽然缺省关，但那个键在 `.env` 里就够 dsh 炸了）。
 * ⇒ 这里把口径钉住：**只读 `AI_DSH_ADMIN_*`**，旧的 `DSH_ADMIN_*` 一律不认。
 */

import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { dshAdminConfig } from "./config.ts";

describe("dsh 管理面的配置", () => {
	it("缺省：**关** + 端口 8399 + home 落在 AI_DSH_HOME 下", () => {
		const config = dshAdminConfig({ AI_DSH_HOME: "C:/tmp/dsh-home", PORT: "3100" });
		expect(config.enabled).toBe(false);
		expect(config.port).toBe(8399);
		// ⚠️ **期望值用 `join` 算出来**（平台原生的分隔符）——**别写死 `C:\...`**。
		//    写死 ⇒ Linux 上 CI 红（`expected 'C:/tmp/dsh-home/dsh-admin'
		//    to be 'C:\tmp\dsh-home\dsh-admin'`）⇒ 代码（`join`）是对的，测试错了。
		expect(config.home).toBe(join("C:/tmp/dsh-home", "dsh-admin"));
		expect(config.trustedHost).toBe("127.0.0.1:3100");
	});

	it("`AI_DSH_ADMIN_*` 覆盖缺省", () => {
		const config = dshAdminConfig({
			AI_DSH_ADMIN_ENABLED: "1",
			AI_DSH_ADMIN_PORT: "8500",
			AI_DSH_ADMIN_HOME: "C:/tmp/admin",
			AI_DSH_ADMIN_TRUSTED_HOST: "ai.example.com",
		});
		expect(config.enabled).toBe(true);
		expect(config.port).toBe(8500);
		expect(config.home).toBe("C:/tmp/admin");
		expect(config.trustedHost).toBe("ai.example.com");
	});

	it("**旧的 `DSH_ADMIN_*` 不再被读**（否则又教人往 `.env` 里写 `DSH_*`）", () => {
		const config = dshAdminConfig({
			DSH_ADMIN_ENABLED: "1",
			DSH_ADMIN_PORT: "8500",
			DSH_ADMIN_HOME: "C:/tmp/old-admin",
			DSH_ADMIN_TRUSTED_HOST: "old.example.com",
		});
		expect(config.enabled).toBe(false);
		expect(config.port).toBe(8399);
		expect(config.home).not.toBe("C:/tmp/old-admin");
		expect(config.trustedHost).not.toBe("old.example.com");
	});
});
