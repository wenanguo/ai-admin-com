import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import {
  PM_MILESTONE_PREFIX,
  PM_PROJECT_PREFIX,
} from '../src/services/api/pm/paths';
import {
  gotoModulePage,
  modalFormItem,
  pickInModal,
  pickToday,
  setupModulePage,
  tableRows,
} from './helpers';

/**
 * 里程碑管理页(/pm/milestone)的前端闭环,接口全部拦截。
 *
 * 覆盖八件事(brief 逐条):
 * - 列表渲染:里程碑名称/所属项目(project_by.name)/状态字典标签/计划与实际区间
 * - 进度条用**后端缓存的 progress**(里程碑响应里没有任务数据,前端算不出来)
 * - 健康度显示后端的 health_score
 * - 表单的状态选项**没有** at_risk 与 missed(INV-13:规则独占写权)
 * - 列表里读到 at_risk 时,标签加一句「由规则引擎判定」的说明
 * - 新增提交的是**线上码**(status_code='in_progress'),且带上 project_id
 * - 编辑把交付物的 JSON 文本还原成对象提交(整对象 PUT)
 * - 交付物不是 JSON 对象时表单内报错,请求根本不发
 * - 编辑 at_risk 的里程碑:状态**只读**(显示字典标签「风险」而不是原始码),
 *   人改不了它,提交体里的状态原样回传(INV-13)
 *
 * 菜单树:PM 模块挂在「/pm」目录下(helpers.buildCurrentUserResponse 的
 * MenuParent 参数),子菜单的相对 route_path 'milestone' 会被拼到 /pm 下,
 * 必须与前端路由表对齐。
 */

const MILESTONE_PAGE_PATH = '/pm/milestone';
const MILESTONE_LIST_URL = `**/api/v1${PM_MILESTONE_PREFIX}/list**`;
const MILESTONE_CREATE_URL = `**/api/v1${PM_MILESTONE_PREFIX}/create**`;
const MILESTONE_UPDATE_URL = `**/api/v1${PM_MILESTONE_PREFIX}/update/**`;
/** 表单的「所属项目」下拉:远程搜项目(候选来自 listProjects) */
const PROJECT_LIST_URL = `**/api/v1${PM_PROJECT_PREFIX}/list**`;
/** 字典选项接口(状态下拉与状态标签共用) */
const dictDataUrl = (dictType: string) =>
  `**/api/v1/system/dict/data/info/${dictType}**`;

/**
 * PM 菜单树里的里程碑菜单(type=2)+ 三个按钮权限节点(type=3)。
 *
 * type=3 节点授予权限但不出现在侧边栏(collectPermissions 收集、
 * buildMenuItems 剔除)—— 「新增」按钮能不能点取决于 create 那条节点在不在。
 */
