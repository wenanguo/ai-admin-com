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
 * 角色管理页的前端闭环(接口全部拦截,不需要真实账号)。
 *
 * 覆盖五件事:
 * - 列表渲染 + 分页参数用后端约定的 page_no / page_size
 * - RF1:后端业务错误(HTTP 500 + 信封)由请求层转成 BizError,弹的是后端的 msg
 * - RF3:后端返回空列表时表格显示空状态,不白屏、不报错
 * - RF2:按钮级权限来自后端菜单树里的 type=3 节点(权限码是 module_system:role:*)
 * - RF4:创建被后端拒绝时,弹窗**保持打开**,用户能直接改编码
 *
 * 菜单树 / 登录态 / 业务错误信封都由 ./helpers 提供 —— helpers 不认识任何具体模块,
 * 下一个模块的 spec 直接复用,不用再抄一遍夹具。
 */

const ROLE_PAGE_PATH = '/system/role';
const ROLE_LIST_URL = '**/api/v1/system/role/list**';

/**
 * 角色管理的菜单树。
 *
 * 角色管理挂在「系统管理」目录下,route_path 是相对的 'role',
 * 后端适配器会把它拼成 /system/role —— 必须与前端路由表一致。
 */
function roleMenu(buttons: ModuleMenu['buttons'] = []): ModuleMenu {
  return {
    title: '角色管理',
    routePath: 'role',
    permission: 'module_system:role:query',
    buttons,
  };
}

/** 侧边栏里的「角色管理」—— 应用就绪的内容信号(不用 networkidle) */
function menuItem(page: Page) {
  return page.locator('.ant-menu').getByText('角色管理');
}

