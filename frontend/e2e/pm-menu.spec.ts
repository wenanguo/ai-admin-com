import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import {
  PM_PROJECT_PREFIX,
  PM_RISK_PREFIX,
} from '../src/services/api/pm/paths';
import type { MenuNode } from './helpers';
import { expandSider, seedAuthState, waitForApp } from './helpers';

/**
 * PM 侧边栏入口的端到端闭环:后端下发的**真实菜单路径** → 侧边栏 → 真实页面。
 *
 * 这条用例钉住的是**后端路径本身**:
 * 后端 `platform_menu` 里 PM 菜单的 route_path 是**插件的源码路径**
 * (`module_pm_project/pm_project` 这种,后端按插件目录自动生成),
 * 不是前端的 /pm/*。前端菜单适配器只保留「已在前端路由表注册过」的菜单路径
 * —— 之前这四条路径没注册,整块 PM 菜单在侧边栏里消失了。
 *
 * 所以夹具里的菜单树用的是**后端的真实形状**(而不是既有 spec 里
 * 「父目录 /pm + 相对路径」那种前端自己编的形状):
 * - 两个顶层目录(项目管理 / pm_risk),各自下面挂菜单
 * - 路径是**绝对**的插件源码路径
 * - 目录与它自己的第一个菜单**共用同一个路径**(后端就是这么种的)
 * - 目录标题是后端下发的名字(pm_risk 是英文组名,后端侧的命名问题)
 *
 * 断言三件事:
 * - 侧边栏出现后端下发的标题(项目管理 / 项目清单 / 任务 / 里程碑 / pm_risk / 风险)
 * - 菜单项的链接是**后端的路径**(不是前端自己编的 /pm/project)
 * - 点「项目清单」落到 /pm/project、点「风险」落到 /pm/risk(重定向解析到真实页面)
 */

const CURRENT_INFO_URL = '**/api/v1/system/user/current/info';
const PROJECT_LIST_URL = `**/api/v1${PM_PROJECT_PREFIX}/list**`;
const RISK_LIST_URL = `**/api/v1${PM_RISK_PREFIX}/list**`;
const USER_LIST_URL = '**/api/v1/system/user/list**';
/** 字典选项接口(各页的状态/优先级标签与下拉共用) */
const DICT_DATA_URL = '**/api/v1/system/dict/data/info/**';

/**
 * 后端 current/info 下发的 PM 菜单树(照后端 platform_menu 的真实行写)。
 *
 * id / parent_id / order / name / title 都用后端种子的真实值 ——
 * 这棵树不是前端自己编的,改它就等于改了「后端种了什么」的假设。
 *
 * ⚠️ 两处照抄后端的「不整齐」,别顺手改掉:
 * - 目录 339 的标题是中文「项目管理」,同源的 372/383/394 却还是英文
 *   (pm_risk / pm_meeting / pm_comment)—— 那是后端侧留下的命名问题
 * - order 大多是 9999(后端的「排最后」默认值),不是 1/2/3
 */
const pmMenuTree: MenuNode[] = [
  {
    // 目录「项目管理」(id=339,后端按插件目录 module_pm_project 自动生成,
    // 后来被人工改成了中文标题)
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
    children: [
      {
        // 菜单「项目清单」:与目录**共用**同一个路径
        id: 340,
        parent_id: 339,
        name: '项目清单',
        type: 2,
        order: 9999,
        route_path: '/module_pm_project/pm_project',
        title: '项目清单',
        permission: 'module_pm_project:pm_project:query',
        status: 0,
        hidden: false,
        children: null,
      },
      {
        id: 351,
        parent_id: 339,
        name: '任务',
        type: 2,
        order: 9999,
        route_path: '/module_pm_project/pm_task',
        title: '任务',
        permission: 'module_pm_project:pm_task:query',
        status: 0,
        hidden: false,
        children: null,
      },
      {
        id: 362,
        parent_id: 339,
        name: '里程碑',
        type: 2,
        order: 9999,
        route_path: '/module_pm_project/pm_milestone',
        title: '里程碑',
        permission: 'module_pm_project:pm_milestone:query',
        status: 0,
        hidden: false,
        children: null,
      },
    ],
  },
  {
    // 目录「pm_risk」:后端自动生成的英文组名(后端侧的命名问题,前端照原样显示)
    id: 372,
    parent_id: null,
    name: 'pm_risk',
    type: 1,
    order: 9999,
    route_path: '/module_pm_risk/pm_risk',
    title: 'pm_risk',
    permission: null,
    status: 0,
    hidden: false,
    children: [
      {
        // 菜单「风险」:与目录**共用**同一个路径
        id: 373,
        parent_id: 372,
        name: '风险',
        type: 2,
        order: 9999,
        route_path: '/module_pm_risk/pm_risk',
        title: '风险',
        permission: 'module_pm_risk:pm_risk:query',
        status: 0,
        hidden: false,
        children: null,
      },
    ],
  },
];

