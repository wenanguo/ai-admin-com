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
 * 字典管理页的前端闭环(接口全部拦截,不需要真实账号)。
 *
 * 本页是**主从结构**:左栏字典类型,右栏该类型下的字典数据。
 * 覆盖五件事:
 * - 左栏渲染类型、右栏渲染该类型下的数据,且右栏请求带上 dict_type 筛选
 * - 点左栏的类型能切换右栏的筛选
 * - RF1:后端业务错误(HTTP 500 + 信封)由请求层转成 BizError,弹的是后端的 msg
 * - RF3:后端返回空列表时表格显示空状态,不白屏、不报错
 * - RF2:按钮级权限来自后端菜单树里的 type=3 节点,且**两套权限码互不通用**
 *   (module_system:dict_type:* 与 module_system:dict_data:*)
 *
 * 菜单树 / 登录态 / 业务错误信封都由 ./helpers 提供 —— helpers 不认识任何具体模块。
 */

const DICT_PAGE_PATH = '/system/dict';
const DICT_TYPE_LIST_URL = '**/api/v1/system/dict/type/list**';
const DICT_DATA_LIST_URL = '**/api/v1/system/dict/data/list**';
const DICT_DATA_CREATE_URL = '**/api/v1/system/dict/data/create**';
const DICT_TYPE_CREATE_URL = '**/api/v1/system/dict/type/create**';

/**
 * 字典管理的菜单树。
 *
 * 挂在「系统管理」目录下,route_path 是相对的 'dict',
 * 后端适配器会把它拼成 /system/dict —— 必须与前端路由表一致。
 * 按钮节点(type=3)由用例决定带不带。
 */
function dictMenu(
  buttons: { title: string; permission: string }[] = [],
): ModuleMenu {
  return {
    title: '字典管理',
    routePath: 'dict',
    permission: 'module_system:dict:query',
    buttons,
  };
}

/** 侧边栏里的「字典管理」—— 应用就绪的内容信号(不用 networkidle) */
function menuItem(page: Page) {
  return page.locator('.ant-menu').getByText('字典管理');
}

/** 左栏的字典类型表格 */
function typeTable(page: Page) {
  return page
    .locator('.ant-card', { hasText: '字典类型' })
    .locator('.ant-table');
}

/** 右栏的字典数据表格(ProTable) */
function dataTable(page: Page) {
  return page.locator('[data-testid="pro-table"] .ant-table');
}

