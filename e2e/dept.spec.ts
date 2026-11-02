import { expect, test } from '@playwright/test';
import {
  assertPermissionGatedButton,
  businessErrorBody,
  gotoModulePage,
  type ModuleMenu,
  setupModulePage,
} from './helpers';

/**
 * 部门管理页的前端闭环(接口全部拦截,不需要真实账号)。
 *
 * 覆盖四件事:
 * - 树形表格渲染出两级部门;数据源是 `/system/dept/tree`(后端没有列表接口)
 * - RF1:后端业务错误(HTTP 500 + 信封)由请求层转成 BizError,弹的是后端的 msg
 * - RF3:后端返回空树时表格显示空状态,不白屏、不报错
 * - RF2:按钮级权限来自后端菜单树里的 type=3 节点(权限码是 module_system:dept:*)
 *
 * 菜单树 / 登录态 / 业务错误信封都由 ./helpers 提供 —— helpers 不认识任何具体模块。
 */

const DEPT_PAGE_PATH = '/system/dept';
const DEPT_TREE_URL = '**/api/v1/system/dept/tree**';

/** 部门管理的菜单树(route_path 是相对的 'dept',拼上父目录就是 /system/dept) */
function deptMenu(withButtons = true): ModuleMenu {
  return {
    title: '部门管理',
    routePath: 'dept',
    permission: 'module_system:dept:query',
    buttons: withButtons
      ? [
          { title: '新增部门', permission: 'module_system:dept:create' },
          { title: '编辑部门', permission: 'module_system:dept:update' },
          { title: '删除部门', permission: 'module_system:dept:delete' },
        ]
      : [],
  };
}

/** 侧边栏里的「部门管理」—— 应用就绪的内容信号(不用 networkidle) */
function menuItem(page: import('@playwright/test').Page) {
  return page.locator('.ant-menu').getByText('部门管理');
}

/** 两级部门树:总公司 → 研发部 */
const deptTreeResponse = {
  code: 0,
  msg: '查询部门树成功',
  data: [
    {
      id: 1,
      name: '总公司',
      code: 'hq',
      order: 1,
      leader: '张三',
      status: 0,
      created_time: '2026-06-21 17:56:33',
      children: [
        {
          id: 2,
          name: '研发部',
          code: 'rd',
          order: 1,
          leader: '李四',
          status: 0,
          created_time: '2026-06-21 17:56:33',
          children: [],
        },
      ],
    },
  ],
  status_code: 200,
  success: true,
};

/** RF3:后端返回空树 */
const emptyDeptTreeResponse = {
  code: 0,
  msg: '查询部门树成功',
  data: [],
  status_code: 200,
  success: true,
};

test.describe('部门管理页', () => {
  test('渲染部门树,数据源是 /system/dept/tree(不是 /list)', async ({
    page,
  }) => {
    const treeRequests = await setupModulePage(page, {
      menus: [deptMenu()],
      listUrl: DEPT_TREE_URL,
      listBody: deptTreeResponse,
    });

    await gotoModulePage(page, DEPT_PAGE_PATH, menuItem(page));

    // 侧边栏来自后端菜单
    await expect(menuItem(page)).toBeVisible();

    // 两级部门都渲染成表格行(有子部门的节点默认展开)
    await expect(page.locator('.ant-table-tbody tr.ant-table-row')).toHaveCount(
      2,
    );
    await expect(page.getByText('总公司')).toBeVisible();
    await expect(page.getByText('研发部')).toBeVisible();

    // 数据源是树接口,后端没有 /system/dept/list
    await expect.poll(() => treeRequests.length).toBeGreaterThan(0);
    expect(treeRequests[0]).toContain('/system/dept/tree');
    expect(treeRequests[0]).not.toContain('/system/dept/list');
  });

  test('搜索在前端做:关键字不过后端,过滤的是已加载的树', async ({ page }) => {
    const treeRequests = await setupModulePage(page, {
      menus: [deptMenu()],
      listUrl: DEPT_TREE_URL,
      listBody: deptTreeResponse,
    });

    await gotoModulePage(page, DEPT_PAGE_PATH, menuItem(page));
    await expect(page.getByText('研发部')).toBeVisible();

    const search = page.getByPlaceholder('搜索部门名称');
    await search.fill('不存在的部门');
    await search.press('Enter');

    // 前端过滤后没有命中的部门 ⇒ 表格显示空状态
    await expect(page.locator('.ant-empty')).toBeVisible();

    // 关键字**没有**发给后端(后端没有带关键字的树接口)
    await expect.poll(() => treeRequests.length).toBeGreaterThan(0);
    for (const url of treeRequests) {
      expect(url).not.toContain('keyword');
    }
  });

  test('业务错误(HTTP 500 + 信封)弹的是后端 msg(RF1)', async ({ page }) => {
    await setupModulePage(page, {
      menus: [deptMenu()],
      listUrl: DEPT_TREE_URL,
      listBody: businessErrorBody('部门编码已存在'),
      listStatus: 500,
    });

    await gotoModulePage(page, DEPT_PAGE_PATH, menuItem(page));

    // 请求层把信封转成 BizError,errorHandler 弹后端的 msg
    await expect(page.getByText('部门编码已存在')).toBeVisible();
    // 不是 axios 的原始报错文案
    await expect(
      page.getByText('Request failed with status code 500'),
    ).toHaveCount(0);
  });

  test('后端返回空树时表格显示空状态,不报错(RF3)', async ({ page }) => {
    await setupModulePage(page, {
      menus: [deptMenu()],
      listUrl: DEPT_TREE_URL,
      listBody: emptyDeptTreeResponse,
    });

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await gotoModulePage(page, DEPT_PAGE_PATH, menuItem(page));

    // 空状态,而不是白屏
    await expect(page.locator('.ant-empty')).toBeVisible();
    await expect(page.locator('.ant-table-tbody tr.ant-table-row')).toHaveCount(
      0,
    );

    // 没有落到错误页
    await expect(page.getByText('页面出现错误')).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  });

  test('菜单树里没有按钮节点时「新增」按钮禁用(RF2)', async ({ page }) => {
    await assertPermissionGatedButton(page, {
      buttonName: '新增',
      permission: 'module_system:dept:create',
      granted: false,
      menu: deptMenu(),
      path: DEPT_PAGE_PATH,
      listUrl: DEPT_TREE_URL,
      listBody: deptTreeResponse,
      ready: menuItem(page),
    });
  });

  test('菜单树里有按钮节点时「新增」按钮可用(RF2)', async ({ page }) => {
    await assertPermissionGatedButton(page, {
      buttonName: '新增',
      permission: 'module_system:dept:create',
      granted: true,
      menu: deptMenu(),
      path: DEPT_PAGE_PATH,
      listUrl: DEPT_TREE_URL,
      listBody: deptTreeResponse,
      ready: menuItem(page),
    });
  });
});
