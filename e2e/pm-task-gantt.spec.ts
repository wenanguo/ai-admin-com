import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import {
  PM_MILESTONE_PREFIX,
  PM_PROJECT_PREFIX,
  PM_TASK_PREFIX,
} from '../src/services/api/pm/paths';
import { gotoModulePage, mainContent, setupModulePage } from './helpers';

/**
 * 任务甘特页(/pm/task/gantt)的前端闭环,接口全部拦截。
 *
 * 覆盖六件事(brief 逐条):
 * - 渲染出甘特容器 `.gantt_container`,行数 = 任务条数 + 分组行数;
 * - **被截断**时提示说清「共 N 条,已显示前 M 条」(分页口径);
 * - **缺计划起止日期**的任务给出提示(不静默丢),并列出被排除的标题;
 * - 列表页工具栏的「甘特」按钮能进甘特页;
 * - 没有 `…:update` 权限时条形不可拖拽;
 * - 时间轴被挤窄时给出提示,收起 AI 工作台(⌘B)后提示消失。
 *
 * 菜单树:PM 模块挂在「/pm」目录下(helpers.buildCurrentUserResponse 的
 * MenuParent 参数),甘特菜单的相对 route_path 'task/gantt' 会被拼到 /pm 下,
 * 必须与前端路由表对齐。
 */

const GANTT_PAGE_PATH = '/pm/task/gantt';
const TASK_LIST_URL = `**/api/v1${PM_TASK_PREFIX}/list**`;
const PROJECT_LIST_URL = `**/api/v1${PM_PROJECT_PREFIX}/list**`;
const MILESTONE_LIST_URL = `**/api/v1${PM_MILESTONE_PREFIX}/list**`;
/** 字典选项接口(状态/优先级的显示文案) */
const DICT_DATA_URL = '**/api/v1/system/dict/data/info/**';
/** 列表页「负责人」的远程搜索用(不拦的话会打到真实后端并 401) */
const USER_LIST_URL = '**/api/v1/system/user/list**';
/** AI 工作台的会话接口(同样不拦) */
const AI_API_URL = '**/ai-api/api/**';

/**
 * PM 菜单树里的甘特菜单(type=2)+ 一个按钮权限节点(type=3)。
 *
 * 甘特是「读 + 改期」的面:列表要 `…:query`,拖拽改期要 `…:update`。
 * type=3 节点授予权限但不出现在侧边栏。
 */
const ganttMenu = {
  title: '任务甘特',
  routePath: 'task/gantt',
  permission: 'module_pm_project:pm_task:query',
  buttons: [
    {
      title: '编辑任务',
      permission: 'module_pm_project:pm_task:update',
    },
  ],
};

/** 字典选项的信封(label 给人看,value 是线上码) */
function dictDataResponse(
  items: { dict_label: string; dict_value: string; list_class: string }[],
) {
  return {
    code: 0,
    msg: '查询成功',
    data: items,
    status_code: 200,
    success: true,
  };
}

/** 任务状态字典(后端种子 SQL 的七态) */
const taskStatusDictResponse = dictDataResponse([
  { dict_label: '待规划', dict_value: 'backlog', list_class: 'default' },
  { dict_label: '待办', dict_value: 'todo', list_class: 'info' },
  { dict_label: '进行中', dict_value: 'in_progress', list_class: 'primary' },
  { dict_label: '阻塞', dict_value: 'blocked', list_class: 'warning' },
  { dict_label: '评审', dict_value: 'review', list_class: 'primary' },
  { dict_label: '已完成', dict_value: 'done', list_class: 'success' },
  { dict_label: '已取消', dict_value: 'cancelled', list_class: 'danger' },
]);

/**
 * 字典选项的响应体。
 *
 * ⚠️ 一条 glob 接管所有字典类型(`…/dict/data/info/**`):甘特页只用到
 * 任务状态与优先级两个字典,列标题与列内容都按线上码查 ⇒ 一份信封够用。
 */

