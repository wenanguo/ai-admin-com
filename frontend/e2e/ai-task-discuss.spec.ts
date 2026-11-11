/**
 * 「与 AI 讨论」的前端闭环（接口全部拦截，**不碰真实后端与 AI 服务**）。
 *
 * 覆盖这条链路：
 *
 * 1. 行内点「讨论」⇒ 右侧工作台出现**上下文条**（正在讨论 #21 …）；
 * 2. 发一句话 ⇒ **命令请求体里带着上下文**（任务 + 项目 + 里程碑）；
 * 3. 服务端推 `entity_updated` ⇒ **列表重新取数** + **目标行高亮**。
 *
 * ⚠️ 第 3 条是本用例的重点：写回之后，左边必须自己动起来，
 *    否则用户看到的是「AI 说改好了，我这边还是老样子」。
 */
import type { Page, Route } from '@playwright/test';
import { expect, test } from '@playwright/test';
import {
  PM_MILESTONE_PREFIX,
  PM_PROJECT_PREFIX,
  PM_TASK_PREFIX,
} from '../src/services/api/pm/paths';
import { gotoModulePage, setupModulePage, tableRows } from './helpers';

const TASK_PAGE_PATH = '/pm/task';
const TASK_LIST_URL = `**/api/v1${PM_TASK_PREFIX}/list**`;
const PROJECT_LIST_URL = `**/api/v1${PM_PROJECT_PREFIX}/list**`;
const MILESTONE_LIST_URL = `**/api/v1${PM_MILESTONE_PREFIX}/list**`;
const USER_LIST_URL = '**/api/v1/system/user/list**';
const dictDataUrl = (dictType: string) =>
  `**/api/v1/system/dict/data/info/${dictType}**`;

/** PM 菜单树里的任务菜单（与后端权限码一致）。 */
const taskMenu = {
  title: '任务管理',
  routePath: 'task',
  permission: 'module_pm_project:pm_task:query',
  buttons: [
    { title: '新增任务', permission: 'module_pm_project:pm_task:create' },
    { title: '编辑任务', permission: 'module_pm_project:pm_task:update' },
    { title: '删除任务', permission: 'module_pm_project:pm_task:delete' },
  ],
};

/** 列表里的那一行（形状对齐 TaskOut）。 */
const taskRow = {
  id: 21,
  project_id: 1,
  milestone_id: 11,
  parent_id: null,
  title: '输出需求规格说明书',
  description: '需求评审通过后交付',
  type_code: 'feature',
  status_code: 'in_progress',
  priority_code: 'P1',
  estimate_hours: 8,
  actual_hours: null,
  assignee_id: 1,
  reporter_id: 2,
  reviewers: null,
  labels: null,
  start_date: '2026-11-06',
  due_date: '2026-11-15',
  actual_start_date: '2026-11-06',
  actual_end_date: null,
  sort_order: 0,
  created_via_code: 'manual',
  blocked_reason: null,
  assignee_by: { id: 1, name: '张三', username: 'zhangsan' },
  reporter_by: { id: 2, name: '李四', username: 'lisi' },
  created_time: '2026-11-01 09:00:00',
  updated_time: '2026-11-06 09:00:00',
};

/** 任务列表信封。 */
function taskListResponse() {
  return {
    code: 0,
    msg: '查询任务列表成功',
    data: {
      items: [taskRow],
      total: 1,
      page_no: 1,
      page_size: 10,
      has_next: false,
    },
    status_code: 200,
    success: true,
  };
}

/** 字典信封（⚠️ `data` 是**数组**，与后端 `DictDataOut` 一致）。 */
function dictResponse(
  items: { dict_label: string; dict_value: string; list_class: string }[],
) {
  return {
    code: 0,
    msg: '查询成功',
    data: items.map((item, index) => ({
      id: index + 1,
      dict_sort: index + 1,
      dict_label: item.dict_label,
      dict_value: item.dict_value,
      dict_type: 'x',
      list_class: item.list_class,
      is_default: false,
      status: 0,
    })),
    status_code: 200,
    success: true,
  };
}

