import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import {
  assertPermissionGatedButton,
  businessErrorBody,
  gotoModulePage,
  type ModuleMenu,
  setupModulePage,
} from './helpers';

/**
 * 工单管理页的前端闭环(接口全部拦截,不需要真实账号)。
 *
 * 覆盖:
 * - 列表渲染 + 分页参数用后端约定的 page_no / page_size
 * - RF1:后端业务错误(HTTP 500 + 信封)由请求层转成 BizError,弹的是后端的 msg
 * - RF3:后端返回空列表时表格显示空状态,不白屏、不报错
 * - RF2:按钮级权限来自后端菜单树里的 type=3 节点
 * - 工单类型是**受限枚举**:提交给后端的是 suggestion / bug / optimize / other,
 *   表格里渲染成中文(建议 / 缺陷 / 优化 / 其他)
 * - 创建/更新入参是后端的**两个 schema**:创建带 description(没有 reply),
 *   更新带 reply(没有 description / images)—— 提交对方 schema 没有的字段
 *   会被 pydantic 静默丢弃
 * - 批量更新走 **PUT** /system/ticket/batch,入参是 { ids, status }
 *
 * 菜单树 / 登录态 / 业务错误信封都由 ./helpers 提供 —— helpers 不认识任何具体模块,
 * 下一个模块的 spec 直接复用,不用再抄一遍夹具。
 */

const TICKET_PAGE_PATH = '/system/ticket';
const TICKET_LIST_URL = '**/api/v1/system/ticket/list**';
const TICKET_CREATE_URL = '**/api/v1/system/ticket/create**';
const TICKET_UPDATE_URL = '**/api/v1/system/ticket/update**';
const TICKET_BATCH_URL = '**/api/v1/system/ticket/batch**';
/** 处理人下拉的数据源(搜索栏里是远程搜索,页面一挂载就会请求它) */
const USER_LIST_URL = '**/api/v1/system/user/list**';

/**
 * 工单管理的菜单树。
 *
 * 工单管理挂在「系统管理」目录下,route_path 是相对的 'ticket',
 * 后端适配器会把它拼成 /system/ticket —— 必须与前端路由表一致。
 *
 * ⚠️ 列表权限码是 `module_system:ticket:list`,**不是** `:query`
 * (其它模块都是 :query,这里是后端现状)。
 */
function ticketMenu(
  withCreateButton = true,
  withEditButton = true,
  withDeleteButton = true,
): ModuleMenu {
  return {
    title: '工单管理',
    routePath: 'ticket',
    permission: 'module_system:ticket:list',
    buttons: [
      ...(withCreateButton
        ? [{ title: '新增工单', permission: 'module_system:ticket:create' }]
        : []),
      ...(withEditButton
        ? [{ title: '编辑工单', permission: 'module_system:ticket:update' }]
        : []),
      ...(withDeleteButton
        ? [{ title: '删除工单', permission: 'module_system:ticket:delete' }]
        : []),
    ],
  };
}

/** 侧边栏里的「工单管理」—— 应用就绪的内容信号(不用 networkidle) */
function menuItem(page: Page) {
  return page.locator('.ant-menu').getByText('工单管理');
}

const ticketListResponse = {
  code: 0,
  msg: '查询成功',
  data: {
    items: [
      {
        id: 1,
        title: '登录时报 500',
        ticket_type: 'bug',
        ticket_content: '登录时后端返回 500',
        summary: '登录报错',
        images: null,
        reply: '工单管理页的测试数据',
        status: 1,
        assigned_id: 3,
        // 后端随工单一起返回处理人(assigned_by)
        assigned_by: { id: 3, name: '张三' },
        created_time: '2026-11-02 17:56:33',
      },
    ],
    total: 1,
    page_no: 1,
    page_size: 10,
    has_next: false,
  },
  status_code: 200,
  success: true,
};

