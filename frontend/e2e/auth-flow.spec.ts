import { expect, test } from '@playwright/test';
import { waitForApp } from './helpers';

/**
 * 登录 / 退出 / 401 静默刷新 的前端闭环(接口全部拦截,不需要真实账号)。
 *
 * 这里断言的是**后端真实失败形态**:
 * 刷新 token 失败时后端抛 CustomException ⇒ HTTP 500 + 业务信封(code=-1),
 * 请求层把它转成 BizError —— BizError 上只有 info、没有 response,
 * 所以「刷新失败要登出」必须在源头判定,不能靠 error.response 判断。
 */

const envelope = (data: unknown, msg = 'ok') => ({
  code: 0,
  msg,
  data,
  status_code: 200,
  success: true,
});

const loginResult = {
  access_token: 'e2e-access-token',
  refresh_token: 'e2e-refresh-token',
  token_type: 'Bearer',
  expires_in: 43200,
  tenants: [],
  user_info: {},
};

const currentUser = {
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
};

/** 1x1 透明 PNG,只为让 <img> 有个可渲染的 src */
const BLANK_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

test.describe('登录与登录态', () => {
  test('登录 → 侧边栏 → 用户管理页 → 退出登录', async ({ page }) => {
    await page.route('**/api/v1/system/auth/captcha/get', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          envelope({
            enable: true,
            key: 'e2e-captcha-key',
            img_base: BLANK_PNG,
          }),
        ),
      }),
    );

    const loginRequests: { contentType: string; body: string }[] = [];
    await page.route('**/api/v1/system/auth/login', (route) => {
      const request = route.request();
      loginRequests.push({
        contentType: request.headers()['content-type'] ?? '',
        body: request.postData() ?? '',
      });
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(envelope(loginResult, '登录成功')),
      });
    });

    await page.route('**/api/v1/system/user/current/info', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(envelope(currentUser)),
      }),
    );

    await page.route('**/api/v1/system/user/list**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          envelope({
            items: [
              {
                id: 1,
                username: 'admin',
                name: '管理员',
                status: 0,
                created_time: '2026-06-21 17:56:33',
              },
            ],
            total: 1,
            page_no: 1,
            page_size: 10,
            has_next: false,
          }),
        ),
      }),
    );

    let logoutCalled = false;
    await page.route('**/api/v1/system/auth/logout', (route) => {
      logoutCalled = true;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(envelope(null, '退出成功')),
      });
    });

    // --- 登录 ---
    await page.goto('/user/login');
    await waitForApp(page);
    await page.getByPlaceholder('请输入用户名').fill('admin');
    await page.getByPlaceholder('请输入密码').fill('e2e-password');
    await page.getByPlaceholder('请输入验证码').fill('1234');
    await page.getByRole('button', { name: '登 录' }).click();

    // 登录接口必须是 form-urlencoded(后端用的是 OAuth2PasswordRequestForm)
    await expect.poll(() => loginRequests.length).toBeGreaterThan(0);
    expect(loginRequests[0].contentType).toContain(
      'application/x-www-form-urlencoded',
    );
    expect(loginRequests[0].body).toContain('username=admin');
    expect(loginRequests[0].body).toContain('captcha_key=e2e-captcha-key');

    // 登录后落到用户管理页(后端菜单里当前唯一注册了前端路由的页面)
    await expect(page).toHaveURL(/\/system\/user/);
    await expect(page.locator('.ant-menu').getByText('用户管理')).toBeVisible();
    await expect(page.locator('.ant-table-tbody tr.ant-table-row')).toHaveCount(
      1,
    );

    // --- 退出登录 ---
    // 后端没给头像(avatar 为 null),ProLayout 只渲染用户名的 span,不渲染 .ant-avatar
    await page.locator('.ant-pro-global-header').getByText('管理员').click();
    await page.getByText('退出登录').first().click();

    await expect.poll(() => logoutCalled).toBe(true);
    await expect(page).toHaveURL(/\/user\/login/);
    const token = await page.evaluate(() =>
      localStorage.getItem('access_token'),
    );
    expect(token).toBeNull();
  });

  test('401 刷新失败 → 清登录态并回登录页', async ({ page }) => {
    // 后端认证失败:HTTP 401 + 业务码 10401
    await page.route('**/api/v1/system/user/current/info', (route) =>
      route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 10401,
          msg: '认证失败,请登录后再试',
          data: null,
          status_code: 401,
          success: false,
        }),
      }),
    );

    let refreshCalled = false;
    // 后端刷新失败的真实形态:HTTP 500 + 业务信封(code=-1),不是 401
    await page.route('**/api/v1/system/auth/token/refresh', (route) => {
      refreshCalled = true;
      return route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          code: -1,
          msg: '会话已过期，请重新登录',
          data: null,
          status_code: 500,
          success: false,
        }),
      });
    });

    await page.addInitScript(() => {
      localStorage.setItem('remember_me', 'true');
      localStorage.setItem('access_token', 'e2e-access-token');
      localStorage.setItem('refresh_token', 'e2e-refresh-token');
    });

    await page.goto('/system/user');
    await waitForApp(page);

    // 先静默刷新,刷新失败才登出
    await expect.poll(() => refreshCalled).toBe(true);
    await expect(page).toHaveURL(/\/user\/login/);

    const tokens = await page.evaluate(() => ({
      access: localStorage.getItem('access_token'),
      refresh: localStorage.getItem('refresh_token'),
    }));
    expect(tokens.access).toBeNull();
    expect(tokens.refresh).toBeNull();
  });
});