/** 装好受控页面：登录态 + 菜单树 + 任务列表 + 字典 + 侧载列表。 */
async function setupTaskPage(page: Page): Promise<{ listCalls: number[] }> {
  const listCalls: number[] = [];

  await setupModulePage(page, {
    menus: [taskMenu],
    parent: { routePath: '/pm', title: '项目管理' },
    listUrl: TASK_LIST_URL,
    listBody: taskListResponse(),
  });

  await page.route(TASK_LIST_URL, async (route) => {
    listCalls.push(Date.now());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(taskListResponse()),
    });
  });

  await page.route(PROJECT_LIST_URL, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        code: 0,
        msg: '成功',
        data: {
          items: [{ id: 1, name: '财务对账系统升级' }],
          total: 1,
          page_no: 1,
          page_size: 10,
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
      body: JSON.stringify({
        code: 0,
        msg: '成功',
        data: {
          items: [{ id: 11, name: 'M1 需求' }],
          total: 1,
          page_no: 1,
          page_size: 10,
        },
        status_code: 200,
        success: true,
      }),
    }),
  );

  await page.route(USER_LIST_URL, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        code: 0,
        msg: '成功',
        data: { items: [], total: 0, page_no: 1, page_size: 10 },
        status_code: 200,
        success: true,
      }),
    }),
  );

  const statusDict = dictResponse([
    { dict_label: '进行中', dict_value: 'in_progress', list_class: 'primary' },
    { dict_label: '已完成', dict_value: 'done', list_class: 'success' },
  ]);
  const typeDict = dictResponse([
    { dict_label: '功能', dict_value: 'feature', list_class: 'primary' },
  ]);
  const priorityDict = dictResponse([
    { dict_label: '高', dict_value: 'P1', list_class: 'warning' },
  ]);
  const createdViaDict = dictResponse([
    { dict_label: '手动', dict_value: 'manual', list_class: 'default' },
  ]);

  await page.route(dictDataUrl('module_pm_task_status'), (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(statusDict),
    }),
  );
  await page.route(dictDataUrl('module_pm_task_type'), (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(typeDict),
    }),
  );
  await page.route(dictDataUrl('module_pm_priority'), (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(priorityDict),
    }),
  );
  await page.route(dictDataUrl('module_pm_task_created_via'), (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(createdViaDict),
    }),
  );

  return { listCalls };
}

/** AI 服务的会话 id（假的）。 */
const CONVERSATION_ID = 'e2e-discuss-conversation';

/** 一帧 SSE（与服务端的格式一致）。 */
function frame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * 装上 AI 服务的假实现。
 *
 * @returns 命令请求体（发消息时带的那份 ⇒ 里面有上下文）。
 */
async function setupAiService(page: Page): Promise<{ commands: unknown[] }> {
  const commands: unknown[] = [];
  let commandSeen = false;
  let release: () => void = () => undefined;
  const commandGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let sseRound = 0;

  await page.route('**/ai-api/api/agent/**', async (route: Route) => {
    const url = route.request().url();
    const path = url.replace(/^https?:\/\/[^/]+/, '');

    const json = (data: unknown): void => {
      void route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ code: 0, msg: '成功', data }),
      });
    };

    if (path.endsWith('/api/agent/conversations')) {
      json({ conversationId: CONVERSATION_ID, title: '新对话' });
      return;
    }

    if (path.endsWith('/command')) {
      commands.push(route.request().postDataJSON());
      commandSeen = true;
      release();
      json({ id: 'cmd-e2e', type: 'prompt', success: true });
      return;
    }

    if (path.endsWith('/events')) {
      sseRound += 1;
      // 第一轮只发 `connected` ⇒ 客户端退避 1 秒重连（第二轮）
      if (sseRound === 1) {
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: frame('connected', {
            conversationId: CONVERSATION_ID,
            isStreaming: false,
          }),
        });
        return;
      }
      // 第二轮：**等命令真的发出去了**再推这一轮
      //    ⇒ 写回事件一定发生在「用户说了话」之后
      await commandGate;
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body:
          frame('connected', {
            conversationId: CONVERSATION_ID,
            isStreaming: false,
          }) +
          frame('message_start', { role: 'assistant' }) +
          frame('text_delta', {
            conversationId: CONVERSATION_ID,
            delta: '已回填：状态改为已完成，实际工时 8 小时。',
          }) +
          frame('message_end', {
            conversationId: CONVERSATION_ID,
            text: '已回填：状态改为已完成，实际工时 8 小时。',
          }) +
          // ⚠️ **写回成功** ⇒ 左边要刷新 + 高亮
          frame('entity_updated', {
            conversationId: CONVERSATION_ID,
            entityType: 'task',
            entityId: 21,
            fields: ['status_code', 'actual_hours'],
          }) +
          frame('agent_settled', {}),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '{}',
    });
  });

  await page.route('**/ai-api/api/pending', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ code: 0, msg: '成功', data: [] }),
    }),
  );

  return { commands };
}

