import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import {
  assertPermissionGatedButton,
  businessErrorBody,
  gotoModulePage,
  type MenuButton,
  type ModuleMenu,
  setupModulePage,
} from './helpers';

/**
 * 日志管理页的前端闭环(接口全部拦截,不需要真实账号)。
 *
 * 覆盖:
 * - 两个 tab 各渲染自己的表格,且**一次进页面只发一个列表请求**
 *   (未激活的 tab 不挂载 —— antd 6 的 destroyOnHidden)
 * - RF1:后端业务错误(HTTP 500 + 信封)由请求层转成 BizError,弹的是后端的 msg
 * - RF3:后端返回空列表时表格显示空状态,不白屏、不报错
 * - RF2:按钮级权限来自后端菜单树里的 type=3 节点 —— 登录日志用
 *   module_system:login_log:*,操作日志用 module_system:log:*(两套码,命名不一致)
 * - 只读页:没有「新增」,也没有「编辑」
 * - 两个 tab 各有详情抽屉
 * - 两个 tab 的删除请求体形状不同:登录日志是裸数组,操作日志是 { ids }
 *
 * 菜单树 / 登录态 / 业务错误信封 / 权限门控断言都由 ./helpers 提供 ——
 * helpers 不认识任何具体模块,下一个模块的 spec 直接复用。
 */

const LOG_PAGE_PATH = '/system/log';
const LOGIN_LIST_URL = '**/api/v1/system/log/login/list**';
const OPERATION_LIST_URL = '**/api/v1/system/log/operation/list**';
const LOGIN_DETAIL_URL = '**/api/v1/system/log/login/detail/**';
const OPERATION_DETAIL_URL = '**/api/v1/system/log/operation/detail/**';
const LOGIN_DELETE_URL = '**/api/v1/system/log/login/delete**';
const OPERATION_DELETE_URL = '**/api/v1/system/log/operation/delete**';

/**
 * 日志管理的菜单树。
 *
 * 日志管理挂在「系统管理」目录下,route_path 是相对的 'log',
 * 后端适配器会把它拼成 /system/log —— 必须与前端路由表一致。
 * 按钮节点(type=3)由权限门控断言自己挂。
 */
function logMenu(buttons?: MenuButton[]): ModuleMenu {
  return {
    title: '日志管理',
    routePath: 'log',
    permission: 'module_system:login_log:query',
    buttons,
  };
}

/** 侧边栏里的「日志管理」—— 应用就绪的内容信号(不用 networkidle) */
function menuItem(page: Page) {
  return page.locator('.ant-menu').getByText('日志管理');
}

/** 通用成功信封(删除接口用) */
const okResponse = {
  code: 0,
  msg: 'ok',
  data: null,
  status_code: 200,
  success: true,
};

