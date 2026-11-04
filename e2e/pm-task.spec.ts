import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import {
  gotoModulePage,
  modalFormItem,
  pickInModal,
  pickToday,
  setupModulePage,
  tableRows,
} from './helpers';

/**
 * 任务管理页(/pm/task)的前端闭环,接口全部拦截。
 *
 * 覆盖五件事(brief 逐条):
 * - 列表渲染:标题/状态字典标签/优先级/类型/负责人/报告人/计划与实际区间
 * - 项目名与里程碑名来自**侧载**列表(任务响应里没有 project_by/milestone_by)
 * - 新增提交的是**线上码**(type_code='feature' / status_code='in_progress' /
 *   priority_code='P1'),不是中文标签
 * - 表单提交**全部必填字段**(project_id/title/type_code/status_code/priority_code)
 * - 新增还要带上后端 NOT NULL 的三列(创建人/排序/创建方式)—— 后端 create 不兜底
 * - 编辑**直接用列表行填表**:不发详情请求,PUT 不带那三列
 *
 * 菜单树:PM 模块挂在「/pm」目录下(helpers.buildCurrentUserResponse 的
 * MenuParent 参数),子菜单的相对 route_path 'task' 会被拼到 /pm 下,
 * 必须与前端路由表对齐。
 */

const TASK_PAGE_PATH = '/pm/task';
const TASK_LIST_URL = '**/api/v1/pm_task/list**';
const TASK_DETAIL_URL = '**/api/v1/pm_task/detail/**';
const TASK_CREATE_URL = '**/api/v1/pm_task/create**';
const TASK_UPDATE_URL = '**/api/v1/pm_task/update/**';
/** 侧载的项目/里程碑列表(任务响应里没有名字,只能另外拉) */
const PROJECT_LIST_URL = '**/api/v1/pm_project/list**';
const MILESTONE_LIST_URL = '**/api/v1/pm_milestone/list**';
/** 用户列表(负责人/报告人的远程搜索候选) */
const USER_LIST_URL = '**/api/v1/system/user/list**';
/** 字典选项接口(状态/类型/优先级的下拉与标签共用) */
const dictDataUrl = (dictType: string) =>
  `**/api/v1/system/dict/data/info/${dictType}**`;

/**
 * PM 菜单树里的任务菜单(type=2)+ 三个按钮权限节点(type=3)。
 *
 * 权限码与后端 controller 一致:
 * list=query / create=create / update=update / delete=delete,
 * 全部前缀 module_pm_project:pm_task:。
 */
const taskMenu = {
  title: '任务管理',
  routePath: 'task',
  permission: 'module_pm_project:pm_task:query',
  buttons: [
    {
      title: '新增任务',
      permission: 'module_pm_project:pm_task:create',
    },
    {
      title: '编辑任务',
      permission: 'module_pm_project:pm_task:update',
    },
    {
      title: '删除任务',
      permission: 'module_pm_project:pm_task:delete',
    },
  ],
};

/** 字典选项的信封(label 给人看,value 是线上码,list_class 决定标签颜色) */
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

/** 任务状态(后端种子 SQL 的七态:有 cancelled,与里程碑的五态不同) */
const taskStatusDictResponse = dictDataResponse([
  { dict_label: '待规划', dict_value: 'backlog', list_class: 'default' },
  { dict_label: '待办', dict_value: 'todo', list_class: 'info' },
  { dict_label: '进行中', dict_value: 'in_progress', list_class: 'primary' },
  { dict_label: '阻塞', dict_value: 'blocked', list_class: 'warning' },
  { dict_label: '评审', dict_value: 'review', list_class: 'primary' },
  { dict_label: '已完成', dict_value: 'done', list_class: 'success' },
  { dict_label: '已取消', dict_value: 'cancelled', list_class: 'danger' },
]);

