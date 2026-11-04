import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import {
  gotoModulePage,
  modalFormItem,
  pickInModal,
  pickToday,
  seedAuthState,
  tableRows,
} from './helpers';

/**
 * 项目管理列表页(/pm/project)的前端闭环,接口全部拦截。
 *
 * 覆盖五件事(brief 逐条):
 * - 列表渲染 + 分页参数用后端约定的 page_no / page_size
 * - 新增提交的是**线上码**:status_code='planning' / priority_code='P1'
 *   (字典的 dict_value,不是中文标签「规划中」「高」)
 * - code 不符合 ^[A-Z0-9_-]{2,32}$ 时表单内报错,请求根本不发
 * - 编辑提交 owner_id(后端必填,整对象 PUT)
 * - 删除的请求体是**裸数组**(后端 delete 接口收 ids: list[int])
 *
 * 菜单树与既有 spec 的差别:PM 模块挂在「/pm」目录下,不是 /system ——
 * 这里手造信封(子菜单的相对 route_path 'project' 会被拼到 /pm 下,
 * 必须与前端路由表对齐)。helpers.buildCurrentUserResponse 现在也支持
 * 自定义父目录(helpers 的 MenuParent),但这份夹具的 id/用户字段是
 * 本 spec 自己的,保持原样不动。
 */

const PROJECT_PAGE_PATH = '/pm/project';
const CURRENT_INFO_URL = '**/api/v1/system/user/current/info';
const PROJECT_LIST_URL = '**/api/v1/pm_project/list**';
const PROJECT_CREATE_URL = '**/api/v1/pm_project/create**';
const PROJECT_UPDATE_URL = '**/api/v1/pm_project/update/**';
const PROJECT_DELETE_URL = '**/api/v1/pm_project/delete**';
const USER_LIST_URL = '**/api/v1/system/user/list**';
/** 详情页:项目详情与成员接口(项目 id 在路径上)+ 三个子列表接口 */
const PROJECT_DETAIL_URL = '**/api/v1/pm_project/detail/1';
const PROJECT_MEMBERS_URL = '**/api/v1/pm_project/members/1';
const MILESTONE_LIST_URL = '**/api/v1/pm_milestone/list**';
const TASK_LIST_URL = '**/api/v1/pm_task/list**';
const RISK_LIST_URL = '**/api/v1/pm_risk/list**';
/** 字典选项接口(状态/优先级/可见性三个下拉与标签共用) */
const dictDataUrl = (dictType: string) =>
  `**/api/v1/system/dict/data/info/${dictType}**`;

/**
 * 后端 current/info 下发的 PM 菜单树。
 *
 * 结构:目录 /pm(type=1)→ 项目菜单(type=2)→ 按钮权限节点(type=3)。
 * type=3 节点授予权限但不出现在侧边栏(collectPermissions 收集、buildMenuItems 剔除)。
 */
const pmCurrentUserResponse = {
  code: 0,
  msg: '获取当前用户信息成功',
  data: {
    id: 1,
    username: 'pmuser',
    name: '项目管理员',
    status: 0,
    is_superuser: false,
    role_ids: [2],
    roles: [],
    menus: [
      {
        id: 2,
        parent_id: null,
        name: '项目管理',
        type: 1,
        order: 2,
        route_path: '/pm',
        title: '项目管理',
        status: 0,
        hidden: false,
        children: [
          {
            id: 3,
            parent_id: 2,
            name: '项目列表',
            type: 2,
            order: 1,
            route_path: 'project',
            title: '项目列表',
            permission: 'module_pm_project:pm_project:query',
            status: 0,
            hidden: false,
            children: [
              {
                id: 30,
                parent_id: 3,
                name: '新增项目',
                type: 3,
                order: 1,
                route_path: '',
                title: '新增项目',
                permission: 'module_pm_project:pm_project:create',
                status: 0,
                hidden: false,
                children: null,
              },
              {
                id: 31,
                parent_id: 3,
                name: '编辑项目',
                type: 3,
                order: 2,
                route_path: '',
                title: '编辑项目',
                permission: 'module_pm_project:pm_project:update',
                status: 0,
                hidden: false,
                children: null,
              },
              {
                id: 32,
                parent_id: 3,
                name: '删除项目',
                type: 3,
                order: 3,
                route_path: '',
                title: '删除项目',
                permission: 'module_pm_project:pm_project:delete',
                status: 0,
                hidden: false,
                children: null,
              },
            ],
          },
        ],
      },
    ],
  },
  status_code: 200,
  success: true,
};

