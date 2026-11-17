/**
 * 库连接串**由配置决定** —— 「换库只改配置」的那根线。
 *
 * ## 为什么要有这个测试
 *
 * Prisma 的 datasource 只能写死**一个**环境变量名（`env("DATABASE_URL")`）⇒
 * 「本服务用自己的库」这件事靠**建客户端之前**把那个变量指向真正的连接串。
 *
 * ⚠️ 这段逻辑藏在 **import 副作用**里（`db.ts` 一被 import 就对齐）⇒
 * 不测的话，它坏了没人知道（表现是「连错库」，最难查的那种）。
 *
 * ⇒ 这里把对齐逻辑抽成一个**可注入**的纯函数（`alignDatabaseUrl`）⇒ 单测直接验它。
 */

import { describe, expect, it } from "vitest";
import { alignDatabaseUrl } from "./db.ts";
import { parseEnv } from "./env.ts";

describe("库连接串由配置决定", () => {
	it("用自己的库 ⇒ 把 Prisma 认的那个变量指过去", () => {
		const target: Record<string, string | undefined> = {
			DATABASE_URL: "mysql://shared/aipm",
		};

		expect(alignDatabaseUrl("mysql://own/ai_own", target)).toBe(true);
		expect(target["DATABASE_URL"]).toBe("mysql://own/ai_own");
	});

	it("本来就对 ⇒ **不动** `process.env`（今天的部署一个字不改）", () => {
		const target: Record<string, string | undefined> = {
			DATABASE_URL: "mysql://shared/aipm",
		};

		expect(alignDatabaseUrl("mysql://shared/aipm", target)).toBe(false);
		expect(target["DATABASE_URL"]).toBe("mysql://shared/aipm");
	});

	it("配了自己的库 ⇒ env 解析出来的就是它（配置说了算）", () => {
		const parsed = parseEnv({
			MINIMAX_CN_API_KEY: "k",
			AI_MODEL: "minimax-cn/MiniMax-M3.1-Flash",
			AIADMIN_BASE_URL: "http://aiadmin.test/api/v1",
			DATABASE_URL: "mysql://shared/aipm",
			AI_DATABASE_URL: "mysql://own/ai_own",
			ALLOWED_ORIGINS: "http://localhost:8000",
		});

		expect(parsed.databaseUrl).toBe("mysql://own/ai_own");
	});
});
