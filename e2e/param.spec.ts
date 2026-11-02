import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import {
  businessErrorBody,
  gotoModulePage,
  type ModuleMenu,
  setupModulePage,
} from './helpers';

/**
 * 参数管理页的前端闭环(接口全部拦截,不需要真实账号)。
 *
 * 覆盖五件事:
 * - 列表渲染 + 分页参数用后端约定的 page_no / page_size
 * - RF1:后端业务错误(HTTP 500 + 信封)由请求层转成 BizError,弹的是后端的 msg
 * - RF3:后端返回空列表时表格显示空状态,不白屏、不报错
 * - 按钮级权限来自后端菜单树里的 type=3 节点(权限码是 module_system:param:*)
 * - config_key 是唯一键,编辑弹窗里不可改;新增时按后端正则做前端校验
 *
 * 菜单树 / 登录态 / 业务错误信封都由 ./helpers 提供 —— helpers 不认识任何具体模块,
 * 下一个模块的 spec 直接复用,不用再抄一遍夹具。
 */

const PARAM_PAGE_PATH = '/system/param';
const PARAM_LIST_URL = '**/api/v1/system/param/list**';

/**
 * 参数管理的菜单树。
 *
 * 参数管理挂在「系统管理」目录下,route_path 是相对的 'param',
 * 后端适配器会把它拼成 /system/param —— 必须与前端路由表一致
 * (前端路由是单数 /system/param,目录才是复数 module_system/params)。
 * 按钮节点(type=3)由用例决定带不带。
 */
function paramMenu(
  withCreateButton: boolean,
  withEditButton: boolean,
): ModuleMenu {
  return {
    title: '参数管理',
    routePath: 'param',
    permission: 'module_system:param:query',
    buttons: [
      ...(withCreateButton
        ? [{ title: '新增参数', permission: 'module_system:param:create' }]
        : []),
      ...(withEditButton
        ? [{ title: '编辑参数', permission: 'module_system:param:update' }]
        : []),
    ],
  };
}

/** 侧边栏里的「参数管理」—— 应用就绪的内容信号(不用 networkidle) */
function menuItem(page: Page) {
  return page.locator('.ant-menu').getByText('参数管理');
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

test.describe('参数管理页', () => {
  test('渲染后端菜单与参数列表,分页参数用 page_no / page_size', async ({
    page,
  }) => {
    const listRequests = await setupModulePage(page, {
      menus: [paramMenu(true, true)],
      listUrl: PARAM_LIST_URL,
      listBody: paramListResponse,
    });

    await gotoModulePage(page, PARAM_PAGE_PATH, menuItem(page));

    // 侧边栏来自后端菜单
    await expect(menuItem(page)).toBeVisible();

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
    await expect.poll(() => listRequests.length).toBeGreaterThan(0);
    expect(listRequests[0]).toContain('page_no=1');
    expect(listRequests[0]).toContain('page_size=10');
  });

  test('业务错误(HTTP 500 + 信封)弹的是后端 msg(RF1)', async ({ page }) => {
    await setupModulePage(page, {
      menus: [paramMenu(true, true)],
      listUrl: PARAM_LIST_URL,
      listBody: businessErrorBody('参数键已存在'),
      listStatus: 500,
    });

    await gotoModulePage(page, PARAM_PAGE_PATH, menuItem(page));

    // 请求层把信封转成 BizError,errorHandler 弹后端的 msg
    await expect(page.getByText('参数键已存在')).toBeVisible();
    // 不是 axios 的原始报错文案
    await expect(
      page.getByText('Request failed with status code 500'),
    ).toHaveCount(0);
  });

  test('后端返回空列表时表格显示空状态,不报错(RF3)', async ({ page }) => {
    await setupModulePage(page, {
      menus: [paramMenu(true, true)],
      listUrl: PARAM_LIST_URL,
      listBody: emptyParamListResponse,
    });

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await gotoModulePage(page, PARAM_PAGE_PATH, menuItem(page));

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
    await setupModulePage(page, {
      menus: [paramMenu(false, true)],
      listUrl: PARAM_LIST_URL,
      listBody: paramListResponse,
    });

    await gotoModulePage(page, PARAM_PAGE_PATH, menuItem(page));

    await expect(page.getByRole('button', { name: '新增' })).toBeDisabled();
  });

  test('菜单树里有按钮节点时「新增」按钮可用', async ({ page }) => {
    await setupModulePage(page, {
      menus: [paramMenu(true, true)],
      listUrl: PARAM_LIST_URL,
      listBody: paramListResponse,
    });

    await gotoModulePage(page, PARAM_PAGE_PATH, menuItem(page));

    await expect(page.getByRole('button', { name: '新增' })).toBeEnabled();
  });

  test('编辑弹窗里参数键 disabled(config_key 是唯一键)', async ({ page }) => {
    await setupModulePage(page, {
      menus: [paramMenu(true, true)],
      listUrl: PARAM_LIST_URL,
      listBody: paramListResponse,
    });

    await gotoModulePage(page, PARAM_PAGE_PATH, menuItem(page));

    await page.getByRole('button', { name: '编辑' }).click();

    // 参数键在编辑模式下不可改
    const configKeyInput = page
      .locator('.ant-modal .ant-form-item', { hasText: '参数键' })
      .locator('input');
    await expect(configKeyInput).toBeDisabled();
    await expect(configKeyInput).toHaveValue('site.name');
  });

  test('新增时参数键不符合后端正则就被前端拦下,不发请求', async ({ page }) => {
    const createRequests: string[] = [];

    await page.route('**/api/v1/system/param/create**', (route) => {
      createRequests.push(route.request().url());
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 0,
          msg: '创建参数成功',
          data: null,
          status_code: 200,
          success: true,
        }),
      });
    });

    await setupModulePage(page, {
      menus: [paramMenu(true, true)],
      listUrl: PARAM_LIST_URL,
      listBody: paramListResponse,
    });

    await gotoModulePage(page, PARAM_PAGE_PATH, menuItem(page));

    await page.getByRole('button', { name: '新增' }).click();

    await page
      .locator('.ant-modal .ant-form-item', { hasText: '参数名称' })
      .locator('input')
      .fill('站点名称');
    await page
      .locator('.ant-modal .ant-form-item', { hasText: '参数键' })
      .locator('input')
      .fill('Site Name');

    await page.locator('.ant-modal-footer button.ant-btn-primary').click();

    // 后端的约束是 ^[a-z][a-z0-9_.-]*$:前端内联校验拦下,
    // 不落到请求层(否则会收到一个 422)
    await expect(
      page.getByText('小写字母开头，仅允许小写字母、数字、_ . -'),
    ).toBeVisible();
    expect(createRequests).toHaveLength(0);
  });

  test('编辑提交时把 disabled 的参数键原样带回(后端 update 必填)', async ({
    page,
  }) => {
    const updateRequests: { url: string; method: string; body: unknown }[] = [];

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

    await setupModulePage(page, {
      menus: [paramMenu(true, true)],
      listUrl: PARAM_LIST_URL,
      listBody: paramListResponse,
    });

    await gotoModulePage(page, PARAM_PAGE_PATH, menuItem(page));

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
