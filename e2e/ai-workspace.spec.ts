/**
 * AI 工作台侧栏的端到端闭环。
 *
 * ## 拦的是哪个地址
 *
 * AI 服务（`D:/project/ai-admin-ai`）是**另一个源**（`localhost:3100`），
 * 但前端**不能**直接用 `/api/agent/...` —— 那条路径归 AiAdmin 的代理规则。
 * ⇒ 浏览器侧用独立前缀 **`/ai-api/`**（见 `config/proxy.ts`），
 * 于是浏览器真正请求的是 `/ai-api/api/agent/...`。
 *
 * 下面两个 pattern 都挂上（代理路径 + 绝对地址），
 * 这样无论构建时 `AI_API_BASE_URL` 是 `/ai-api` 还是绝对地址都能拦住。
 *
 * ## 三件事
 *
 * - 侧边栏出现「AI 工作台」（常驻右栏，**不是抽屉**）；
 * - `⌘B` / `Ctrl+B` 能折叠与展开（400px ⇄ 40px，主内容跟着收窄）；
 * - 输入一句话能出现助手回复（SSE 走完一轮，外加一张命令卡片）。
 */
import type { Page, Route } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { gotoModulePage, setupModulePage } from './helpers';

/** 挂一个受控页面（岗位管理）：菜单树 + 列表接口 + 登录态。 */
const PAGE_PATH = '/system/position';
const LIST_URL = '**/api/v1/system/position/list**';
const LIST_BODY = {
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

/** AI 服务的会话 id（假的）。 */
const CONVERSATION_ID = 'e2e-conversation';

/** e2e 里用户说的那句话。 */
const USER_TEXT =
  '在项目 PRJ-2026-Q3-001 下建一个任务，标题叫「侧栏冒烟」，优先级 P1';

/** 助手回复的正文。 */
const REPLY_TEXT =
  '好的，已在 PRJ-2026-Q3-001 下建好任务「侧栏冒烟」，优先级 P1。';

/** 睡一会儿（等 SSE 的第二轮：客户端重连要等 1 秒退避）。 */
function delay(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * 一轮对话的 SSE 帧（与服务端的格式一致：`event:` 行 + `data:` 行 + 空行）。
 *
 * ⚠️ **这里不带 `connected`** —— 原因见 `setupAiService` 里那段注释。
 */
function conversationFrames(): string {
  const frames: [string, unknown][] = [
    ['message_start', { role: 'assistant' }],
    ['text_delta', { conversationId: CONVERSATION_ID, delta: '好的，' }],
    ['text_delta', { conversationId: CONVERSATION_ID, delta: REPLY_TEXT }],
    [
      'tool_call',
      {
        toolName: 'create_task',
        args: {
          projectCode: 'PRJ-2026-Q3-001',
          title: '侧栏冒烟',
          priority: 'P1',
        },
      },
    ],
    [
      'tool_result',
      {
        toolName: 'create_task',
        status: 'ok',
        summary: '任务「侧栏冒烟」已创建',
      },
    ],
    ['message_end', { text: REPLY_TEXT }],
    ['agent_settled', {}],
  ];
  return frames
    .map(
      ([event, payload]) =>
        `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`,
    )
    .join('');
}

/**
 * 装上 AI 服务的假实现。
 *
 * @param page 页面。
 * @returns 收到的请求 URL（按顺序）。
 */
async function setupAiService(page: Page): Promise<string[]> {
  const requests: string[] = [];
  /** 命令真的发出去了（放行 SSE 的第二轮）。 */
  let commandSeen = false;
  let release: () => void = () => undefined;
  const commandGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  /** 这是第几次连事件流。 */
  let sseRound = 0;

  const handler = async (route: Route): Promise<void> => {
    const url = route.request().url();
    requests.push(url);
    const path = url.replace(/^https?:\/\/[^/]+/, '');

    const json = (data: unknown): void => {
      void route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ code: 0, msg: '成功', data }),
      });
    };

    // 新建会话
    if (path.endsWith('/api/agent/conversations')) {
      json({ conversationId: CONVERSATION_ID, title: '新对话' });
      return;
    }

    // 提交命令
    if (path.endsWith('/command')) {
      commandSeen = true;
      release();
      json({ id: 'cmd-e2e', type: 'prompt', success: true });
      return;
    }

    // 事件流（SSE）
    //
    // ⚠️ **分两轮发**是刻意的：
    // 客户端收到 `connected` 会去拉一次会话快照重建界面（快照才是真相），
    // 若把 `connected` 与这一轮的帧**放在同一次响应**里，快照会与帧赛跑 ——
    // 快照晚到就把刚渲染出来的这一轮整个覆盖掉（命令卡片尤其会丢）。
    // 真实服务端是「先连上、快照先回来、帧随后陆续到」，
    // 于是这里照抄那个时序：第一轮只发 `connected`，
    // 客户端退避 1 秒重连（第二轮）时才推这一轮的帧。
    if (path.endsWith('/events')) {
      sseRound += 1;
      if (sseRound === 1) {
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: `event: connected\ndata: ${JSON.stringify({
            conversationId: CONVERSATION_ID,
            isStreaming: false,
          })}\n\n`,
        });
        return;
      }
      // 第二轮：等命令真的发出去了，再推这一轮对话
      await Promise.race([commandGate, delay(5000)]);
      if (sseRound === 2 && commandSeen) {
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: conversationFrames(),
        });
        return;
      }
      // 之后的重连：什么都不发（客户端安静地重连，界面保持原样）
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: '',
      });
      return;
    }

    // 会话快照
    if (path.endsWith('/state')) {
      json({
        conversationId: CONVERSATION_ID,
        messages: commandSeen
          ? [
              { id: 'm1', role: 'USER', content: USER_TEXT },
              { id: 'm2', role: 'ASSISTANT', content: REPLY_TEXT },
            ]
          : [],
        isStreaming: false,
        model: 'e2e-model',
      });
      return;
    }

    // 审计 / 待确认（两个只读列表）
    if (path.endsWith('/api/audit')) {
      json({ total: 0, items: [] });
      return;
    }
    if (path.endsWith('/api/pending')) {
      json([]);
      return;
    }

    // 没认出来的路径：一律 404，不放行到别处
    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({
        code: 404,
        msg: 'e2e 未拦截的 AI 路径',
        data: null,
      }),
    });
  };

  await page.route('**/ai-api/api/**', handler);
  await page.route('http://localhost:3100/api/**', handler);
  return requests;
}