/** 列表里那一行项目(线上的值 + owner_by 冗余字段,形状对齐 ProjectOut) */
const projectRow = {
  id: 1,
  code: 'AIPM-CORE',
  name: 'AIPM 核心项目',
  description: 'v1 交付',
  owner_id: 1,
  template_id: null,
  status_code: 'planning',
  priority_code: 'P1',
  start_date: '2026-11-01',
  due_date: '2026-12-31',
  visibility_code: 'public',
  tags: '["财务","合规"]',
  extra_fields: null,
  owner_by: { id: 1, name: '张三', username: 'zhangsan' },
  created_time: '2026-11-01 09:00:00',
  updated_time: '2026-11-01 09:00:00',
};

const projectListResponse = {
  code: 0,
  msg: '查询成功',
  data: {
    items: [projectRow],
    total: 1,
    page_no: 1,
    page_size: 10,
    has_next: false,
  },
  status_code: 200,
  success: true,
};

/** 负责人远程搜索的候选(列表页搜索项与表单的下拉共用这个接口) */
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

/** 项目状态(后端种子 SQL 的 6 态) */
const statusDictResponse = dictDataResponse([
  { dict_label: '规划中', dict_value: 'planning', list_class: 'info' },
  { dict_label: '进行中', dict_value: 'active', list_class: 'primary' },
  { dict_label: '挂起', dict_value: 'on_hold', list_class: 'warning' },
  { dict_label: '已完成', dict_value: 'completed', list_class: 'success' },
  { dict_label: '已归档', dict_value: 'archived', list_class: 'default' },
  { dict_label: '已取消', dict_value: 'cancelled', list_class: 'danger' },
]);

/** 优先级(P0–P3) */
const priorityDictResponse = dictDataResponse([
  { dict_label: '紧急', dict_value: 'P0', list_class: 'danger' },
  { dict_label: '高', dict_value: 'P1', list_class: 'warning' },
  { dict_label: '中', dict_value: 'P2', list_class: 'info' },
  { dict_label: '低', dict_value: 'P3', list_class: 'default' },
]);

/** 可见性(公开/内部/私有) */
const visibilityDictResponse = dictDataResponse([
  { dict_label: '公开', dict_value: 'public', list_class: 'success' },
  { dict_label: '内部', dict_value: 'internal', list_class: 'primary' },
  { dict_label: '私有', dict_value: 'private', list_class: 'warning' },
]);

/** 里程碑状态(五态:upcoming/in_progress/at_risk/done/missed) */
const milestoneStatusDictResponse = dictDataResponse([
  { dict_label: '未开始', dict_value: 'upcoming', list_class: 'info' },
  { dict_label: '进行中', dict_value: 'in_progress', list_class: 'primary' },
  { dict_label: '风险', dict_value: 'at_risk', list_class: 'warning' },
  { dict_label: '已完成', dict_value: 'done', list_class: 'success' },
  { dict_label: '已延期', dict_value: 'missed', list_class: 'danger' },
]);

/** 任务状态(七态) */
const taskStatusDictResponse = dictDataResponse([
  { dict_label: '待规划', dict_value: 'backlog', list_class: 'default' },
  { dict_label: '待办', dict_value: 'todo', list_class: 'info' },
  { dict_label: '进行中', dict_value: 'in_progress', list_class: 'primary' },
  { dict_label: '阻塞', dict_value: 'blocked', list_class: 'warning' },
  { dict_label: '评审', dict_value: 'review', list_class: 'primary' },
  { dict_label: '已完成', dict_value: 'done', list_class: 'success' },
  { dict_label: '已取消', dict_value: 'cancelled', list_class: 'danger' },
]);

/** 风险状态(五态) */
const riskStatusDictResponse = dictDataResponse([
  { dict_label: '已识别', dict_value: 'identified', list_class: 'info' },
  { dict_label: '分析中', dict_value: 'analyzing', list_class: 'primary' },
  { dict_label: '缓解中', dict_value: 'mitigating', list_class: 'warning' },
  { dict_label: '已关闭', dict_value: 'closed', list_class: 'success' },
  { dict_label: '已发生', dict_value: 'realized', list_class: 'danger' },
]);

