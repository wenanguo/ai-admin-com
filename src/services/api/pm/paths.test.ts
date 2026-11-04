import { request } from '@umijs/max';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createMilestone,
  deleteMilestones,
  getMilestoneDetail,
  listMilestones,
  updateMilestone,
} from './milestone';
import {
  PM_MILESTONE_PREFIX,
  PM_PROJECT_PREFIX,
  PM_RISK_PREFIX,
  PM_TASK_PREFIX,
} from './paths';
import {
  createProject,
  deleteProjects,
  getProjectDetail,
  getProjectMembers,
  listProjects,
  updateProject,
} from './project';
import {
  createRisk,
  deleteRisks,
  getRiskDetail,
  listRisks,
  updateRisk,
} from './risk';
import {
  createTask,
  deleteTasks,
  getTaskDetail,
  listTasks,
  updateTask,
} from './task';

vi.mock('@umijs/max', () => ({
  request: vi.fn(),
}));

/**
 * PM 路由前缀的守卫测试。
 *
 * 这个 bug 的教训:e2e 拦截的 URL 与 service 层请求的 URL 是同一份字面量,
 * 两边一起写错 ⇒ 单测全绿、e2e 全绿,而线上每个接口都 404。
 *
 * 现在前缀只有一处出处(`./paths`),service 层与 e2e 用例都从它拼 URL。
 * 本文件把两头都钉住:
 * - 前缀常量与后端**已部署**的路由逐字一致(抄自 openapi.json,不是抄自己);
 * - service 层实际请求的 URL 全部由这些常量拼出(不许再写死字面量)。
 */

/** 项目新增/更新的必填集(后端 UpdateSchema 继承 CreateSchema) */
const projectFixture = {
  code: 'APP_REWORK',
  name: '管理后台重构',
  owner_id: 1,
  status_code: 'planning',
  priority_code: 'P1',
  start_date: '2026-11-03',
  due_date: '2026-12-31',
  visibility_code: 'private',
};

/** 里程碑的必填集 */
const milestoneFixture = {
  project_id: 3,
  name: 'M1 需求冻结',
  start_date: '2026-11-03',
  due_date: '2026-11-30',
  status_code: 'not_started',
  sort_order: 1,
};

/** 任务的必填集 */
const taskFixture = {
  project_id: 3,
  title: '梳理风险清单',
  type_code: 'feature',
  status_code: 'todo',
  priority_code: 'P2',
};

/** 风险的必填集(score 由调用方算好传入) */
const riskFixture = {
  project_id: 3,
  title: '后端接口延期',
  category_code: 'schedule',
  probability: 3,
  impact: 5,
  score: 15,
  status_code: 'open',
  owner_id: 2,
  created_via_code: 'manual',
};

describe('pm 路由前缀', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(request).mockResolvedValue({
      code: 0,
      msg: 'ok',
      data: null,
      status_code: 200,
      success: true,
    });
  });

  it('四个前缀与后端已部署的路由逐字一致', () => {
    // 对照 https://www.pmdict.cn/api/v1/openapi.json 的 paths 段
    // (2026-11-04 抓取):/pm_project/pm_project/list、
    // /pm_project/pm_milestone/list、/pm_project/pm_task/list、
    // /pm_risk/pm_risk/list —— 前缀重复是因为后端容器前缀与
    // controller 自己的 prefix 拼接,见 paths.ts 的说明。
    expect(PM_PROJECT_PREFIX).toBe('/pm_project/pm_project');
    expect(PM_MILESTONE_PREFIX).toBe('/pm_project/pm_milestone');
    expect(PM_TASK_PREFIX).toBe('/pm_project/pm_task');
    expect(PM_RISK_PREFIX).toBe('/pm_risk/pm_risk');
  });

  it('service 层请求的 URL 全部由前缀常量拼出', async () => {
    await listProjects({});
    await getProjectDetail(7);
    await getProjectMembers(7);
    await createProject(projectFixture);
    await updateProject(7, projectFixture);
    await deleteProjects([1, 2]);

    await listMilestones({});
    await getMilestoneDetail(7);
    await createMilestone(milestoneFixture);
    await updateMilestone(7, milestoneFixture);
    await deleteMilestones([1, 2]);

    await listTasks({});
    await getTaskDetail(7);
    await createTask(taskFixture);
    await updateTask(7, taskFixture);
    await deleteTasks([1, 2]);

    await listRisks({});
    await getRiskDetail(7);
    await createRisk(riskFixture);
    await updateRisk(7, riskFixture);
    await deleteRisks([1, 2]);

    const expectedUrls = [
      `${PM_PROJECT_PREFIX}/list`,
      `${PM_PROJECT_PREFIX}/detail/7`,
      `${PM_PROJECT_PREFIX}/members/7`,
      `${PM_PROJECT_PREFIX}/create`,
      `${PM_PROJECT_PREFIX}/update/7`,
      `${PM_PROJECT_PREFIX}/delete`,
      `${PM_MILESTONE_PREFIX}/list`,
      `${PM_MILESTONE_PREFIX}/detail/7`,
      `${PM_MILESTONE_PREFIX}/create`,
      `${PM_MILESTONE_PREFIX}/update/7`,
      `${PM_MILESTONE_PREFIX}/delete`,
      `${PM_TASK_PREFIX}/list`,
      `${PM_TASK_PREFIX}/detail/7`,
      `${PM_TASK_PREFIX}/create`,
      `${PM_TASK_PREFIX}/update/7`,
      `${PM_TASK_PREFIX}/delete`,
      `${PM_RISK_PREFIX}/list`,
      `${PM_RISK_PREFIX}/detail/7`,
      `${PM_RISK_PREFIX}/create`,
      `${PM_RISK_PREFIX}/update/7`,
      `${PM_RISK_PREFIX}/delete`,
    ];

    for (const url of expectedUrls) {
      expect(request).toHaveBeenCalledWith(url, expect.anything());
    }
    // 数量也对得上:多出来的/漏掉的请求都能被这条抓住
    expect(request).toHaveBeenCalledTimes(expectedUrls.length);
  });
});