/** 侧边栏。 */
function sider(page: Page) {
  return page.getByTestId('ai-workspace-sider');
}

/** 侧边栏的宽度（折叠 ⇄ 展开）。 */
async function siderWidth(page: Page): Promise<number | undefined> {
  const box = await sider(page).boundingBox();
  return box?.width;
}

test.describe('AI 工作台侧栏', () => {
  test('侧边栏出现 AI 工作台,在主内容右边', async ({ page }) => {
    const requests = await setupAiService(page);
    await setupModulePage(page, {
      menus: [{ title: '岗位管理', routePath: 'position' }],
      listUrl: LIST_URL,
      listBody: LIST_BODY,
    });
    await gotoModulePage(
      page,
      PAGE_PATH,
      page.locator('.ant-menu').getByText('岗位管理'),
    );

    // 侧栏在工作台头部下面
    await expect(sider(page)).toBeVisible();
    await expect(sider(page).getByText('AI 工作台')).toBeVisible();
    await expect(sider(page).getByRole('tab', { name: '对话' })).toBeVisible();

    // 展开时 400px
    expect(await siderWidth(page)).toBe(400);

    // 在主内容**右边**（不是盖在主内容上面）
    const siderBox = await sider(page).boundingBox();
    const tableBox = await page.locator('.ant-table').first().boundingBox();
    expect(siderBox).not.toBeNull();
    expect(tableBox).not.toBeNull();
    expect(siderBox?.x).toBeGreaterThan(tableBox?.x ?? 0);

    // 请求走的是**独立前缀** `/ai-api/`（不能是 AiAdmin 的 `/api/`）
    expect(requests.length).toBeGreaterThan(0);
    for (const url of requests) {
      expect(url).toContain('/ai-api/api/agent/');
    }
  });

  test('⌘B 能折叠与展开,主内容跟着收窄', async ({ page }) => {
    await setupAiService(page);
    await setupModulePage(page, {
      menus: [{ title: '岗位管理', routePath: 'position' }],
      listUrl: LIST_URL,
      listBody: LIST_BODY,
    });
    await gotoModulePage(
      page,
      PAGE_PATH,
      page.locator('.ant-menu').getByText('岗位管理'),
    );

    await expect(sider(page)).toBeVisible();
    expect(await siderWidth(page)).toBe(400);

    // 折叠
    await page.keyboard.press('Control+b');
    await expect(page.getByTestId('ai-workspace-strip')).toBeVisible();
    await expect.poll(() => siderWidth(page)).toBe(40);

    // 展开
    await page.keyboard.press('Control+b');
    await expect.poll(() => siderWidth(page)).toBe(400);
  });

  test('输入一句话能出现助手回复', async ({ page }) => {
    const requests = await setupAiService(page);
    await setupModulePage(page, {
      menus: [{ title: '岗位管理', routePath: 'position' }],
      listUrl: LIST_URL,
      listBody: LIST_BODY,
    });
    await gotoModulePage(
      page,
      PAGE_PATH,
      page.locator('.ant-menu').getByText('岗位管理'),
    );

    await expect(sider(page)).toBeVisible();

    // 说一句话
    await page.getByPlaceholder('说点什么…').fill(USER_TEXT);
    // ⚠️ antd 会在两个汉字之间插一个空格 ⇒ 按钮的可访问名是「发 送」
    await page.getByRole('button', { name: /发\s*送/ }).click();

    // 用户自己的话先上屏（乐观上屏）
    await expect(page.locator('[data-role="user"]')).toContainText(
      'PRJ-2026-Q3-001',
    );

    // 助手回复（流式推来的）
    await expect(page.locator('[data-role="assistant"]').last()).toContainText(
      '已在 PRJ-2026-Q3-001 下建好任务',
    );

    // 命令卡片：命令名 + 状态
    await expect(sider(page).getByText('create_task')).toBeVisible();
    await expect(sider(page).getByText('已执行')).toBeVisible();

    // 命令真的发到了 AI 服务（走 /ai-api 前缀）
    expect(
      requests.some((url) =>
        url.endsWith(`/api/agent/${CONVERSATION_ID}/command`),
      ),
    ).toBe(true);
  });
});
