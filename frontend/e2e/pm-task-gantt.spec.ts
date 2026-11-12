import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import {
  PM_MILESTONE_PREFIX,
  PM_PROJECT_PREFIX,
  PM_TASK_PREFIX,
} from '../src/services/api/pm/paths';
import {
  businessErrorBody,
  gotoModulePage,
  mainContent,
  setupModulePage,
} from './helpers';

/**
 * 任务甘特页(/pm/task/gantt)的前端闭环,接口全部拦截。
 *
 * 覆盖这些事(brief 逐条 + 复审的回归点):
 * - 渲染出甘特容器 `.gantt_container`,行数 = 任务条数 + 分组行数;
 * - **被截断**时提示说清「共 N 条,已显示前 M 条」(分页口径),
 *   且 M 只算**真正画进甘特**的任务(不含缺日期被排除的);
 * - **缺计划起止日期**的任务给出提示(不静默丢),并列出被排除的标题;
 * - 列表页工具栏的「甘特」按钮能进甘特页;
 * - 没有 `…:update` 权限时条形不可拖拽;**有**权限时有拖拽手柄(正向对照);
 * - 没有可排期任务时「今天」「适应」是禁用的;
 * - 时间轴被挤窄时给出提示(窄视口有、宽视口没有 —— 与 AI 面板状态无关)。
 *
 * 菜单树:PM 模块挂在「/pm」目录下(helpers.buildCurrentUserResponse 的
 * MenuParent 参数),甘特菜单的相对 route_path 'task/gantt' 会被拼到 /pm 下,
 * 必须与前端路由表对齐。
 */

const GANTT_PAGE_PATH = '/pm/task/gantt';
const TASK_LIST_URL = `**/api/v1${PM_TASK_PREFIX}/list**`;
const TASK_UPDATE_URL = `**/api/v1${PM_TASK_PREFIX}/update/**`;
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
 * @param ready 「页面真的可用」的内容信号;默认等甘特容器。
 *   ⚠️ 空数据那页**没有**甘特容器 ⇒ 那里要传空状态的定位器。
 */
