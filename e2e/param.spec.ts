import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { waitForApp } from './helpers';

/**
 * 参数管理页的前端闭环(接口全部拦截,不需要真实账号)。
 *
 * 覆盖四件事:
 * - 列表渲染 + 分页参数用后端约定的 page_no / page_size
 * - RF3:后端返回空列表时表格显示空状态,不白屏、不报错
 * - 按钮级权限来自后端菜单树里的 type=3 节点(权限码是 module_system:param:*)
 * - config_key 是唯一键,编辑弹窗里不可改
 */

type ParamFixture = {
  /** 菜单树里是否带「新增参数」按钮节点(type=3) */
  withCreateButton?: boolean;
  /** 菜单树里是否带「编辑参数」按钮节点(type=3) */
  withEditButton?: boolean;
  /** 列表接口的响应体 */
  listBody?: unknown;
};

/** 捕获到的更新请求 */
type UpdateRequest = {
  url: string;
  method: string;
  body: unknown;
};

/**
 * 后端 current/info 下发的菜单树。
 *
 * 参数管理挂在「系统管理」目录下,route_path 是相对的 'param',
 * 后端适配器会把它拼成 /system/param —— 必须与前端路由表一致
 * (前端路由是单数 /system/param,目录才是复数 module_system/params)。
 */
function buildCurrentUserResponse(
  options: { withCreateButton?: boolean; withEditButton?: boolean } = {},
) {
  const { withCreateButton = true, withEditButton = true } = options;

  const buttonNodes = [
    ...(withCreateButton
      ? [
          {
            id: 30,
            parent_id: 3,
            name: '新增参数',
            type: 3,
            order: 1,
            route_path: '',
            title: '新增参数',
            permission: 'module_system:param:create',
            status: 0,
            hidden: false,
            children: null,
          },
        ]
      : []),
    ...(withEditButton
      ? [
          {
            id: 31,
            parent_id: 3,
            name: '编辑参数',
            type: 3,
            order: 2,
            route_path: '',
            title: '编辑参数',
            permission: 'module_system:param:update',
            status: 0,
            hidden: false,
            children: null,
          },
        ]
      : []),
  ];

  return {
    code: 0,
    msg: '获取当前用户信息成功',
    data: {
      id: 1,
      username: 'admin',
      name: '管理员',
      status: 0,
      is_superuser: true,
      role_ids: [1],
      roles: [],
      menus: [
        {
          id: 2,
          parent_id: null,
          name: '系统管理',
          type: 1,
          order: 2,
          route_path: '/system',
          title: '系统管理',
          status: 0,
          hidden: false,
          children: [
            {
              id: 3,
              parent_id: 2,
              name: '参数管理',
              type: 2,
              order: 1,
              route_path: 'param',
              title: '参数管理',
              permission: 'module_system:param:query',
              status: 0,
              hidden: false,
              children: buttonNodes.length ? buttonNodes : null,
            },
          ],
        },
      ],
    },
    status_code: 200,
    success: true,
  };
}

const paramListResponse = {
  code: 0,
  msg: '查询参数列表成功',
  data: {
    items: [
      {
        id: 1,
        config_name: '站点名称',
        config_key: 'site.name',
        config_value: 'AI Admin',
        config_type: true,
        status: 0,
        description: '站点标题',
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
const emptyParamListResponse = {
  code: 0,
  msg: '查询参数列表成功',
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

/** 装好拦截器,返回收集到的列表请求 URL */
async function setupParamPage(page: Page, fixture: ParamFixture = {}) {
  const {
    withCreateButton = true,
    withEditButton = true,
    listBody = paramListResponse,
  } = fixture;

  const listRequests: string[] = [];

  await page.route('**/api/v1/system/user/current/info', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        buildCurrentUserResponse({ withCreateButton, withEditButton }),
      ),
    }),
  );

  await page.route('**/api/v1/system/param/list**', (route) => {
    listRequests.push(route.request().url());
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(listBody),
    });
  });

  // 前端认为已登录(请求拦截器会带上这个 Bearer)
  await page.addInitScript(() => {
    localStorage.setItem('remember_me', 'true');
    localStorage.setItem('access_token', 'e2e-mock-access-token');
    localStorage.setItem('refresh_token', 'e2e-mock-refresh-token');
  });

  return listRequests;
}

