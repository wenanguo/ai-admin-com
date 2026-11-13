import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import {
  PM_MILESTONE_PREFIX,
  PM_PROJECT_PREFIX,
  PM_TASK_PREFIX,
} from '../src/services/api/pm/paths';
import { gotoModulePage, setupModulePage } from './helpers';

/**
 * **任务工作台**（列表 / 看板 / 甘特三合一）的前端闭环,接口全部拦截。
 *
 * 覆盖三件事:
 * 1. **切视图零请求** —— 页面进入时取一次数,之后切列表/看板/甘特
 *    **一个请求都不该多发**（这是「切换太慢」的根因:以前每次切都重新取数）;
 * 2. **三个视图是同一份数据** —— 看板里拖一张卡改状态,切回列表,
 *    那一行的状态**已经变了**（以前两个页面互不相通）;
 * 3. **旧地址不失效** —— `/pm/task/board` 重定向到 `/pm/task?view=board`。
 */

const TASK_LIST_URL = `**/api/v1${PM_TASK_PREFIX}/list**`;
const TASK_UPDATE_URL = `**/api/v1${PM_TASK_PREFIX}/update/**`;
const PROJECT_LIST_URL = `**/api/v1${PM_PROJECT_PREFIX}/list**`;
const MILESTONE_LIST_URL = `**/api/v1${PM_MILESTONE_PREFIX}/list**`;
const dictDataUrl = (dictType: string) =>
  `**/api/v1/system/dict/data/info/${dictType}**`;
/**
 * 用户列表（列表页「负责人」下拉的远程搜索候选）。
 *
 * ⚠️ **不拦它就会 401** ⇒ 共享请求层「刷新 token ⇒ 还是 401」⇒ 全局登出
 *    ⇒ 页面跳到 /user/login ⇒ 后面所有断言超时。
 */
const USER_LIST_URL = '**/api/v1/system/user/list**';

/** 一张卡片的数据(形状对齐后端的 TaskOut) */
function taskRow(row: {
  id: number;
  title: string;
  status_code: string;
}): Record<string, unknown> {
  return {
    id: row.id,
    project_id: 1,
    milestone_id: null,
    parent_id: null,
    title: row.title,
    description: '需求评审通过后交付',
    type_code: 'feature',
    status_code: row.status_code,
    priority_code: 'P1',
    estimate_hours: 3,
    actual_hours: null,
    assignee_id: 1,
    reporter_id: 2,
    reviewers: null,
    labels: null,
    start_date: null,
    due_date: null,
    actual_start_date: null,
    actual_end_date: null,
    sort_order: 0,
    created_via_code: 'manual',
    blocked_reason: null,
    assignee_by: { id: 1, name: '张三', username: 'zhangsan' },
    reporter_by: { id: 2, name: '李四', username: 'lisi' },
    created_time: '2026-11-01 09:00:00',
    updated_time: '2026-11-04 09:00:00',
  };
}

/** 三条任务:分别在「待办」「进行中」「已完成」 */
const listResponse = {
  code: 0,
  msg: '查询成功',
  data: {
    items: [
      taskRow({ id: 31, title: '梳理需求清单', status_code: 'todo' }),
      taskRow({
        id: 32,
        title: '输出需求规格说明书',
        status_code: 'in_progress',
      }),
      taskRow({ id: 33, title: '初始化仓库', status_code: 'done' }),
    ],
    total: 3,
    page_no: 1,
    page_size: 100,
    has_next: false,
  },
  status_code: 200,
  success: true,
};

/** 任务状态字典(列标题 + 列表里的状态标签) */
const statusDictResponse = {
  code: 0,
  msg: '查询成功',
  data: [
    {
      dict_type: 'module_pm_task_status',
      dict_value: 'backlog',
      dict_label: '待规划',
    },
    {
      dict_type: 'module_pm_task_status',
      dict_value: 'todo',
      dict_label: '待办',
    },
    {
      dict_type: 'module_pm_task_status',
      dict_value: 'in_progress',
      dict_label: '进行中',
    },
    {
      dict_type: 'module_pm_task_status',
      dict_value: 'blocked',
      dict_label: '阻塞',
    },
    {
      dict_type: 'module_pm_task_status',
      dict_value: 'review',
      dict_label: '评审',
    },
    {
      dict_type: 'module_pm_task_status',
      dict_value: 'done',
      dict_label: '已完成',
    },
    {
      dict_type: 'module_pm_task_status',
      dict_value: 'cancelled',
      dict_label: '已取消',
    },
  ],
  status_code: 200,
  success: true,
};

