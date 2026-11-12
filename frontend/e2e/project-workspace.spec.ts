import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import {
  gotoModulePage,
  mainContent,
  modalFormItem,
  tableRows,
  waitForApp,
} from './helpers';
import {
  CURRENT_INFO_URL,
  dictDataUrl,
  okResponse,
  PROJECT_CREATE_URL,
  PROJECT_DELETE_URL,
  PROJECT_LIST_URL,
  PROJECT_PAGE_PATH,
  PROJECT_UPDATE_URL,
  pmCurrentUserResponse,
  priorityDictResponse,
  statusDictResponse,
  USER_LIST_URL,
  userListResponse,
  visibilityDictResponse,
} from './pm-project-fixture';

/**
 * **项目工作台**（列表 / 卡片两个视图，一个页面）的守卫。
 *
 * ## 这组用例钉的是「两个视图是一份数据」这件事
 *
 * 以前项目清单只有一个表格；加了卡片视图之后，最容易出的岔子是
 * 「两个视图各取各的数」⇒ 切一次视图就重新拉一遍 ⇒ 「太慢」，
 * 而且两边看到的可能不是同一批项目。
 *
 * ⇒ 现在两个视图共用**同一份数据集**（react-query 缓存）⇒
 *   切视图**零请求**，两边永远是同一批项目。
 *
 * ## 六条用例
 *
 * 1. **切视图不重新取数** —— 一个请求都不多发；
 * 2. **两个视图是同一份数据** —— 卡片数 == 表格分页器上的总数；
 * 3. **视图状态在 URL 上** —— 刷新以后还是那个视图；
 * 4. **卡片上的机器人** —— 打开 AI 工作台并带上这个项目，且**不进详情页**；
 * 5. **项目太多（> 1000）** —— 显式提示只取到前 N 条（不静默）；
 * 6. **写操作之后切视图** —— 两边都是新数据。
 *
 * 外加两条：
 * 7. **分页在本地做** —— 25 条数据能翻到第 3 页，且翻页**不发请求**；
 * 8. **改完名字切视图** —— 卡片上也是新名字。
 */

/** 视图切换器（Segmented）里的某一项 */
function viewTab(page: Page, label: string) {
  return page.locator('.ant-segmented-item', { hasText: label }).first();
}

/** 项目卡片（`ProjectCardView` 给每张卡打了 `data-project-id`） */
function projectCards(page: Page) {
  return page.locator('[data-project-id]');
}

/** 一个项目行（形状对齐后端的 ProjectOut） */
function makeProject(id: number, name = `项目 ${id}`) {
  return {
    id,
    code: `PRJ-${String(id).padStart(3, '0')}`,
    name,
    description: 'v1 交付',
    owner_id: 1,
    template_id: null,
    status_code: 'planning',
    priority_code: 'P1',
    start_date: '2026-11-01',
    due_date: '2026-12-31',
    visibility_code: 'public',
    tags: '["财务","合规"]',
    extra_fields: null,
    owner_by: { id: 1, name: '张三', username: 'zhangsan' },
    created_time: '2026-11-01 09:00:00',
    updated_time: '2026-11-01 09:00:00',
  };
}

/** 假后端里那份项目的形状 */
type ProjectRow = ReturnType<typeof makeProject>;

/** 假后端的配置 */
type WorkspaceFixture = {
  /** 假后端**真的有的**项目条数 */
  count?: number;
  /**
   * 后端说的总数（默认 = `count`）。
   * 用来造「后端说 1200 条，但我们只取到 1000 条」⇒ 页面必须显式提示。
   */
  total?: number;
};

/** 装好受控页面后拿到的东西 */
type Workspace = {
  /** 项目列表请求的 URL（按顺序）—— 「切视图零请求」那条用例的尺子 */
  listRequests: string[];
  /** 假后端里那份**可变**的项目列表（写操作改它，GET 读它） */
  items: ProjectRow[];
};

/**
 * 装好受控页面：登录态 + 菜单树 + **会分页的**项目列表 + 三个字典 + 用户列表
 * + 写接口（改的是同一份可变列表）+ AI 服务的假实现。
 *
 * ⚠️ 列表接口是**按 `page_no` / `page_size` 真分页**的假后端，
 *    而不是固定返回一份 —— 这样「本地分页」那条用例才有意义
 *    （本地切片的前提正是「一次已经取全了」）。
 */