const loginLogListResponse = {
  code: 0,
  msg: '查询登录日志列表成功',
  data: {
    items: [
      {
        id: 1,
        uuid: 'a1b2c3',
        username: 'zhangsan',
        status: 1,
        login_ip: '192.168.1.10',
        login_location: '内网',
        request_browser: 'Chrome 120',
        request_os: 'Windows 10',
        msg: '登录成功',
        created_time: '2026-06-21 17:56:33',
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

const operationLogListResponse = {
  code: 0,
  msg: '查询操作日志列表成功',
  data: {
    items: [
      {
        id: 9,
        uuid: 'd4e5f6',
        request_path: '/system/user/list',
        request_method: 'GET',
        response_code: 200,
        process_time: '12ms',
        status: 0,
        description: '查询用户列表',
        created_time: '2026-06-22 09:12:00',
        created_by: { id: 1, name: '管理员' },
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

/** RF3:后端返回空列表 */
const emptyLoginLogListResponse = {
  code: 0,
  msg: '查询登录日志列表成功',
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

/** 登录日志详情:列表里没有的字段(登录地点 / 提示消息 …)都在这里 */
const loginLogDetailResponse = {
  code: 0,
  msg: '获取登录日志详情成功',
  data: {
    id: 1,
    uuid: 'a1b2c3',
    username: 'zhangsan',
    status: 1,
    login_ip: '192.168.1.10',
    login_location: '内网',
    request_browser: 'Chrome 120',
    request_os: 'Windows 10',
    msg: '登录成功',
    created_time: '2026-06-21 17:56:33',
    updated_time: '2026-06-21 17:56:35',
    created_by: { id: 1, name: '管理员' },
  },
  status_code: 200,
  success: true,
};

/** 操作日志详情:比列表多请求体 / 响应体两个大文本字段 */
const operationLogDetailResponse = {
  code: 0,
  msg: '获取操作日志详情成功',
  data: {
    id: 9,
    uuid: 'd4e5f6',
    request_path: '/system/user/list',
    request_method: 'GET',
    response_code: 200,
    process_time: '12ms',
    status: 0,
    description: '查询用户列表',
    created_time: '2026-06-22 09:12:00',
    created_by: { id: 1, name: '管理员' },
    request_payload: '{"page_no":1}',
    response_json: '{"items":[],"total":0}',
  },
  status_code: 200,
  success: true,
};

/** 拦截操作日志列表接口(切到第二个 tab 之前要装上) */
async function mockOperationList(page: Page) {
  await page.route(OPERATION_LIST_URL, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(operationLogListResponse),
    }),
  );
}

/** 切到「操作日志」tab,并等它的表格真的渲染出来 */
async function switchToOperationTab(page: Page) {
  await page.getByRole('tab', { name: '操作日志' }).click();
  await expect(page.getByText('/system/user/list')).toBeVisible();
}

/**
 * Popconfirm 的确认按钮。
 *
 * 用 class 定位而不是文案(确定 / OK)—— antd 的 locale 文案会变,
 * class 不会。
 */
function confirmButton(page: Page) {
  return page.locator('.ant-popconfirm-buttons .ant-btn-primary');
}

test.describe('日志管理页', () => {
  test('默认渲染登录日志,切 tab 渲染操作日志,一次只发一个列表请求', async ({
    page,
  }) => {
    const operationRequests: string[] = [];

    await page.route(OPERATION_LIST_URL, (route) => {
      operationRequests.push(route.request().url());
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(operationLogListResponse),
      });
    });

    const loginRequests = await setupModulePage(page, {
      menus: [logMenu()],
      listUrl: LOGIN_LIST_URL,
      listBody: loginLogListResponse,
    });

    await gotoModulePage(page, LOG_PAGE_PATH, menuItem(page));

    // 侧边栏来自后端菜单
    await expect(menuItem(page)).toBeVisible();

    // 默认 tab 是登录日志
    await expect(page.locator('.ant-table-tbody tr.ant-table-row')).toHaveCount(
      1,
    );
    await expect(page.getByText('zhangsan')).toBeVisible();

    // 分页参数用后端约定的 page_no / page_size
    await expect.poll(() => loginRequests.length).toBeGreaterThan(0);
    expect(loginRequests[0]).toContain('page_no=1');
    expect(loginRequests[0]).toContain('page_size=10');

    // 未激活的 tab 不挂载 ⇒ 操作日志接口一次都没被请求过。
    // 这条断言放在**登录日志表格已经渲染出来之后**:此时应用已经在跑,
    // 操作日志 tab 若被挂载过,请求早就发出并被记下来了 ——
    // 所以这是「确实没请求过」,而不是「还没来得及请求」。
    expect(operationRequests).toHaveLength(0);

    // 切到「操作日志」
    await switchToOperationTab(page);
    await expect(page.locator('.ant-table-tbody tr.ant-table-row')).toHaveCount(
      1,
    );
    // 切过去之后恰好一个请求(poll 会在数量到 1 之前一直等)
    await expect.poll(() => operationRequests.length).toBe(1);
    expect(operationRequests).toHaveLength(1);
  });

  test('页面没有「新增」「编辑」按钮(只读页)', async ({ page }) => {
    await mockOperationList(page);

    await setupModulePage(page, {
      menus: [logMenu()],
      listUrl: LOGIN_LIST_URL,
      listBody: loginLogListResponse,
    });

    await gotoModulePage(page, LOG_PAGE_PATH, menuItem(page));

    await expect(page.getByRole('button', { name: '新增' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '编辑' })).toHaveCount(0);

    // 第二个 tab 同样没有编辑入口(操作列走共享脚手架,省略了 onEdit)
    await switchToOperationTab(page);
    await expect(page.getByRole('button', { name: '新增' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '编辑' })).toHaveCount(0);
  });

  test('业务错误(HTTP 500 + 信封)弹的是后端 msg(RF1)', async ({ page }) => {
    await setupModulePage(page, {
      menus: [logMenu()],
      listUrl: LOGIN_LIST_URL,
      listBody: businessErrorBody('登录日志查询失败'),
      listStatus: 500,
    });

    await gotoModulePage(page, LOG_PAGE_PATH, menuItem(page));

    // 请求层把信封转成 BizError,errorHandler 弹后端的 msg
    await expect(page.getByText('登录日志查询失败')).toBeVisible();
    // 不是 axios 的原始报错文案
    await expect(
      page.getByText('Request failed with status code 500'),
    ).toHaveCount(0);
  });

  test('后端返回空列表时表格显示空状态,不报错(RF3)', async ({ page }) => {
    await setupModulePage(page, {
      menus: [logMenu()],
      listUrl: LOGIN_LIST_URL,
      listBody: emptyLoginLogListResponse,
    });

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await gotoModulePage(page, LOG_PAGE_PATH, menuItem(page));

    // 空状态,而不是白屏
    await expect(page.locator('.ant-empty')).toBeVisible();
    await expect(page.locator('.ant-table-tbody tr.ant-table-row')).toHaveCount(
      0,
    );

    // 没有落到错误页
    await expect(page.getByText('页面出现错误')).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  });

  test('菜单树里没有按钮节点时「删除」按钮禁用(RF2)', async ({ page }) => {
    await assertPermissionGatedButton(page, {
      buttonName: '删除',
      permission: 'module_system:login_log:delete',
      granted: false,
      menu: logMenu(),
      path: LOG_PAGE_PATH,
      listUrl: LOGIN_LIST_URL,
      listBody: loginLogListResponse,
      ready: menuItem(page),
    });
  });

  test('菜单树里有按钮节点时「删除」按钮可用(RF2)', async ({ page }) => {
    await assertPermissionGatedButton(page, {
      buttonName: '删除',
      permission: 'module_system:login_log:delete',
      granted: true,
      menu: logMenu(),
      path: LOG_PAGE_PATH,
      listUrl: LOGIN_LIST_URL,
      listBody: loginLogListResponse,
      ready: menuItem(page),
    });
  });

  test('操作日志的「删除」按钮按 module_system:log:delete 门控(RF2)', async ({
    page,
  }) => {
    // 操作日志是**另一套**权限码(module_system:log:*,与登录日志不同名),
    // 写错只会静默禁用按钮 —— 所以这条断言不能省。
    await assertPermissionGatedButton(page, {
      buttonName: '删除',
      permission: 'module_system:log:delete',
      granted: false,
      menu: logMenu(),
      path: LOG_PAGE_PATH,
      listUrl: LOGIN_LIST_URL,
      listBody: loginLogListResponse,
      ready: menuItem(page),
      prepare: async (p) => {
        await mockOperationList(p);
        await switchToOperationTab(p);
      },
    });
  });

  test('操作日志的按钮节点挂上后「删除」按钮可用(RF2)', async ({ page }) => {
    await assertPermissionGatedButton(page, {
      buttonName: '删除',
      permission: 'module_system:log:delete',
      granted: true,
      menu: logMenu(),
      path: LOG_PAGE_PATH,
      listUrl: LOGIN_LIST_URL,
      listBody: loginLogListResponse,
      ready: menuItem(page),
      prepare: async (p) => {
        await mockOperationList(p);
        await switchToOperationTab(p);
      },
    });
  });

  test('登录日志的详情抽屉展示该行的全部字段', async ({ page }) => {
    const detailRequests: string[] = [];

    await page.route(LOGIN_DETAIL_URL, (route) => {
      detailRequests.push(route.request().url());
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(loginLogDetailResponse),
      });
    });

    await setupModulePage(page, {
      menus: [logMenu()],
      listUrl: LOGIN_LIST_URL,
      listBody: loginLogListResponse,
    });

    await gotoModulePage(page, LOG_PAGE_PATH, menuItem(page));

    await page.getByRole('button', { name: '详情' }).click();

    // 详情走详情接口
    await expect.poll(() => detailRequests.length).toBe(1);
    expect(detailRequests[0]).toContain('/system/log/login/detail/1');

    const drawer = page.getByRole('dialog', { name: '登录日志详情' });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText('zhangsan')).toBeVisible();
    await expect(drawer.getByText('192.168.1.10')).toBeVisible();
    await expect(drawer.getByText('内网')).toBeVisible();
    await expect(drawer.getByText('Chrome 120')).toBeVisible();
    await expect(drawer.getByText('Windows 10')).toBeVisible();
    await expect(drawer.getByText('登录成功')).toBeVisible();
    await expect(drawer.getByText('2026-06-21 17:56:33')).toBeVisible();
  });

  test('操作日志的详情抽屉展示请求体 / 响应体', async ({ page }) => {
    const detailRequests: string[] = [];

    await page.route(OPERATION_DETAIL_URL, (route) => {
      detailRequests.push(route.request().url());
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(operationLogDetailResponse),
      });
    });

    await mockOperationList(page);

    await setupModulePage(page, {
      menus: [logMenu()],
      listUrl: LOGIN_LIST_URL,
      listBody: loginLogListResponse,
    });

    await gotoModulePage(page, LOG_PAGE_PATH, menuItem(page));

    await switchToOperationTab(page);
    await page.getByRole('button', { name: '详情' }).click();

    // 详情走详情接口(列表接口不返回这两个大文本字段)
    await expect.poll(() => detailRequests.length).toBe(1);
    expect(detailRequests[0]).toContain('/system/log/operation/detail/9');

    // 抽屉里能看到字段,JSON 字段在 <pre> 里
    const drawer = page.getByRole('dialog', { name: '操作日志详情' });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText('/system/user/list')).toBeVisible();
    await expect(drawer.locator('pre').first()).toHaveText('{"page_no":1}');
    await expect(drawer.locator('pre').last()).toHaveText(
      '{"items":[],"total":0}',
    );
  });

  test('两个 tab 的删除请求体形状不同:登录日志裸数组、操作日志 { ids }', async ({
    page,
  }) => {
    const loginDeleteBodies: string[] = [];
    const operationDeleteBodies: string[] = [];

    await page.route(LOGIN_DELETE_URL, (route) => {
      loginDeleteBodies.push(route.request().postData() ?? '');
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(okResponse),
      });
    });

    await page.route(OPERATION_DELETE_URL, (route) => {
      operationDeleteBodies.push(route.request().postData() ?? '');
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(okResponse),
      });
    });

    await mockOperationList(page);

    await setupModulePage(page, {
      // 删除按钮要有权限才点得动
      menus: [
        logMenu([
          {
            title: '删除登录日志',
            permission: 'module_system:login_log:delete',
          },
          { title: '删除操作日志', permission: 'module_system:log:delete' },
        ]),
      ],
      listUrl: LOGIN_LIST_URL,
      listBody: loginLogListResponse,
    });

    await gotoModulePage(page, LOG_PAGE_PATH, menuItem(page));

    // 登录日志:裸数组 [1]
    await page.getByRole('button', { name: '删除' }).first().click();
    await confirmButton(page).click();
    await expect.poll(() => loginDeleteBodies.length).toBe(1);
    expect(JSON.parse(loginDeleteBodies[0])).toEqual([1]);

    // 操作日志:{ ids: [9] }
    await switchToOperationTab(page);
    await page.getByRole('button', { name: '删除' }).first().click();
    await confirmButton(page).click();
    await expect.poll(() => operationDeleteBodies.length).toBe(1);
    expect(JSON.parse(operationDeleteBodies[0])).toEqual({ ids: [9] });
  });
});