/** 项目成员角色(五角色) */
const projectRoleDictResponse = dictDataResponse([
  { dict_label: '浏览者', dict_value: 'viewer', list_class: 'default' },
  { dict_label: '成员', dict_value: 'member', list_class: 'info' },
  { dict_label: '执行者', dict_value: 'assignee', list_class: 'primary' },
  { dict_label: '管理者', dict_value: 'manager', list_class: 'warning' },
  { dict_label: '所有者', dict_value: 'owner', list_class: 'danger' },
]);

/** 写操作成功后的信封(提示文案由请求层统一弹,这里只让 promise 落地) */
const okResponse = {
  code: 0,
  msg: '操作成功',
  data: null,
  status_code: 200,
  success: true,
};

/* -------------------------------------------------------------------------- */
/* 项目详情页的夹具                                                             */
/* -------------------------------------------------------------------------- */

/**
 * 详情接口的信封:复用列表页的 projectRow —— 同一个项目,
 * 列表与详情看到的必须是同一份字段
 */
const projectDetailResponse = {
  code: 0,
  msg: '查询成功',
  data: projectRow,
  status_code: 200,
  success: true,
};

/**
 * 里程碑 tab 的那一行(形状对齐 MilestoneOut)。
 * progress=66 是后端缓存的派生字段 —— 里程碑响应里没有任何任务数据,
 * 前端不可能算出 66,页面能显示它就证明读的是后端字段而不是前端重算
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
  deliverables: null,
  sort_order: 1,
  health_score: 80,
  progress: 66,
  project_by: { id: 1, name: 'AIPM 核心项目', code: 'AIPM-CORE' },
  created_time: '2026-11-01 09:00:00',
  updated_time: '2026-11-10 09:00:00',
};

/** 任务 tab 的那一行(形状对齐 TaskOut;负责人读 assignee_by 冗余字段) */
const taskRow = {
  id: 21,
  project_id: 1,
  milestone_id: 11,
  parent_id: null,
  title: '输出需求规格说明书',
  description: null,
  type_code: 'feature',
  status_code: 'in_progress',
  priority_code: 'P1',
  estimate_hours: 8,
  actual_hours: 4,
  assignee_id: 1,
  reporter_id: 1,
  reviewers: null,
  labels: null,
  start_date: '2026-11-06',
  due_date: '2026-11-15',
  actual_start_date: '2026-11-06',
  actual_end_date: null,
  sort_order: 0,
  created_via_code: 'manual',
  blocked_reason: null,
  assignee_by: { id: 1, name: '张三', username: 'zhangsan' },
  reporter_by: { id: 1, name: '张三', username: 'zhangsan' },
  created_time: '2026-11-01 09:00:00',
  updated_time: '2026-11-06 09:00:00',
};

/**
 * 风险 tab 的两行(形状对齐 RiskOut)。后端只有 score 没有 level ——
 * 16(4×4)按共享件 riskLevel 落 SEVERE,6(2×3)落 MEDIUM,
 * 两个不同等级能证明等级标签真的是按 score 推导的
 */
const riskRows = [
  {
    id: 31,
    project_id: 1,
    title: '核心开发人员流失',
    description: null,
    category_code: 'scope',
    probability: 4,
    impact: 4,
    score: 16,
    status_code: 'identified',
    owner_id: 1,
    mitigation_plan: null,
    contingency_plan: null,
    due_date: null,
    trigger_date: null,
    created_via_code: 'manual',
    ai_suggestion: null,
    created_time: '2026-11-01 09:00:00',
    updated_time: '2026-11-01 09:00:00',
  },
  {
    id: 32,
    project_id: 1,
    title: '需求评审延期',
    description: null,
    category_code: 'schedule',
    probability: 2,
    impact: 3,
    score: 6,
    status_code: 'mitigating',
    owner_id: 2,
    mitigation_plan: '提前锁定评审时间',
    contingency_plan: null,
    due_date: '2026-11-25',
    trigger_date: null,
    created_via_code: 'manual',
    ai_suggestion: null,
    created_time: '2026-11-01 09:00:00',
    updated_time: '2026-11-02 09:00:00',
  },
];

/** 成员 tab 的那一行(形状对齐 ProjectMemberOut;姓名在 user_info 里) */
const memberRow = {
  id: 41,
  project_id: 1,
  user_id: 1,
  role_code: 'owner',
  joined_at: '2026-11-01T09:00:00',
  user_info: { id: 1, username: 'zhangsan', name: '张三' },
};

