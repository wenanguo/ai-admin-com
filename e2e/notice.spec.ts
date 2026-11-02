import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import {
  assertPermissionGatedButton,
  businessErrorBody,
  gotoModulePage,
  type ModuleMenu,
  setupModulePage,
} from './helpers';

/**
 * 公告管理页的前端闭环(接口全部拦截,不需要真实账号)。
 *
 * 覆盖五件事:
 * - 列表渲染 + 分页参数用后端约定的 page_no / page_size
 * - RF1:后端业务错误(HTTP 500 + 信封)由请求层转成 BizError,弹的是后端的 msg
 * - RF3:后端返回空列表时表格显示空状态,不白屏、不报错
 * - 按钮级权限来自后端菜单树里的 type=3 节点(权限码是 module_system:notice:*)
 * - 公告类型是**受限枚举**:只有「通知」「公告」两个候选,
 *   且提交给后端的是线上的值 '1' / '2'(后端只认这两个),不是中文标签
 *
 * 菜单树 / 登录态 / 业务错误信封都由 ./helpers 提供 —— helpers 不认识任何具体模块,
 * 下一个模块的 spec 直接复用,不用再抄一遍夹具。
 */

const NOTICE_PAGE_PATH = '/system/notice';
const NOTICE_LIST_URL = '**/api/v1/system/notice/list**';

/**
 * 公告管理的菜单树。
 *
 * 公告管理挂在「系统管理」目录下,route_path 是相对的 'notice',
 * 后端适配器会把它拼成 /system/notice —— 必须与前端路由表一致。
 * 按钮节点(type=3)由用例决定带不带。
 */
function noticeMenu(
  withCreateButton = true,
  withEditButton = true,
  withDeleteButton = true,
): ModuleMenu {
  return {
    title: '公告管理',
    routePath: 'notice',
    permission: 'module_system:notice:query',
    buttons: [
      ...(withCreateButton
        ? [{ title: '新增公告', permission: 'module_system:notice:create' }]
        : []),
      ...(withEditButton
        ? [{ title: '编辑公告', permission: 'module_system:notice:update' }]
        : []),
      ...(withDeleteButton
        ? [{ title: '删除公告', permission: 'module_system:notice:delete' }]
        : []),
    ],
  };
}

/** 侧边栏里的「公告管理」—— 应用就绪的内容信号(不用 networkidle) */
function menuItem(page: Page) {
  return page.locator('.ant-menu').getByText('公告管理');
}