test.describe('与 AI 讨论', () => {
  test('点「讨论」→ 带上下文发消息 → 写回后列表刷新并高亮', async ({
    page,
  }) => {
    const { listCalls } = await setupTaskPage(page);
    const { commands } = await setupAiService(page);

    await gotoModulePage(page, TASK_PAGE_PATH);
    await expect(page.getByText('输出需求规格说明书').first()).toBeVisible();
    // ⚠️ 等字典标签渲染出来（状态的中文名来自字典接口）
    //    ⇒ 上下文里才能带上「进行中（in_progress）」两样。
    await expect(page.getByText('进行中').first()).toBeVisible();

    // 1. 点行内的「讨论」
    const row = tableRows(page).first();
    await row.getByRole('button', { name: /讨论/ }).click();

    // 上下文条：说明 AI 现在聊的是哪一条
    // ⚠️ 它在**面板头部下面**（不是对话页签里）⇒ 切到哪个页签都看得到。
    const bar = page.locator('[data-testid="ai-context-bar"]');
    await expect(bar).toBeVisible();
    await expect(bar).toContainText('#21');
    await expect(bar).toContainText('输出需求规格说明书');
    // 项目与里程碑也要能看到（用户要确认“我聊的是哪条”）
    await expect(bar).toContainText('所属项目：财务对账系统升级');
    await expect(bar).toContainText('所属里程碑：M1 需求');
    // 状态：中文 + 线上码两样
    await expect(bar).toContainText('进行中（in_progress）');

    // 2. 发一句话 ⇒ 命令请求体里带着上下文
    const composer = page.getByPlaceholder('输入消息').first();
    await composer.click();
    await composer.fill('这条其实已经做完了，实际工时 8 小时。');
    await composer.press('Enter');

    await expect.poll(() => commands.length).toBeGreaterThan(0);
    const command = commands[0] as {
      message?: string;
      context?: {
        task?: { id?: number; title?: string };
        project?: { id?: number };
      };
    };
    expect(command.message).toContain('已经做完了');
    // ⚠️ 上下文是**前端组装的**（任务 + 项目 + 里程碑）
    expect(command.context?.task?.id).toBe(21);
    expect(command.context?.task?.title).toBe('输出需求规格说明书');
    expect(command.context?.project?.id).toBe(1);

    // 3. 写回成功 ⇒ 列表重新取数 + 目标行高亮
    await expect(page.locator('.pm-ai-updated-row')).toHaveCount(1, {
      timeout: 30_000,
    });
    // 列表确实被重新拉了一次（首屏那一次之外）
    expect(listCalls.length).toBeGreaterThan(1);
  });

  test('切到「待确认」页签 ⇒ 当前讨论条仍然在', async ({ page }) => {
    await setupTaskPage(page);
    await setupAiService(page);

    await gotoModulePage(page, TASK_PAGE_PATH);
    await expect(page.getByText('输出需求规格说明书').first()).toBeVisible();

    const row = tableRows(page).first();
    await row.getByRole('button', { name: /讨论/ }).click();

    const bar = page.locator('[data-testid="ai-context-bar"]');
    await expect(bar).toBeVisible();

    // ⚠️ 停在别的页签上时，**也要看得见**在聊哪条任务
    //    （之前它只在对话页签里 ⇒ 用户反馈「点了讨论，工作台一点反应都没有」）
    await page.getByRole('tab', { name: '待确认' }).click();
    await expect(bar).toBeVisible();
    await expect(bar).toContainText('输出需求规格说明书');
  });
});