/** 详情页子列表的分页信封(详情页不翻页,一次拉满 page_size=100) */
function pagedListResponse(items: unknown[]) {
  return {
    code: 0,
    msg: '查询成功',
    data: {
      items,
      total: items.length,
      page_no: 1,
      page_size: 100,
      has_next: false,
    },
    status_code: 200,
    success: true,
  };
}

/** members 接口的信封:返回的是**数组**(不是分页信封) */
function membersResponse(members: unknown[]) {
  return {
    code: 0,
    msg: '获取项目成员列表成功',
    data: members,
    status_code: 200,
    success: true,
  };
}

/**
 * 当前激活的 tab 面板(懒挂载:只有打开过的 tab 才在 DOM 里)。
 * 隐藏面板是 aria-hidden="true",激活的才是 false —— 用 ARIA 契约选,
 * 不碰 antd 内部类名(antd 6 的面板类名已从 ant-tabs-tabpane-* 改成 ant-tabs-content-*)
 */
function activePanel(page: Page) {
  return page.locator('[role="tabpanel"][aria-hidden="false"]');
}

/**
 * 装好受控页面:登录态 + current/info 菜单树 + 项目列表 + 三个字典 + 用户列表。
 * 返回收集到的列表请求 URL(断言分页参数用,读之前先 expect.poll)。
 */
async function setupProjectPage(page: Page): Promise<string[]> {
  const listRequests: string[] = [];

  await page.route(CURRENT_INFO_URL, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(pmCurrentUserResponse),
    }),
  );

  await page.route(PROJECT_LIST_URL, (route) => {
    listRequests.push(route.request().url());
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(projectListResponse),
    });
  });

  await page.route(dictDataUrl('module_pm_project_status'), (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(statusDictResponse),
    }),
  );
  await page.route(dictDataUrl('module_pm_priority'), (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(priorityDictResponse),
    }),
  );
  await page.route(dictDataUrl('module_pm_visibility'), (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(visibilityDictResponse),
    }),
  );

  // 负责人下拉(listUsers):列表页搜索项与表单都会来取
  await page.route(USER_LIST_URL, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(userListResponse),
    }),
  );

  await seedAuthState(page);

  return listRequests;
}

/**
 * 详情页四个 tab 的子列表收集器：project_id 过滤断言与懒加载断言共用 ——
 * 懒加载要求进页面时四个数组都是空的
 */
type SubListRequests = {
  milestones: string[];
  tasks: string[];
  risks: string[];
  members: string[];
};

/** 详情页子列表夹具：不传就给空列表 */
type DetailTabFixture = {
  milestones?: unknown[];
  tasks?: unknown[];
  risks?: unknown[];
  members?: unknown[];
};

/**
 * 装好详情页：登录态 + current/info 菜单树(复用列表页那套) +
 * 项目详情 + 详情页要用的全部字典 + 四个子列表接口。
 *
 * 子列表接口在这里一并拦截并收集 URL —— 既是 project_id 过滤断言的素材，
 * 也是懒加载断言的素材(进页面时四个收集器都该是空的)
 */
async function setupProjectDetailPage(
  page: Page,
  fixture: DetailTabFixture = {},
): Promise<SubListRequests> {
  const requests: SubListRequests = {
    milestones: [],
    tasks: [],
    risks: [],
    members: [],
  };

  await page.route(CURRENT_INFO_URL, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(pmCurrentUserResponse),
    }),
  );

  await page.route(PROJECT_DETAIL_URL, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(projectDetailResponse),
    }),
  );

  // 详情页用到的全部字典：概览三个与列表页共用，另加四个 tab 各自的
  const dictBodies: Record<string, unknown> = {
    module_pm_project_status: statusDictResponse,
    module_pm_priority: priorityDictResponse,
    module_pm_visibility: visibilityDictResponse,
    module_pm_milestone_status: milestoneStatusDictResponse,
    module_pm_task_status: taskStatusDictResponse,
    module_pm_risk_status: riskStatusDictResponse,
    module_pm_project_role: projectRoleDictResponse,
  };
  for (const [dictType, body] of Object.entries(dictBodies)) {
    await page.route(dictDataUrl(dictType), (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(body),
      }),
    );
  }

  // 四个子列表：拦截即收集 URL(读之前先 expect.poll，别在请求前读)
  const subListIntercepts: { url: string; body: unknown; sink: string[] }[] = [
    {
      url: MILESTONE_LIST_URL,
      body: pagedListResponse(fixture.milestones ?? []),
      sink: requests.milestones,
    },
    {
      url: TASK_LIST_URL,
      body: pagedListResponse(fixture.tasks ?? []),
      sink: requests.tasks,
    },
    {
      url: RISK_LIST_URL,
      body: pagedListResponse(fixture.risks ?? []),
      sink: requests.risks,
    },
    {
      url: PROJECT_MEMBERS_URL,
      body: membersResponse(fixture.members ?? []),
      sink: requests.members,
    },
  ];
  for (const { url, body, sink } of subListIntercepts) {
    await page.route(url, (route) => {
      sink.push(route.request().url());
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(body),
      });
    });
  }

  await seedAuthState(page);

  return requests;
}

