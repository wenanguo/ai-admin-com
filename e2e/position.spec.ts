import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import {
  businessErrorBody,
  gotoModulePage,
  type ModuleMenu,
  setupModulePage,
} from './helpers';

/**
 * 岗位管理页的前端闭环(接口全部拦截,不需要真实账号)。
 *
 * 覆盖三件事:
 * - 列表渲染 + 分页参数用后端约定的 page_no / page_size
 * - RF1:后端业务错误(HTTP 500 + 信封)由请求层转成 BizError,弹的是后端的 msg
 * - RF2:按钮级权限来自后端菜单树里的 type=3 节点 ——
 *   buildMenuItems 会把按钮节点从侧边栏剔掉,但 collectPermissions 会收进权限集合,
 *   所以「新增」按钮能不能点,取决于菜单树里有没有那条按钮节点。
 *
 * 菜单树 / 登录态 / 业务错误信封都由 ./helpers 提供 —— helpers 不认识任何具体模块,
 * 下一个模块的 spec 直接复用,不用再抄一遍夹具。
 */

const POSITION_PAGE_PATH = '/system/position';
const POSITION_LIST_URL = '**/api/v1/system/position/list**';

/**
 * 岗位管理的菜单树。
 *
 * 岗位管理挂在「系统管理」目录下,route_path 是相对的 'position',
 * 后端适配器会把它拼成 /system/position —— 必须与前端路由表一致。
 * 「新增岗位」按钮节点(type=3)由用例决定带不带。
 */
function positionMenu(withCreateButton: boolean): ModuleMenu {
  return {
    title: '岗位管理',
    routePath: 'position',
    permission: 'module_system:position:query',
    buttons: withCreateButton
      ? [{ title: '新增岗位', permission: 'module_system:position:create' }]
      : [],
  };
}

/** 侧边栏里的「岗位管理」—— 应用就绪的内容信号(不用 networkidle) */
function menuItem(page: Page) {
  return page.locator('.ant-menu').getByText('岗位管理');
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

test.describe('岗位管理页', () => {
  test('渲染后端菜单与岗位列表,分页参数用 page_no / page_size', async ({
    page,
  }) => {
    const listRequests = await setupModulePage(page, {
      menus: [positionMenu(true)],
      listUrl: POSITION_LIST_URL,
      listBody: positionListResponse,
    });

    await gotoModulePage(page, POSITION_PAGE_PATH, menuItem(page));

    // 侧边栏来自后端菜单
    await expect(menuItem(page)).toBeVisible();

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
    await expect.poll(() => listRequests.length).toBeGreaterThan(0);
    expect(listRequests[0]).toContain('page_no=1');
    expect(listRequests[0]).toContain('page_size=10');
  });

  test('业务错误(HTTP 500 + 信封)弹的是后端 msg', async ({ page }) => {
    await setupModulePage(page, {
      menus: [positionMenu(true)],
      listUrl: POSITION_LIST_URL,
      listBody: businessErrorBody('岗位名称已存在'),
      listStatus: 500,
    });

    await gotoModulePage(page, POSITION_PAGE_PATH, menuItem(page));

    // 请求层把信封转成 BizError,errorHandler 弹后端的 msg
    await expect(page.getByText('岗位名称已存在')).toBeVisible();
    // 不是 axios 的原始报错文案
    await expect(
      page.getByText('Request failed with status code 500'),
    ).toHaveCount(0);
  });

  test('菜单树里没有按钮节点时「新增」按钮禁用', async ({ page }) => {
    await setupModulePage(page, {
      menus: [positionMenu(false)],
      listUrl: POSITION_LIST_URL,
      listBody: positionListResponse,
    });

    await gotoModulePage(page, POSITION_PAGE_PATH, menuItem(page));

    await expect(page.getByRole('button', { name: '新增' })).toBeDisabled();
  });

  test('菜单树里有按钮节点时「新增」按钮可用', async ({ page }) => {
    await setupModulePage(page, {
      menus: [positionMenu(true)],
      listUrl: POSITION_LIST_URL,
      listBody: positionListResponse,
    });

    await gotoModulePage(page, POSITION_PAGE_PATH, menuItem(page));

    await expect(page.getByRole('button', { name: '新增' })).toBeEnabled();
  });
});