/** current/info 的成功信封 */
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
    menus: pmMenuTree,
  },
  status_code: 200,
  success: true,
};

/** 空列表的信封(页面要有着落,不然请求层会弹错误提示) */
const emptyListResponse = {
  code: 0,
  msg: '查询成功',
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

/** 空字典的信封(标签与下拉共用) */
const emptyDictResponse = {
  code: 0,
  msg: '查询成功',
  data: [],
  status_code: 200,
  success: true,
};

/** 装好受控页面:登录态 + 后端真实菜单树 + 页面要用的接口 */
async function setupPmMenu(page: Page): Promise<void> {
  await page.route(CURRENT_INFO_URL, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(currentUserResponse),
    }),
  );

  await page.route(PROJECT_LIST_URL, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(emptyListResponse),
    }),
  );

  await page.route(RISK_LIST_URL, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(emptyListResponse),
    }),
  );

  await page.route(USER_LIST_URL, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(emptyListResponse),
    }),
  );

  await page.route(DICT_DATA_URL, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(emptyDictResponse),
    }),
  );

  await seedAuthState(page);
}

/** 侧边栏 */
function siderMenu(page: Page) {
  return page.locator('.ant-menu');
}

/** 当前地址里的路径(去掉 query/hash) */
function currentPath(page: Page): string {
  return new URL(page.url()).pathname;
}

test.describe('PM 侧边栏菜单(后端真实路径)', () => {
  test('侧边栏按后端的路径显示 PM 菜单,点进去落到真实页面', async ({
    page,
  }) => {
    await setupPmMenu(page);

    // 从风险页进场(PM 的两个目录都没被展开:菜单路径与当前路由对不上,
    // ProLayout 不会自动展开任何一个目录)
    await page.goto('/pm/risk');
    await waitForApp(page);
    await expect(
      page.locator('.ant-table-thead').getByText('风险标题'),
    ).toBeVisible();

    // ⚠️ 菜单**默认是收缩的** ⇒ 菜单项的文字看不见 ⇒ 先展开
    await expandSider(page);
    const menu = siderMenu(page);

    // 两个顶层目录的标题都是后端下发的
    await expect(menu.getByText('项目管理', { exact: true })).toBeVisible();
    await expect(menu.getByText('pm_risk', { exact: true })).toBeVisible();

    // 展开「项目管理」,三个菜单项露出来
    await menu.getByText('项目管理', { exact: true }).click();
    await expect(menu.getByText('项目清单', { exact: true })).toBeVisible();
    await expect(menu.getByText('任务', { exact: true })).toBeVisible();
    await expect(menu.getByText('里程碑', { exact: true })).toBeVisible();

    /*
      菜单项的链接指向**最终会去的那个地址**（/pm/project），不是后端下发的
      源码路径（/module_pm_project/pm_project）。

      ⚠️ 为什么：ProLayout 用**当前地址**去匹配菜单项 ⇒ 若菜单链接的是
      「重定向的起点」，点完地址变了就匹配不上 ⇒ **菜单组自动折叠、
      菜单项也不高亮**（看着像刷新了一遍）。
      ⇒ 链接与落地地址一致 ⇒ 匹配得上 ⇒ 组保持展开、项保持高亮。

      ⚠️ 后端下发的路径**仍然注册了路由**（重定向到同一个页面），
      所以直接访问 /module_pm_project/pm_task 也照样能进。
    */
    await expect(menu.locator('a[href="/pm/project"]')).toContainText(
      '项目清单',
    );
    await expect(menu.locator('a[href="/pm/task"]')).toContainText('任务');
    await expect(menu.locator('a[href="/pm/milestone"]')).toContainText(
      '里程碑',
    );

    // 点「项目清单」⇒ 直接落到真实页面 /pm/project
    await menu.getByText('项目清单', { exact: true }).click();
    await expect.poll(() => currentPath(page)).toBe('/pm/project');
    await expect(
      page.locator('.ant-table-thead').getByText('项目名称'),
    ).toBeVisible();

    // 「pm_risk」目录里的「风险」→ /pm/risk
    await menu.getByText('pm_risk', { exact: true }).click();
    await expect(menu.getByText('风险', { exact: true })).toBeVisible();
    await expect(menu.locator('a[href="/pm/risk"]')).toContainText('风险');

    await menu.getByText('风险', { exact: true }).click();
    await expect.poll(() => currentPath(page)).toBe('/pm/risk');
    await expect(
      page.locator('.ant-table-thead').getByText('风险标题'),
    ).toBeVisible();
  });
});
