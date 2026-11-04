import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { businessErrorBody, gotoModulePage, setupModulePage } from './helpers';

/**
 * 任务看板页(/pm/task/board)的前端闭环,接口全部拦截。
 *
 * 覆盖六件事(brief 逐条):
 * - 渲染**六列**(待规划/待办/进行中/阻塞/评审/已完成),顺序固定
 * - 看板**不含已取消列**:字典 module_pm_task_status 有七态,`cancelled` 不进看板,
 *   已取消的任务也不出现在看板上
 * - 卡片:标题 + 优先级标签 + 负责人 + 估时 + 截止日(逾期的标红)
 * - 拖到已完成列写的是**整对象 PUT**(必填字段齐、只改 status_code 一个维度、
 *   不带 reporter_id/sort_order/created_via_code 三列)
 * - 拖拽写失败时**卡片回到原列**(错误提示由请求层统一弹)
 * - 没有 `…:update` 权限时卡片**不可拖拽**
 *
 * 菜单树:PM 模块挂在「/pm」目录下(helpers.buildCurrentUserResponse 的
 * MenuParent 参数),看板菜单的相对 route_path 'task/board' 会被拼到 /pm 下,
 * 必须与前端路由表对齐。
 */

const BOARD_PAGE_PATH = '/pm/task/board';
const TASK_LIST_URL = '**/api/v1/pm_task/list**';
const TASK_DETAIL_URL = '**/api/v1/pm_task/detail/**';
const TASK_UPDATE_URL = '**/api/v1/pm_task/update/**';
/** 字典选项接口(列标题的任务状态 + 卡片上的优先级标签) */
const dictDataUrl = (dictType: string) =>
  `**/api/v1/system/dict/data/info/${dictType}**`;

/**
 * PM 菜单树里的看板菜单(type=2)+ 一个按钮权限节点(type=3)。
 *
 * 看板是「读 + 改状态」的面:列表要 `…:query`,拖拽要 `…:update`。
 * type=3 节点授予权限但不出现在侧边栏。
 */