/** 其余字典(类型/优先级/创建方式/项目字典……)给个空壳,别打到真实后端 */
const emptyDictResponse = {
  code: 0,
  msg: '查询成功',
  data: [],
  status_code: 200,
  success: true,
};

/** PM 菜单树(「任务」是入口,看板不是菜单项) */
const taskMenu = {
  title: '任务管理',
  routePath: 'task',
  permission: 'module_pm_project:pm_task:query',
  buttons: [
    {
      title: '更新任务',
      permission: 'module_pm_project:pm_task:update',
    },
  ],
};

/**
 * 装好受控页面,并返回**任务列表请求的记录**。
 *
 * ⚠️ 请求计数是「切视图零请求」那条用例的尺子。
 */
async function setupWorkspace(page: Page): Promise<string[]> {
  const requests = await setupModulePage(page, {
    menus: [taskMenu],
    parent: { routePath: '/pm', title: '项目管理' },
    listUrl: TASK_LIST_URL,
    listBody: listResponse,
  });

  await page.route(PROJECT_LIST_URL, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        code: 0,
        msg: 'ok',
        data: {
          items: [{ id: 1, name: '核心项目' }],
          total: 1,
          page_no: 1,
          page_size: 100,
          has_next: false,
        },
        status_code: 200,
        success: true,
      }),
    }),
  );

  await page.route(MILESTONE_LIST_URL, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(emptyDictResponse),
    }),
  );

  /*
    字典:其余一律空壳(别打到真实后端 ⇒ 假 token 401 ⇒ 全局登出)。

    ⚠️ **顺序要紧**:Playwright 里**后注册的路由先匹配** ⇒ 兜底必须先注册,
    具体的「任务状态」字典后注册 ⇒ 它才能拿到真正的中文标签
    (状态列显示「待办」而不是线上码 `todo`)。
  */
  await page.route('**/api/v1/system/dict/data/info/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(emptyDictResponse),
    }),
  );

  await page.route(dictDataUrl('module_pm_task_status'), (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(statusDictResponse),
    }),
  );

  await page.route(USER_LIST_URL, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        code: 0,
        msg: 'ok',
        data: {
          items: [{ id: 1, name: '张三', username: 'zhangsan' }],
          total: 1,
          page_no: 1,
          page_size: 100,
          has_next: false,
        },
        status_code: 200,
        success: true,
      }),
    }),
  );

  // 更新接口(看板拖拽要写)
  await page.route(TASK_UPDATE_URL, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        code: 0,
        msg: 'ok',
        data: null,
        status_code: 200,
        success: true,
      }),
    }),
  );

  return requests;
}

/** 顶上的视图切换器(Segmented)里的某一项 */
function viewTab(page: Page, label: string) {
  return page.locator('.ant-segmented-item', { hasText: label }).first();
}