const milestoneMenu = {
  title: '里程碑管理',
  routePath: 'milestone',
  permission: 'module_pm_project:pm_milestone:query',
  buttons: [
    {
      title: '新增里程碑',
      permission: 'module_pm_project:pm_milestone:create',
    },
    {
      title: '编辑里程碑',
      permission: 'module_pm_project:pm_milestone:update',
    },
    {
      title: '删除里程碑',
      permission: 'module_pm_project:pm_milestone:delete',
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

/** 里程碑状态字典(后端种子 SQL 的五态:没有 cancelled) */
const milestoneStatusDictResponse = dictDataResponse([
  { dict_label: '未开始', dict_value: 'upcoming', list_class: 'info' },
  { dict_label: '进行中', dict_value: 'in_progress', list_class: 'primary' },
  { dict_label: '风险', dict_value: 'at_risk', list_class: 'warning' },
  { dict_label: '已完成', dict_value: 'done', list_class: 'success' },
  { dict_label: '已延期', dict_value: 'missed', list_class: 'danger' },
]);

/**
 * 列表里的第一行(形状对齐 MilestoneOut)。
 *
 * progress=66 是后端缓存的派生字段 —— 里程碑响应里没有任何任务数据,
 * 前端算不出 66,页面能显示它就证明读的是后端字段而不是前端重算。
 * deliverables 是 dict(不是数组),编辑时表单要还原成 JSON 文本。
 */
const milestoneRow = {
  id: 11,
  project_id: 1,
  name: '需求分析完成',
  description: '输出需求规格说明书',
  start_date: '2026-11-05',
  due_date: '2026-11-20',
  actual_start_date: '2026-11-06',
  actual_end_date: null,
  status_code: 'in_progress',
  deliverables: { doc: '需求规格说明书' },
  sort_order: 1,
  health_score: 80,
  progress: 66,
  project_by: { id: 1, name: 'AIPM 核心项目', code: 'AIPM-CORE' },
  created_time: '2026-11-01 09:00:00',
  updated_time: '2026-11-10 09:00:00',
};

/**
 * 第二行:状态是 at_risk —— 规则引擎判定的状态,人不能手工设。
 * 列表里读到它要显示标签 + 一句说明。
 */
const atRiskMilestoneRow = {
  id: 12,
  project_id: 1,
  name: '联调准备',
  description: null,
  start_date: '2026-11-21',
  due_date: '2026-12-05',
  actual_start_date: null,
  actual_end_date: null,
  status_code: 'at_risk',
  deliverables: null,
  sort_order: 2,
  health_score: 40,
  progress: 20,
  project_by: { id: 1, name: 'AIPM 核心项目', code: 'AIPM-CORE' },
  created_time: '2026-11-01 09:00:00',
  updated_time: '2026-11-10 09:00:00',
};

const milestoneListResponse = {
  code: 0,
  msg: '查询成功',
  data: {
    items: [milestoneRow, atRiskMilestoneRow],
    total: 2,
    page_no: 1,
    page_size: 10,
    has_next: false,
  },
  status_code: 200,
  success: true,
};

/** 「所属项目」下拉的候选(远程搜项目) */
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

/** 写操作成功后的信封(提示文案由请求层统一弹,这里只让 promise 落地) */
const okResponse = {
  code: 0,
  msg: '操作成功',
  data: null,
  status_code: 200,
  success: true,
};

/**
 * 装好受控页面:登录态 + PM 菜单树 + 里程碑列表 + 状态字典 + 项目列表。
 * 返回收集到的列表请求 URL(断言分页/排序参数用,读之前先 expect.poll)。
 */
async function setupMilestonePage(page: Page): Promise<string[]> {
  const listRequests = await setupModulePage(page, {
    menus: [milestoneMenu],
    parent: { routePath: '/pm', title: '项目管理' },
    listUrl: MILESTONE_LIST_URL,
    listBody: milestoneListResponse,
  });

  // 状态字典:列表标签与表单下拉共用(模块级缓存只发一次)
  await page.route(dictDataUrl('module_pm_milestone_status'), (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(milestoneStatusDictResponse),
    }),
  );

  // 「所属项目」下拉的候选(远程搜项目)
  await page.route(PROJECT_LIST_URL, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(projectListResponse),
    }),
  );

  return listRequests;
}