const boardMenu = {
  title: '任务看板',
  routePath: 'task/board',
  permission: 'module_pm_project:pm_task:query',
  buttons: [
    {
      title: '编辑任务',
      permission: 'module_pm_project:pm_task:update',
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

/** 任务状态字典(后端种子 SQL 的**七**态:多出来的 cancelled 是「已取消」) */
const taskStatusDictResponse = dictDataResponse([
  { dict_label: '待规划', dict_value: 'backlog', list_class: 'default' },
  { dict_label: '待办', dict_value: 'todo', list_class: 'info' },
  { dict_label: '进行中', dict_value: 'in_progress', list_class: 'primary' },
  { dict_label: '阻塞', dict_value: 'blocked', list_class: 'warning' },
  { dict_label: '评审', dict_value: 'review', list_class: 'primary' },
  { dict_label: '已完成', dict_value: 'done', list_class: 'success' },
  { dict_label: '已取消', dict_value: 'cancelled', list_class: 'danger' },
]);

/** 优先级(P0–P3) */
const priorityDictResponse = dictDataResponse([
  { dict_label: '紧急', dict_value: 'P0', list_class: 'danger' },
  { dict_label: '高', dict_value: 'P1', list_class: 'warning' },
  { dict_label: '中', dict_value: 'P2', list_class: 'info' },
  { dict_label: '低', dict_value: 'P3', list_class: 'default' },
]);

/** 写操作成功后的信封(提示文案由请求层统一弹,这里只让 promise 落地) */
const okResponse = {
  code: 0,
  msg: '操作成功',
  data: null,
  status_code: 200,
  success: true,
};

/**
 * 相对今天偏移若干天的日期(YYYY-MM-DD,本地时区)。
 *
 * 逾期的判定是「截止日 < 今天」—— 用相对日期写夹具,
 * 用例不会随日历往前跑而失效。
 */
function dateOffset(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** 逾期任务的截止日(昨天) */
const OVERDUE_DATE = dateOffset(-1);
/** 未逾期任务的截止日(明天) */
const FUTURE_DATE = dateOffset(1);

/** 一张卡片的数据(形状对齐后端的 TaskOut) */
function taskRow(row: {
  id: number;
  title: string;
  status_code: string;
  priority_code?: string;
  type_code?: string;
  estimate_hours?: number | null;
  due_date?: string | null;
  assignee?: { id: number; name: string; username: string } | null;
}): Record<string, unknown> {
  return {
    id: row.id,
    project_id: 1,
    milestone_id: 11,
    parent_id: null,
    title: row.title,
    description: '需求评审通过后交付',
    type_code: row.type_code ?? 'feature',
    status_code: row.status_code,
    priority_code: row.priority_code ?? 'P1',
    estimate_hours: row.estimate_hours ?? null,
    actual_hours: null,
    assignee_id: row.assignee?.id ?? null,
    reporter_id: 2,
    reviewers: null,
    labels: null,
    start_date: null,
    due_date: row.due_date ?? null,
    actual_start_date: null,
    actual_end_date: null,
    sort_order: 0,
    created_via_code: 'manual',
    blocked_reason: null,
    assignee_by: row.assignee ?? null,
    reporter_by: { id: 2, name: '李四', username: 'lisi' },
    created_time: '2026-11-01 09:00:00',
    updated_time: '2026-11-04 09:00:00',
  };
}

const zhangsan = { id: 1, name: '张三', username: 'zhangsan' };
const lisi = { id: 2, name: '李四', username: 'lisi' };

/**
 * 看板的六列各放一张卡片,外加一条**已取消**的任务。
 *
 * 已取消的那条用来证明「cancelled 不进看板」—— 它在响应里,却不该出现在页面上。
 */
const boardListResponse = {
  code: 0,
  msg: '查询成功',
  data: {
    items: [
      taskRow({
        id: 21,
        title: '梳理需求清单',
        status_code: 'backlog',
        priority_code: 'P2',
        estimate_hours: 3,
        due_date: FUTURE_DATE,
        assignee: lisi,
      }),
      taskRow({
        id: 22,
        title: '搭建脚手架',
        status_code: 'todo',
        priority_code: 'P1',
        estimate_hours: 8,
        due_date: FUTURE_DATE,
        assignee: zhangsan,
      }),
      taskRow({
        id: 23,
        title: '输出需求规格说明书',
        status_code: 'in_progress',
        priority_code: 'P0',
        estimate_hours: 16,
        due_date: OVERDUE_DATE,
        assignee: zhangsan,
      }),
      taskRow({
        id: 24,
        title: '修复登录超时',
        status_code: 'blocked',
        priority_code: 'P0',
        type_code: 'bug',
        assignee: null,
      }),
      taskRow({
        id: 25,
        title: '评审技术方案',
        status_code: 'review',
        priority_code: 'P2',
        estimate_hours: 5,
        due_date: FUTURE_DATE,
        assignee: lisi,
      }),
      taskRow({
        id: 26,
        title: '初始化仓库',
        status_code: 'done',
        priority_code: 'P3',
        estimate_hours: 1,
        due_date: FUTURE_DATE,
        assignee: zhangsan,
      }),
      taskRow({
        id: 27,
        title: '放弃的需求',
        status_code: 'cancelled',
        priority_code: 'P3',
        assignee: lisi,
      }),
    ],
    total: 7,
    page_no: 1,
    page_size: 100,
    has_next: false,
  },
  status_code: 200,
  success: true,
};

/**
 * 装好受控页面:登录态 + PM 菜单树 + 任务列表 + 两个字典。
 *
 * @param canDrag 是否授予 `…:update` 权限(没有它卡片不可拖拽)
 * @param total 后端一共多少个任务(默认夹具里的 7;给 250 就是「看板只拉得回一页」)
 */
async function setupBoardPage(
  page: Page,
  options?: { canDrag?: boolean; total?: number },
): Promise<string[]> {
  const canDrag = options?.canDrag ?? true;
  const buttons = canDrag ? boardMenu.buttons : [];

  const listRequests = await setupModulePage(page, {
    menus: [{ ...boardMenu, buttons }],
    parent: { routePath: '/pm', title: '项目管理' },
    listUrl: TASK_LIST_URL,
    listBody: options?.total
      ? {
          ...boardListResponse,
          data: { ...boardListResponse.data, total: options.total },
        }
      : boardListResponse,
  });

  // 字典:列标题(任务状态)与卡片上的优先级标签
  await page.route(dictDataUrl('module_pm_task_status'), (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(taskStatusDictResponse),
    }),
  );
  await page.route(dictDataUrl('module_pm_priority'), (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(priorityDictResponse),
    }),
  );

  await gotoModulePage(
    page,
    BOARD_PAGE_PATH,
    page.locator('[data-column="backlog"]'),
  );

  return listRequests;
}

/** 看板上的某一列 */
function boardColumn(page: Page, status: string): Locator {
  return page.locator(`[data-column="${status}"]`);
}

/** 某一列的列头(拖拽落点:列头是空的,不会误拖到卡片上) */
function boardColumnHead(page: Page, status: string): Locator {
  return page.locator(`[data-column-head="${status}"]`);
}

/** 看板上的某张卡片 */
function boardCard(page: Page, taskId: number): Locator {
  return page.locator(`[data-task-id="${taskId}"]`);
}

/** 取元素的计算颜色(rgb(r, g, b);alpha 不参与比较) */
async function colorOf(locator: Locator): Promise<[number, number, number]> {
  const color = await locator.evaluate(
    (element) => window.getComputedStyle(element).color,
  );
  const matched = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(color);
  if (!matched) throw new Error(`拿不到颜色:${color}`);
  return [Number(matched[1]), Number(matched[2]), Number(matched[3])];
}

test.describe('任务看板页', () => {
  test('渲染六列', async ({ page }) => {
    const listRequests = await setupBoardPage(page);

    // 看板一次拉满:后端的 page_size 上限是 100
    await expect.poll(() => listRequests.length).toBe(1);
    expect(listRequests[0]).toContain('page_size=100');

    // 六列,顺序固定
    expect(
      await page
        .locator('[data-column]')
        .evaluateAll((elements) =>
          elements.map((element) => element.getAttribute('data-column')),
        ),
    ).toEqual(['backlog', 'todo', 'in_progress', 'blocked', 'review', 'done']);

    // 列标题是中文
    await expect(boardColumn(page, 'backlog')).toContainText('待规划');
    await expect(boardColumn(page, 'todo')).toContainText('待办');
    await expect(boardColumn(page, 'in_progress')).toContainText('进行中');
    await expect(boardColumn(page, 'blocked')).toContainText('阻塞');
    await expect(boardColumn(page, 'review')).toContainText('评审');
    await expect(boardColumn(page, 'done')).toContainText('已完成');

    // 每一列都有卡片
    await expect(boardCard(page, 21)).toBeVisible();
    await expect(boardCard(page, 26)).toBeVisible();
  });

  test('看板不含已取消列', async ({ page }) => {
    await setupBoardPage(page);

    // 字典里明明有「已取消」,但看板没有这一列
    await expect(page.locator('[data-column="cancelled"]')).toHaveCount(0);
    await expect(page.getByText('已取消')).toHaveCount(0);

    // 已取消的任务也不出现在看板上
    await expect(boardCard(page, 27)).toHaveCount(0);
    await expect(page.getByText('放弃的需求')).toHaveCount(0);
  });

  test('任务数超过一页时提示说清「只拉到 100 条」与已取消的不进看板', async ({
    page,
  }) => {
    // 后端一共 250 个任务,但看板只拉得回第一页(100 条)
    await setupBoardPage(page, { total: 250 });

    const alert = page.locator('.ant-alert');
    await expect(alert).toHaveCount(1);
    // 提示说的是**实际发生的事**:只拉到前 100 条 + 已取消的不进看板
    await expect(alert).toContainText('只拉了前 100 个任务');
    await expect(alert).toContainText('250 个');
    await expect(alert).toContainText('已取消');
  });

  test('卡片显示标题/优先级/负责人/估时/截止日,逾期的标红', async ({
    page,
  }) => {
    await setupBoardPage(page);

    const card = boardCard(page, 23);
    await expect(card).toContainText('输出需求规格说明书');
    // 优先级是字典标签(不是原始的 P0)
    await expect(card.getByText('紧急', { exact: true })).toBeVisible();
    // 负责人
    await expect(card.getByText('张三', { exact: true })).toBeVisible();
    // 估时
    await expect(card.getByText('估时 16h', { exact: true })).toBeVisible();
    // 截止日
    await expect(card.getByText(OVERDUE_DATE, { exact: true })).toBeVisible();

    // 逾期的截止日标红:与未逾期的那个颜色不同,且红色分量占优
    const overdue = await colorOf(
      card.getByText(OVERDUE_DATE, { exact: true }),
    );
    const normal = await colorOf(
      boardCard(page, 22).getByText(FUTURE_DATE, { exact: true }),
    );
    expect(overdue).not.toEqual(normal);
    expect(overdue[0]).toBeGreaterThan(overdue[1]);
    expect(overdue[0]).toBeGreaterThan(overdue[2]);
  });

  test('拖到已完成列会写 status_code=done', async ({ page }) => {
    const updateRequests: { url: string; method: string; body: unknown }[] = [];
    const detailRequests: string[] = [];

    await setupBoardPage(page);

    // 详情接口**不该被调用**:卡片自带 PUT 需要的每一个字段。
    // 这里把它拦下来并记录 —— 实现一旦退回「读-改-写」就会被这条断言抓住。
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

    // 拖「输出需求规格说明书」(进行中)到「已完成」
    await boardCard(page, 23).dragTo(boardColumnHead(page, 'done'));

    await expect.poll(() => updateRequests.length).toBe(1);
    expect(updateRequests[0].method).toBe('PUT');
    expect(updateRequests[0].url).toContain('/pm_task/update/23');

    // 没有详情请求:拖拽只要 update 权限,不能再多要一个 detail 权限
    expect(detailRequests).toHaveLength(0);

    const body = updateRequests[0].body as Record<string, unknown>;

    // 拖拽只改 status_code 一个维度
    expect(body.status_code).toBe('done');
    // 整对象 PUT(后端没有 PATCH):必填字段一个都不能少,其余字段原样带回
    expect(body).toMatchObject({
      project_id: 1,
      milestone_id: 11,
      title: '输出需求规格说明书',
      type_code: 'feature',
      priority_code: 'P0',
      estimate_hours: 16,
      assignee_id: 1,
    });
    // 不是用户可编辑的三列:一个都不带
    // (后端 `model_dump(exclude_unset=True)` 会原样保留库里的值)
    expect(body).not.toHaveProperty('reporter_id');
    expect(body).not.toHaveProperty('sort_order');
    expect(body).not.toHaveProperty('created_via_code');

    // 卡片落到已完成列
    await expect(
      boardColumn(page, 'done').locator('[data-task-id="23"]'),
    ).toBeVisible();
    await expect(
      boardColumn(page, 'in_progress').locator('[data-task-id="23"]'),
    ).toHaveCount(0);
  });

  test('拖拽写失败时卡片回到原列', async ({ page }) => {
    const updateRequests: unknown[] = [];

    await setupBoardPage(page);

    // 写失败:后端的业务错误是 HTTP 500 + 信封
    await page.route(TASK_UPDATE_URL, (route) => {
      updateRequests.push(route.request().postDataJSON());
      return route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify(businessErrorBody('保存失败,请重试')),
      });
    });

    await boardCard(page, 23).dragTo(boardColumnHead(page, 'review'));

    await expect.poll(() => updateRequests.length).toBe(1);

    // 卡片回到原列(进行中),没有留在评审列
    await expect(
      boardColumn(page, 'in_progress').locator('[data-task-id="23"]'),
    ).toBeVisible();
    await expect(
      boardColumn(page, 'review').locator('[data-task-id="23"]'),
    ).toHaveCount(0);

    // 错误提示由请求层统一弹(页面自己不弹 message)
    await expect(page.getByText('保存失败,请重试')).toBeVisible();
  });

  test('没有 update 权限时卡片不可拖拽', async ({ page }) => {
    await setupBoardPage(page, { canDrag: false });

    // 看板能读(query),但拖不动(没有 update)
    await expect(boardCard(page, 23)).toHaveAttribute('draggable', 'false');
  });
});