const roleListResponse = {
  code: 0,
  msg: '查询角色列表成功',
  data: {
    items: [
      {
        id: 1,
        name: '系统管理员',
        code: 'admin',
        order: 1,
        data_scope: 4,
        status: 0,
        description: '拥有全部权限',
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

/** RF3:后端返回空列表 */
const emptyRoleListResponse = {
  code: 0,
  msg: '查询角色列表成功',
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

test.describe('角色管理页', () => {
  test('渲染后端菜单与角色列表,分页参数用 page_no / page_size', async ({
    page,
  }) => {
    const listRequests = await setupModulePage(page, {
      menus: [roleMenu()],
      listUrl: ROLE_LIST_URL,
      listBody: roleListResponse,
    });

    await gotoModulePage(page, ROLE_PAGE_PATH, menuItem(page));

    // 侧边栏来自后端菜单
    await expect(menuItem(page)).toBeVisible();

    // 表格渲染出后端返回的数据
    await expect(page.locator('.ant-table-tbody tr.ant-table-row')).toHaveCount(
      1,
    );
    await expect(page.getByText('系统管理员')).toBeVisible();

    // 数据权限列按 valueEnum 渲染成中文
    await expect(
      page.getByRole('cell', { name: '全部', exact: true }),
    ).toBeVisible();

    // 分页参数用后端约定的 page_no / page_size
    await expect.poll(() => listRequests.length).toBeGreaterThan(0);
    expect(listRequests[0]).toContain('page_no=1');
    expect(listRequests[0]).toContain('page_size=10');
  });

  test('业务错误(HTTP 500 + 信封)弹的是后端 msg(RF1)', async ({ page }) => {
    await setupModulePage(page, {
      menus: [roleMenu()],
      listUrl: ROLE_LIST_URL,
      listBody: businessErrorBody('角色查询失败'),
      listStatus: 500,
    });

    await gotoModulePage(page, ROLE_PAGE_PATH, menuItem(page));

    // 请求层把信封转成 BizError,errorHandler 弹后端的 msg
    await expect(page.getByText('角色查询失败')).toBeVisible();
    // 不是 axios 的原始报错文案
    await expect(
      page.getByText('Request failed with status code 500'),
    ).toHaveCount(0);
  });

  test('后端返回空列表时表格显示空状态,不报错(RF3)', async ({ page }) => {
    await setupModulePage(page, {
      menus: [roleMenu()],
      listUrl: ROLE_LIST_URL,
      listBody: emptyRoleListResponse,
    });

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await gotoModulePage(page, ROLE_PAGE_PATH, menuItem(page));

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
    await assertPermissionGatedButton(page, {
      buttonName: '新增',
      permission: 'module_system:role:create',
      granted: false,
      menu: roleMenu(),
      path: ROLE_PAGE_PATH,
      listUrl: ROLE_LIST_URL,
      listBody: roleListResponse,
      ready: menuItem(page),
    });
  });

  test('菜单树里有按钮节点时「新增」按钮可用', async ({ page }) => {
    await assertPermissionGatedButton(page, {
      buttonName: '新增',
      permission: 'module_system:role:create',
      granted: true,
      menu: roleMenu(),
      path: ROLE_PAGE_PATH,
      listUrl: ROLE_LIST_URL,
      listBody: roleListResponse,
      ready: menuItem(page),
    });
  });

  test('创建被后端拒绝时弹窗保持打开并显示后端文案(RF4)', async ({ page }) => {
    await page.route('**/api/v1/system/role/create**', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify(businessErrorBody('角色编码已存在')),
      }),
    );

    await setupModulePage(page, {
      menus: [
        roleMenu([
          { title: '新增角色', permission: 'module_system:role:create' },
        ]),
      ],
      listUrl: ROLE_LIST_URL,
      listBody: roleListResponse,
    });

    await gotoModulePage(page, ROLE_PAGE_PATH, menuItem(page));

    await page.getByRole('button', { name: '新增' }).click();

    await page
      .locator('.ant-modal .ant-form-item', { hasText: '角色名称' })
      .locator('input')
      .fill('系统管理员');
    await page
      .locator('.ant-modal .ant-form-item', { hasText: '角色编码' })
      .locator('input')
      .fill('admin');

    await page.locator('.ant-modal-footer button.ant-btn-primary').click();

    // 请求层把信封转成 BizError,errorHandler 弹后端的 msg
    await expect(page.getByText('角色编码已存在')).toBeVisible();
    // 不是 axios 的原始报错文案
    await expect(
      page.getByText('Request failed with status code 500'),
    ).toHaveCount(0);
    // 失败时弹窗不关,用户能直接改编码再提交
    await expect(page.locator('.ant-modal')).toBeVisible();
  });

  test('数据权限选「自定义」时才出现部门范围', async ({ page }) => {
    await page.route('**/api/v1/system/dept/tree**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 0,
          msg: '查询部门树成功',
          data: [{ id: 1, name: '总公司', code: 'hq', children: [] }],
          status_code: 200,
          success: true,
        }),
      }),
    );

    await setupModulePage(page, {
      menus: [
        roleMenu([
          { title: '角色授权', permission: 'module_system:role:permission' },
        ]),
      ],
      listUrl: ROLE_LIST_URL,
      listBody: roleListResponse,
    });

    await gotoModulePage(page, ROLE_PAGE_PATH, menuItem(page));

    await page.getByRole('button', { name: '授权' }).first().click();

    // 默认是「全部」⇒ 不需要选部门
    await expect(page.getByText('部门范围')).toHaveCount(0);

    // 改成「自定义」
    await page
      .locator('.ant-modal .ant-form-item', { hasText: '数据权限' })
      .getByRole('combobox')
      .click();
    await page
      .locator(
        '.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option',
        { hasText: '自定义' },
      )
      .click();

    // 自定义 ⇒ 出现部门范围(部门树选择器,多选)
    await expect(page.getByText('部门范围')).toBeVisible();
    await page
      .locator('.ant-modal .ant-form-item', { hasText: '部门范围' })
      .getByRole('combobox')
      .click();
    await expect(
      page.locator('.ant-select-tree-title', { hasText: '总公司' }),
    ).toBeVisible();
  });

  test('操作列有「授权」入口,提交的是四个平级字段', async ({ page }) => {
    const permissionRequests: {
      url: string;
      method: string;
      body: unknown;
    }[] = [];

    await page.route('**/api/v1/system/role/permission', (route) => {
      const request = route.request();
      permissionRequests.push({
        url: request.url(),
        method: request.method(),
        body: request.postDataJSON(),
      });
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 0,
          msg: '授权角色成功',
          data: null,
          status_code: 200,
          success: true,
        }),
      });
    });

    await setupModulePage(page, {
      menus: [
        roleMenu([
          { title: '角色授权', permission: 'module_system:role:permission' },
        ]),
      ],
      listUrl: ROLE_LIST_URL,
      listBody: roleListResponse,
    });

    await gotoModulePage(page, ROLE_PAGE_PATH, menuItem(page));

    await page.getByRole('button', { name: '授权' }).first().click();

    // 授权弹窗里有菜单权限树(数据源是 current/info 的 menus)
    await expect(page.getByText('菜单权限')).toBeVisible();
    await expect(
      page.getByRole('checkbox', { name: '角色管理' }),
    ).toBeVisible();

    // 勾一个菜单(角色管理是目录的子节点,勾上它会连带勾上它的按钮节点)
    await page.getByRole('checkbox', { name: '角色管理' }).click();

    await page.locator('.ant-modal-footer button.ant-btn-primary').click();

    await expect.poll(() => permissionRequests.length).toBe(1);
    expect(permissionRequests[0].method).toBe('PUT');
    expect(permissionRequests[0].url).toContain('/system/role/permission');
    expect(permissionRequests[0].body).toMatchObject({
      // 弹窗默认带上角色自己的数据权限(这里是「全部」)
      data_scope: 4,
      role_ids: [1],
    });
    expect(
      (permissionRequests[0].body as { menu_ids: number[] }).menu_ids.length,
    ).toBeGreaterThan(0);
    // 自定义之外的数据权限不带部门
    expect(permissionRequests[0].body).toMatchObject({ dept_ids: [] });
  });
});