/** 任务类型(五类) */
const taskTypeDictResponse = dictDataResponse([
  { dict_label: '功能', dict_value: 'feature', list_class: 'primary' },
  { dict_label: '缺陷', dict_value: 'bug', list_class: 'danger' },
  { dict_label: '运维', dict_value: 'ops', list_class: 'warning' },
  { dict_label: '调研', dict_value: 'research', list_class: 'info' },
  { dict_label: '技术预研', dict_value: 'spike', list_class: 'info' },
]);

/** 优先级(P0–P3) */
const priorityDictResponse = dictDataResponse([
  { dict_label: '紧急', dict_value: 'P0', list_class: 'danger' },
  { dict_label: '高', dict_value: 'P1', list_class: 'warning' },
  { dict_label: '中', dict_value: 'P2', list_class: 'info' },
  { dict_label: '低', dict_value: 'P3', list_class: 'default' },
]);

/** 创建方式(后端种子 SQL 的四项:manual / nl_chat / import / api —— 没有 'web') */
const taskCreatedViaDictResponse = dictDataResponse([
  { dict_label: '手动', dict_value: 'manual', list_class: 'default' },
  { dict_label: 'NL对话', dict_value: 'nl_chat', list_class: 'primary' },
  { dict_label: '导入', dict_value: 'import', list_class: 'info' },
  { dict_label: 'API', dict_value: 'api', list_class: 'info' },
]);

/**
 * 列表里的第一行(形状对齐 TaskOut)。
 *
 * ⚠️ 故意**不带** project_by / milestone_by —— 后端的任务 schema 只有
 * assignee_by 与 reporter_by,项目名与里程碑名得靠侧载列表在户端映射。
 */
const taskRow = {
  id: 21,
  project_id: 1,
  milestone_id: 11,
  parent_id: null,
  title: '输出需求规格说明书',
  description: '需求评审通过后交付',
  type_code: 'feature',
  status_code: 'in_progress',
  priority_code: 'P1',
  estimate_hours: 8,
  actual_hours: 4,
  assignee_id: 1,
  reporter_id: 2,
  reviewers: '3,5',
  labels: '["财务","合规"]',
  start_date: '2026-11-06',
  due_date: '2026-11-15',
  actual_start_date: '2026-11-06',
  actual_end_date: null,
  sort_order: 0,
  created_via_code: 'manual',
  blocked_reason: null,
  assignee_by: { id: 1, name: '张三', username: 'zhangsan' },
  reporter_by: { id: 2, name: '李四', username: 'lisi' },
  created_time: '2026-11-01 09:00:00',
  updated_time: '2026-11-06 09:00:00',
};

/**
 * 第二行:阻塞中的缺陷任务,没有负责人、没有实际结束时间 ——
 * 空值列要显示占位符而不是空白。
 */
const blockedTaskRow = {
  id: 22,
  project_id: 2,
  milestone_id: 12,
  parent_id: 21,
  title: '修复登录超时',
  description: null,
  type_code: 'bug',
  status_code: 'blocked',
  priority_code: 'P0',
  estimate_hours: 3,
  actual_hours: null,
  assignee_id: null,
  reporter_id: 2,
  reviewers: null,
  labels: null,
  start_date: null,
  due_date: null,
  actual_start_date: null,
  actual_end_date: null,
  sort_order: 1,
  created_via_code: 'manual',
  blocked_reason: '等待三方接口联调',
  assignee_by: null,
  reporter_by: { id: 2, name: '李四', username: 'lisi' },
  created_time: '2026-11-02 09:00:00',
  updated_time: '2026-11-03 09:00:00',
};

const taskListResponse = {
  code: 0,
  msg: '查询成功',
  data: {
    items: [taskRow, blockedTaskRow],
    total: 2,
    page_no: 1,
    page_size: 10,
    has_next: false,
  },
  status_code: 200,
  success: true,
};

