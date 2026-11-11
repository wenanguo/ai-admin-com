import { describe, expect, it } from "vitest";
import { CAPABILITIES } from "./capabilities.ts";
import { PM_PATHS } from "../aadmin/types.ts";

/**
 * 能力位必须被**钉死** —— 注释不是断言。
 *
 * 每条的依据都写在后端源码里（只读参考）：
 * - `D:/project/AiAdmin/backend/app/plugin/module_pm_project/pm_task/controller.py`
 * - `D:/project/AiAdmin/backend/app/plugin/module_pm_project/pm_project/model.py`
 * - `D:/project/AiAdmin/backend/app/core/base_params.py`（分页上限）
 * - `D:/project/AiAdmin/backend/app/init_app.py`（限流）
 * - `D:/project/AiAdmin/backend/sql/mysql/pm_v2_schema_v1.sql`（建表 SQL）
 *
 * 改这里的值 = 改对后端的认知，必须同时改测试与注释。
 */
describe("能力位", () => {
	it("整体被钉死（一次改动就要改测试）", () => {
		expect(CAPABILITIES).toEqual({
			supportsDelete: true,
			deleteMode: "SOFT",
			supportsBatchUpdate: false,
			supportsHistory: false,
			supportsCustomFields: true,
			supportsDependencyGraph: false,
			supportsComments: true,
			maxBatchSize: 100,
			rateLimitPerMinute: 1200,
		});
	});

	it("逐项断言（每条附实测依据）", () => {
		// 有删除端点：DELETE /pm_project/pm_task/delete（请求体是裸数组）
		expect(CAPABILITIES.supportsDelete).toBe(true);
		// ⚠️ 删除是**软删除**（不是物理删除）：`BaseCRUD.delete` 只置 is_deleted / deleted_time / deleted_id，
		// 行仍在表里 ⇒ 一条 UPDATE … SET is_deleted = 0 就能恢复。
		// （后端 controller 自己的 docstring 写着「物理删除」—— 那是错的，以 base_crud.py 的实现为准。）
		expect(CAPABILITIES.deleteMode).toBe("SOFT");
		// 没有「多字段批量更新」：只有 PATCH .../status/batch，且它写的是框架的 status 列（0/1）
		expect(CAPABILITIES.supportsBatchUpdate).toBe(false);
		// 没有字段级历史表 ⇒ 撤销只能是补偿式
		expect(CAPABILITIES.supportsHistory).toBe(false);
		// module_pm_project.extra_fields 是 JSON 列
		expect(CAPABILITIES.supportsCustomFields).toBe(true);
		// module_pm_task_dependency 只有建表 SQL，没有 model/controller
		expect(CAPABILITIES.supportsDependencyGraph).toBe(false);
		// module_pm_comment 插件有完整 CRUD
		expect(CAPABILITIES.supportsComments).toBe(true);
		// PaginationQueryParam.page_size 上限 le=100
		expect(CAPABILITIES.maxBatchSize).toBe(100);
		// 插件路由挂的是 RateLimiter(times=200, seconds=10) ⇒ 200 次/10 秒 = 1200 次/分钟
		expect(CAPABILITIES.rateLimitPerMinute).toBe(1200);
	});

	it("能力位引用的路径与 PM_PATHS 一致（路径写错 ⇒ 能力位也会跟着错）", () => {
		expect(PM_PATHS.task.remove).toBe("/pm_project/pm_task/delete");
		expect(PM_PATHS.task.statusBatch).toBe("/pm_project/pm_task/status/batch");
		expect(PM_PATHS.task.list).toBe("/pm_project/pm_task/list");
	});

	it("批量上限不超过后端分页上限", () => {
		expect(CAPABILITIES.maxBatchSize).toBeLessThanOrEqual(100);
		expect(CAPABILITIES.maxBatchSize).toBeGreaterThan(0);
	});
});