/** 一条任务的数据(形状对齐后端的 TaskOut) */
function taskRow(row: {
  id: number;
  title: string;
  status_code: string;
  priority_code?: string;
  start_date?: string | null;
  due_date?: string | null;
}): Record<string, unknown> {
  return {
    id: row.id,
    project_id: 1,
    milestone_id: 11,
    parent_id: null,
    title: row.title,
    description: '需求评审通过后交付',
    type_code: 'feature',
    status_code: row.status_code,
    priority_code: row.priority_code ?? 'P1',
    estimate_hours: 8,
    actual_hours: null,
    assignee_id: 1,
    reporter_id: 2,
    reviewers: null,
    labels: null,
    start_date: row.start_date ?? null,
    due_date: row.due_date ?? null,
    actual_start_date: null,
    actual_end_date: null,
    sort_order: 0,
    created_via_code: 'manual',
    blocked_reason: null,
    assignee_by: { id: 1, name: '张三', username: 'zhangsan' },
    reporter_by: { id: 2, name: '李四', username: 'lisi' },
    created_time: '2026-11-01 09:00:00',
    updated_time: '2026-11-04 09:00:00',
  };
}

/** 三条**带日期**的任务(都能画进甘特) */
const datedTasks = [
  taskRow({
    id: 31,
    title: '梳理需求清单',
    status_code: 'backlog',
    start_date: '2026-11-02',
    due_date: '2026-11-06',
  }),
  taskRow({
    id: 32,
    title: '搭建脚手架',
    status_code: 'in_progress',
    start_date: '2026-11-05',
    due_date: '2026-11-16',
  }),
  taskRow({
    id: 33,
    title: '输出需求规格说明书',
    status_code: 'todo',
    priority_code: 'P0',
    start_date: '2026-11-10',
    due_date: '2026-11-20',
  }),
];

/** 分页信封 */
function listEnvelope(items: Record<string, unknown>[], total: number) {
  return {
    code: 0,
    msg: '查询成功',
    data: {
      items,
      total,
      page_no: 1,
      page_size: 100,
      has_next: total > items.length,
    },
    status_code: 200,
    success: true,
  };
}

/** 默认的任务列表响应:三条带日期的任务,总数就是 3 */
const defaultTaskList = listEnvelope(datedTasks, datedTasks.length);

/** 项目/里程碑的侧载列表(甘特页的分组行名字与项目筛选都要它) */
const projectList = {
  code: 0,
  msg: '查询成功',
  data: {
    items: [{ id: 1, name: 'AIPM 核心项目' }],
    total: 1,
    page_no: 1,
    page_size: 100,
    has_next: false,
  },
  status_code: 200,
  success: true,
};

const milestoneList = {
  code: 0,
  msg: '查询成功',
  data: {
    items: [{ id: 11, name: 'M1 需求' }],
    total: 1,
    page_no: 1,
    page_size: 100,
    has_next: false,
  },
  status_code: 200,
  success: true,
};

/**
 * 装好受控页面:登录态 + PM 菜单树 + 任务/项目/里程碑列表 + 字典。
 *
 * @param canUpdate 是否授予 `…:update` 权限(没有它条形不可拖拽)
 * @param taskList 任务列表的响应(默认三条带日期的任务)
 */
async function setupGanttPage(
  page: Page,
  options?: {
    canUpdate?: boolean;
    taskList?: ReturnType<typeof listEnvelope>;
  },
): Promise<void> {
  const canUpdate = options?.canUpdate ?? true;
  const buttons = canUpdate ? ganttMenu.buttons : [];

  await setupModulePage(page, {
    menus: [{ ...ganttMenu, buttons }],
    parent: { routePath: '/pm', title: '项目管理' },
    listUrl: TASK_LIST_URL,
    listBody: options?.taskList ?? defaultTaskList,
  });

  await page.route(PROJECT_LIST_URL, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(projectList),
    }),
  );
  await page.route(MILESTONE_LIST_URL, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(milestoneList),
    }),
  );
  await page.route(DICT_DATA_URL, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(taskStatusDictResponse),
    }),
  );
  await page.route(USER_LIST_URL, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        code: 0,
        msg: '查询成功',
        data: { items: [], total: 0, page_no: 1, page_size: 100 },
        status_code: 200,
        success: true,
      }),
    }),
  );
  await page.route(AI_API_URL, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ code: 0, msg: 'ok', data: [], success: true }),
    }),
  );

  await gotoModulePage(page, GANTT_PAGE_PATH, page.locator('.gantt_container'));
}

