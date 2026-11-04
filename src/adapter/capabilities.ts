/**
 * 能力位 —— 声明 AiAdmin 后端**实际支持**什么。
 *
 * 上层（agent 的工具定义、前端的提示语）据此决定「能不能做」「要不要先跟用户确认」，
 * 所以每一条都必须有**可复核的依据**（哪个端点 / 哪张表），
 * 不能凭 AIPM 文档的设计意图写。
 *
 * 事实源（只读参考）：
 * - `D:/project/AiAdmin/backend/app/plugin/module_pm_project/**`
 * - `D:/project/AiAdmin/backend/app/plugin/module_pm_risk/**`
 * - `D:/project/AiAdmin/backend/app/plugin/module_pm_comment/**`
 * - `D:/project/AiAdmin/backend/app/core/base_params.py`
 * - `D:/project/AiAdmin/backend/app/init_app.py`
 * - `D:/project/AiAdmin/backend/sql/mysql/pm_v2_schema_v1.sql`
 */

/** 能力位的形状。 */
export interface Capabilities {
	/** 能否删除（物理删除，不可恢复）。 */
	supportsDelete: boolean;
	/** 能否「一次改多个字段 × 多条记录」。 */
	supportsBatchUpdate: boolean;
	/** 能否取到字段级历史（改动前的旧值）。 */
	supportsHistory: boolean;
	/** 能否存自定义字段（extra_fields 之类）。 */
	supportsCustomFields: boolean;
	/** 是否有任务依赖图（前置/后继关系）。 */
	supportsDependencyGraph: boolean;
	/** 能否挂评论。 */
	supportsComments: boolean;
	/** 一次批量操作最多处理多少条。 */
	maxBatchSize: number;
	/** 每分钟最多能打多少个请求（用于自我节流）。 */
	rateLimitPerMinute: number;
}

/**
 * 能力位矩阵 —— **按实测，不按 AIPM 的设想**。
 *
 * 与计划里的假设有一处偏差：`rateLimitPerMinute` 计划写 60，
 * 实测后端限流是 `RateLimiter(times=200, seconds=10)` ⇒ 折合 **1200 次/分钟**
 * （见 `app/init_app.py` 里 `get_dynamic_router()` 挂的依赖）。
 * 其余七条与计划一致（详见 task-4-report.md）。
 */
export const CAPABILITIES: Capabilities = {
	/**
	 * ✅ 能删。
	 * 依据：`pm_task/controller.py` 的 `delete_obj_controller` ——
	 * `DELETE /pm_project/pm_task/delete`，请求体是**裸数组** `[1, 2]`（不是 `{ids:[]}`）。
	 * ⚠️ 是物理删除，不可恢复。
	 */
	supportsDelete: true,

	/**
	 * ❌ 不能批量改字段。
	 * 依据：任务模块只有 `PATCH /pm_project/pm_task/status/batch`，
	 * 请求体是 `BatchSetAvailable`（`app/core/base_schema.py`）= `{ids: list[int], status: int}`，
	 * 其中 `status` 是 0/1 的**可用标记**，写的是框架的 `status` 列，**不是** PM 的 `status_code`
	 * （controller 的描述「todo→doing」与实际行为不符）。
	 * ⇒ 没有「一次改多个字段 × 多条记录」的端点，批量更新只能逐条 PUT。
	 */
	supportsBatchUpdate: false,

	/**
	 * ❌ 没有字段级历史。
	 * 依据：PM 插件的模型里只有 `module_pm_project` / `module_pm_milestone` / `module_pm_task` /
	 * `module_pm_risk` / `module_pm_project_member` / `module_pm_comment` / `module_pm_meeting`，
	 * **没有**任何 `*_history` / `*_audit` 表（`pm_v2_schema_v1.sql` 里也没有）。
	 * ⇒ 撤销只能做成**补偿式**（再写一次把值改回去），不能「回滚到某个版本」。
	 */
	supportsHistory: false,

	/**
	 * ✅ 能存自定义字段。
	 * 依据：`module_pm_project.extra_fields`（JSON 列，见 `pm_project/model.py`）。
	 * ⚠️ **只有项目有**：任务、里程碑、风险都没有自定义字段列。
	 */
	supportsCustomFields: true,

	/**
	 * ❌ 没有依赖图。
	 * 依据：`module_pm_task_dependency` **只有建表 SQL**（`pm_v2_schema_v1.sql`），
	 * 全仓搜不到对应的 SQLAlchemy model，也没有 controller
	 * ⇒ 依赖关系写得进去、读不出来（依赖读写端点都不存在）。
	 */
	supportsDependencyGraph: false,

	/**
	 * ✅ 能挂评论。
	 * 依据：`module_pm_comment` 插件有完整 CRUD（`app/plugin/module_pm_comment/pm_comment/controller.py`，
	 * 路径 `/pm_comment/pm_comment/*`），且通过 `target_type_code` 多态挂到
	 * 任务/里程碑/项目/风险（字典 `module_pm_comment_target_type`）。
	 */
	supportsComments: true,

	/**
	 * 一次最多 100 条。
	 * 依据：`PaginationQueryParam.page_size` 的上限是 `le=100`（`app/core/base_params.py`）。
	 * ⚠️ 删除/批改端点的 `ids` 数组本身**没有长度上限**（后端不校验），
	 * 这里取 100 是因为「一次最多能拉回来的条数」就是 100，批量操作按同一上限封顶最稳。
	 */
	maxBatchSize: 100,

	/**
	 * 每分钟 1200 次。
	 * 依据：`app/init_app.py` 里插件路由挂的是 `RateLimiter(times=200, seconds=10)`
	 * （`app.include_router(router=get_dynamic_router(), dependencies=[Depends(RateLimiter(times=200, seconds=10))])`）
	 * ⇒ 200 次 / 10 秒 = **1200 次 / 分钟**。
	 * ⚠️ fastapi-limiter 没传 `key_func`，默认按**客户端 IP** 计数 ——
	 * 本服务与同出口 IP 的其它调用方共享这个额度。
	 */
	rateLimitPerMinute: 1200,
};
