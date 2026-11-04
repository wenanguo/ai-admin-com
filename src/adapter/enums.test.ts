import { afterEach, describe, expect, it, vi } from "vitest";
import {
	ENUM_TABLES,
	clearEnumWarnings,
	getEnumWarnings,
	milestoneStatusFromUnified,
	milestoneStatusToUnified,
	priorityFromUnified,
	priorityToUnified,
	projectStatusFromUnified,
	projectStatusToUnified,
	riskCategoryFromUnified,
	riskCategoryToUnified,
	riskStatusFromUnified,
	riskStatusToUnified,
	setEnumWarningSink,
	TASK_STATUS_MAPPING,
	taskSourceToUnified,
	taskStatusFromUnified,
	taskStatusToUnified,
	taskTypeFromUnified,
	taskTypeToUnified,
	type EnumWarning,
} from "./enums";

/**
 * 归一表里的值必须与后端字典逐字一致。
 * 字典来源（只读参考）：
 * - `D:/project/AiAdmin/backend/sql/mysql/pm_v2_seed_v1.sql`（种子的 dict_value 列）
 * - 线上库 `sys_dict_data`（2026-11-04 实测；module_pm_project_status 线上少了
 *   on_hold/cancelled，详见 task-4-report.md 的「实测与计划的偏差」）
 *
 * 这里写死一遍，是为了让「字典被人改了」在测试里立刻炸掉，而不是悄悄改变归一结果。
 */
const EXPECTED_WIRE_VALUES: Record<string, string[]> = {
	task_status: ["backlog", "todo", "in_progress", "blocked", "review", "done", "cancelled"],
	task_type: ["feature", "bug", "ops", "research", "spike"],
	priority: ["P0", "P1", "P2", "P3"],
	project_status: ["planning", "active", "on_hold", "completed", "cancelled", "archived"],
	milestone_status: ["upcoming", "in_progress", "at_risk", "done", "missed"],
	risk_status: ["identified", "analyzing", "mitigating", "realized", "closed"],
	risk_category: ["schedule", "scope", "quality", "resource", "compliance"],
	task_source: ["manual", "nl_chat", "import", "api"],
};

/** 收集告警用的 sink（用数组而不是 `as`，免得测试里出现类型断言）。 */
function collector(): { warnings: EnumWarning[]; sink: (warning: EnumWarning) => void } {
	const warnings: EnumWarning[] = [];
	return { warnings, sink: (warning) => void warnings.push(warning) };
}

afterEach(() => {
	setEnumWarningSink(undefined);
	clearEnumWarnings();
});

describe("枚举归一 · 每一对都能来回", () => {
	it("八个字典的线上码与后端字典逐字一致", () => {
		for (const table of ENUM_TABLES) {
			const actual = [...table.toWire.values()].flat();
			expect(actual).toEqual(EXPECTED_WIRE_VALUES[table.field]);
		}
	});

	it("线上码 → 统一名 → 线上码（往返不丢信息）", () => {
		for (const table of ENUM_TABLES) {
			for (const [unified, codes] of table.toWire) {
				for (const code of codes) {
					expect(table.toUnified(code)).toBe(unified);
				}
				// 反向：统一名 → **第一个**线上码
				expect(table.fromUnified(unified)).toBe(codes[0]);
			}
		}
	});

	it("统一名本身也是合法的输入（大小写不敏感）", () => {
		expect(taskStatusToUnified("IN_PROGRESS")).toBe("IN_PROGRESS");
		expect(taskStatusToUnified("in_progress")).toBe("IN_PROGRESS");
		expect(taskStatusToUnified("In_Progress")).toBe("IN_PROGRESS");
		expect(priorityToUnified("P1")).toBe("P1");
		expect(priorityToUnified("p1")).toBe("P1");
	});

	it("recognizes 认统一名与线上码（忽略大小写），不认识的一律 false", () => {
		expect(TASK_STATUS_MAPPING.recognizes("IN_PROGRESS")).toBe(true);
		expect(TASK_STATUS_MAPPING.recognizes("in_progress")).toBe(true);
		expect(TASK_STATUS_MAPPING.recognizes("  done  ")).toBe(true);
		expect(TASK_STATUS_MAPPING.recognizes("ARCHIVED")).toBe(false);
		expect(TASK_STATUS_MAPPING.recognizes("")).toBe(false);
	});
});

describe("枚举归一 · 任务", () => {
	it("任务状态", () => {
		expect(taskStatusToUnified("backlog")).toBe("BACKLOG");
		expect(taskStatusToUnified("todo")).toBe("TODO");
		expect(taskStatusToUnified("in_progress")).toBe("IN_PROGRESS");
		expect(taskStatusToUnified("blocked")).toBe("BLOCKED");
		expect(taskStatusToUnified("review")).toBe("REVIEW");
		expect(taskStatusToUnified("done")).toBe("DONE");
		expect(taskStatusToUnified("cancelled")).toBe("CANCELLED");
		expect(taskStatusFromUnified("CANCELLED")).toBe("cancelled");
	});

	it("任务类型（后端字典是 feature/bug/ops/research/spike，不是 AIPM 的 TASK/CHORE）", () => {
		expect(taskTypeToUnified("feature")).toBe("FEATURE");
		expect(taskTypeToUnified("bug")).toBe("BUG");
		expect(taskTypeToUnified("ops")).toBe("OPS");
		expect(taskTypeToUnified("research")).toBe("RESEARCH");
		expect(taskTypeToUnified("spike")).toBe("SPIKE");
		expect(taskTypeFromUnified("SPIKE")).toBe("spike");
	});

	it("优先级（线上码本身就是 P0~P3）", () => {
		expect(priorityToUnified("P0")).toBe("P0");
		expect(priorityToUnified("P1")).toBe("P1");
		expect(priorityToUnified("P2")).toBe("P2");
		expect(priorityToUnified("P3")).toBe("P3");
		expect(priorityFromUnified("P1")).toBe("P1");
	});

	it("创建来源（字典里没有 web，只有 manual/nl_chat/import/api）", () => {
		expect(taskSourceToUnified("manual")).toBe("MANUAL");
		expect(taskSourceToUnified("nl_chat")).toBe("NL_CHAT");
		expect(taskSourceToUnified("import")).toBe("IMPORT");
		expect(taskSourceToUnified("api")).toBe("API");
	});
});

