import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { waitForApp } from './helpers';

/**
 * 岗位管理页的前端闭环(接口全部拦截,不需要真实账号)。
 *
 * 覆盖三件事:
 * - 列表渲染 + 分页参数用后端约定的 page_no / page_size
 * - RF1:后端业务错误(HTTP 500 + 信封)由请求层转成 BizError,弹的是后端的 msg
 * - RF2:按钮级权限来自后端菜单树里的 type=3 节点 ——
 *   buildMenuItems 会把按钮节点从侧边栏剔掉,但 collectPermissions 会收进权限集合,
 *   所以「新增」按钮能不能点,取决于菜单树里有没有那条按钮节点。
 */

type PositionFixture = {
  /** 菜单树里是否带「新增岗位」按钮节点(type=3) */
  withCreateButton?: boolean;
  /** 列表接口的 HTTP 状态码 */
  listStatus?: number;
  /** 列表接口的响应体 */
  listBody?: unknown;
};

/**
 * 后端 current/info 下发的菜单树。
 *
 * 岗位管理挂在「系统管理」目录下,route_path 是相对的 'position',
 * 后端适配器会把它拼成 /system/position —— 必须与前端路由表一致。
 */
function buildCurrentUserResponse(
  options: { withCreateButton?: boolean } = {},
) {
  const { withCreateButton = true } = options;

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
              name: '岗位管理',
              type: 2,
              order: 1,
              route_path: 'position',
              title: '岗位管理',
              permission: 'module_system:position:query',
              status: 0,
              hidden: false,
              children: withCreateButton
                ? [
                    {
                      id: 30,
                      parent_id: 3,
                      name: '新增岗位',
                      type: 3,
                      order: 1,
                      route_path: '',
                      title: '新增岗位',
                      permission: 'module_system:position:create',
                      status: 0,
                      hidden: false,
                      children: null,
                    },
                  ]
                : null,
            },
          ],
        },
      ],
    },
    status_code: 200,
    success: true,
  };
}

const positionListResponse = {
  code: 0,
  msg: '查询岗位列表成功',
  data: {
    items: [
      {
        id: 1,
        name: '后端工程师',
        code: 'backend',
        order: 7,
        status: 0,
        description: '负责服务端开发',
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

/** 业务错误:HTTP 500 + 信封(后端业务异常的固定形态) */
const positionListErrorResponse = {
  code: -1,
  msg: '岗位名称已存在',
  data: null,
  status_code: 500,
  success: false,
};

/** 装好拦截器,返回收集到的列表请求 URL */
async function setupPositionPage(page: Page, fixture: PositionFixture = {}) {
  const {
    withCreateButton = true,
    listStatus = 200,
    listBody = positionListResponse,
  } = fixture;

  const listRequests: string[] = [];

  await page.route('**/api/v1/system/user/current/info', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(buildCurrentUserResponse({ withCreateButton })),
    }),
  );

  await page.route('**/api/v1/system/position/list**', (route) => {
    listRequests.push(route.request().url());
    return route.fulfill({
      status: listStatus,
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

/** 打开岗位管理页并等应用挂载 */
async function gotoPositionPage(page: Page) {
  await page.goto('/system/position');
  await waitForApp(page);
  await page.waitForLoadState('networkidle');
}

test.describe('岗位管理页', () => {
  test('渲染后端菜单与岗位列表,分页参数用 page_no / page_size', async ({
    page,
  }) => {
    const listRequests = await setupPositionPage(page);

    await gotoPositionPage(page);

    // 侧边栏来自后端菜单
    await expect(page.locator('.ant-menu').getByText('岗位管理')).toBeVisible();

    // 表格渲染出后端返回的数据
    await expect(page.locator('.ant-table-tbody tr.ant-table-row')).toHaveCount(
      1,
    );
    await expect(page.getByText('后端工程师')).toBeVisible();

    // 「排序」列取的是后端的 order 字段(列名和表格的列顺序容易撞车,这里钉一下)
    // 第 4 列:ID / 岗位名称 / 岗位编码 / 排序
    await expect(
      page.locator('.ant-table-tbody tr.ant-table-row td').nth(3),
    ).toHaveText('7');

    // 分页参数用后端约定的 page_no / page_size
    expect(listRequests.length).toBeGreaterThan(0);
    expect(listRequests[0]).toContain('page_no=1');
    expect(listRequests[0]).toContain('page_size=10');
  });

  test('业务错误(HTTP 500 + 信封)弹的是后端 msg', async ({ page }) => {
    await setupPositionPage(page, {
      listStatus: 500,
      listBody: positionListErrorResponse,
    });

    await gotoPositionPage(page);

    // 请求层把信封转成 BizError,errorHandler 弹后端的 msg
    await expect(page.getByText('岗位名称已存在')).toBeVisible();
    // 不是 axios 的原始报错文案
    await expect(
      page.getByText('Request failed with status code 500'),
    ).toHaveCount(0);
  });

  test('菜单树里没有按钮节点时「新增」按钮禁用', async ({ page }) => {
    await setupPositionPage(page, { withCreateButton: false });

    await gotoPositionPage(page);

    await expect(page.getByRole('button', { name: '新增' })).toBeDisabled();
  });

  test('菜单树里有按钮节点时「新增」按钮可用', async ({ page }) => {
    await setupPositionPage(page, { withCreateButton: true });

    await gotoPositionPage(page);

    await expect(page.getByRole('button', { name: '新增' })).toBeEnabled();
  });
});