/**
 * 图片是**非空** JSON 数组文本的工单 —— 编辑提交的断言用:
 * TicketUpdateSchema 没有 images,编辑弹窗不该渲染它;
 * 渲染了就会把库里的值原样提交、再被后端静默丢弃
 */
const ticketWithImagesListResponse = {
  ...ticketListResponse,
  data: {
    ...ticketListResponse.data,
    items: [
      {
        ...ticketListResponse.data.items[0],
        images: '["https://example.com/a.png"]',
      },
    ],
  },
};

/** RF3:后端返回空列表 */
const emptyTicketListResponse = {
  code: 0,
  msg: '查询成功',
  data: {
    items: [],
    total: 0,
    page_no: 1,
    page_size: 10,
    has_next: false,
  },
  status_code: 200,
  success: true,
};

/** 还没指派处理人的工单 —— 后端 assigned_by 是 null */
const unassignedTicketListResponse = {
  code: 0,
  msg: '查询成功',
  data: {
    items: [
      {
        id: 9,
        title: '还没有人接单',
        ticket_type: 'suggestion',
        ticket_content: '待指派',
        summary: null,
        images: null,
        reply: null,
        status: 0,
        assigned_id: null,
        assigned_by: null,
        created_time: '2026-11-02 18:00:00',
      },
    ],
    total: 1,
    page_no: 1,
    page_size: 10,
    has_next: false,
  },
  status_code: 200,
  success: true,
};

/** 处理人下拉的候选(搜索栏里的远程搜索) */
const userListResponse = {
  code: 0,
  msg: '查询成功',
  data: {
    items: [{ id: 3, username: 'zhangsan', name: '张三' }],
    total: 1,
    page_no: 1,
    page_size: 10,
    has_next: false,
  },
  status_code: 200,
  success: true,
};

/** 远程搜索命中关键字时的候选(模拟后端按 name 过滤) */
const userListSearchResponse = {
  code: 0,
  msg: '查询成功',
  data: {
    items: [{ id: 4, username: 'lisi', name: '李四' }],
    total: 1,
    page_no: 1,
    page_size: 10,
    has_next: false,
  },
  status_code: 200,
  success: true,
};

/** 处理人下拉 mock 的可选项 */
type UserListMockOptions = {
  /** 收集到的每次请求带的 name 关键字(null = 没带关键字) */
  keywords?: (string | null)[];
  /** 带了 name 关键字时的响应体 */
  keywordResponse?: unknown;
};

/**
 * 拦下处理人下拉的数据源。
 *
 * 搜索栏里的「处理人」是远程搜索(列级 select + listUsers),
 * 页面一挂载就会请求 /system/user/list —— 不拦的话请求会打到真实后端,
 * 报错弹出的提示还会干扰别的断言。
 *
 * 传了 keywords 就能拿到「每次请求带的 name 关键字」——
 * 用来断言远程搜索真的把关键字发出去了(见下面的「处理人下拉能远程搜索」用例)。
 */