/** 打开参数管理页并等应用挂载 */
async function gotoParamPage(page: Page) {
  await page.goto('/system/param');
  await waitForApp(page);
  await page.waitForLoadState('networkidle');
}

test.describe('参数管理页', () => {
  test('渲染后端菜单与参数列表,分页参数用 page_no / page_size', async ({
    page,
  }) => {
    const listRequests = await setupParamPage(page);

    await gotoParamPage(page);

    // 侧边栏来自后端菜单
    await expect(page.locator('.ant-menu').getByText('参数管理')).toBeVisible();

    // 表格渲染出后端返回的数据
    await expect(page.locator('.ant-table-tbody tr.ant-table-row')).toHaveCount(
      1,
    );
    await expect(page.getByText('站点名称')).toBeVisible();

    // 布尔列渲染成「是/否」,不用 valueEnum
    // 第 5 列:ID / 参数名称 / 参数键 / 参数值 / 系统内置
    await expect(
      page.locator('.ant-table-tbody tr.ant-table-row td').nth(4),
    ).toHaveText('是');

    // 分页参数用后端约定的 page_no / page_size
    expect(listRequests.length).toBeGreaterThan(0);
    expect(listRequests[0]).toContain('page_no=1');
    expect(listRequests[0]).toContain('page_size=10');
  });

  test('后端返回空列表时表格显示空状态,不报错(RF3)', async ({ page }) => {
    await setupParamPage(page, { listBody: emptyParamListResponse });

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await gotoParamPage(page);

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
    await setupParamPage(page, { withCreateButton: false });

    await gotoParamPage(page);

    await expect(page.getByRole('button', { name: '新增' })).toBeDisabled();
  });

  test('菜单树里有按钮节点时「新增」按钮可用', async ({ page }) => {
    await setupParamPage(page, { withCreateButton: true });

    await gotoParamPage(page);

    await expect(page.getByRole('button', { name: '新增' })).toBeEnabled();
  });

  test('编辑弹窗里参数键 disabled(config_key 是唯一键)', async ({ page }) => {
    await setupParamPage(page, { withEditButton: true });

    await gotoParamPage(page);

    await page.getByRole('button', { name: '编辑' }).click();

    // 参数键在编辑模式下不可改
    const configKeyInput = page
      .locator('.ant-modal .ant-form-item', { hasText: '参数键' })
      .locator('input');
    await expect(configKeyInput).toBeDisabled();
    await expect(configKeyInput).toHaveValue('site.name');
  });

  test('编辑提交时把 disabled 的参数键原样带回(后端 update 必填)', async ({
    page,
  }) => {
    const updateRequests: UpdateRequest[] = [];

    await page.route('**/api/v1/system/param/update/**', async (route) => {
      const req = route.request();
      updateRequests.push({
        url: req.url(),
        method: req.method(),
        body: req.postDataJSON(),
      });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 0,
          msg: '更新参数成功',
          data: null,
          status_code: 200,
          success: true,
        }),
      });
    });

    await setupParamPage(page, { withEditButton: true });

    await gotoParamPage(page);

    await page.getByRole('button', { name: '编辑' }).click();

    await page
      .locator('.ant-modal .ant-form-item', { hasText: '参数名称' })
      .locator('input')
      .fill('新站点名称');

    await page.locator('.ant-modal-footer button.ant-btn-primary').click();

    await expect.poll(() => updateRequests.length).toBe(1);
    expect(updateRequests[0].method).toBe('PUT');
    expect(updateRequests[0].url).toContain('/system/param/update/1');
    // config_key 虽然是 disabled 的,但值仍在表单里,必须原样提交
    expect(updateRequests[0].body).toMatchObject({
      config_name: '新站点名称',
      config_key: 'site.name',
    });
  });
});