test.describe('里程碑管理页', () => {
  test('渲染里程碑列表与状态标签', async ({ page }) => {
    const listRequests = await setupMilestonePage(page);

    await gotoModulePage(
      page,
      MILESTONE_PAGE_PATH,
      page.locator('.ant-menu').getByText('里程碑管理'),
    );

    // 侧边栏来自后端菜单:PM 目录挂在 /pm 下(不是 /system)
    await expect(page.locator('.ant-menu').getByText('项目管理')).toBeVisible();
    await expect(
      page.locator('.ant-menu').getByText('里程碑管理'),
    ).toBeVisible();

    // 两行里程碑
    const rows = tableRows(page);
    await expect(rows).toHaveCount(2);

    const row = rows.filter({ hasText: '需求分析完成' });
    await expect(row).toContainText('需求分析完成');
    // 所属项目读 project_by.name(后端随行返回的冗余字段)
    await expect(row).toContainText('AIPM 核心项目');
    // 字典线上码渲染成中文标签(不是原始的 in_progress)
    await expect(row).toContainText('进行中');
    // 计划区间与实际区间(实际结束日期为空时用占位符)
    await expect(row).toContainText('2026-11-05 ~ 2026-11-20');
    await expect(row).toContainText('2026-11-06 ~ -');
    // 显示排序
    await expect(row.getByText('1', { exact: true })).toBeVisible();

    // 列表请求:后端约定的分页参数 + 竖排时间线的排序(显示排序 → 计划开始日)
    await expect.poll(() => listRequests.length).toBeGreaterThan(0);
    expect(listRequests[0]).toContain('page_no=1');
    expect(listRequests[0]).toContain('page_size=10');
    const decoded = decodeURIComponent(listRequests[0]);
    expect(decoded).toContain('sort_order');
    expect(decoded).toContain('start_date');
  });

  test('进度条用后端缓存的 progress,不在前端重算', async ({ page }) => {
    await setupMilestonePage(page);

    await gotoModulePage(
      page,
      MILESTONE_PAGE_PATH,
      page.locator('.ant-menu').getByText('里程碑管理'),
    );

    const row = tableRows(page).filter({ hasText: '需求分析完成' });

    // 里程碑响应里没有任何任务数据,前端算不出 66 ——
    // 能显示出来就证明读的是后端缓存的 progress 字段
    await expect(row.getByRole('progressbar')).toHaveAttribute(
      'aria-valuenow',
      '66',
    );
    await expect(row.getByText('66%')).toBeVisible();
  });

  test('健康度显示后端的 health_score', async ({ page }) => {
    await setupMilestonePage(page);

    await gotoModulePage(
      page,
      MILESTONE_PAGE_PATH,
      page.locator('.ant-menu').getByText('里程碑管理'),
    );

    const row = tableRows(page).filter({ hasText: '需求分析完成' });
    await expect(row.getByText('80', { exact: true })).toBeVisible();
  });

  test('表单的状态选项不含 at_risk 与 missed(规则独占写权)', async ({
    page,
  }) => {
    await setupMilestonePage(page);

    await gotoModulePage(
      page,
      MILESTONE_PAGE_PATH,
      page.locator('.ant-menu').getByText('里程碑管理'),
    );

    await page.getByRole('button', { name: '新增' }).click();
    await expect(page.locator('.ant-modal')).toBeVisible();

    await modalFormItem(page, '状态').locator('input[role="combobox"]').click();
    const dropdown = page.locator('.ant-select-dropdown:visible');

    // 手工能设的三个态
    await expect(dropdown.getByText('未开始', { exact: true })).toBeVisible();
    await expect(dropdown.getByText('进行中', { exact: true })).toBeVisible();
    await expect(dropdown.getByText('已完成', { exact: true })).toBeVisible();

    // at_risk / missed 由规则引擎独占写权(INV-13),表单里不提供
    await expect(dropdown.getByText('风险', { exact: true })).toHaveCount(0);
    await expect(dropdown.getByText('已延期', { exact: true })).toHaveCount(0);
  });

  test('列表读到 at_risk 时说明它由规则引擎判定', async ({ page }) => {
    await setupMilestonePage(page);

    await gotoModulePage(
      page,
      MILESTONE_PAGE_PATH,
      page.locator('.ant-menu').getByText('里程碑管理'),
    );

    const row = tableRows(page).filter({ hasText: '联调准备' });
    const tag = row.getByText('风险', { exact: true });
    await expect(tag).toBeVisible();

    // 悬停出说明:这个状态不是人手工设的
    await tag.hover();
    await expect(page.getByText('由规则引擎判定，不可手工设置')).toBeVisible();
  });

  test('新增提交 project_id 与 status_code', async ({ page }) => {
    const createRequests: { url: string; method: string; body: unknown }[] = [];

    await setupMilestonePage(page);

    await page.route(MILESTONE_CREATE_URL, (route) => {
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
      MILESTONE_PAGE_PATH,
      page.locator('.ant-menu').getByText('里程碑管理'),
    );

    await page.getByRole('button', { name: '新增' }).click();
    await expect(page.locator('.ant-modal')).toBeVisible();

    // 所属项目:远程搜索下拉,选项来自 listProjects
    await pickInModal(page, '所属项目', 'AIPM 核心项目');

    await modalFormItem(page, '里程碑名称').locator('input').fill('E2E 里程碑');

    // 计划区间:两个日期都选今天(提交时序列化成 YYYY-MM-DD 字符串)
    await pickToday(page, '计划开始日期');
    await pickToday(page, '计划截止日期');

    // 状态:字典下拉,提交 dict_value
    await pickInModal(page, '状态', '进行中');

    // 显示排序:数字
    await modalFormItem(page, '显示排序').locator('input').fill('3');

    // 交付物:JSON 对象文本
    await modalFormItem(page, '交付物')
      .locator('textarea')
      .fill('{"doc":"需求规格说明书"}');

    await page.locator('.ant-modal-footer button.ant-btn-primary').click();

    await expect.poll(() => createRequests.length).toBe(1);
    expect(createRequests[0].method).toBe('POST');
    expect(createRequests[0].url).toContain(`${PM_MILESTONE_PREFIX}/create`);

    // 提交的是线上码(dict_value),不是中文标签
    const body = createRequests[0].body as Record<string, unknown>;
    expect(body).toMatchObject({
      project_id: 1,
      name: 'E2E 里程碑',
      status_code: 'in_progress',
      sort_order: 3,
      // 交付物是 dict(后端是 JSON 列),不是字符串
      deliverables: { doc: '需求规格说明书' },
    });
    expect(JSON.stringify(body)).not.toContain('进行中');
    // 规则独占的状态不进创建请求(INV-13):下拉里没有这两项,提交体里也不该有
    expect(['at_risk', 'missed']).not.toContain(String(body.status_code));
    // 日期提交为 YYYY-MM-DD 字符串(后端 date 协议),不是时间戳
    expect(String(body.start_date)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.start_date).toBe(body.due_date);
  });

  test('编辑把交付物的 JSON 文本还原成对象提交(整对象 PUT)', async ({
    page,
  }) => {
    const updateRequests: { url: string; method: string; body: unknown }[] = [];

    await setupMilestonePage(page);

    await page.route(MILESTONE_UPDATE_URL, (route) => {
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
      MILESTONE_PAGE_PATH,
      page.locator('.ant-menu').getByText('里程碑管理'),
    );

    await page.getByRole('button', { name: '编辑' }).first().click();
    await expect(page.locator('.ant-modal')).toBeVisible();

    // 回显:后端存的是 dict,表单里编辑成 JSON 文本
    await expect(modalFormItem(page, '交付物').locator('textarea')).toHaveValue(
      JSON.stringify({ doc: '需求规格说明书' }, null, 2),
    );
    // 状态回显:线上码渲染成中文标签
    await expect(
      modalFormItem(page, '状态').locator('.ant-select-content'),
    ).toContainText('进行中');
    // 所属项目回显:下拉把项目 id 显示成项目名
    await expect(
      modalFormItem(page, '所属项目').locator('.ant-select-content'),
    ).toContainText('AIPM 核心项目');

    await page.locator('.ant-modal-footer button.ant-btn-primary').click();

    await expect.poll(() => updateRequests.length).toBe(1);
    expect(updateRequests[0].method).toBe('PUT');
    expect(updateRequests[0].url).toContain(`${PM_MILESTONE_PREFIX}/update/11`);

    // 更新是整对象 PUT:后端必填的字段都在,交付物还原成对象
    const body = updateRequests[0].body as Record<string, unknown>;
    expect(body).toMatchObject({
      project_id: 1,
      name: '需求分析完成',
      status_code: 'in_progress',
      sort_order: 1,
      deliverables: { doc: '需求规格说明书' },
    });
    // 日期以 YYYY-MM-DD 字符串原样回传(后端 date 协议)
    expect(body.start_date).toBe('2026-11-05');
    expect(body.due_date).toBe('2026-11-20');
  });

  test('编辑 at_risk 的里程碑:状态只读显示标签,人改不了', async ({ page }) => {
    const updateRequests: { url: string; method: string; body: unknown }[] = [];

    await setupMilestonePage(page);

    await page.route(MILESTONE_UPDATE_URL, (route) => {
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
      MILESTONE_PAGE_PATH,
      page.locator('.ant-menu').getByText('里程碑管理'),
    );

    // 第二行是 at_risk:规则引擎判定的状态,人不能手工设
    const row = tableRows(page).filter({ hasText: '联调准备' });
    await row.getByRole('button', { name: '编辑' }).click();
    await expect(page.locator('.ant-modal')).toBeVisible();

    const statusItem = modalFormItem(page, '状态');
    // 显示字典标签(「风险」),不是原始线上码 at_risk
    await expect(statusItem).toContainText('风险');
    await expect(statusItem).not.toContainText('at_risk');

    // 只读:没有可输入的下拉,点它也开不出选项
    await expect(statusItem.locator('input[role="combobox"]')).toHaveCount(0);
    await statusItem.click();
    await expect(page.locator('.ant-select-dropdown:visible')).toHaveCount(0);

    // 悬停出说明:这个状态不是人手工设的
    await statusItem.getByText('风险', { exact: true }).hover();
    await expect(page.getByText('由规则引擎判定，不可手工设置')).toBeVisible();

    // 改个名字提交:状态原样回传,人没机会挑它
    await modalFormItem(page, '里程碑名称')
      .locator('input')
      .fill('联调准备(改名)');
    await page.locator('.ant-modal-footer button.ant-btn-primary').click();

    await expect.poll(() => updateRequests.length).toBe(1);
    expect(updateRequests[0].method).toBe('PUT');
    expect(updateRequests[0].url).toContain(`${PM_MILESTONE_PREFIX}/update/12`);

    const body = updateRequests[0].body as Record<string, unknown>;
    expect(body.name).toBe('联调准备(改名)');
    // 规则独占的状态:只读展示、原样回传 —— 人改不了它
    expect(body.status_code).toBe('at_risk');
  });

  test('交付物不是 JSON 对象时表单内报错,请求根本不发', async ({ page }) => {
    const createRequests: unknown[] = [];

    await setupMilestonePage(page);

    await page.route(MILESTONE_CREATE_URL, (route) => {
      createRequests.push(route.request().postDataJSON());
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(okResponse),
      });
    });

    await gotoModulePage(
      page,
      MILESTONE_PAGE_PATH,
      page.locator('.ant-menu').getByText('里程碑管理'),
    );

    await page.getByRole('button', { name: '新增' }).click();
    await expect(page.locator('.ant-modal')).toBeVisible();

    // 交付物必须是 JSON 对象:数组不行
    await modalFormItem(page, '交付物')
      .locator('textarea')
      .fill('["需求规格说明书"]');

    await page.locator('.ant-modal-footer button.ant-btn-primary').click();

    // 表单内报错(不是后端 422 之后的 toast)
    await expect(page.getByText(/交付物必须是\s*JSON\s*对象/)).toBeVisible();
    // 请求根本没发出去
    expect(createRequests).toHaveLength(0);
  });
});