describe("枚举归一 · 项目 / 里程碑 / 风险", () => {
	it("项目状态", () => {
		expect(projectStatusToUnified("planning")).toBe("PLANNING");
		expect(projectStatusToUnified("active")).toBe("ACTIVE");
		expect(projectStatusToUnified("on_hold")).toBe("ON_HOLD");
		expect(projectStatusToUnified("completed")).toBe("COMPLETED");
		expect(projectStatusToUnified("cancelled")).toBe("CANCELLED");
		expect(projectStatusToUnified("archived")).toBe("ARCHIVED");
		expect(projectStatusFromUnified("ON_HOLD")).toBe("on_hold");
	});

	it("里程碑状态", () => {
		expect(milestoneStatusToUnified("upcoming")).toBe("UPCOMING");
		expect(milestoneStatusToUnified("in_progress")).toBe("IN_PROGRESS");
		expect(milestoneStatusToUnified("at_risk")).toBe("AT_RISK");
		expect(milestoneStatusToUnified("done")).toBe("DONE");
		expect(milestoneStatusToUnified("missed")).toBe("MISSED");
		expect(milestoneStatusFromUnified("AT_RISK")).toBe("at_risk");
	});

	it("风险状态", () => {
		expect(riskStatusToUnified("identified")).toBe("IDENTIFIED");
		expect(riskStatusToUnified("analyzing")).toBe("ANALYZING");
		expect(riskStatusToUnified("mitigating")).toBe("MITIGATING");
		expect(riskStatusToUnified("realized")).toBe("REALIZED");
		expect(riskStatusToUnified("closed")).toBe("CLOSED");
		expect(riskStatusFromUnified("REALIZED")).toBe("realized");
	});

	it("风险分类", () => {
		expect(riskCategoryToUnified("schedule")).toBe("SCHEDULE");
		expect(riskCategoryToUnified("scope")).toBe("SCOPE");
		expect(riskCategoryToUnified("quality")).toBe("QUALITY");
		expect(riskCategoryToUnified("resource")).toBe("RESOURCE");
		expect(riskCategoryToUnified("compliance")).toBe("COMPLIANCE");
		expect(riskCategoryFromUnified("SCHEDULE")).toBe("schedule");
	});
});

describe("枚举归一 · 未命中的值", () => {
	it("归一为该字段的默认值，并且记录一条告警", () => {
		const sink = vi.fn<(warning: EnumWarning) => void>();

		expect(taskStatusToUnified("不存在的状态", sink)).toBe("BACKLOG");
		expect(sink).toHaveBeenCalledTimes(1);

		const warning = sink.mock.calls[0]?.[0];
		expect(warning?.field).toBe("task_status");
		expect(warning?.raw).toBe("不存在的状态");
		expect(warning?.fallback).toBe("BACKLOG");
		expect(warning?.message).toContain("不存在的状态");
	});

	it("每个字段的默认值就是后端字典里 is_default=1 的那一个", () => {
		expect(taskStatusToUnified("???")).toBe("BACKLOG");
		expect(taskTypeToUnified("???")).toBe("FEATURE");
		expect(priorityToUnified("???")).toBe("P2");
		expect(projectStatusToUnified("???")).toBe("PLANNING");
		expect(milestoneStatusToUnified("???")).toBe("UPCOMING");
		expect(riskStatusToUnified("???")).toBe("IDENTIFIED");
		expect(riskCategoryToUnified("???")).toBe("SCHEDULE");
		expect(taskSourceToUnified("???")).toBe("MANUAL");
	});

	it("里程碑没有 cancelled —— 不能借用任务状态的映射", () => {
		const { warnings, sink } = collector();

		expect(milestoneStatusToUnified("cancelled", sink)).toBe("UPCOMING");
		expect(warnings).toHaveLength(1);
		expect(warnings[0]?.raw).toBe("cancelled");
	});

	it("默认的收集器也留痕（不注入 sink 也能查到最后若干条告警）", () => {
		clearEnumWarnings();

		taskStatusToUnified("???");
		priorityToUnified("???");

		const warnings = getEnumWarnings();
		expect(warnings).toHaveLength(2);
		expect(warnings[0]?.field).toBe("task_status");
		expect(warnings[1]?.field).toBe("priority");
	});

	it("按次传入的 sink 优先于全局 sink", () => {
		const global = vi.fn<(warning: EnumWarning) => void>();
		const local = vi.fn<(warning: EnumWarning) => void>();
		setEnumWarningSink(global);

		taskStatusToUnified("???", local);

		expect(local).toHaveBeenCalledTimes(1);
		expect(global).not.toHaveBeenCalled();
	});

	it("反向映射遇到不认识的统一名 ⇒ 退回默认值的标准码并告警", () => {
		const { warnings, sink } = collector();

		expect(TASK_STATUS_MAPPING.fromUnified("IN_REVIEW", sink)).toBe("backlog");
		expect(warnings).toHaveLength(1);
		expect(warnings[0]?.fallback).toBe("BACKLOG");
	});
});