async function mockUserList(
  page: Page,
  options: UserListMockOptions = {},
): Promise<void> {
  const { keywords, keywordResponse } = options;

  await page.route(USER_LIST_URL, (route) => {
    const url = route.request().url();
    const keyword = new URL(url).searchParams.get('name');
    keywords?.push(keyword);

    const body =
      keyword && keywordResponse ? keywordResponse : userListResponse;

    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
}

/** 装受控页面:处理人下拉 + 共享夹具(菜单树 / 登录态 / 列表接口) */
async function setupTicketPage(
  page: Page,
  listBody: unknown,
  listStatus = 200,
  userListOptions: UserListMockOptions = {},
): Promise<string[]> {
  await mockUserList(page, userListOptions);
  return setupModulePage(page, {
    menus: [ticketMenu()],
    listUrl: TICKET_LIST_URL,
    listBody,
    listStatus,
  });
}

test.describe('工单管理页', () => {
  test('渲染后端菜单与工单列表,分页参数用 page_no / page_size', async ({
    page,
  }) => {
    const listRequests = await setupTicketPage(page, ticketListResponse);

    await gotoModulePage(page, TICKET_PAGE_PATH, menuItem(page));

    // 侧边栏来自后端菜单
    await expect(menuItem(page)).toBeVisible();

    // 表格渲染出后端返回的数据
    await expect(page.locator('.ant-table-tbody tr.ant-table-row')).toHaveCount(
      1,
    );
    await expect(page.getByText('登录时报 500')).toBeVisible();

    // 列顺序:勾选 / ID / 工单标题 / 工单类型 / 处理人 / 状态 / 回复 / 创建时间
    // (第一列是 rowSelection 的勾选框)
    const cells = page.locator('.ant-table-tbody tr.ant-table-row td');
    await expect(cells.nth(2)).toHaveText('登录时报 500');
    // 后端给的是 'bug' ⇒ 表格渲染的是中文标签「缺陷」,不是原始的 'bug'
    await expect(cells.nth(3)).toHaveText('缺陷');
    // 处理人显示名字(后端随工单返回 assigned_by),不是 id
    await expect(cells.nth(4)).toHaveText('张三');
    await expect(cells.nth(5)).toHaveText('处理中');
    // 回复列显示后端返回的 reply(后端响应里没有 description 这个字段)
    await expect(cells.nth(6)).toHaveText('工单管理页的测试数据');

    // 分页参数用后端约定的 page_no / page_size
    await expect.poll(() => listRequests.length).toBeGreaterThan(0);
    expect(listRequests[0]).toContain('page_no=1');
    expect(listRequests[0]).toContain('page_size=10');
  });

  test('编辑工单:预填 reply、提交 reply,不带 description 与 images', async ({
    page,
  }) => {
    const updateRequests: { method: string; body: unknown }[] = [];

    await page.route(TICKET_UPDATE_URL, async (route) => {
      const req = route.request();
      updateRequests.push({
        method: req.method(),
        body: req.postDataJSON(),
      });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 0,
          msg: '更新成功',
          data: null,
          status_code: 200,
          success: true,
        }),
      });
    });

    await setupTicketPage(page, ticketWithImagesListResponse);

    await gotoModulePage(page, TICKET_PAGE_PATH, menuItem(page));

    await page.getByRole('button', { name: '编辑' }).first().click();

    await expect(page.locator('.ant-modal')).toBeVisible();
    // ⚠️ 后端 TicketOutSchema 里是 reply —— 表单得绑到它,
    // 绑到不存在的 description 就是「永远为空的框 + 覆写库里存的值」
    await expect(
      page
        .locator('.ant-modal .ant-form-item', { hasText: '回复内容' })
        .locator('textarea'),
    ).toHaveValue('工单管理页的测试数据');

    // 更新态不渲染创建态的字段:描述与图片链接都是 TicketCreateSchema 的字段,
    // TicketUpdateSchema 没有 —— 渲染了就是「提交了也存不进去」的死字段
    await expect(
      page.locator('.ant-modal .ant-form-item', { hasText: '描述' }),
    ).toHaveCount(0);
    await expect(
      page.locator('.ant-modal .ant-form-item', { hasText: '图片链接' }),
    ).toHaveCount(0);

    await page
      .locator('.ant-modal .ant-form-item', { hasText: '回复内容' })
      .locator('textarea')
      .fill('已定位:网关证书过期,已修复');

    await page.locator('.ant-modal-footer button.ant-btn-primary').click();

    await expect.poll(() => updateRequests.length).toBe(1);
    // ⚠️ 方法是 PUT,路径是 /system/ticket/update/{id}
    expect(updateRequests[0].method).toBe('PUT');
    // 更新走 TicketUpdateSchema:带 reply;description / images 不带 ——
    // 没提交的字段后端按 exclude_unset 保持原值(不会被空值覆写)
    expect(updateRequests[0].body).toMatchObject({
      title: '登录时报 500',
      reply: '已定位:网关证书过期,已修复',
    });
    expect(updateRequests[0].body).not.toHaveProperty('description');
    expect(updateRequests[0].body).not.toHaveProperty('images');
  });

  test('业务错误(HTTP 500 + 信封)弹的是后端 msg(RF1)', async ({ page }) => {
    await setupTicketPage(
      page,
      businessErrorBody('工单状态不允许这样流转'),
      500,
    );

    await gotoModulePage(page, TICKET_PAGE_PATH, menuItem(page));

    // 请求层把信封转成 BizError,errorHandler 弹后端的 msg
    await expect(page.getByText('工单状态不允许这样流转')).toBeVisible();
    // 不是 axios 的原始报错文案
    await expect(
      page.getByText('Request failed with status code 500'),
    ).toHaveCount(0);
  });

  test('后端返回空列表时表格显示空状态,不报错(RF3)', async ({ page }) => {
    await setupTicketPage(page, emptyTicketListResponse);

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await gotoModulePage(page, TICKET_PAGE_PATH, menuItem(page));

    // 空状态,而不是白屏
    await expect(page.locator('.ant-empty')).toBeVisible();
    await expect(page.locator('.ant-table-tbody tr.ant-table-row')).toHaveCount(
      0,
    );

    // 没有落到错误页
    await expect(page.getByText('页面出现错误')).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  });

  test('菜单树里没有按钮节点时「新增」按钮禁用', async ({ page }) => {
    await mockUserList(page);
    await assertPermissionGatedButton(page, {
      buttonName: '新增',
      permission: 'module_system:ticket:create',
      granted: false,
      menu: ticketMenu(),
      path: TICKET_PAGE_PATH,
      listUrl: TICKET_LIST_URL,
      listBody: ticketListResponse,
      ready: menuItem(page),
    });
  });

  test('菜单树里有按钮节点时「新增」按钮可用', async ({ page }) => {
    await mockUserList(page);
    await assertPermissionGatedButton(page, {
      buttonName: '新增',
      permission: 'module_system:ticket:create',
      granted: true,
      menu: ticketMenu(),
      path: TICKET_PAGE_PATH,
      listUrl: TICKET_LIST_URL,
      listBody: ticketListResponse,
      ready: menuItem(page),
    });
  });

  test('处理人是远程搜索的下拉,候选来自用户列表', async ({ page }) => {
    await setupTicketPage(page, ticketListResponse);

    await gotoModulePage(page, TICKET_PAGE_PATH, menuItem(page));

    // 搜索栏默认只展开第一行,「处理人」在折叠区里 —— 先展开
    await page.locator('.ant-pro-query-filter-collapse-button').click();

    const assigneeSearch = page
      .locator('.ant-form-item', { hasText: '处理人' })
      .locator('input[role="combobox"]');
    await assigneeSearch.click();

    // 候选来自 listUsers(远程搜索),显示的是名字而不是 id
    await expect(
      page.locator('.ant-select-dropdown:visible .ant-select-item-option'),
    ).toHaveText(['张三']);
  });

  test('处理人下拉能远程搜索:输入关键字后请求带上关键字', async ({ page }) => {
    const keywords: (string | null)[] = [];

    await setupTicketPage(page, ticketListResponse, 200, {
      keywords,
      keywordResponse: userListSearchResponse,
    });

    await gotoModulePage(page, TICKET_PAGE_PATH, menuItem(page));

    // 搜索栏默认只展开第一行,「处理人」在折叠区里 —— 先展开
    await page.locator('.ant-pro-query-filter-collapse-button').click();

    const assigneeSearch = page
      .locator('.ant-form-item', { hasText: '处理人' })
      .locator('input[role="combobox"]');
    await assigneeSearch.click();

    // ⚠️ 必须真的**打字**。
    // 列级 select 如果没开 fieldProps.showSearch,antd Select 的输入框是
    // readOnly ⇒ onSearch 永远不触发 ⇒ 远程搜索是死代码(永远只有第一页候选)。
    await page.keyboard.type('李');

    // 请求真的带上了关键字(而不是永远只发一次不带关键字的列表请求)
    await expect.poll(() => keywords).toContain('李');

    // 候选换成了命中关键字的人
    await expect(
      page.locator('.ant-select-dropdown:visible .ant-select-item-option'),
    ).toHaveText(['李四']);
  });

  test('工单还没指派处理人时显示占位符,不崩', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await setupTicketPage(page, unassignedTicketListResponse);

    await gotoModulePage(page, TICKET_PAGE_PATH, menuItem(page));

    // assigned_by 是 null ⇒ 显示占位符,不是空白也不是报错
    const assigneeCell = page
      .locator('.ant-table-tbody tr.ant-table-row td')
      .nth(4);
    await expect(assigneeCell).toHaveText('-');

    // 没有落到错误页,也没有未捕获的异常
    await expect(page.getByText('页面出现错误')).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  });

  test('按工单类型筛选时提交的是后端的线上的值', async ({ page }) => {
    const listRequests = await setupTicketPage(page, ticketListResponse);

    await gotoModulePage(page, TICKET_PAGE_PATH, menuItem(page));

    const typeSearch = page
      .locator('.ant-form-item', { hasText: '工单类型' })
      .locator('input[role="combobox"]');
    await typeSearch.click();
    await page
      .locator('.ant-select-dropdown:visible .ant-select-item-option')
      .filter({ hasText: '缺陷' })
      .click();

    // ProTable 的搜索表单要点了「查询」才发请求
    await page.locator('.ant-pro-table-search button.ant-btn-primary').click();

    // 筛选条件提交的是线上的值 'bug',不是中文标签「缺陷」
    await expect
      .poll(() => listRequests[listRequests.length - 1] ?? '')
      .toContain('ticket_type=bug');
  });

  test('工单类型只有四个候选,提交的是后端的线上的值', async ({ page }) => {
    const createRequests: { body: unknown }[] = [];

    await page.route(TICKET_CREATE_URL, async (route) => {
      createRequests.push({ body: route.request().postDataJSON() });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 0,
          msg: '创建成功',
          data: null,
          status_code: 200,
          success: true,
        }),
      });
    });

    await setupTicketPage(page, ticketListResponse);

    await gotoModulePage(page, TICKET_PAGE_PATH, menuItem(page));

    await page.getByRole('button', { name: '新增' }).click();

    const typeFormItem = page.locator('.ant-modal .ant-form-item', {
      hasText: '工单类型',
    });
    const typeInput = typeFormItem.locator('input[role="combobox"]');

    // 候选恰好是建议 / 缺陷 / 优化 / 其他(后端 TicketTypeEnum 的四个值)
    await typeInput.click();
    const dropdown = page.locator('.ant-select-dropdown:visible');
    await expect(dropdown.locator('.ant-select-item-option')).toHaveText([
      '建议',
      '缺陷',
      '优化',
      '其他',
    ]);

    await dropdown
      .locator('.ant-select-item-option', { hasText: '缺陷' })
      .click();

    await page
      .locator('.ant-modal .ant-form-item', { hasText: '工单标题' })
      .locator('input')
      .fill('登录时报 500');
    await page
      .locator('.ant-modal .ant-form-item', { hasText: '工单内容' })
      .locator('textarea')
      .fill('登录时后端返回 500');

    await page.locator('.ant-modal-footer button.ant-btn-primary').click();

    // 提交出去的是**线上的值 'bug'**,不是中文标签「缺陷」
    await expect.poll(() => createRequests.length).toBe(1);
    expect(createRequests[0].body).toMatchObject({
      title: '登录时报 500',
      ticket_content: '登录时后端返回 500',
      ticket_type: 'bug',
    });
  });

  test('新增工单提交的是 description(TicketCreateSchema 没有 reply)', async ({
    page,
  }) => {
    const createRequests: { body: unknown }[] = [];

    await page.route(TICKET_CREATE_URL, async (route) => {
      createRequests.push({ body: route.request().postDataJSON() });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 0,
          msg: '创建成功',
          data: null,
          status_code: 200,
          success: true,
        }),
      });
    });

    await setupTicketPage(page, ticketListResponse);

    await gotoModulePage(page, TICKET_PAGE_PATH, menuItem(page));

    await page.getByRole('button', { name: '新增' }).click();

    await expect(page.locator('.ant-modal')).toBeVisible();

    // 创建态不渲染「回复内容」—— reply 是 TicketUpdateSchema 的字段,
    // 创建接口不收它,渲染了就是「提交了也存不进去」的死字段
    await expect(
      page.locator('.ant-modal .ant-form-item', { hasText: '回复内容' }),
    ).toHaveCount(0);

    // 工单类型(必填):选「缺陷」—— 提交给后端的是线上的 'bug'
    await page
      .locator('.ant-modal .ant-form-item', { hasText: '工单类型' })
      .locator('input[role="combobox"]')
      .click();
    await page
      .locator('.ant-select-dropdown:visible .ant-select-item-option')
      .filter({ hasText: '缺陷' })
      .click();

    await page
      .locator('.ant-modal .ant-form-item', { hasText: '工单标题' })
      .locator('input')
      .fill('登录时报 500');
    await page
      .locator('.ant-modal .ant-form-item', { hasText: '工单内容' })
      .locator('textarea')
      .fill('登录时后端返回 500');
    // 创建态的「描述」—— TicketCreateSchema.description(max_length=255)
    await page
      .locator('.ant-modal .ant-form-item', { hasText: '描述' })
      .locator('textarea')
      .fill('客户环境必现');

    await page.locator('.ant-modal-footer button.ant-btn-primary').click();

    await expect.poll(() => createRequests.length).toBe(1);
    // ⚠️ 创建走 TicketCreateSchema:带 description;
    //    reply 是更新态的字段,创建请求里出现它就是 bug(后端会静默丢弃)
    expect(createRequests[0].body).toMatchObject({
      title: '登录时报 500',
      ticket_content: '登录时后端返回 500',
      ticket_type: 'bug',
      description: '客户环境必现',
    });
    expect(createRequests[0].body).not.toHaveProperty('reply');
  });

  test('批量更新走 PUT /system/ticket/batch,入参是 { ids, status }', async ({
    page,
  }) => {
    const batchRequests: { url: string; method: string; body: unknown }[] = [];

    await page.route(TICKET_BATCH_URL, async (route) => {
      const req = route.request();
      batchRequests.push({
        url: req.url(),
        method: req.method(),
        body: req.postDataJSON(),
      });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 0,
          msg: '批量操作成功',
          data: null,
          status_code: 200,
          success: true,
        }),
      });
    });

    await setupTicketPage(page, ticketListResponse);

    await gotoModulePage(page, TICKET_PAGE_PATH, menuItem(page));

    // 没勾选行时没有「批量更新」
    await expect(page.getByRole('button', { name: '批量更新' })).toHaveCount(0);

    // 勾选第一行
    await page
      .locator('.ant-table-tbody')
      .getByRole('checkbox')
      .first()
      .check();

    await page.getByRole('button', { name: '批量更新' }).click();

    // 选目标状态 —— 后端 TicketBatchSchema.status 的 0..3
    const statusSelect = page
      .locator('.ant-modal .ant-form-item', { hasText: '目标状态' })
      .locator('input[role="combobox"]');
    await statusSelect.click();
    await page
      .locator('.ant-select-dropdown:visible .ant-select-item-option')
      .filter({ hasText: '已完成' })
      .click();

    await page.locator('.ant-modal-footer button.ant-btn-primary').click();

    await expect.poll(() => batchRequests.length).toBe(1);
    // ⚠️ 方法是 PUT(不是 PATCH),入参是 { ids, status } 两个平级字段
    expect(batchRequests[0].method).toBe('PUT');
    expect(batchRequests[0].url).toContain('/system/ticket/batch');
    expect(batchRequests[0].body).toEqual({ ids: [1], status: 2 });
  });
});
