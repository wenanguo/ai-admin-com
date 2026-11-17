/**
 * PM 插件 —— **业务能力的一包**（命令目录 + 身份查询）。
 *
 * ## 这个插件负责什么
 *
 * - **命令**：`create_task`（在 AiAdmin 的项目下新建一条任务）；
 * - **身份**：问 AiAdmin「当前用户是谁」（内核只认「有个用户 id」）。
 *
 * ## 为什么命令目录在插件里
 *
 * 「任务 / 项目 / 里程碑」是**业务概念** ⇒ 内核（`core/**`）不许出现它们。
 * 内核的命令机制（`core/tools/index.ts`）只认 `CommandDefinition` 这个形状 ⇒
 * 插件把命令登记好，注册表送进来，内核照单注册给模型。
 *
 * ## 依赖方向
 *
 * 插件 → 内核 ✓（可以）；内核 → 插件 ✗（不许）。
 */

import { env } from "../../env.ts";
import type { AiPlugin } from "../../core/plugins.ts";
import {
	CachedCurrentUserResolver,
	type CurrentUserResolver,
} from "../../core/session/identity.ts";
import type { CommandDefinition } from "../../core/tools/types.ts";
import { AadminClient } from "./adapter/aadmin/client.ts";
import { AadminCurrentUserResolver } from "./adapter/aadmin/current-user.ts";
import { AadminDataSource } from "./adapter/datasource.ts";
import { setEnumWarningSink, standardEnumWarningSink } from "./adapter/enums.ts";
import {
	createCreateTaskTool,
	CREATE_TASK_TOOL_NAME,
	type TaskCreator,
} from "./tools/create-task.ts";

/** 插件 id（智能体配置里用它指明「这个智能体用哪个插件」—— 那是后面的阶段）。 */
export const PM_PLUGIN_ID = "pm";

/** PM 插件的依赖（**测试可以注入假的** ⇒ 单测不必打 AiAdmin）。 */
export interface PmPluginOptions {
	/** 造一个带 token 的数据源（默认：真数据源 ⇒ 打 AiAdmin）。 */
	createDataSource?: (token: string) => TaskCreator;
	/** 怎么问当前用户（默认：问 AiAdmin）。 */
	currentUser?: CurrentUserResolver;
}

/**
 * PM 的命令目录。
 *
 * ⚠️ 破坏性**不在这儿写** —— 它由**工具自己的 annotations** 决定
 *    （`destructiveHint: false`：新建是可补偿的 ⇒ 非破坏性 ⇒ 不需要待确认）。
 */
export function createPmCommands(
	options: PmPluginOptions = {},
): readonly CommandDefinition[] {
	const createDataSource = options.createDataSource ?? defaultDataSourceFactory();
	return [
		{
			name: CREATE_TASK_TOOL_NAME,
			label: "创建任务",
			build: (context) =>
				createCreateTaskTool({
					currentToken: context.currentToken,
					createDataSource,
					// ⚠️ 内核只说「当前用户 id」；「报告人」是业务语义 ⇒ 插件自己翻译。
					resolveReporterId: context.currentUserId,
					audit: context.audit,
					model: context.model,
					gate: context.gate,
				}),
		},
	];
}

/** 造 PM 插件（**注册表里现在只有它**）。 */
export function createPmPlugin(options: PmPluginOptions = {}): AiPlugin {
	// ⚠️ 进程级的告警去处也装上（不只数据源这一条路径）
	//    ⇒ 「不猜语义」的承诺是**可观测**的（枚举归一遇到不认识的线上码要打日志）。
	setEnumWarningSink(standardEnumWarningSink);
	return {
		id: PM_PLUGIN_ID,
		label: "PM 业务插件",
		commands: createPmCommands(options),
		currentUser: options.currentUser ?? defaultCurrentUserResolver(),
	};
}

/** 默认的数据源工厂（打 AiAdmin）。 */
function defaultDataSourceFactory(): (token: string) => TaskCreator {
	return (token) =>
		new AadminDataSource({
			client: new AadminClient({ baseUrl: env.AIADMIN_BASE_URL }),
			token,
			// ⚠️ 告警不许被悄悄丢掉 ⇒ 注入一个会打日志的去处
			onWarning: standardEnumWarningSink,
		});
}

/** 默认的当前用户解析器（问 AiAdmin + 内核那层短缓存）。 */
function defaultCurrentUserResolver(): CurrentUserResolver {
	return new CachedCurrentUserResolver(
		new AadminCurrentUserResolver(new AadminClient({ baseUrl: env.AIADMIN_BASE_URL })),
	);
}