async function setupWorkspace(
  page: Page,
  fixture: WorkspaceFixture = {},
): Promise<Workspace> {
  const count = fixture.count ?? 3;
  const items: ProjectRow[] = Array.from({ length: count }, (_, index) =>
    makeProject(index + 1),
  );
  const total = fixture.total ?? items.length;
  const listRequests: string[] = [];

  await page.route(CURRENT_INFO_URL, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(pmCurrentUserResponse),
    }),
  );

  await page.route(PROJECT_LIST_URL, (route) => {
    const request = route.request();
    listRequests.push(request.url());
    const url = new URL(request.url());
    const pageNo = Number(url.searchParams.get('page_no') ?? '1');
    const pageSize = Number(url.searchParams.get('page_size') ?? '100');
    const start = (pageNo - 1) * pageSize;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        code: 0,
        msg: '查询成功',
        data: {
          items: items.slice(start, start + pageSize),
          total,
          page_no: pageNo,
          page_size: pageSize,
          has_next: start + pageSize < total,
        },
        status_code: 200,
        success: true,
      }),
    });
  });

  /*
    字典：先注册**兜底**的空壳，再注册具体的那几个。
    ⚠️ Playwright 里**后注册的路由先匹配** ⇒ 兜底必须先注册。
    （不拦字典就会打到真实后端 ⇒ 假 token 401 ⇒ 全局登出。）
  */
  await page.route('**/api/v1/system/dict/data/info/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ code: 0, msg: '查询成功', data: [] }),
    }),
  );
  for (const [dictType, body] of [
    ['module_pm_project_status', statusDictResponse],
    ['module_pm_priority', priorityDictResponse],
    ['module_pm_visibility', visibilityDictResponse],
  ] as const) {
    await page.route(dictDataUrl(dictType), (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(body),
      }),
    );
  }

  // 负责人下拉（列表页搜索项与编辑表单都会来取）
  await page.route(USER_LIST_URL, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(userListResponse),
    }),
  );

  /*
    写接口：**改的就是那份可变列表** ⇒ 改完再 GET 拿到的就是新数据。
    （后端更新是整对象 PUT ⇒ 这里整份替换。）
  */
  await page.route(PROJECT_UPDATE_URL, (route) => {
    const request = route.request();
    const id = Number(request.url().split('/update/')[1]);
    const body = request.postDataJSON() as Partial<ProjectRow>;
    const index = items.findIndex((item) => item.id === id);
    if (index >= 0) {
      items[index] = { ...items[index], ...body, id };
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(okResponse),
    });
  });
  await page.route(PROJECT_CREATE_URL, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(okResponse),
    }),
  );
  await page.route(PROJECT_DELETE_URL, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(okResponse),
    }),
  );

  // AI 服务：会话与事件流都要有，否则浮层打不开
  await page.route('**/ai-api/api/agent/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        code: 0,
        msg: '成功',
        data: { conversationId: 'c-project-card', title: '新对话' },
      }),
    }),
  );

  await page.addInitScript(() => {
    localStorage.setItem('remember_me', 'true');
    localStorage.setItem('access_token', 'e2e-mock-access-token');
    localStorage.setItem('refresh_token', 'e2e-mock-refresh-token');
  });

  return { listRequests, items };
}

/**
 * 表格分页器上的**总数**。
 *
 * ⚠️ 读的是「最后一个数字」而不是正则硬抠「共 N 条」——
 *    分页器的文案是「第 1-10 条/总共 25 条」，最后一个数字才是总数。
 */
async function paginationTotal(page: Page): Promise<number> {
  const text =
    (await page.locator('.ant-pagination-total-text').textContent()) ?? '';
  const numbers = text.match(/\d+/g) ?? [];
  return Number(numbers[numbers.length - 1]);
}