test.describe('任务工作台(列表/看板/甘特)', () => {
  test('切视图不重新取数：一个请求都不多发', async ({ page }) => {
    const requests = await setupWorkspace(page);

    await gotoModulePage(page, '/pm/task', page.getByText('任务管理'));

    // 首屏:取一次数
    await expect.poll(() => requests.length).toBeGreaterThan(0);
    const afterEnter = requests.length;

    // 切到看板
    await viewTab(page, '看板').click();
    await expect(page).toHaveURL(/\/pm\/task\?view=board$/);
    await expect(page.locator('[data-task-id="31"]')).toBeVisible();

    // 切到甘特
    await viewTab(page, '甘特').click();
    await expect(page).toHaveURL(/\/pm\/task\?view=gantt$/);

    // 切回列表
    await viewTab(page, '列表').click();
    await expect(page).toHaveURL(/\/pm\/task\?view=list$/);
    await expect(
      page.locator('.ant-table-tbody tr.ant-table-row').first(),
    ).toBeVisible();

    // ⚠️ **一个请求都不该多发**
    expect(requests.length).toBe(afterEnter);
  });

  test('三个视图是同一份数据：看板拖完状态，列表里那一行也变了', async ({
    page,
  }) => {
    await setupWorkspace(page);

    await gotoModulePage(page, '/pm/task', page.getByText('任务管理'));

    // 列表里 31 号任务的状态是「待办」
    const row31 = page.locator('tr.ant-table-row', { hasText: '梳理需求清单' });
    await expect(row31).toContainText('待办');

    // 切到看板,把它拖进「已完成」列
    await viewTab(page, '看板').click();
    const card = page.locator('[data-task-id="31"]');
    await expect(card).toBeVisible();
    await card.dragTo(page.locator('[data-column-head="done"]'));

    // 切回列表 ⇒ 同一份数据 ⇒ 状态已经变了
    await viewTab(page, '列表').click();
    const rowAfter = page.locator('tr.ant-table-row', {
      hasText: '梳理需求清单',
    });
    await expect(rowAfter).toContainText('已完成');
    await expect(rowAfter).not.toContainText('待办');
  });

  /**
   * **三个视图高度一致**（issue #9）。
   *
   * ⚠️ 以前看板列高只有 276px（内容区的三分之一）⇒ 三个视图切过去「塌一下」。
   * ⇒ 现在三个视图都用同一套高度口径（`useContentHeight`）⇒ 容器等高。
   */
  test('三个视图高度一致：都吃满内容区，内容区不出现外层滚动条', async ({
    page,
  }) => {
    await setupWorkspace(page);
    await page.goto('/');
    await page.waitForTimeout(1000);

    const heights: number[] = [];

    for (const view of ['list', 'board', 'gantt']) {
      await gotoModulePage(page, `/pm/task?view=${view}`);
      await page.waitForTimeout(2000);

      const measured = await page.evaluate(() => {
        const content = document.querySelector(
          '.ant-pro-layout-content',
        ) as HTMLElement | null;
        // 视图容器 = 内容区里那个带 flex-col 的 div
        const viewRoot = content?.querySelector(':scope > div > div');
        return {
          viewHeight: viewRoot
            ? Math.round(viewRoot.getBoundingClientRect().height)
            : 0,
          // 内容区自己滚不滚（0 = 不滚，页面不出现外层滚动条）
          overflow: content ? content.scrollHeight - content.clientHeight : -1,
        };
      });

      heights.push(measured.viewHeight);
      // 内容区不该有溢出（页面自己滚了）
      expect(measured.overflow).toBeLessThanOrEqual(1);
      expect(measured.viewHeight).toBeGreaterThan(400);
    }

    // 三个视图的容器高度应该一致（允许 1px 取整误差）
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(1);
  });

  /**
   * **载入中要有提示**（issue #9）。
   *
   * ⚠️ 列表视图的 `request` 是**同步的本地切片** ⇒ 数据集没回来时
   *    它立刻 resolve 空数组 ⇒ ProTable 以为「加载完了」⇒ 显示「暂无数据」
   *    ⇒ 用户看到「空列表 → 数据突然冒出来」。
   *
   * ⚠️ **断言放在接口拦截处**：那时页面已挂载、数据还没到 ⇒ 正是「载入中」的时刻。
   *    （在页面侧断言会抢时间：数据一回来，覆盖层就没了。）
   */
  test('列表视图载入时显示 loading，不是空列表', async ({ page }) => {
    await setupWorkspace(page);

    let gateSeen = false;
    await page.route(TASK_LIST_URL, async (route) => {
      gateSeen = true;
      const overlay = page.locator('[data-role="task-list-loading"]');
      // ⚠️ **直接量 box**，不用 toBeVisible：
      //    Playwright 的可见性判定在这里会误报（元素确实在、也有尺寸）。
      //    量 box 更直白：载入指示得真的占着地方，不是 0×0 的摆设。
      await expect(overlay).toBeAttached({ timeout: 5000 });
      const box = await overlay.evaluate((el) => {
        const rect = el.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      });
      expect(box.width, '载入指示要有宽度').toBeGreaterThan(0);
      expect(box.height, '载入指示要有高度').toBeGreaterThan(0);
      // 旋转的圈圈也得在（antd Spin）
      await expect(
        overlay.locator('.ant-spin-dot').first(),
        '载入指示里要有转圈',
      ).toBeAttached({ timeout: 5000 });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(listResponse),
      });
    });

    await page.goto('/');
    await page.waitForTimeout(1000);
    await gotoModulePage(page, '/pm/task?view=list');

    // 接口确实被拦到了（否则上面的断言根本没跑 ⇒ 假通过）
    await expect.poll(() => gateSeen).toBe(true);

    // 数据到位后 ⇒ 行出现
    // ⚠️ 不能用 .ant-table-tbody tr 的 first：那是 antd 的**隐藏测量行**
    await expect(
      page.locator('.ant-table-tbody tr.ant-table-row').first(),
    ).toBeVisible({
      timeout: 10_000,
    });
  });

  test('旧地址重定向到新界面', async ({ page }) => {
    await setupWorkspace(page);

    await gotoModulePage(page, '/pm/task/board', page.getByText('任务管理'));

    await expect(page).toHaveURL(/\/pm\/task\?view=board$/);
    await expect(page.locator('[data-task-id="31"]')).toBeVisible();
  });
});
