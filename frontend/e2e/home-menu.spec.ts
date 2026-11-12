/**
 * 后端菜单里的**「首页」**项 ⇒ 侧边栏能看见 ⇒ 点进去是能出图的看板。
 *
 * ## 这条用例钉的是什么
 *
 * 后端 `platform_menu` 里有一个**顶层**菜单项「首页」：
 * `route_path = /app/home`、`component_path = null`、`hidden = false`。
 *
 * ⚠️ 菜单适配器的规则是「菜单(type=2)的路径必须已在前端路由表里注册，
 *    否则**整条跳过**并告警」⇒
 *    前端**没有** `/app/home` 这条路由时，「首页」这个菜单项
 *    就**根本不会出现**在侧边栏（用户侧看到的就是「菜单里有首页，界面上没有」）。
 *
 * ⇒ 前端注册了 `/app/home`（挂看板页）⇒ 菜单项出现、且点进去能出图。
 *
 * ## 为什么看板要改成演示数据
 *
 * 看板原来请求 `GET /api/fake_analysis_chart_data` —— 那个接口**只在 umi 的
 * mock 里存在**（开发模式）：
 * - `npm run dev`（连真后端、不开 mock）⇒ 404；
 * - 生产构建里没有 mock ⇒ 同样 404 ⇒ 打开就是「Not Found」。
 *
 * ⇒ 改成直接调本地函数 ⇒ 任何环境都能出图，**而且一个请求都不发**。
 */
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import type { MenuNode } from './helpers';
import { expandSider, seedAuthState, waitForApp } from './helpers';

const CURRENT_INFO_URL = '**/api/v1/system/user/current/info';

/**
 * 菜单树：**照后端 platform_menu 的真实行写**。
 *
 * ⚠️ 「首页」是**顶层**菜单项（`parent_id = null`、`type = 2`），
 *    路径 `/app/home`、`component_path` 为空 —— 这正是后端种的样子。
 */
const menuTree: MenuNode[] = [
  {
    id: 1,
    parent_id: null,
    name: '首页',
    type: 2,
    order: 1,
    route_path: '/app/home',
    title: '首页',
    permission: null,
    status: 0,
    hidden: false,
    children: null,
  },
];

function currentUserResponse(menus: MenuNode[]) {
  return {
    code: 0,
    msg: '成功',
    data: {
      id: 1,
      username: 'admin',
      name: '管理员',
      status: 0,
      is_superuser: true,
      role_ids: [],
      roles: [],
      menus,
    },
    status_code: 200,
    success: true,
  };
}

async function setupHomeMenu(page: Page): Promise<void> {
  await page.route(CURRENT_INFO_URL, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(currentUserResponse(menuTree)),
    }),
  );
  await seedAuthState(page);
}

test.describe('后端菜单里的「首页」', () => {
  test('侧边栏出现「首页」,点进去是能出图的看板', async ({ page }) => {
    await setupHomeMenu(page);

    /*
     * ⚠️ 只访问**不发请求**的页面。
     *
     * e2e 的预览服务器会把 `/api` **代理到真后端** ⇒ 假 token 拿到 401
     * ⇒ 全局请求层清登录态并跳登录页 ⇒ 侧边栏根本渲染不出来。
     * 看板页用演示数据、**一个请求都不发** ⇒ 正好适合。
     */
    await page.goto('/app/home');
    await waitForApp(page);

    // 看板用**演示数据**渲染 ⇒ 没有「Not Found」
    await expect(page.getByText('总销售额').first()).toBeVisible();
    await expect(page.getByText('Not Found')).toHaveCount(0);

    // ⚠️ 侧边栏出现「首页」
    //    （菜单**默认是收缩的** ⇒ 菜单项的文字看不见 ⇒ 先展开）
    await expandSider(page);
    const home = page.locator('.ant-menu a[href="/app/home"]');
    await expect(home).toBeVisible();
    // 它的标题就是后端下发的那个
    await expect(home).toHaveText('首页');
  });

  test('看板不发那个假接口的请求(它在生产构建里不存在)', async ({ page }) => {
    await setupHomeMenu(page);

    const fakeRequests: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('fake_analysis_chart_data')) {
        fakeRequests.push(request.url());
      }
    });

    await page.goto('/app/home');
    await waitForApp(page);
    await expect(page.getByText('总销售额').first()).toBeVisible();

    // ⚠️ 那个接口只在 umi 的 mock 里存在 ⇒ 走它就 404 ⇒ 现在**根本不发它**
    expect(fakeRequests).toEqual([]);
  });

  test('根路径(登录后的落点)就是它', async ({ page }) => {
    await setupHomeMenu(page);

    await page.goto('/');
    await waitForApp(page);

    await expect(page).toHaveURL(/\/app\/home/);
    await expect(page.getByText('总销售额').first()).toBeVisible();
  });
});
