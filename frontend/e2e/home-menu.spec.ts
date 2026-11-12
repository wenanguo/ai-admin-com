/**
 * 侧边栏的**「首页」**项 ⇒ 点进去是能出图的看板。
 *
 * ## 这条用例钉的是什么
 *
 * 后端 `platform_menu` 里**确实有**一个叫「首页」的菜单行，但它的
 * `client` 是 **`app`** —— 那是**移动端 APP** 的首页
 * （描述写着「APP 移动端-首页」，`route_path = /app/home`）。
 *
 * ⚠️ Web 端的 `current/info` 只下发 `client = 'pc'` 的菜单
 *    ⇒ **Web 侧边栏里本来就没有「首页」**，前端注册多少路由都没用。
 *
 * ⇒ 所以「首页」这条菜单项由**前端自己加**（`buildHomeMenuItem`），
 *    排在侧边栏最上面，指向 `/app/home`（看板页）。
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

/** 一条**不含**「首页」的 Web 端菜单（= 后端 `client='pc'` 的真实样子）。 */
const pcMenuTree: MenuNode[] = [
  {
    id: 339,
    parent_id: null,
    name: '项目管理',
    type: 1,
    order: 1,
    route_path: '/module_pm_project/pm_project',
    title: '项目管理',
    permission: null,
    status: 0,
    hidden: false,
    children: [],
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

async function setupMenu(page: Page, menus: MenuNode[]): Promise<void> {
  await page.route(CURRENT_INFO_URL, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(currentUserResponse(menus)),
    }),
  );
  await seedAuthState(page);
}

test.describe('侧边栏的「首页」', () => {
  test('后端没下发首页时,前端自己加一条在最上面', async ({ page }) => {
    await setupMenu(page, pcMenuTree);

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
    await expect(home).toHaveText('首页');

    // ⚠️ 排在**最上面**（在「项目管理」之前）
    const titles = await page
      .locator('.ant-menu .ant-menu-item, .ant-menu .ant-menu-submenu-title')
      .allTextContents();
    expect(titles[0]?.trim()).toBe('首页');
  });

  test('后端若下发了一条首页,就不会出现两个', async ({ page }) => {
    await setupMenu(page, [
      {
        id: 9,
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
      ...pcMenuTree,
    ]);

    await page.goto('/app/home');
    await waitForApp(page);
    await expandSider(page);

    const homeCount = await page
      .locator('.ant-menu a[href="/app/home"]')
      .count();
    expect(homeCount).toBe(1);
  });

  test('看板不发那个假接口的请求(它在生产构建里不存在)', async ({ page }) => {
    await setupMenu(page, pcMenuTree);

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
    await setupMenu(page, pcMenuTree);

    await page.goto('/');
    await waitForApp(page);

    await expect(page).toHaveURL(/\/app\/home/);
    await expect(page.getByText('总销售额').first()).toBeVisible();
  });
});