/** 侧载的项目列表(任务响应里没有项目名,名字从这里来) */
const projectListResponse = {
  code: 0,
  msg: '查询成功',
  data: {
    items: [
      {
        id: 1,
        code: 'AIPM-CORE',
        name: 'AIPM 核心项目',
        status_code: 'planning',
        priority_code: 'P1',
        start_date: '2026-11-01',
        due_date: '2026-12-31',
        owner_id: 1,
        owner_by: { id: 1, name: '张三', username: 'zhangsan' },
        tags: null,
      },
      {
        id: 2,
        code: 'AIPM-EXT',
        name: 'AIPM 扩展项目',
        status_code: 'planning',
        priority_code: 'P1',
        start_date: '2026-12-01',
        due_date: '2027-01-31',
        owner_id: 1,
        owner_by: { id: 1, name: '张三', username: 'zhangsan' },
        tags: null,
      },
    ],
    total: 2,
    page_no: 1,
    page_size: 100,
    has_next: false,
  },
  status_code: 200,
  success: true,
};

/** 侧载的里程碑列表(任务响应里也没有里程碑名) */
const milestoneListResponse = {
  code: 0,
  msg: '查询成功',
  data: {
    items: [
      {
        id: 11,
        project_id: 1,
        name: '需求分析完成',
        description: null,
        start_date: '2026-11-05',
        due_date: '2026-11-20',
        actual_start_date: null,
        actual_end_date: null,
        status_code: 'in_progress',
        deliverables: null,
        sort_order: 1,
        health_score: 80,
        progress: 66,
        project_by: { id: 1, name: 'AIPM 核心项目', code: 'AIPM-CORE' },
        created_time: '2026-11-01 09:00:00',
        updated_time: '2026-11-10 09:00:00',
      },
      {
        id: 12,
        project_id: 2,
        name: '联调准备',
        description: null,
        start_date: '2026-11-21',
        due_date: '2026-12-05',
        actual_start_date: null,
        actual_end_date: null,
        status_code: 'in_progress',
        deliverables: null,
        sort_order: 2,
        health_score: 60,
        progress: 10,
        project_by: { id: 2, name: 'AIPM 扩展项目', code: 'AIPM-EXT' },
        created_time: '2026-11-01 09:00:00',
        updated_time: '2026-11-10 09:00:00',
      },
    ],
    total: 2,
    page_no: 1,
    page_size: 100,
    has_next: false,
  },
  status_code: 200,
  success: true,
};

/** 负责人/报告人的远程搜索候选 */
const userListResponse = {
  code: 0,
  msg: '查询成功',
  data: {
    items: [
      { id: 1, username: 'zhangsan', name: '张三' },
      { id: 2, username: 'lisi', name: '李四' },
    ],
    total: 2,
    page_no: 1,
    page_size: 100,
    has_next: false,
  },
  status_code: 200,
  success: true,
};

/** 写操作成功后的信封(提示文案由请求层统一弹,这里只让 promise 落地) */
const okResponse = {
  code: 0,
  msg: '操作成功',
  data: null,
  status_code: 200,
  success: true,
};

/**
 * 在弹窗的下拉里选一个候选,并**核对**值真的进去了。
 *
 * 为什么不用 helpers.pickInModal 就完事:它只点一次选项、不核对结果。
 * 实测(6 个 worker 并行时)会偶发「点空」—— 下拉还开着,值却是空的,
 * 于是必填项校验不过、请求发不出去,用例以「没等到请求」的形式挂掉,
 * 而且是偶发的,极难定位(e2e/helpers.ts 是共享夹具,本轮不改它)。
 *
 * 这里在它之后再核对一次显示值,没进去就关掉下拉重选(最多 3 轮)。
 */
async function pickChecked(
  page: Page,
  label: string,
  optionText: string,
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await pickInModal(page, label, optionText);
    try {
      // 选中后表单项里会出现这个文案
      await expect(modalFormItem(page, label)).toContainText(optionText, {
        timeout: 3000,
      });
      return;
    } catch {
      // 没进去:可能下拉还开着(卡住的 portal),先关掉再重选
      await page.keyboard.press('Escape');
    }
  }
  throw new Error(`下拉「${label}」没能选中「${optionText}」`);
}