test.describe('项目详情页', () => {
  const DETAIL_PAGE_PATH = '/pm/project/1';

  test('渲染项目的概览信息，懒加载不在进页面时预取子列表', async ({ page }) => {
    const requests = await setupProjectDetailPage(page);

    await gotoModulePage(
      page,
      DETAIL_PAGE_PATH,
      page.getByText('AIPM 核心项目'),
    );

    // 页头：项目名 + 编码 + 状态/优先级字典标签(切到其它 tab 也能认出是哪个项目)
    const head = page.locator('.ant-card-head');
    await expect(head).toContainText('AIPM 核心项目');
    await expect(head).toContainText('AIPM-CORE');
    await expect(head).toContainText('规划中');
    await expect(head).toContainText('高');

    // 概览：详情接口的字段原样呈现，字典字段渲染成中文标签
    const overview = activePanel(page);
    await expect(overview).toContainText('AIPM-CORE');
    await expect(overview).toContainText('规划中');
    await expect(overview).toContainText('公开');
    await expect(overview).toContainText('张三');
    await expect(overview).toContainText('2026-11-01 ~ 2026-12-31');
    await expect(overview).toContainText('财务');
    await expect(overview).toContainText('合规');

    // 五个 tab 都在(评论 tab v1 不做)
    for (const label of ['概览', '里程碑', '任务', '风险', '成员']) {
      await expect(page.getByRole('tab', { name: label })).toBeVisible();
    }
    await expect(page.getByRole('tab', { name: '评论' })).toHaveCount(0);

    // 懒加载：tab 首次打开才拉数据，进页面只发 detail 一个业务请求。
    // 负向断言留一个缓冲窗口：上面的文案都渲染完了，四个子列表仍然一个请求都没有
    await page.waitForTimeout(500);
    expect(requests.milestones).toHaveLength(0);
    expect(requests.tasks).toHaveLength(0);
    expect(requests.risks).toHaveLength(0);
    expect(requests.members).toHaveLength(0);
  });

  test('里程碑 tab 用后端缓存的 progress 渲染进度条，不在前端重算', async ({
    page,
  }) => {
    const requests = await setupProjectDetailPage(page, {
      milestones: [milestoneRow],
    });

    await gotoModulePage(
      page,
      DETAIL_PAGE_PATH,
      page.getByText('AIPM 核心项目'),
    );

    await page.getByRole('tab', { name: '里程碑' }).click();
    const panel = activePanel(page);

    // 里程碑卡片：名称 + 状态字典标签 + 计划/实际区间
    await expect(panel).toContainText('需求分析完成');
    await expect(panel).toContainText('进行中');
    await expect(panel).toContainText('2026-11-05 ~ 2026-11-20');
    await expect(panel).toContainText('2026-11-06 ~ -');

    // 进度条显示后端缓存的 progress 字段(66%)：里程碑响应里没有任何任务数据，
    // 前端算不出 66 —— 能显示出来就证明读的是后端字段
    await expect(panel.getByRole('progressbar')).toHaveAttribute(
      'aria-valuenow',
      '66',
    );
    await expect(panel.getByText('66%')).toBeVisible();

    // 子列表请求带 project_id 过滤
    await expect.poll(() => requests.milestones.length).toBeGreaterThan(0);
    expect(requests.milestones[0]).toContain('project_id=1');
  });

  test('任务 tab 显示精简表格，请求带 project_id 过滤', async ({ page }) => {
    const requests = await setupProjectDetailPage(page, { tasks: [taskRow] });

    await gotoModulePage(
      page,
      DETAIL_PAGE_PATH,
      page.getByText('AIPM 核心项目'),
    );

    await page.getByRole('tab', { name: '任务' }).click();

    // 精简表格：标题/状态/优先级/负责人/截止日(负责人读 assignee_by 冗余字段)
    const rows = tableRows(page);
    await expect(rows).toHaveCount(1);
    const row = rows.first();
    await expect(row).toContainText('输出需求规格说明书');
    await expect(row).toContainText('进行中');
    await expect(row).toContainText('高');
    await expect(row).toContainText('张三');
    await expect(row).toContainText('2026-11-15');

    // 子列表请求带 project_id 过滤
    await expect.poll(() => requests.tasks.length).toBeGreaterThan(0);
    expect(requests.tasks[0]).toContain('project_id=1');
  });

  test('风险 tab 显示风险等级标签(由 score 本地推导，后端没有 level)', async ({
    page,
  }) => {
    const requests = await setupProjectDetailPage(page, { risks: riskRows });

    await gotoModulePage(
      page,
      DETAIL_PAGE_PATH,
      page.getByText('AIPM 核心项目'),
    );

    await page.getByRole('tab', { name: '风险' }).click();
    const panel = activePanel(page);

    await expect(panel).toContainText('核心开发人员流失');
    await expect(panel).toContainText('需求评审延期');
    await expect(panel).toContainText('已识别');
    await expect(panel).toContainText('缓解中');

    // 等级标签：共享件 riskLevel(score) 推导 —— 16 → SEVERE(严重/红)，
    // 6 → MEDIUM(中/黄)；文案与预设色都对得上才算等级真的按 score 推导了
    const severe = panel.getByText('严重', { exact: true });
    await expect(severe).toBeVisible();
    await expect(severe).toHaveClass(/ant-tag-error/);
    const medium = panel.getByText('中', { exact: true });
    await expect(medium).toBeVisible();
    await expect(medium).toHaveClass(/ant-tag-gold/);

    // 分数随行展示(等级的推导依据)
    await expect(panel.getByText('16 分', { exact: true })).toBeVisible();
    await expect(panel.getByText('6 分', { exact: true })).toBeVisible();

    // 子列表请求带 project_id 过滤
    await expect.poll(() => requests.risks.length).toBeGreaterThan(0);
    expect(requests.risks[0]).toContain('project_id=1');
  });

  test('成员 tab 调 members 接口渲染成员与角色', async ({ page }) => {
    const requests = await setupProjectDetailPage(page, {
      members: [memberRow],
    });

    await gotoModulePage(
      page,
      DETAIL_PAGE_PATH,
      page.getByText('AIPM 核心项目'),
    );

    await page.getByRole('tab', { name: '成员' }).click();

    // 成员表格：姓名在 user_info 里(JOIN sys_user 的冗余)，角色是字典标签
    const rows = tableRows(page);
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('张三');
    await expect(rows.first()).toContainText('所有者');
    // joined_at 是 ISO 字符串，展示时把 T 换成空格
    await expect(rows.first()).toContainText('2026-11-01 09:00:00');

    // members 是路径参数接口(/pm_project/members/{id})，返回数组不是分页信封
    await expect.poll(() => requests.members.length).toBeGreaterThan(0);
    expect(requests.members[0]).toContain('/pm_project/members/1');
  });
});

