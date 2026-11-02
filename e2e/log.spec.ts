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
 * 日志管理页的前端闭环(接口全部拦截,不需要真实账号)。
 *
 * 覆盖五件事:
 * - 两个 tab 各渲染自己的表格,且**一次进页面只发一个列表请求**
 *   (未激活的 tab 不挂载 —— antd 6 的 destroyOnHidden)
 * - RF1:后端业务错误(HTTP 500 + 信封)由请求层转成 BizError,弹的是后端的 msg
 * - RF3:后端返回空列表时表格显示空状态,不白屏、不报错
 * - RF2:按钮级权限来自后端菜单树里的 type=3 节点 —— 登录日志用
 *   module_system:login_log:*,操作日志用 module_system:log:*(两套码,命名不一致)
 * - 详情抽屉:列表接口不返回请求体 / 响应体,详情要走详情接口
 *
 * 菜单树 / 登录态 / 业务错误信封 / 权限门控断言都由 ./helpers 提供 ——
 * helpers 不认识任何具体模块,下一个模块的 spec 直接复用。
 */

const LOG_PAGE_PATH = '/system/log';
const LOGIN_LIST_URL = '**/api/v1/system/log/login/list**';
const OPERATION_LIST_URL = '**/api/v1/system/log/operation/list**';
const OPERATION_DETAIL_URL = '**/api/v1/system/log/operation/detail/**';

/**
 * 日志管理的菜单树。
 *
 * 日志管理挂在「系统管理」目录下,route_path 是相对的 'log',
 * 后端适配器会把它拼成 /system/log —— 必须与前端路由表一致。
 * 按钮节点(type=3)由权限门控断言自己挂。
 */
function logMenu(): ModuleMenu {
  return {
    title: '日志管理',
    routePath: 'log',
    permission: 'module_system:login_log:query',
  };
}

/** 侧边栏里的「日志管理」—— 应用就绪的内容信号(不用 networkidle) */
function menuItem(page: Page) {
  return page.locator('.ant-menu').getByText('日志管理');
}

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

    // 未激活的 tab 不挂载 ⇒ 一次进页面不会发两个列表请求
    expect(operationRequests).toHaveLength(0);

    // 切到「操作日志」
    await page.getByRole('tab', { name: '操作日志' }).click();
    await expect(page.locator('.ant-table-tbody tr.ant-table-row')).toHaveCount(
      1,
    );
    await expect(page.getByText('/system/user/list')).toBeVisible();
    await expect.poll(() => operationRequests.length).toBe(1);
  });

  test('页面没有「新增」按钮(只读页)', async ({ page }) => {
    await setupModulePage(page, {
      menus: [logMenu()],
      listUrl: LOGIN_LIST_URL,
      listBody: loginLogListResponse,
    });

    await gotoModulePage(page, LOG_PAGE_PATH, menuItem(page));

    await expect(page.getByRole('button', { name: '新增' })).toHaveCount(0);
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

    await page.route(OPERATION_LIST_URL, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(operationLogListResponse),
      }),
    );

    await setupModulePage(page, {
      menus: [logMenu()],
      listUrl: LOGIN_LIST_URL,
      listBody: loginLogListResponse,
    });

    await gotoModulePage(page, LOG_PAGE_PATH, menuItem(page));

    await page.getByRole('tab', { name: '操作日志' }).click();
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
});