/**
 * 装好受控页面:登录态 + PM 菜单树 + 任务列表 + 三个字典 + 侧载的项目/里程碑列表。
 * 返回侧载请求的收集器(断言「只拉一次」用)。
 */
async function setupTaskPage(page: Page): Promise<{
  projectRequests: string[];
  milestoneRequests: string[];
}> {
  const projectRequests: string[] = [];
  const milestoneRequests: string[] = [];

  await setupModulePage(page, {
    menus: [taskMenu],
    parent: { routePath: '/pm', title: '项目管理' },
    listUrl: TASK_LIST_URL,
    listBody: taskListResponse,
  });

  // 侧载的项目/里程碑列表:各拉一次,页面在列的 render 里查表映射成名字
  await page.route(PROJECT_LIST_URL, (route) => {
    projectRequests.push(route.request().url());
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(projectListResponse),
    });
  });

  await page.route(MILESTONE_LIST_URL, (route) => {
    milestoneRequests.push(route.request().url());
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(milestoneListResponse),
    });
  });

  // 负责人/报告人的远程搜索候选
  await page.route(USER_LIST_URL, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(userListResponse),
    }),
  );

  // 字典:列表标签与表单下拉共用(模块级缓存只发一次)
  await page.route(dictDataUrl('module_pm_task_status'), (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(taskStatusDictResponse),
    }),
  );
  await page.route(dictDataUrl('module_pm_task_type'), (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(taskTypeDictResponse),
    }),
  );
  await page.route(dictDataUrl('module_pm_priority'), (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(priorityDictResponse),
    }),
  );

  await page.route(dictDataUrl('module_pm_task_created_via'), (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(taskCreatedViaDictResponse),
    }),
  );

  return { projectRequests, milestoneRequests };
}