async function setupGanttPage(
  page: Page,
  options?: {
    canUpdate?: boolean;
    taskList?: ReturnType<typeof listEnvelope>;
    ready?: Locator;
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

  await gotoModulePage(
    page,
    GANTT_PAGE_PATH,
    options?.ready ?? page.locator('.gantt_container'),
  );
}

/** 甘特上的某条任务条(叶子行,不是分组汇总条) */
function ganttBar(page: Page, taskId: number): Locator {
  return page.locator(`.gantt_task_line[data-task-id="t-${taskId}"]`);
}

/**
 * 取一条任务条的位置(等图表先稳定下来)。
 *
 * ⚠️ dhtmlx 首次布局后还会再算一次左表格的宽度 ⇒ 条形会挪一两像素 ⇒
 * 这时 `boundingBox()` 可能拿不到(元素正在动)⇒ 等它稳定。
 */
async function barBox(
  page: Page,
  taskId: number,
): Promise<{ x: number; y: number; width: number; height: number }> {
  const bar = ganttBar(page, taskId);
  await bar.waitFor({ state: 'visible' });
  let box = await bar.boundingBox();
  for (let attempt = 0; attempt < 30 && !box; attempt += 1) {
    await page.waitForTimeout(100);
    box = await bar.boundingBox();
  }
  if (!box) throw new Error('拿不到任务条的位置');
  return box;
}

/**
 * **真的用鼠标**拖一条任务条(规格 §6.5:拖拽写回的是整对象 PUT)。
 *
 * ⚠️ 不能用接口层模拟:dhtmlx 的拖拽是靠 mousedown/mousemove/mouseup
 * 做的,只有真拖才会触发 `onBeforeTaskDrag` / `onAfterTaskDrag`
 * ⇒ 写回链路(整对象 PUT + 失败回滚)才会被真正走到。
 */
async function dragTaskBar(
  page: Page,
  taskId: number,
  deltaX: number,
): Promise<void> {
  const box = await barBox(page, taskId);
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // 分几步移:dhtmlx 的拖拽按 mousemove 的位移累积
  await page.mouse.move(startX + deltaX, startY, { steps: 12 });
  await page.mouse.up();
}

/** 写操作成功后的信封(提示文案由请求层统一弹,这里只让 promise 落地) */
const okResponse = {
  code: 0,
  msg: '操作成功',
  data: null,
  status_code: 200,
  success: true,
};

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

  /**
   * 截断提示里的数字**只算真正画进甘特的任务**。
   *
   * ⚠️ 这条是「两条提示不许互相矛盾」的回归测试:
   *   取回 4 条(3 条有日期 + 1 条缺日期)、后端总数 5 ⇒
   *   - 截断提示说「已显示前 3 条」(真的画了 3 条条形);
   *   - 排除提示说「1 个任务没有计划起止日期,未显示」(取到了但没画)。
   *   以前截断提示把 excludedCount 也加进去 ⇒ 说「已显示前 4 条」,
   *   而实际只画了 3 条 ⇒ 与另一条提示自相矛盾。
   */
  test('截断提示的数字只算画进甘特的任务(不含缺日期被排除的)', async ({
    page,
  }) => {
    const noDate = taskRow({
      id: 34,
      title: '还没排期的任务',
      status_code: 'backlog',
      start_date: null,
      due_date: null,
    });

    await setupGanttPage(page, {
      taskList: listEnvelope([...datedTasks, noDate], 5),
    });

    const alerts = mainContent(page).locator('.ant-alert-info');
    // 两条提示各自独立
    await expect(alerts).toHaveCount(2);

    // 截断提示:M = 真正画出来的条数(3),**不是**取回的条数(4)
    const truncated = alerts.filter({ hasText: '共 5 条' });
    await expect(truncated).toHaveCount(1);
    await expect(truncated).toContainText('已显示前 3 条');
    await expect(truncated).not.toContainText('已显示前 4 条');

    // 排除提示:N = 取到了但没显示的条数
    const excluded = alerts.filter({ hasText: '没有计划起止日期' });
    await expect(excluded).toHaveCount(1);
    await expect(excluded).toContainText('1 个任务没有计划起止日期');

    // 真的只画了 3 条任务条(3 任务 + 2 分组 = 5 行)
    await expect(page.locator('.gantt_row')).toHaveCount(5);
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

  /**
   * 权限那条用例的**正向对照**。
   *
   * ⚠️ 只断言「没有权限时 `.gantt_task_drag` 为 0」是不够的:
   *   class 名写错、或者根本没渲染,这条断言照样通过(假绿)。
   *   这里补一条反向对照:有 `…:update` 权限时**必须**有拖拽手柄
   *   ⇒ 前一条的「0」才真的说明「是权限把它关掉了」。
   */
  test('有 update 权限时条形带拖拽手柄(正向对照)', async ({ page }) => {
    await setupGanttPage(page);

    // 三条任务都是叶子行(不是分组汇总行)⇒ 每条都该有拖拽手柄
    await expect(page.locator('.gantt_task_drag')).not.toHaveCount(0);
  });

  /**
   * 没有可排期任务时,「今天」「适应」是死的按钮 ⇒ 必须禁用。
   *
   * 空数据分支里图表压根没挂载 ⇒ 点击只是「点了空气」,
   * 用户还以为图表坏了。
   */
  test('没有可排期任务时禁用「今天」「适应」', async ({ page }) => {
    const noDate = taskRow({
      id: 41,
      title: '还没排期的任务',
      status_code: 'backlog',
      start_date: null,
      due_date: null,
    });

    await setupGanttPage(page, {
      taskList: listEnvelope([noDate], 1),
      // 没有可排期任务 ⇒ 甘特容器不存在,等空状态
      ready: mainContent(page).locator('.ant-empty'),
    });

    // 空状态在
    await expect(mainContent(page).locator('.ant-empty')).toBeVisible();
    // 图表没挂载
    await expect(page.locator('.gantt_container')).toHaveCount(0);

    // 两个按钮都是禁用的
    // ⚠️ antd 会给**两个汉字**的按钮文案中间插一个空格(排版用)
    //    ⇒ 可访问名是「今 天」,不是「今天」⇒ 用正则宽松匹配
    await expect(
      mainContent(page).getByRole('button', { name: /今\s*天/ }),
    ).toBeDisabled();
    await expect(
      mainContent(page).getByRole('button', { name: /适\s*应/ }),
    ).toBeDisabled();
  });

  /**
   * 窄时间轴的提示:窄视口时出现、宽视口时消失。
   *
   * ⚠️ **这条用例不能依赖 AI 工作台的展开/收起状态**:
   *   提示的判据是「图表容器的宽度」,而主内容宽度会变 ⇒ 同一份代码在两种
   *   面板状态下结论相反。
   *
   *   现在 AI 工作台是**浮层** ⇒ **不占布局宽度** ⇒ 主内容宽度**只取决于视口**:
   *   - 1000px:主内容 = 1000 - 左侧菜单 - 内边距 ⇒ 远小于 1200 ⇒ 提示必现;
   *   - 2200px:主内容 > 1200 ⇒ 提示必不现。
   *
   * ⚠️ 提示的文案里**不再有快捷键**：
   *   以前写「按 Ctrl/⌘+B 收起右侧 AI 工作台」⇒ 浮层化之后那句话是错的
   *   （收起面板并不会让主内容变宽）⇒ 改成「拖分隔条」。
   */
  test('窄视口时给提示,宽视口时不出现(与 AI 面板状态无关)', async ({
    page,
  }) => {
    await setupGanttPage(page);

    const hint = mainContent(page).locator('.ant-alert-warning');

    // 窄视口 ⇒ 提示在
    await page.setViewportSize({ width: 1000, height: 900 });
    await expect(hint).toContainText('时间轴空间有限');
    // ⚠️ 文案里**不再提快捷键**（收起浮层不会让主内容变宽）
    await expect(hint).not.toContainText('Ctrl/⌘+B');
    await expect(hint).toContainText('分隔条');

    // 宽视口 ⇒ 提示不在
    await page.setViewportSize({ width: 2200, height: 900 });
    await expect(hint).toHaveCount(0);
  });
});

/**
 * 规格 §6.5:e2e 要覆盖「拖拽写回的是**整对象 PUT**」与「写失败回滚」。
 *
 * 这两条是甘特与看板**同一套纪律**的落点:
 * - 拖一次 ⇒ 请求体是**整个任务对象**(后端没有 PATCH,少一个必填字段就 422),
 *   且**只有两个日期字段变了**(不动状态、负责人、优先级);
 * - 写失败 ⇒ 条形**回到拖动前的位置**(界面上不许留下一个假的成功)。
 */
test.describe('甘特拖拽写回', () => {
  test('拖动任务条 ⇒ 写回的是整对象 PUT(只有两个日期字段变了)', async ({
    page,
  }) => {
    const updateRequests: { method: string; url: string; body: unknown }[] = [];

    await setupGanttPage(page);

    await page.route(TASK_UPDATE_URL, (route) => {
      const request = route.request();
      updateRequests.push({
        method: request.method(),
        url: request.url(),
        body: request.postDataJSON(),
      });
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(okResponse),
      });
    });

    await dragTaskBar(page, 32, 80);

    await expect.poll(() => updateRequests.length).toBe(1);
    const request = updateRequests[0];

    // 整对象 PUT(后端没有 PATCH)
    expect(request.method).toBe('PUT');
    expect(request.url).toContain(`${PM_TASK_PREFIX}/update/32`);

    const body = request.body as Record<string, unknown>;

    // 必填字段一个都不能少(少一个就是 422)
    expect(body).toMatchObject({
      project_id: 1,
      milestone_id: 11,
      title: '搭建脚手架',
      type_code: 'feature',
      status_code: 'in_progress',
      priority_code: 'P1',
      assignee_id: 1,
      estimate_hours: 8,
    });

    // **只有两个日期字段变了**:其余字段与拖动前完全一致
    const before = datedTasks[1];
    expect(body.start_date).not.toBe(before.start_date);
    expect(body.due_date).not.toBe(before.due_date);
    // 整对象 PUT 携带的字段(载荷层会原样搬回来的那些)一个都不能变
    for (const key of [
      'project_id',
      'milestone_id',
      'parent_id',
      'title',
      'description',
      'type_code',
      'status_code',
      'priority_code',
      'estimate_hours',
      'actual_hours',
      'assignee_id',
      'reviewers',
      'labels',
      'blocked_reason',
    ]) {
      expect(body[key]).toEqual(before[key as keyof typeof before]);
    }

    // 不是用户可编辑的三列(与看板页同一口径)
    expect(body).not.toHaveProperty('reporter_id');
    expect(body).not.toHaveProperty('sort_order');
    expect(body).not.toHaveProperty('created_via_code');
  });

  test('写失败 ⇒ 条形回到拖动前的位置', async ({ page }) => {
    const updateRequests: unknown[] = [];

    await setupGanttPage(page);

    await page.route(TASK_UPDATE_URL, (route) => {
      updateRequests.push(route.request().postDataJSON());
      return route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify(businessErrorBody('保存失败,请重试')),
      });
    });

    const bar = ganttBar(page, 32);
    const before = await barBox(page, 32);

    await dragTaskBar(page, 32, 80);

    await expect.poll(() => updateRequests.length).toBe(1);

    // 条形回到拖动前的位置(界面上不许留下一个假的成功)
    await expect
      .poll(async () => (await bar.boundingBox())?.x ?? 0)
      .toBeCloseTo(before.x, 0);

    // 错误提示由请求层统一弹(页面自己不弹 message)
    await expect(page.getByText('保存失败,请重试')).toBeVisible();
  });

  /**
   * 规格 §5.5:**页面本身不滚**(沿用 app shell 的满高布局)⇒
   * 图表高度跟着可用高度走,滚动条只在左表格/时间轴里。
   */
  test('页面自己不滚(图表高度跟着可用高度走)', async ({ page }) => {
    await setupGanttPage(page);

    await expect(page.locator('.gantt_container')).toBeVisible();

    // 内容区(自己滚的那一层)不该有溢出 ⇒ 页面不滚
    const overflow = await page.evaluate(() => {
      const area = document.querySelector(
        '[data-testid="ai-workspace-content"]',
      ) as HTMLElement | null;
      if (!area) return null;
      return area.scrollHeight - area.clientHeight;
    });
    expect(overflow).not.toBeNull();
    // 允许 1px 的取整误差,不许出现滚动条
    expect(overflow ?? 0).toBeLessThanOrEqual(1);

    // 图表的高度 ≈ 内容区剩下的高度(不是写死的 520)
    const chartHeight = await page.evaluate(() => {
      const chart = document.querySelector(
        '[data-testid="pm-gantt-box"]',
      ) as HTMLElement | null;
      return chart?.clientHeight ?? 0;
    });
    expect(chartHeight).toBeGreaterThan(300);
  });
});
