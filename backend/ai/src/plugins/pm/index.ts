/**
 * PM 插件 —— **业务能力的一包**（命令目录 + 身份查询）。
 *
 * ## 这个插件负责什么
 *
 * - **命令**：`pm_create_task`（在 AiAdmin 的项目下新建一条任务；
 *   ⚠️ **不叫** `create_task` —— 那是 AiAdmin 后端 MCP 那个工具的裸名，
 *   同名两义会让模型挑错 ⇒ issue #182 · C18-1）；
 * - **身份**：问 AiAdmin「当前用户是谁」（内核只认「有个用户 id」）。
 *
 * ## 为什么命令目录在插件里
 *
 * 「任务 / 项目 / 里程碑」是**业务概念** ⇒ 内核（`core/**`）不许出现它们。
 * 内核只认**一种形状**（`core/mcp/tool.ts` 的 MCP 工具）⇒ 插件把命令登记好，
 * 注册表送进来，内核照单注册给模型。
 *
 * ## 依赖方向
 *
 * 插件 → 内核 ✓（可以）；内核 → 插件 ✗（不许）。
 */

import { env } from "../../core/env/env.ts";
import type { AiPlugin } from "../../core/plugins.ts";
import {
	CachedCurrentUserResolver,
	type AdminJudge,
	type CurrentUserResolver,
} from "../../core/session/identity.ts";
import type { McpToolDefinition } from "../../core/mcp/tool.ts";
import { AadminClient } from "./adapter/aadmin/client.ts";
import { AadminCurrentUserResolver } from "./adapter/aadmin/current-user.ts";
import { createAdminJudge } from "./adapter/aadmin/admin-judge.ts";
import { AadminDataSource } from "./adapter/datasource.ts";
import { setEnumWarningSink, standardEnumWarningSink } from "./adapter/enums.ts";
import { pmContextProvider } from "./context/pm-context.ts";
import { pmEnv } from "./env.ts";
import { probeAiAdmin } from "./health.ts";
import {
	createPmCreateTaskTool,
	type TaskCreator,
} from "./tools/pm-create-task.ts";

/** 插件 id（智能体配置里用它指明「这个智能体用哪个插件」—— 那是后面的阶段）。 */
export const PM_PLUGIN_ID = "pm";

/** PM 插件的依赖（**测试可以注入假的** ⇒ 单测不必打 AiAdmin）。 */
export interface PmPluginOptions {
	/** 造一个带 token 的数据源（默认：真数据源 ⇒ 打 AiAdmin）。 */
	createDataSource?: (token: string) => TaskCreator;
	/** 怎么问当前用户（默认：问 AiAdmin）。 */
	currentUser?: CurrentUserResolver;
	/** 怎么判 admin（默认：问 AiAdmin 的 `is_superuser`）。 */
	adminJudge?: AdminJudge;
}

/**
 * PM 的命令目录（**MCP 工具形状** —— issue #169 · S3）。
 *
 * ⚠️ 破坏性**不在这儿写** —— 它由**工具自己的 annotations** 决定
 *    （`destructiveHint: false`：新建是可补偿的 ⇒ 非破坏性 ⇒ 不需要待确认）。
 *
 * ⚠️ **工具定义是纯静态的**（token / 审计 / 闸门在**调用时**给）
 *    ⇒ 一份定义可以复用到所有会话。
 *
 * ⚠️ **命令名不许与 MCP 工具的裸名撞车**（issue #182 · C18-1）
 *    ⇒ `pm_create_task`（我们的）≠ `create_task`（MCP 的）
 *    ⇒ 守卫会盯着（`scripts/e2e/mcp-tools-snapshot.static.cjs`）。
 */
export function createPmCommands(
	options: PmPluginOptions = {},
): readonly McpToolDefinition[] {
	const createDataSource = options.createDataSource ?? defaultDataSourceFactory();
	return [createPmCreateTaskTool({ createDataSource })];
}

/** 造 PM 插件（**注册表里现在只有它**）。 */
export function createPmPlugin(options: PmPluginOptions = {}): AiPlugin {
	// ⚠️ 进程级的告警去处也装上（不只数据源这一条路径）
	//    ⇒ 「不猜语义」的承诺是**可观测**的（枚举归一遇到不认识的线上码要打日志）。
	setEnumWarningSink(standardEnumWarningSink);
	// ⚠️ **身份与 admin 判定共用同一份缓存** ⇒ 同一个 token 只问一次 AiAdmin
	//    （管理面是整页 iframe ⇒ 几十个资源 ⇒ 不缓存就是几十次问权威系统）。
	const currentUser = options.currentUser ?? defaultCurrentUserResolver();
	return {
		id: PM_PLUGIN_ID,
		label: "PM 业务插件",
		commands: createPmCommands(options),
		currentUser,
		// ⚠️ **admin 判定 = 问 AiAdmin**（不是解 token 载荷 ⇒ 伪造载荷提不了权）
		adminJudge: options.adminJudge ?? createAdminJudge(currentUser),
		context: pmContextProvider,
		// ⚠️ **探针与默认地址也归插件** ⇒ 内核不认识 AiAdmin
		health: { aiadmin: probeAiAdmin },
		mcpDefaultUrl: pmEnv.AIADMIN_MCP_URL,
	};
}

/** 默认的数据源工厂（打 AiAdmin）。 */
function defaultDataSourceFactory(): (token: string) => TaskCreator {
	return (token) =>
		new AadminDataSource({
			client: new AadminClient({ baseUrl: pmEnv.AIADMIN_BASE_URL }),
			token,
			// ⚠️ 告警不许被悄悄丢掉 ⇒ 注入一个会打日志的去处
			onWarning: standardEnumWarningSink,
		});
}

/**
 * 默认的当前用户解析器（问 AiAdmin + 内核那层短缓存）。
 *
 * ⚠️ **缓存很重要**：管理面是整页 iframe ⇒ 几十个静态资源 ⇒
 *    不缓存就是几十次「问权威系统」。
 */
function defaultCurrentUserResolver(): CurrentUserResolver {
	return new CachedCurrentUserResolver(
		new AadminCurrentUserResolver(new AadminClient({ baseUrl: pmEnv.AIADMIN_BASE_URL })),
	);
}
