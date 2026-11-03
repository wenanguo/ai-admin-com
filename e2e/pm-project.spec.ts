import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { gotoModulePage, seedAuthState } from './helpers';

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
 * helpers.buildCurrentUserResponse 把父目录写死成 /system,这里手造信封
 * (子菜单的相对 route_path 'project' 会被拼到 /pm 下,必须与前端路由表对齐)。
 */

const PROJECT_PAGE_PATH = '/pm/project';
const CURRENT_INFO_URL = '**/api/v1/system/user/current/info';
const PROJECT_LIST_URL = '**/api/v1/pm_project/list**';
const PROJECT_CREATE_URL = '**/api/v1/pm_project/create**';
const PROJECT_UPDATE_URL = '**/api/v1/pm_project/update/**';
const PROJECT_DELETE_URL = '**/api/v1/pm_project/delete**';
const USER_LIST_URL = '**/api/v1/system/user/list**';
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

/** 写操作成功后的信封(提示文案由请求层统一弹,这里只让 promise 落地) */
const okResponse = {
  code: 0,
  msg: '操作成功',
  data: null,
  status_code: 200,
  success: true,
};

/** 弹窗里的表单项(按 label 文案找,不依赖 antd 的 id 生成规则) */
function modalFormItem(page: Page, label: string) {
  return page.locator('.ant-modal .ant-form-item', { hasText: label });
}

/** 在弹窗的下拉表单项里选一个候选(字典下拉 / 负责人远程搜索共用) */
async function pickInModal(
  page: Page,
  label: string,
  optionText: string,
): Promise<void> {
  await modalFormItem(page, label).locator('input[role="combobox"]').click();
  await page
    .locator('.ant-select-dropdown:visible .ant-select-item-option', {
      hasText: optionText,
    })
    .click();
}

/** 在弹窗的日期表单项里选「今天」(提交时序列化成 YYYY-MM-DD 字符串) */
async function pickToday(page: Page, label: string): Promise<void> {
  // 日期面板开合有动画:上一个面板还没关完(仍 display:block)就点下一个
  // 输入框时,新面板尚未挂载,选择器会解析到正在关闭的旧面板的单元格 ——
  // 它随后 display:none,点击永远等不到可见。所以先等旧面板关完再开新的。
  await expect(page.locator('.ant-picker-dropdown:visible')).toHaveCount(0);
  await modalFormItem(page, label).locator('.ant-picker input').click();
  const todayCell = page.locator(
    '.ant-picker-dropdown:visible .ant-picker-cell-today',
  );
  await expect(todayCell).toBeVisible();
  await todayCell.click();
}

/** 表格行 —— 用例关心的就绪信号(不用 networkidle) */
function tableRows(page: Page) {
  return page.locator('.ant-table-tbody tr.ant-table-row');
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
