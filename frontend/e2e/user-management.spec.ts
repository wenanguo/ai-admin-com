import { expect, test } from '@playwright/test';
import { waitForApp } from './helpers';

/**
 * 用户管理页的前端闭环(接口全部拦截,不需要真实账号)。
 *
 * 这条用例同时是「父路由 redirect 导致无限重定向」的回归护栏:
 * 之前 /system 父路由带了 redirect,访问 /system/user 会被重定向到自己,
 * React 抛 error #185,整页变成 ErrorBoundary 的错误页 ——
 * 页面断言「没有落到错误页」就会失败。
 */

/** 后端 current/info 下发的菜单树(只保留模板真正注册了前端路由的那一段) */
const currentUserResponse = {
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
            name: '用户管理',
            type: 2,
            order: 1,
            route_path: 'user',
            title: '用户管理',
            permission: 'module_system:user:query',
            status: 0,
            hidden: false,
            children: null,
          },
        ],
      },
    ],
  },
  status_code: 200,
  success: true,
};

const userListResponse = {
  code: 0,
  msg: '查询成功',
  data: {
    items: [
      {
        id: 1,
        username: 'admin',
        name: '管理员',
        mobile: '13800000000',
        email: 'admin@example.com',
        status: 0,
        dept_name: null,
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

test.describe('用户管理页', () => {
  test('渲染后端菜单与用户列表,且不会落到错误页', async ({ page }) => {
    const listRequests: string[] = [];

    await page.route('**/api/v1/system/user/current/info', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(currentUserResponse),
      }),
    );

    await page.route('**/api/v1/system/user/list**', (route) => {
      listRequests.push(route.request().url());
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(userListResponse),
      });
    });

    // 前端认为已登录(请求拦截器会带上这个 Bearer)
    await page.addInitScript(() => {
      localStorage.setItem('remember_me', 'true');
      localStorage.setItem('access_token', 'e2e-mock-access-token');
      localStorage.setItem('refresh_token', 'e2e-mock-refresh-token');
    });

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto('/system/user');
    await waitForApp(page);
    await page.waitForLoadState('networkidle');

    // 回归护栏:父路由的 redirect 曾让这里无限重定向,整页变成错误页
    await expect(page.getByText('页面出现错误')).toHaveCount(0);
    expect(pageErrors).toEqual([]);

    // 侧边栏来自后端菜单
    await expect(page.locator('.ant-menu').getByText('用户管理')).toBeVisible();

    // 表格渲染出后端返回的数据
    await expect(page.locator('.ant-table-tbody tr.ant-table-row')).toHaveCount(
      1,
    );
    await expect(page.getByText('admin').first()).toBeVisible();

    // 分页参数用后端约定的 page_no / page_size
    expect(listRequests.length).toBeGreaterThan(0);
    expect(listRequests[0]).toContain('page_no=1');
    expect(listRequests[0]).toContain('page_size=10');
  });
});