test.describe('任务甘特页', () => {
  test('渲染出甘特容器,行数 = 任务条数 + 分组行数', async ({ page }) => {
    await setupGanttPage(page);

    await expect(page.locator('.gantt_container')).toBeVisible();

    // 三条任务 + 一个项目分组行 + 一个里程碑分组行 = 五行
    await expect(page.locator('.gantt_row')).toHaveCount(5);

    // 任务标题在行里(分组行用项目/里程碑名)
    const text = await page.locator('.gantt_row').allInnerTexts();
    expect(text.join('|')).toContain('梳理需求清单');
    expect(text.join('|')).toContain('AIPM 核心项目');
    expect(text.join('|')).toContain('M1 需求');
  });

  test('被截断时提示说清「共 N 条,已显示前 M 条」', async ({ page }) => {
    // 后端一共 250 个任务,本页只拉回 3 条 ⇒ 只看到了一部分
    await setupGanttPage(page, {
      taskList: listEnvelope(datedTasks, 250),
    });

    // ⚠️ 计数只算**主内容区**里的:AI 工作台的侧栏里也有自己的 Alert
    // (窄时间轴的提示是 warning 级的,这里只数 info 级的这两条)
    const alert = mainContent(page).locator('.ant-alert-info');
    await expect(alert).toHaveCount(1);
    await expect(alert).toContainText('共 250 条');
    await expect(alert).toContainText('已显示前 3 条');
  });

  test('缺计划起止日期的任务给出提示(不静默丢)', async ({ page }) => {
    // 第四条任务没有计划起止日期 ⇒ 画不出条形,但必须告诉用户
    const noDate = taskRow({
      id: 34,
      title: '还没排期的任务',
      status_code: 'backlog',
      start_date: null,
      due_date: null,
    });

    await setupGanttPage(page, {
      taskList: listEnvelope([...datedTasks, noDate], 4),
    });

    const alert = mainContent(page).locator('.ant-alert-info');
    await expect(alert).toHaveCount(1);
    await expect(alert).toContainText('1 个任务没有计划起止日期');
    // 举例列出被排除的标题
    await expect(alert).toContainText('还没排期的任务');

    // 它确实没进甘特(行数还是 5)
    await expect(page.locator('.gantt_row')).toHaveCount(5);
  });

  test('列表页工具栏的「甘特」按钮能进甘特页', async ({ page }) => {
    await setupGanttPage(page);

    // 回列表页点入口
    await page.goto('/pm/task');
    await page.getByRole('button', { name: '甘特' }).click();

    await expect(page).toHaveURL(/\/pm\/task\/gantt$/);
    await expect(page.locator('.gantt_container')).toBeVisible();
  });

  test('没有 update 权限时条形不可拖拽', async ({ page }) => {
    await setupGanttPage(page, { canUpdate: false });

    // 甘特能读(query),但拖不动(没有 update)
    await expect(page.locator('.gantt_task_drag')).toHaveCount(0);
  });

  test('时间轴被挤窄时给提示,收起 AI 工作台后提示消失', async ({ page }) => {
    await setupGanttPage(page);

    // 右侧常驻的 AI 工作台占 400px ⇒ 时间轴被挤 ⇒ 页面给一条提示
    const hint = mainContent(page).locator('.ant-alert-warning');
    await expect(hint).toContainText('时间轴空间有限');

    // 收起 AI 工作台(⌘B / Ctrl+B)⇒ 主内容变宽 ⇒ 提示消失
    await page.keyboard.press('Control+b');
    await expect(hint).toHaveCount(0);
  });
});