test.describe('项目工作台（列表 / 卡片）', () => {
  test('切视图不重新取数：一个请求都不多发', async ({ page }) => {
    const { listRequests } = await setupWorkspace(page, { count: 12 });

    await gotoModulePage(page, PROJECT_PAGE_PATH, tableRows(page).first());

    // 首屏：取一次数
    await expect.poll(() => listRequests.length).toBeGreaterThan(0);
    const afterEnter = listRequests.length;

    // 切到卡片
    await viewTab(page, '卡片').click();
    await expect(page).toHaveURL(/\/pm\/project\?view=card$/);
    await expect(projectCards(page)).toHaveCount(12);

    // 切回列表
    await viewTab(page, '列表').click();
    await expect(page).toHaveURL(/\/pm\/project\?view=list$/);
    await expect(tableRows(page).first()).toBeVisible();

    // ⚠️ **一个请求都不该多发**
    //    （两个视图的 queryKey 不一致 ⇒ 这里必红）
    expect(listRequests.length).toBe(afterEnter);
  });

  test('两个视图是同一份数据：卡片数 == 表格分页器上的总数', async ({
    page,
  }) => {
    await setupWorkspace(page, { count: 12 });

    await gotoModulePage(page, PROJECT_PAGE_PATH, tableRows(page).first());

    // 表格视图：分页器上的总数（表格**分页**，所以行数 != 总数）
    await expect(page.locator('.ant-pagination-total-text')).toBeVisible();
    const total = await paginationTotal(page);
    expect(total).toBe(12);

    // 切到卡片视图：卡片渲染的是**整个筛选结果集**
    await viewTab(page, '卡片').click();
    await expect(page).toHaveURL(/\/pm\/project\?view=card$/);
    await expect(projectCards(page)).toHaveCount(total);
  });

  test('视图状态在 URL 上：刷新以后还是卡片视图', async ({ page }) => {
    await setupWorkspace(page, { count: 3 });

    await gotoModulePage(
      page,
      `${PROJECT_PAGE_PATH}?view=card`,
      projectCards(page).first(),
    );

    // 渲染的是卡片，表格**不存在**
    await expect(projectCards(page)).toHaveCount(3);
    await expect(tableRows(page)).toHaveCount(0);

    await page.reload();
    await waitForApp(page);

    // ⚠️ 刷新以后仍然是卡片视图
    await expect(page).toHaveURL(/\/pm\/project\?view=card$/);
    await expect(projectCards(page)).toHaveCount(3);
    await expect(tableRows(page)).toHaveCount(0);
  });

  test('卡片上的机器人：打开 AI 工作台并带上这个项目，且不进详情页', async ({
    page,
  }) => {
    await setupWorkspace(page, { count: 3 });

    await gotoModulePage(page, PROJECT_PAGE_PATH, tableRows(page).first());

    await viewTab(page, '卡片').click();
    await expect(page).toHaveURL(/\/pm\/project\?view=card$/);

    // 点卡片标题旁的机器人
    await projectCards(page)
      .first()
      .locator('[data-role="ai-discuss-button"]')
      .click();

    // AI 工作台打开了，上下文是这个项目
    await expect(page.getByTestId('ai-workspace-panel')).toBeVisible();
    const bar = page.locator('[data-testid="ai-context-bar"]');
    await expect(bar).toBeVisible();
    await expect(bar).toContainText('正在讨论项目');
    await expect(bar).toContainText('项目 1');

    // ⚠️ **没有**导航到详情页（机器人是标题链接的兄弟，不是嵌在链接里）
    await expect(page).toHaveURL(/\/pm\/project\?view=card$/);
    expect(page.url()).not.toContain('/pm/project/');
  });

  test('项目太多（超过 1000 条）时显式提示只取到前 N 条', async ({ page }) => {
    // 后端说 1200 条，但数据集封顶 10 页 ⇒ 只取到 1000 条
    await setupWorkspace(page, { count: 1000, total: 1200 });

    await gotoModulePage(page, PROJECT_PAGE_PATH, tableRows(page).first());

    // ⚠️ **上限不静默**：页面上有一条提示，文案里带着后端说的总数
    //    （限定在**主内容区**里数 Alert —— AI 工作台的侧栏里也有自己的 Alert）
    const alert = mainContent(page).locator('.ant-alert');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText('1200');
    await expect(alert).toContainText('1000');
  });

  test('写操作之后切视图：两个视图都是新数据', async ({ page }) => {
    const { items } = await setupWorkspace(page, { count: 3 });

    await gotoModulePage(page, PROJECT_PAGE_PATH, tableRows(page).first());

    // 列表视图里把项目名改掉
    await page.getByRole('button', { name: '编辑' }).first().click();
    await expect(page.locator('.ant-modal')).toBeVisible();
    await modalFormItem(page, '项目名称').locator('input').fill('改名后的项目');
    await page.locator('.ant-modal-footer button.ant-btn-primary').click();
    await expect(page.locator('.ant-modal')).toBeHidden();

    // 假后端里名字真的改了（写操作 ⇒ 重新取数）
    await expect.poll(() => items[0]?.name).toBe('改名后的项目');

    // 表格里是新名字
    await expect(tableRows(page).first()).toContainText('改名后的项目');

    // 切到卡片视图 ⇒ 同一份数据 ⇒ 也是新名字
    await viewTab(page, '卡片').click();
    await expect(page).toHaveURL(/\/pm\/project\?view=card$/);
    await expect(projectCards(page).first()).toContainText('改名后的项目');
  });
});

test.describe('项目工作台的本地分页', () => {
  test('表格能翻到第 3 页，且翻页不发请求（分页在本地做）', async ({
    page,
  }) => {
    const { listRequests } = await setupWorkspace(page, { count: 25 });

    await gotoModulePage(page, PROJECT_PAGE_PATH, tableRows(page).first());

    // 首页 10 行，分页器上摆着总数
    await expect(tableRows(page)).toHaveCount(10);
    await expect(page.locator('.ant-pagination-total-text')).toBeVisible();
    expect(await paginationTotal(page)).toBe(25);

    const afterEnter = listRequests.length;

    // 翻到第 3 页 ⇒ 最后 5 条
    await page.locator('.ant-pagination-item-3').click();
    await expect(tableRows(page)).toHaveCount(5);
    await expect(tableRows(page).first()).toContainText('项目 21');

    // ⚠️ 翻页是**本地**切片 ⇒ 一个请求都不多发
    expect(listRequests.length).toBe(afterEnter);

    // 卡片视图渲染的是**整个结果集**（不分页）
    await viewTab(page, '卡片').click();
    await expect(projectCards(page)).toHaveCount(25);
  });
});