test.describe('项目管理列表页', () => {
  test('渲染后端菜单与项目列表,分页参数用 page_no / page_size', async ({
    page,
  }) => {
    const listRequests = await setupProjectPage(page);

    await gotoModulePage(
      page,
      PROJECT_PAGE_PATH,
      page.locator('.ant-menu').getByText('项目列表'),
    );

    // 侧边栏来自后端菜单:PM 目录挂在 /pm 下(不是 /system)
    await expect(page.locator('.ant-menu').getByText('项目管理')).toBeVisible();
    await expect(page.locator('.ant-menu').getByText('项目列表')).toBeVisible();

    // 表格渲染出后端返回的数据
    const rows = tableRows(page);
    await expect(rows).toHaveCount(1);
    const row = rows.first();
    await expect(row).toContainText('AIPM-CORE');
    await expect(row).toContainText('AIPM 核心项目');
    // 字典线上码渲染成中文标签(不是原始的 planning / P1)
    await expect(row).toContainText('规划中');
    await expect(row).toContainText('高');
    // 负责人读 owner_by 冗余字段
    await expect(row).toContainText('张三');
    await expect(row).toContainText('2026-11-01 ~ 2026-12-31');
    // 标签是 JSON 数组字符串,表格里渲染成 Tag 串
    await expect(row).toContainText('财务');
    await expect(row).toContainText('合规');

    // 分页参数用后端约定的 page_no / page_size
    await expect.poll(() => listRequests.length).toBeGreaterThan(0);
    expect(listRequests[0]).toContain('page_no=1');
    expect(listRequests[0]).toContain('page_size=10');
  });

  test('新增项目提交的是后端的线上码,不是中文标签', async ({ page }) => {
    const createRequests: { url: string; method: string; body: unknown }[] = [];

    const listRequests = await setupProjectPage(page);
    void listRequests;

    await page.route(PROJECT_CREATE_URL, (route) => {
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

    await gotoModulePage(page, PROJECT_PAGE_PATH, tableRows(page).first());

    await page.getByRole('button', { name: '新增' }).click();
    await expect(page.locator('.ant-modal')).toBeVisible();

    await modalFormItem(page, '项目编码').locator('input').fill('E2E-PM-1');
    await modalFormItem(page, '项目名称')
      .locator('input')
      .fill('AIPM 核心项目二期');

    // 负责人:远程搜索下拉,选项来自 listUsers
    await pickInModal(page, '负责人', '李四');

    // 状态/优先级/可见性:字典下拉,提交 dict_value
    await pickInModal(page, '状态', '规划中');
    await pickInModal(page, '优先级', '高');
    await pickInModal(page, '可见性', '公开');

    // 计划区间:两个日期都选今天(提交时序列化成 YYYY-MM-DD 字符串)
    await pickToday(page, '计划开始日期');
    await pickToday(page, '计划截止日期');

    // 标签:后端存的就是 JSON 数组字符串,表单原样提交
    await modalFormItem(page, '标签')
      .locator('textarea')
      .fill('["财务","合规"]');

    await page.locator('.ant-modal-footer button.ant-btn-primary').click();

    await expect.poll(() => createRequests.length).toBe(1);
    expect(createRequests[0].method).toBe('POST');
    expect(createRequests[0].url).toContain('/pm_project/create');

    // 提交的是线上码(dict_value),不是中文标签
    const body = createRequests[0].body as Record<string, unknown>;
    expect(body).toMatchObject({
      code: 'E2E-PM-1',
      name: 'AIPM 核心项目二期',
      owner_id: 2,
      status_code: 'planning',
      priority_code: 'P1',
      visibility_code: 'public',
      tags: '["财务","合规"]',
    });
    // 表单里看到的中文标签没有混进请求体
    expect(JSON.stringify(body)).not.toContain('规划中');
    expect(JSON.stringify(body)).not.toContain('高');
    // 日期提交为 YYYY-MM-DD 字符串(后端 date 协议),不是时间戳
    expect(String(body.start_date)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.start_date).toBe(body.due_date);
  });

  test('code 不符合正则时表单内报错,请求根本不发', async ({ page }) => {
    const createRequests: unknown[] = [];

    const listRequests = await setupProjectPage(page);
    void listRequests;

    await page.route(PROJECT_CREATE_URL, (route) => {
      createRequests.push(route.request().postDataJSON());
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(okResponse),
      });
    });

    await gotoModulePage(page, PROJECT_PAGE_PATH, tableRows(page).first());

    await page.getByRole('button', { name: '新增' }).click();
    await expect(page.locator('.ant-modal')).toBeVisible();

    // 后端 ModulePmProjectCreateSchema.code 的正则 ^[A-Z0-9_-]{2,32}$
    // (小写 + 空格 + 感叹号,三种非法字符都占了)
    await modalFormItem(page, '项目编码')
      .locator('input')
      .fill('invalid code!');

    // 其余必填项留空也无所谓:任何一项校验失败都不该发请求
    await page.locator('.ant-modal-footer button.ant-btn-primary').click();

    // 表单内报错(不是后端 422 之后的 toast)
    await expect(
      page.getByText('项目编码需为 2-32 位大写字母/数字/下划线/连字符'),
    ).toBeVisible();
    // 请求根本没发出去
    expect(createRequests).toHaveLength(0);
  });

  test('编辑提交 owner_id(后端必填),整对象原样回传', async ({ page }) => {
    const updateRequests: { url: string; method: string; body: unknown }[] = [];

    const listRequests = await setupProjectPage(page);
    void listRequests;

    await page.route(PROJECT_UPDATE_URL, (route) => {
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

    await gotoModulePage(page, PROJECT_PAGE_PATH, tableRows(page).first());

    await page.getByRole('button', { name: '编辑' }).first().click();
    await expect(page.locator('.ant-modal')).toBeVisible();

    // 回显:负责人是张三(owner_id=1,下拉把 id 显示成姓名)
    await expect(
      modalFormItem(page, '负责人').locator('.ant-select-content'),
    ).toContainText('张三');

    // 换成李四(owner_id=2)
    await pickInModal(page, '负责人', '李四');

    await page.locator('.ant-modal-footer button.ant-btn-primary').click();

    await expect.poll(() => updateRequests.length).toBe(1);
    expect(updateRequests[0].method).toBe('PUT');
    expect(updateRequests[0].url).toContain('/pm_project/update/1');

    // 后端必填的 owner_id 提交的是用户 id;更新是整对象 PUT,其余必填字段都在
    const body = updateRequests[0].body as Record<string, unknown>;
    expect(body).toMatchObject({
      code: 'AIPM-CORE',
      name: 'AIPM 核心项目',
      owner_id: 2,
      status_code: 'planning',
      priority_code: 'P1',
      visibility_code: 'public',
      // 日期以 YYYY-MM-DD 字符串原样回传(后端 date 协议)
      start_date: '2026-11-01',
      due_date: '2026-12-31',
      tags: '["财务","合规"]',
    });
  });

  test('点项目名称进详情页(菜单里没有详情项,入口在列表页)', async ({
    page,
  }) => {
    // 列表页与详情页的接口一起装好:点完链接直接落到详情页
    await setupProjectPage(page);
    await setupProjectDetailPage(page);

    await gotoModulePage(page, PROJECT_PAGE_PATH, tableRows(page).first());

    // 项目名称是个链接,指向 /pm/project/:id
    const link = tableRows(page)
      .first()
      .getByRole('link', { name: 'AIPM 核心项目' });
    await expect(link).toBeVisible();
    await link.click();

    // 详情页真的打开了(地址变了 + 详情的内容渲染出来了)
    await expect(page).toHaveURL(/\/pm\/project\/1$/);
    const head = page.locator('.ant-card-head');
    await expect(head).toContainText('AIPM 核心项目');
    await expect(head).toContainText('AIPM-CORE');
  });

  test('编辑时负责人显示名字,不是裸 id', async ({ page }) => {
    await setupProjectPage(page);

    // 用户列表里**没有**项目的负责人(张三):远程搜索只回一页,
    // 负责人不在候选里时编辑框里就只是个裸 id —— 行里的 owner_by 把它补上
    await page.unroute(USER_LIST_URL);
    await page.route(USER_LIST_URL, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ...userListResponse,
          data: {
            items: [userListResponse.data.items[1]],
            total: 1,
            page_no: 1,
            page_size: 100,
            has_next: false,
          },
        }),
      }),
    );

    await gotoModulePage(page, PROJECT_PAGE_PATH, tableRows(page).first());

    await page.getByRole('button', { name: '编辑' }).first().click();
    await expect(page.locator('.ant-modal')).toBeVisible();

    // 负责人显示的是名字(不是 id 1)
    const owner = modalFormItem(page, '负责人').locator('.ant-select-content');
    await expect(owner).toContainText('张三');
    await expect(owner).not.toContainText('1');
  });

  test('删除的请求体是裸数组(后端收 ids: list[int])', async ({ page }) => {
    const deleteRequests: { url: string; method: string; body: unknown }[] = [];

    const listRequests = await setupProjectPage(page);
    void listRequests;

    await page.route(PROJECT_DELETE_URL, (route) => {
      const request = route.request();
      deleteRequests.push({
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

    await gotoModulePage(page, PROJECT_PAGE_PATH, tableRows(page).first());

    await page.getByRole('button', { name: '删除' }).first().click();

    // Popconfirm 的确认按钮用 class 定位(文案随 antd locale 变)
    await page.locator('.ant-popconfirm-buttons .ant-btn-primary').click();

    await expect.poll(() => deleteRequests.length).toBe(1);
    expect(deleteRequests[0].method).toBe('DELETE');
    expect(deleteRequests[0].url).toContain('/pm_project/delete');
    // 裸数组,不是 { ids: [...] } 的包裹形态
    expect(deleteRequests[0].body).toEqual([1]);
  });
});
