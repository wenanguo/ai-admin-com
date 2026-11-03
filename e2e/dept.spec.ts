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
 * 覆盖五件事:
 * - 树形表格渲染出两级部门;数据源是 `/system/dept/tree`(后端没有列表接口)
 * - RF1:后端业务错误(HTTP 500 + 信封)由请求层转成 BizError,弹的是后端的 msg
 * - RF3:后端返回空树时表格显示空状态,不白屏、不报错
 * - RF2:按钮级权限来自后端菜单树里的 type=3 节点(权限码是 module_system:dept:*)
 * - 排序清空后提交体**不带** order 字段(后端 order 是必填 int,null 就是 422)
 *
 * 菜单树 / 登录态 / 业务错误信封都由 ./helpers 提供 —— helpers 不认识任何具体模块。
 */

const DEPT_PAGE_PATH = '/system/dept';
const DEPT_TREE_URL = '**/api/v1/system/dept/tree**';
/**
 * 更宽的 glob:**任何**部门接口都会被捕获。
 *
 * 用它来断言「后端没有 /system/dept/list」—— 只拦 tree 的话,
 * 就算前端真的发了 /list 也捕获不到,断言就是空的(永远不会失败)。
 */
const DEPT_ANY_URL = '**/api/v1/system/dept/**';

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

/**
 * 12 个根部门(超过默认每页 10 条)—— 用来钉住「树形表格不分页」。
 *
 * antd 的分页是按**顶层数组**切片的:根部门超过 10 个时,第 11、12 个
 * 会被切到第二页 —— 分页器只数根部门,却把整棵树都渲染出来。
 */
const manyRootsResponse = {
  code: 0,
  msg: '查询部门树成功',
  data: Array.from({ length: 12 }, (_, index) => ({
    id: 100 + index,
    name: `部门${index + 1}`,
    code: `dept${index + 1}`,
    order: index + 1,
    leader: '',
    status: 0,
    created_time: '2026-06-21 17:56:33',
    children: [],
  })),
  status_code: 200,
  success: true,
};

test.describe('部门管理页', () => {
  test('渲染部门树,数据源是 /system/dept/tree(不是 /list)', async ({
    page,
  }) => {
    // 拦**所有**部门接口,这样「没有 /list」这条断言才可能失败
    const deptRequests = await setupModulePage(page, {
      menus: [deptMenu()],
      listUrl: DEPT_ANY_URL,
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

    // 捕获机制有效:确实抓到了部门接口的请求
    await expect.poll(() => deptRequests.length).toBeGreaterThan(0);
    expect(deptRequests[0]).toContain('/system/dept/tree');

    // 数据源是树接口,后端没有 /system/dept/list
    // (对**所有**捕获到的部门接口断言,不是只看第一条)
    expect(deptRequests.filter((url) => url.includes('/list'))).toEqual([]);
  });

  test('搜索在前端做:关键字不过后端,过滤的是已加载的树', async ({ page }) => {
    const deptRequests = await setupModulePage(page, {
      menus: [deptMenu()],
      listUrl: DEPT_ANY_URL,
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
    await expect.poll(() => deptRequests.length).toBeGreaterThan(0);
    for (const url of deptRequests) {
      expect(url).not.toContain('keyword');
    }
  });

  test('根部门超过一页大小时也全部可达(树形表格不分页)', async ({ page }) => {
    await setupModulePage(page, {
      menus: [deptMenu()],
      listUrl: DEPT_ANY_URL,
      listBody: manyRootsResponse,
    });

    await gotoModulePage(page, DEPT_PAGE_PATH, menuItem(page));

    // 12 个根部门全部渲染出来(分页的话第 11、12 个会被切到第二页)
    await expect(page.locator('.ant-table-tbody tr.ant-table-row')).toHaveCount(
      12,
    );
    await expect(page.getByText('部门12')).toBeVisible();

    // 页面上没有分页控件(树是一个整体数据集)
    await expect(page.locator('.ant-pagination')).toHaveCount(0);
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

  test('排序清空后提交体不带 order 字段(后端 order 是必填 int)', async ({
    page,
  }) => {
    const createRequests: { body: unknown }[] = [];

    await page.route('**/api/v1/system/dept/create**', async (route) => {
      createRequests.push({ body: route.request().postDataJSON() });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 0,
          msg: '创建部门成功',
          data: null,
          status_code: 200,
          success: true,
        }),
      });
    });

    await setupModulePage(page, {
      menus: [deptMenu()],
      listUrl: DEPT_TREE_URL,
      listBody: deptTreeResponse,
    });

    await gotoModulePage(page, DEPT_PAGE_PATH, menuItem(page));

    await page.getByRole('button', { name: '新增' }).click();

    await expect(page.locator('.ant-modal')).toBeVisible();

    // 必填项:部门名称 + 部门编码
    await page
      .locator('.ant-modal .ant-form-item', { hasText: '部门名称' })
      .locator('input')
      .fill('测试部');
    await page
      .locator('.ant-modal .ant-form-item', { hasText: '部门编码' })
      .locator('input')
      .fill('qa');

    // 排序:填一个再清空 —— InputNumber 清空后表单值是 null
    const orderInput = page
      .locator('.ant-modal .ant-form-item', { hasText: '排序' })
      .locator('input');
    await orderInput.fill('2');
    await orderInput.fill('');

    await page.locator('.ant-modal-footer button.ant-btn-primary').click();

    await expect.poll(() => createRequests.length).toBe(1);
    // ⚠️ 空排序不带 order 字段(不是 order: null):后端 DeptCreateSchema.order
    //    是必填 int,传 null 就是 422;不带它走后端默认值 1
    expect(createRequests[0].body).toMatchObject({
      name: '测试部',
      code: 'qa',
    });
    expect(createRequests[0].body).not.toHaveProperty('order');
  });
});