test.describe('任务管理页', () => {
  test('渲染任务列表', async ({ page }) => {
    await setupTaskPage(page);

    await gotoModulePage(
      page,
      TASK_PAGE_PATH,
      page.locator('.ant-menu').getByText('任务管理'),
    );

    // 侧边栏来自后端菜单:PM 目录挂在 /pm 下(不是 /system)
    await expect(page.locator('.ant-menu').getByText('项目管理')).toBeVisible();
    await expect(page.locator('.ant-menu').getByText('任务管理')).toBeVisible();

    const rows = tableRows(page);
    await expect(rows).toHaveCount(2);

    const row = rows.filter({ hasText: '输出需求规格说明书' });
    await expect(row).toContainText('输出需求规格说明书');
    // 字典线上码渲染成中文标签(不是原始的 in_progress / feature / P1)
    await expect(row).toContainText('进行中');
    await expect(row).toContainText('功能');
    await expect(row).toContainText('高');
    // 负责人/报告人读 assignee_by / reporter_by 冗余字段
    await expect(row).toContainText('张三');
    await expect(row).toContainText('李四');
    // 计划区间与实际区间(实际结束日期为空时用占位符)
    await expect(row).toContainText('2026-11-06 ~ 2026-11-15');
    await expect(row).toContainText('2026-11-06 ~ -');
    // 估时 / 实际工时 / 排序
    await expect(row.getByText('8', { exact: true })).toBeVisible();
    await expect(row.getByText('4', { exact: true })).toBeVisible();
    await expect(row.getByText('0', { exact: true })).toBeVisible();
    // 创建方式有字典:渲染成中文标签(「手动」)
    await expect(row).toContainText('手动');

    // 第二行:阻塞原因与占位符
    const blockedRow = rows.filter({ hasText: '修复登录超时' });
    await expect(blockedRow).toContainText('阻塞');
    await expect(blockedRow).toContainText('等待三方接口联调');
    await expect(blockedRow).toContainText('- ~ -');
  });

  test('项目名与里程碑名来自侧载列表,不是按行发请求', async ({ page }) => {
    const { projectRequests, milestoneRequests } = await setupTaskPage(page);

    await gotoModulePage(
      page,
      TASK_PAGE_PATH,
      page.locator('.ant-menu').getByText('任务管理'),
    );

    // 前提:任务的响应里**根本没有**项目名与里程碑名 ——
    // 页面上能显示名字,只能来自另外两次列表请求
    expect(taskRow).not.toHaveProperty('project_by');
    expect(taskRow).not.toHaveProperty('milestone_by');

    const row = tableRows(page).filter({ hasText: '输出需求规格说明书' });
    await expect(row).toContainText('AIPM 核心项目');
    await expect(row).toContainText('需求分析完成');

    // 侧载**一次**就够:两行任务不是两次请求(不是每行一次)
    await expect.poll(() => projectRequests.length).toBeGreaterThan(0);
    await expect.poll(() => milestoneRequests.length).toBeGreaterThan(0);
    expect(projectRequests).toHaveLength(1);
    expect(milestoneRequests).toHaveLength(1);
  });

  test('新增任务提交 type_code/status_code/priority_code 的线上码', async ({
    page,
  }) => {
    const createRequests: { url: string; method: string; body: unknown }[] = [];

    await setupTaskPage(page);

    await page.route(TASK_CREATE_URL, (route) => {
      const request = route.request();
      createRequests.push({
        url: request.url(),
        method: request.method(),
        body: request.postDataJSON(),
      });
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(okResponse),
      });
    });

    await gotoModulePage(
      page,
      TASK_PAGE_PATH,
      page.locator('.ant-menu').getByText('任务管理'),
    );

    await page.getByRole('button', { name: '新增' }).click();
    await expect(page.locator('.ant-modal')).toBeVisible();

    // 所属项目:侧载的项目列表(表单不再单独发请求)
    await pickChecked(page, '所属项目', 'AIPM 核心项目');

    await modalFormItem(page, '任务标题').locator('input').fill('E2E 任务');

    // 类型/状态/优先级:字典下拉,提交的是线上码
    await pickChecked(page, '类型', '功能');
    await pickChecked(page, '状态', '进行中');
    await pickChecked(page, '优先级', '高');

    await page.locator('.ant-modal-footer button.ant-btn-primary').click();

    await expect.poll(() => createRequests.length).toBe(1);
    expect(createRequests[0].method).toBe('POST');
    expect(createRequests[0].url).toContain('/pm_task/create');

    const body = createRequests[0].body as Record<string, unknown>;
    expect(body).toMatchObject({
      project_id: 1,
      title: 'E2E 任务',
      type_code: 'feature',
      status_code: 'in_progress',
      priority_code: 'P1',
    });
    // 表单里看到的中文标签没有混进请求体
    expect(JSON.stringify(body)).not.toContain('功能');
    expect(JSON.stringify(body)).not.toContain('进行中');
  });

  test('任务表单提交全部必填字段', async ({ page }) => {
    /*
      这个用例最重:连开 6 个下拉(项目/里程碑/类型/状态/优先级/负责人)
      + 2 个日期面板,每次开下一个之前还要等上一个关完。
      默认 30s 的用例超时在机器并行跑的时候不够(实测会超时),
      这里单独放宽 —— 放宽的是**用例预算**,不是断言的等待时长。
    */
    test.setTimeout(60_000);

    const createRequests: { url: string; method: string; body: unknown }[] = [];

    await setupTaskPage(page);

    await page.route(TASK_CREATE_URL, (route) => {
      const request = route.request();
      createRequests.push({
        url: request.url(),
        method: request.method(),
        body: request.postDataJSON(),
      });
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(okResponse),
      });
    });

    await gotoModulePage(
      page,
      TASK_PAGE_PATH,
      page.locator('.ant-menu').getByText('任务管理'),
    );

    await page.getByRole('button', { name: '新增' }).click();
    await expect(page.locator('.ant-modal')).toBeVisible();

    await pickChecked(page, '所属项目', 'AIPM 核心项目');
    // 里程碑候选按所选项目过滤(选的是 AIPM 核心项目 → 只有它的里程碑)
    await pickChecked(page, '所属里程碑', '需求分析完成');

    await modalFormItem(page, '任务标题').locator('input').fill('E2E 任务');
    await modalFormItem(page, '任务描述')
      .locator('textarea')
      .fill('需求评审通过后交付');

    await pickChecked(page, '类型', '功能');
    await pickChecked(page, '状态', '进行中');
    await pickChecked(page, '优先级', '高');

    // 负责人:远程搜索下拉,候选来自 listUsers
    await pickChecked(page, '负责人', '张三');

    // 工时是数字(后端是 Decimal);排序不再由人填(见下面的创建载荷断言)
    await modalFormItem(page, '预估工时').locator('input').fill('8');
    await modalFormItem(page, '实际工时').locator('input').fill('4');

    // 评审人是逗号分隔的 id 字符串;标签是 JSON 数组字符串(都不是数组)
    await modalFormItem(page, '评审人').locator('input').fill('3,5');
    await modalFormItem(page, '标签')
      .locator('textarea')
      .fill('["财务","合规"]');

    await pickToday(page, '计划开始日期');
    await pickToday(page, '计划截止日期');

    await modalFormItem(page, '阻塞原因')
      .locator('textarea')
      .fill('等待三方接口联调');

    await page.locator('.ant-modal-footer button.ant-btn-primary').click();

    await expect.poll(() => createRequests.length).toBe(1);
    const body = createRequests[0].body as Record<string, unknown>;

    // 必填字段一个都不能少(后端 CreateSchema 缺一个就 422)
    for (const key of [
      'project_id',
      'title',
      'type_code',
      'status_code',
      'priority_code',
    ]) {
      expect(body).toHaveProperty(key);
    }

    expect(body).toMatchObject({
      project_id: 1,
      milestone_id: 11,
      title: 'E2E 任务',
      description: '需求评审通过后交付',
      type_code: 'feature',
      status_code: 'in_progress',
      priority_code: 'P1',
      estimate_hours: 8,
      actual_hours: 4,
      assignee_id: 1,
      // 评审人是逗号分隔的字符串,标签是 JSON 数组字符串 —— 都不是数组
      reviewers: '3,5',
      labels: '["财务","合规"]',
      blocked_reason: '等待三方接口联调',
    });
    // 日期提交为 YYYY-MM-DD 字符串(后端 date 协议),不是时间戳
    expect(String(body.start_date)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.start_date).toBe(body.due_date);
    // 后端 NOT NULL 的三列:创建人(当前登录用户)/排序/创建方式
    expect(body).toMatchObject({
      reporter_id: 1,
      sort_order: 0,
      created_via_code: 'manual',
    });
  });

  test('新增任务补齐后端 NOT NULL 的创建人/排序/创建方式', async ({ page }) => {
    const createRequests: { url: string; method: string; body: unknown }[] = [];

    await setupTaskPage(page);

    await page.route(TASK_CREATE_URL, (route) => {
      const request = route.request();
      createRequests.push({
        url: request.url(),
        method: request.method(),
        body: request.postDataJSON(),
      });
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(okResponse),
      });
    });

    await gotoModulePage(
      page,
      TASK_PAGE_PATH,
      page.locator('.ant-menu').getByText('任务管理'),
    );

    await page.getByRole('button', { name: '新增' }).click();
    await expect(page.locator('.ant-modal')).toBeVisible();

    // 只填必填项:报告人与排序**不由人填**(库里 NOT NULL,前端按固定规则补)
    await pickChecked(page, '所属项目', 'AIPM 核心项目');
    await modalFormItem(page, '任务标题').locator('input').fill('E2E 任务');
    await pickChecked(page, '类型', '功能');
    await pickChecked(page, '状态', '进行中');
    await pickChecked(page, '优先级', '高');

    await page.locator('.ant-modal-footer button.ant-btn-primary').click();

    await expect.poll(() => createRequests.length).toBe(1);
    expect(createRequests[0].method).toBe('POST');
    expect(createRequests[0].url).toContain('/pm_task/create');

    const body = createRequests[0].body as Record<string, unknown>;

    // 这三列在库里都是 NOT NULL,后端 create 也不兜底 ⇒ 不带就是 INSERT NULL
    expect(body).toMatchObject({
      // 创建人 = 当前登录用户(夹具的 current/info 里 id 是 1),
      // 不是列表行里的那个报告人(行里是 2)
      reporter_id: 1,
      // 新建的任务排序一律 0
      sort_order: 0,
      // 创建方式用字典里的真值(没有 'web' 这一项)
      created_via_code: 'manual',
    });
  });

  test('编辑任务直接用列表行填表:不发详情请求,PUT 不带创建三列', async ({
    page,
  }) => {
    const detailRequests: string[] = [];
    const updateRequests: { url: string; method: string; body: unknown }[] = [];

    await setupTaskPage(page);

    // 详情接口**不该被调用**:行里的字段已经够填表了。
    // 这里仍然把它拦下来并记录 —— 实现一旦退回「读-改-写」就会被这条断言抓住。
    await page.route(TASK_DETAIL_URL, (route) => {
      detailRequests.push(route.request().url());
      return route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({
          code: -1,
          msg: '没有任务详情权限',
          data: null,
          status_code: 403,
          success: false,
        }),
      });
    });

    await page.route(TASK_UPDATE_URL, (route) => {
      const request = route.request();
      updateRequests.push({
        url: request.url(),
        method: request.method(),
        body: request.postDataJSON(),
      });
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(okResponse),
      });
    });

    await gotoModulePage(
      page,
      TASK_PAGE_PATH,
      page.locator('.ant-menu').getByText('任务管理'),
    );

    await tableRows(page)
      .filter({ hasText: '输出需求规格说明书' })
      .getByRole('button', { name: '编辑' })
      .click();
    await expect(page.locator('.ant-modal')).toBeVisible();

    // 表单是用**列表行**填的:标题、字典字段、里程碑都回显
    await expect(modalFormItem(page, '任务标题').locator('input')).toHaveValue(
      '输出需求规格说明书',
    );
    await expect(
      modalFormItem(page, '状态').locator('.ant-select-content'),
    ).toContainText('进行中');
    await expect(
      modalFormItem(page, '类型').locator('.ant-select-content'),
    ).toContainText('功能');
    await expect(
      modalFormItem(page, '所属里程碑').locator('.ant-select-content'),
    ).toContainText('需求分析完成');

    // 没有详情请求:后端的详情接口要 `…:detail` 权限,编辑只要 `…:update` ——
    // 发了详情请求,有 update 没 detail 的角色就会打开一个用不了的弹窗
    expect(detailRequests).toHaveLength(0);

    // 改个标题提交(写)
    await modalFormItem(page, '任务标题')
      .locator('input')
      .fill('输出需求规格说明书(改名)');
    await page.locator('.ant-modal-footer button.ant-btn-primary').click();

    await expect.poll(() => updateRequests.length).toBe(1);
    expect(updateRequests[0].method).toBe('PUT');
    expect(updateRequests[0].url).toContain('/pm_task/update/21');

    // 整对象 PUT(后端没有 PATCH):必填字段一个都不能少
    const body = updateRequests[0].body as Record<string, unknown>;
    expect(body).toMatchObject({
      project_id: 1,
      title: '输出需求规格说明书(改名)',
      type_code: 'feature',
      status_code: 'in_progress',
      priority_code: 'P1',
    });
    // 读回来的其它字段原样带回(读-改-写不是只发改的那个字段)
    expect(body).toMatchObject({
      milestone_id: 11,
      estimate_hours: 8,
      actual_hours: 4,
      reviewers: '3,5',
      labels: '["财务","合规"]',
      start_date: '2026-11-06',
      due_date: '2026-11-15',
    });
    // 创建三列不是用户可编辑的:更新时**一个都不带** ——
    // 后端 `model_dump(exclude_unset=True)` 会原样保留库里的值
    expect(body).not.toHaveProperty('reporter_id');
    expect(body).not.toHaveProperty('sort_order');
    expect(body).not.toHaveProperty('created_via_code');
  });
});