const noticeListResponse = {
  code: 0,
  msg: '查询公告列表成功',
  data: {
    items: [
      {
        id: 1,
        notice_title: '系统维护通知',
        // 后端返回的是**线上的值** '1'(通知)⇒ 表格里要渲染成中文标签
        notice_type: '1',
        notice_content: '<p>今晚 23:00 进行系统维护</p>',
        status: 0,
        description: '运维公告',
        created_time: '2026-11-02 17:56:33',
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
const emptyNoticeListResponse = {
  code: 0,
  msg: '查询公告列表成功',
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

test.describe('公告管理页', () => {
  test('渲染后端菜单与公告列表,分页参数用 page_no / page_size', async ({
    page,
  }) => {
    const listRequests = await setupModulePage(page, {
      menus: [noticeMenu()],
      listUrl: NOTICE_LIST_URL,
      listBody: noticeListResponse,
    });

    await gotoModulePage(page, NOTICE_PAGE_PATH, menuItem(page));

    // 侧边栏来自后端菜单
    await expect(menuItem(page)).toBeVisible();

    // 表格渲染出后端返回的数据
    await expect(page.locator('.ant-table-tbody tr.ant-table-row')).toHaveCount(
      1,
    );
    await expect(page.getByText('系统维护通知')).toBeVisible();

    // 列顺序:ID / 公告标题 / 公告类型 / 状态 / 创建时间
    const cells = page.locator('.ant-table-tbody tr.ant-table-row td');
    await expect(cells.nth(1)).toHaveText('系统维护通知');
    // 后端给的是 '1' ⇒ 表格渲染的是中文标签「通知」,不是原始的 '1'
    await expect(cells.nth(2)).toHaveText('通知');
    await expect(cells.nth(3)).toHaveText('正常');

    // 分页参数用后端约定的 page_no / page_size
    await expect.poll(() => listRequests.length).toBeGreaterThan(0);
    expect(listRequests[0]).toContain('page_no=1');
    expect(listRequests[0]).toContain('page_size=10');
  });

  test('业务错误(HTTP 500 + 信封)弹的是后端 msg(RF1)', async ({ page }) => {
    await setupModulePage(page, {
      menus: [noticeMenu()],
      listUrl: NOTICE_LIST_URL,
      listBody: businessErrorBody('公告标题已存在'),
      listStatus: 500,
    });

    await gotoModulePage(page, NOTICE_PAGE_PATH, menuItem(page));

    // 请求层把信封转成 BizError,errorHandler 弹后端的 msg
    await expect(page.getByText('公告标题已存在')).toBeVisible();
    // 不是 axios 的原始报错文案
    await expect(
      page.getByText('Request failed with status code 500'),
    ).toHaveCount(0);
  });

  test('后端返回空列表时表格显示空状态,不报错(RF3)', async ({ page }) => {
    await setupModulePage(page, {
      menus: [noticeMenu()],
      listUrl: NOTICE_LIST_URL,
      listBody: emptyNoticeListResponse,
    });

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await gotoModulePage(page, NOTICE_PAGE_PATH, menuItem(page));

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
    await assertPermissionGatedButton(page, {
      buttonName: '新增',
      permission: 'module_system:notice:create',
      granted: false,
      menu: noticeMenu(),
      path: NOTICE_PAGE_PATH,
      listUrl: NOTICE_LIST_URL,
      listBody: noticeListResponse,
      ready: menuItem(page),
    });
  });

  test('菜单树里有按钮节点时「新增」按钮可用', async ({ page }) => {
    await assertPermissionGatedButton(page, {
      buttonName: '新增',
      permission: 'module_system:notice:create',
      granted: true,
      menu: noticeMenu(),
      path: NOTICE_PAGE_PATH,
      listUrl: NOTICE_LIST_URL,
      listBody: noticeListResponse,
      ready: menuItem(page),
    });
  });

  test('公告类型只有通知/公告两个候选,提交的是线上的值 "1"', async ({
    page,
  }) => {
    const createRequests: { body: unknown }[] = [];

    await page.route('**/api/v1/system/notice/create**', async (route) => {
      createRequests.push({ body: route.request().postDataJSON() });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 0,
          msg: '创建公告成功',
          data: null,
          status_code: 200,
          success: true,
        }),
      });
    });

    await setupModulePage(page, {
      menus: [noticeMenu()],
      listUrl: NOTICE_LIST_URL,
      listBody: noticeListResponse,
    });

    await gotoModulePage(page, NOTICE_PAGE_PATH, menuItem(page));

    await page.getByRole('button', { name: '新增' }).click();

    const typeFormItem = page.locator('.ant-modal .ant-form-item', {
      hasText: '公告类型',
    });
    const typeInput = typeFormItem.locator('input[role="combobox"]');

    // 候选恰好是通知 / 公告 两个(后端只认 '1' / '2')
    await typeInput.click();
    const dropdown = page.locator('.ant-select-dropdown:visible');
    await expect(dropdown.locator('.ant-select-item-option')).toHaveText([
      '通知',
      '公告',
    ]);

    // 不是自由文本框:输入框只读,管理员填不了自定义值(填了后端必然 422)
    await expect(typeInput).toHaveJSProperty('readOnly', true);

    // 选中「通知」⇒ 表单里显示中文标签
    await dropdown
      .locator('.ant-select-item-option', { hasText: '通知' })
      .click();
    await expect(typeFormItem.locator('.ant-select-content')).toHaveText(
      '通知',
    );

    await page
      .locator('.ant-modal .ant-form-item', { hasText: '公告标题' })
      .locator('input')
      .fill('系统升级通知');

    await page.locator('.ant-modal-footer button.ant-btn-primary').click();

    // 提交出去的是**线上的值 '1'**,不是中文标签「通知」
    await expect.poll(() => createRequests.length).toBe(1);
    expect(createRequests[0].body).toMatchObject({
      notice_title: '系统升级通知',
      notice_type: '1',
    });
  });

  test('按公告类型筛选时提交的是线上的值 "1"', async ({ page }) => {
    const listRequests = await setupModulePage(page, {
      menus: [noticeMenu()],
      listUrl: NOTICE_LIST_URL,
      listBody: noticeListResponse,
    });

    await gotoModulePage(page, NOTICE_PAGE_PATH, menuItem(page));

    // 搜索栏的「公告类型」是同值的下拉(不是自由文本)
    const typeSearch = page
      .locator('.ant-form-item', { hasText: '公告类型' })
      .locator('input[role="combobox"]');
    await typeSearch.click();
    await page
      .locator('.ant-select-dropdown:visible .ant-select-item-option')
      .filter({ hasText: '通知' })
      .click();

    // ProTable 的搜索表单要点了「查询」才发请求
    await page.locator('.ant-pro-table-search button.ant-btn-primary').click();

    // 筛选条件提交的是线上的值 '1'
    await expect
      .poll(() => listRequests[listRequests.length - 1] ?? '')
      .toContain('notice_type=1');
  });

  test('新增公告时表单值原样提交到 create 接口', async ({ page }) => {
    const createRequests: { url: string; method: string; body: unknown }[] = [];

    await page.route('**/api/v1/system/notice/create**', async (route) => {
      const req = route.request();
      createRequests.push({
        url: req.url(),
        method: req.method(),
        body: req.postDataJSON(),
      });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 0,
          msg: '创建公告成功',
          data: null,
          status_code: 200,
          success: true,
        }),
      });
    });

    await setupModulePage(page, {
      menus: [noticeMenu()],
      listUrl: NOTICE_LIST_URL,
      listBody: noticeListResponse,
    });

    await gotoModulePage(page, NOTICE_PAGE_PATH, menuItem(page));

    await page.getByRole('button', { name: '新增' }).click();

    await page
      .locator('.ant-modal .ant-form-item', { hasText: '公告标题' })
      .locator('input')
      .fill('系统升级通知');

    const typeInput = page
      .locator('.ant-modal .ant-form-item', { hasText: '公告类型' })
      .locator('input[role="combobox"]');
    await typeInput.click();
    await page
      .locator('.ant-select-dropdown:visible .ant-select-item-option')
      .filter({ hasText: '公告' })
      .click();

    await page.locator('.ant-modal-footer button.ant-btn-primary').click();

    await expect.poll(() => createRequests.length).toBe(1);
    expect(createRequests[0].method).toBe('POST');
    expect(createRequests[0].url).toContain('/system/notice/create');
    expect(createRequests[0].body).toMatchObject({
      notice_title: '系统升级通知',
      notice_type: '2',
    });
  });
});