/** 字典类型列表:两个类型,用来验证「点左栏切换右栏筛选」 */
const dictTypeListResponse = {
  code: 0,
  msg: '查询字典类型列表成功',
  data: {
    items: [
      {
        id: 1,
        dict_name: '用户状态',
        dict_type: 'user_status',
        status: 0,
        description: '用户的启停状态',
        created_time: '2026-06-21 17:56:33',
      },
      {
        id: 2,
        dict_name: '订单状态',
        dict_type: 'order_status',
        status: 0,
        description: '订单的流转状态',
        created_time: '2026-06-21 17:56:33',
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

/** 字典数据列表:user_status 下的两条数据 */
const dictDataListResponse = {
  code: 0,
  msg: '查询字典数据列表成功',
  data: {
    items: [
      {
        id: 11,
        dict_sort: 1,
        dict_label: '已启用',
        dict_value: '1',
        dict_type: 'user_status',
        dict_type_id: 1,
        css_class: '',
        list_class: 'success',
        is_default: true,
        status: 0,
        description: '启用',
        created_time: '2026-06-21 17:56:33',
      },
      {
        id: 12,
        dict_sort: 2,
        dict_label: '已停用',
        dict_value: '0',
        dict_type: 'user_status',
        dict_type_id: 1,
        css_class: '',
        list_class: 'danger',
        is_default: false,
        status: 0,
        description: '停用',
        created_time: '2026-06-21 17:56:33',
      },
    ],
    total: 2,
    page_no: 1,
    page_size: 10,
    has_next: false,
  },
  status_code: 200,
  success: true,
};

/** RF3:后端返回空列表 */
const emptyDictDataListResponse = {
  code: 0,
  msg: '查询字典数据列表成功',
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

test.describe('字典管理页', () => {
  test('左栏渲染字典类型,右栏渲染该类型下的字典数据', async ({ page }) => {
    const dataRequests: string[] = [];

    const typeRequests = await setupModulePage(page, {
      menus: [dictMenu()],
      listUrl: DICT_TYPE_LIST_URL,
      listBody: dictTypeListResponse,
    });

    await page.route(DICT_DATA_LIST_URL, (route) => {
      dataRequests.push(route.request().url());
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(dictDataListResponse),
      });
    });

    await gotoModulePage(page, DICT_PAGE_PATH, menuItem(page));

    // 侧边栏来自后端菜单
    await expect(menuItem(page)).toBeVisible();

    // 左栏:字典类型
    await expect(typeTable(page).getByText('用户状态')).toBeVisible();
    await expect(typeTable(page).getByText('order_status')).toBeVisible();

    // 右栏:该类型下的字典数据
    await expect(
      dataTable(page).locator('.ant-table-tbody tr.ant-table-row'),
    ).toHaveCount(2);
    await expect(dataTable(page).getByText('已启用')).toBeVisible();

    // 类型列表一次拉 100 条
    await expect.poll(() => typeRequests.length).toBeGreaterThan(0);
    expect(typeRequests[0]).toContain('page_no=1');
    expect(typeRequests[0]).toContain('page_size=100');

    // 右栏的请求带上选中类型的筛选
    await expect.poll(() => dataRequests.length).toBeGreaterThan(0);
    expect(dataRequests[0]).toContain('dict_type=user_status');
    expect(dataRequests[0]).toContain('page_no=1');
    expect(dataRequests[0]).toContain('page_size=10');
  });

  test('点左栏的类型,右栏跟着换筛选', async ({ page }) => {
    const dataRequests: string[] = [];

    await setupModulePage(page, {
      menus: [dictMenu()],
      listUrl: DICT_TYPE_LIST_URL,
      listBody: dictTypeListResponse,
    });

    await page.route(DICT_DATA_LIST_URL, (route) => {
      dataRequests.push(route.request().url());
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(dictDataListResponse),
      });
    });

    await gotoModulePage(page, DICT_PAGE_PATH, menuItem(page));

    // 首次进入默认选中第一个类型
    await expect.poll(() => dataRequests.length).toBeGreaterThan(0);
    expect(dataRequests[0]).toContain('dict_type=user_status');

    // 点第二个类型 ⇒ 右栏换成它的筛选
    await typeTable(page).getByText('订单状态').click();

    await expect
      .poll(() =>
        dataRequests.some((url) => url.includes('dict_type=order_status')),
      )
      .toBe(true);
  });

  test('业务错误(HTTP 500 + 信封)弹的是后端 msg(RF1)', async ({ page }) => {
    await setupModulePage(page, {
      menus: [dictMenu()],
      listUrl: DICT_TYPE_LIST_URL,
      listBody: dictTypeListResponse,
    });

    await page.route(DICT_DATA_LIST_URL, (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify(businessErrorBody('字典数据不存在')),
      }),
    );

    await gotoModulePage(page, DICT_PAGE_PATH, menuItem(page));

    // 请求层把信封转成 BizError,errorHandler 弹后端的 msg
    await expect(page.getByText('字典数据不存在')).toBeVisible();
    // 不是 axios 的原始报错文案
    await expect(
      page.getByText('Request failed with status code 500'),
    ).toHaveCount(0);
  });

  test('字典数据为空时右栏显示空状态,不报错(RF3)', async ({ page }) => {
    await setupModulePage(page, {
      menus: [dictMenu()],
      listUrl: DICT_TYPE_LIST_URL,
      listBody: dictTypeListResponse,
    });

    await page.route(DICT_DATA_LIST_URL, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(emptyDictDataListResponse),
      }),
    );

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await gotoModulePage(page, DICT_PAGE_PATH, menuItem(page));

    // 空状态,而不是白屏
    await expect(dataTable(page).locator('.ant-empty')).toBeVisible();
    await expect(
      dataTable(page).locator('.ant-table-tbody tr.ant-table-row'),
    ).toHaveCount(0);

    // 没有落到错误页
    await expect(page.getByText('页面出现错误')).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  });

  test('菜单树里没有按钮节点时「新增类型」按钮禁用', async ({ page }) => {
    await page.route(DICT_DATA_LIST_URL, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(dictDataListResponse),
      }),
    );

    await assertPermissionGatedButton(page, {
      buttonName: '新增类型',
      permission: 'module_system:dict_type:create',
      granted: false,
      menu: dictMenu(),
      path: DICT_PAGE_PATH,
      listUrl: DICT_TYPE_LIST_URL,
      listBody: dictTypeListResponse,
      ready: menuItem(page),
    });
  });

  test('菜单树里有按钮节点时「新增类型」按钮可用', async ({ page }) => {
    await page.route(DICT_DATA_LIST_URL, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(dictDataListResponse),
      }),
    );

    await assertPermissionGatedButton(page, {
      buttonName: '新增类型',
      permission: 'module_system:dict_type:create',
      granted: true,
      menu: dictMenu(),
      path: DICT_PAGE_PATH,
      listUrl: DICT_TYPE_LIST_URL,
      listBody: dictTypeListResponse,
      ready: menuItem(page),
    });
  });

  test('两套权限码互不通用:给了类型的建权限,数据的建权限仍然禁用', async ({
    page,
  }) => {
    await setupModulePage(page, {
      menus: [
        dictMenu([
          { title: '新增类型', permission: 'module_system:dict_type:create' },
        ]),
      ],
      listUrl: DICT_TYPE_LIST_URL,
      listBody: dictTypeListResponse,
    });

    await page.route(DICT_DATA_LIST_URL, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(dictDataListResponse),
      }),
    );

    await gotoModulePage(page, DICT_PAGE_PATH, menuItem(page));

    await expect(
      page.getByRole('button', { name: '新增类型' }).first(),
    ).toBeEnabled();
    // module_system:dict_data:create 没有授权 ⇒ 禁用
    await expect(
      page.getByRole('button', { name: '新增数据' }).first(),
    ).toBeDisabled();
  });

  test('左栏的「编辑」打开类型弹窗并预填该行', async ({ page }) => {
    await setupModulePage(page, {
      menus: [
        dictMenu([
          { title: '编辑类型', permission: 'module_system:dict_type:update' },
        ]),
      ],
      listUrl: DICT_TYPE_LIST_URL,
      listBody: dictTypeListResponse,
    });

    await page.route(DICT_DATA_LIST_URL, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(dictDataListResponse),
      }),
    );

    await gotoModulePage(page, DICT_PAGE_PATH, menuItem(page));

    await typeTable(page).getByRole('button', { name: '编辑' }).first().click();

    await expect(page.locator('.ant-modal')).toBeVisible();
    await expect(
      page
        .locator('.ant-modal .ant-form-item', { hasText: '字典名称' })
        .locator('input'),
    ).toHaveValue('用户状态');
    await expect(
      page
        .locator('.ant-modal .ant-form-item', { hasText: '字典类型' })
        .locator('input'),
    ).toHaveValue('user_status');
  });

  test('右栏的「编辑」打开数据弹窗并预填该行', async ({ page }) => {
    await setupModulePage(page, {
      menus: [
        dictMenu([
          { title: '编辑数据', permission: 'module_system:dict_data:update' },
        ]),
      ],
      listUrl: DICT_TYPE_LIST_URL,
      listBody: dictTypeListResponse,
    });

    await page.route(DICT_DATA_LIST_URL, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(dictDataListResponse),
      }),
    );

    await gotoModulePage(page, DICT_PAGE_PATH, menuItem(page));

    await dataTable(page).getByRole('button', { name: '编辑' }).first().click();

    await expect(page.locator('.ant-modal')).toBeVisible();
    await expect(
      page
        .locator('.ant-modal .ant-form-item', { hasText: '字典标签' })
        .locator('input'),
    ).toHaveValue('已启用');
    // 字典数据挂在当前选中的类型下
    await expect(
      page.locator('.ant-modal .ant-form-item', { hasText: '字典类型' }),
    ).toContainText('用户状态(user_status)');
  });

  test('新增字典数据时提交体带上后端必填的 dict_sort 与 dict_type', async ({
    page,
  }) => {
    const createRequests: { body: Record<string, unknown> }[] = [];

    await page.route(DICT_DATA_CREATE_URL, async (route) => {
      createRequests.push({ body: route.request().postDataJSON() });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 0,
          msg: '创建字典数据成功',
          data: null,
          status_code: 200,
          success: true,
        }),
      });
    });

    await setupModulePage(page, {
      menus: [
        dictMenu([
          { title: '新增数据', permission: 'module_system:dict_data:create' },
        ]),
      ],
      listUrl: DICT_TYPE_LIST_URL,
      listBody: dictTypeListResponse,
    });

    await page.route(DICT_DATA_LIST_URL, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(dictDataListResponse),
      }),
    );

    await gotoModulePage(page, DICT_PAGE_PATH, menuItem(page));

    await page.getByRole('button', { name: '新增数据' }).click();

    await expect(page.locator('.ant-modal')).toBeVisible();

    await page
      .locator('.ant-modal .ant-form-item', { hasText: '字典标签' })
      .locator('input')
      .fill('已启用');
    await page
      .locator('.ant-modal .ant-form-item', { hasText: '字典键值' })
      .locator('input')
      .fill('1');

    await page.locator('.ant-modal-footer button.ant-btn-primary').click();

    await expect.poll(() => createRequests.length).toBe(1);
    // ⚠️ dict_sort 与 dict_type 是后端的必填字段,少一个就是 422
    expect(createRequests[0].body).toMatchObject({
      dict_sort: 1,
      dict_type: 'user_status',
      dict_label: '已启用',
      dict_value: '1',
      dict_type_id: 1,
    });
  });

  test('字典类型编码不符合后端的正则时表单内报错,不发请求', async ({
    page,
  }) => {
    const createRequests: unknown[] = [];

    await page.route(DICT_TYPE_CREATE_URL, async (route) => {
      createRequests.push(route.request().postDataJSON());
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 0,
          msg: '创建字典类型成功',
          data: null,
          status_code: 200,
          success: true,
        }),
      });
    });

    await setupModulePage(page, {
      menus: [
        dictMenu([
          { title: '新增类型', permission: 'module_system:dict_type:create' },
        ]),
      ],
      listUrl: DICT_TYPE_LIST_URL,
      listBody: dictTypeListResponse,
    });

    await page.route(DICT_DATA_LIST_URL, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(dictDataListResponse),
      }),
    );

    await gotoModulePage(page, DICT_PAGE_PATH, menuItem(page));

    await page.getByRole('button', { name: '新增类型' }).click();

    await page
      .locator('.ant-modal .ant-form-item', { hasText: '字典名称' })
      .locator('input')
      .fill('用户状态');
    // 后端 validate_dict_type 的正则是 ^[a-z][a-z0-9_]*$
    await page
      .locator('.ant-modal .ant-form-item', { hasText: '字典类型' })
      .locator('input')
      .fill('User Status');

    await page.locator('.ant-modal-footer button.ant-btn-primary').click();

    // 表单内报错(不是后端 422 之后的 toast)
    await expect(
      page.getByText('小写字母开头,只能包含小写字母、数字与下划线'),
    ).toBeVisible();
    // 请求根本没发出去
    expect(createRequests).toHaveLength(0);
  });
});
