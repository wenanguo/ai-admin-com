/**
 * AI 工作台浮层的端到端闭环。
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
 * - 右下角有个悬浮按钮，点开浮出 AI 工作台面板（**不是常驻右栏**）；
 * - `⌘B` / `Ctrl+B` 能开关面板，**主内容宽度不变**（浮层不占布局宽度）；
 * - 输入一句话能出现助手回复（SSE 走完一轮，外加一张命令卡片）。
 *
 * 外加一条**窄屏**用例：视口窄于 768px 时浮层占满整宽。
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
 * ⚠️ **这里不带 `connected`** —— `connected` 是「连上了」的意思，
 *    而这个假实现**每一轮连接都会发**（见 `setupAiService`）。
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

/** `connected` 帧（服务端**每次连接**都会先发它）。 */
function connectedFrame(): string {
  return `event: connected\ndata: ${JSON.stringify({
    conversationId: CONVERSATION_ID,
    isStreaming: false,
  })}\n\n`;
}

/**
 * 装上 AI 服务的假实现。
 *
 * @param page 页面。
 * @param options 假实现的时序开关。
 * @returns 收到的请求 URL（按顺序）。
 */
async function setupAiService(
  page: Page,
  options: { sse?: 'two-rounds' | 'replay' } = {},
): Promise<string[]> {
  const requests: string[] = [];
  /** 命令真的发出去了（放行 SSE 的第二轮）。 */
  let commandSeen = false;
  let release: () => void = () => undefined;
  const commandGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  /** 这是第几次连事件流。 */
  let sseRound = 0;
  /** 事件流的时序（缺省：分两轮；`replay` = 真实服务端的时序）。 */
  const sseMode = options.sse ?? 'two-rounds';

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
    // ⚠️ **分两轮发**是刻意的（为了让「输入一句话能出现助手回复」这条用例的
    //    时序确定）：
    //    第一轮只发 `connected`；客户端退避 1 秒重连（第二轮）时才推这一轮的帧。
    //
    // ⚠️ **真实服务端的时序不是这样**（服务端
    //    `src/app/api/agent/[conversationId]/events/route.ts`）：
    //    `write(connected)` → `for (const frame of snapshot) write(...)`
    //    ⇒ **同一个响应里**先发 `connected`，紧接着把整段历史（回放）写完；
    //    而且**每一次连接**都会重新发 `connected`（不是只有第一次）。
    //    那个时序由下面的「回放（真实时序）」用例组覆盖。
    if (path.endsWith('/events')) {
      sseRound += 1;
      // 真实时序：**每一次连接**都在同一个响应里发 `connected` + 整段回放。
      if (sseMode === 'replay') {
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: connectedFrame() + conversationFrames(),
        });
        return;
      }
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
        messages:
          sseMode === 'replay' || commandSeen
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

/** 浮层面板（点开才有）。 */
function panel(page: Page) {
  return page.getByTestId('ai-workspace-panel');
}

/** 右下角的悬浮按钮（面板关着时才有）。 */
function launcher(page: Page) {
  return page.getByTestId('ai-workspace-launcher');
}

/** 主内容那一列。 */
function content(page: Page) {
  return page.getByTestId('ai-workspace-content');
}

/** 浮层面板的宽度。 */
async function panelWidth(page: Page): Promise<number | undefined> {
  const box = await panel(page).boundingBox();
  return box?.width;
}

/**
 * 打开浮层面板（点右下角的悬浮按钮）。
 *
 * ⚠️ 面板**默认关着** ⇒ 每个要跟面板打交道的用例都得先开它。
 */
async function openPanel(page: Page): Promise<void> {
  const button = launcher(page);
  await expect(button).toBeVisible();
  await button.click();
  await expect(panel(page)).toBeVisible();
}

/**
 * 等布局**稳定**下来再量盒子。
 *
 * ⚠️ ProLayout 的左侧菜单在首屏之后还会自己展开一次（约 1 秒后），
 *    那一瞬间整页的宽度都会变 ⇒ 量之前必须等它稳下来，
 *    否则「主内容多宽了多少」会量到一个假的差值。
 */
async function waitForStableLayout(page: Page): Promise<void> {
  let previous = -1;
  await expect
    .poll(
      async () => {
        const width = (await content(page).boundingBox())?.width ?? -1;
        const stable = width === previous;
        previous = width;
        return stable;
      },
      { timeout: 15_000, intervals: [200, 200, 200, 200, 200, 200, 200, 200] },
    )
    .toBe(true);
}

test.describe('AI 工作台侧栏', () => {
  test('默认关着,右下角有个悬浮按钮;点开浮出 AI 工作台', async ({ page }) => {
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

    // **默认关着** ⇒ 面板不出现、不挡内容
    await expect(panel(page)).toHaveCount(0);
    await expect(launcher(page)).toBeVisible();

    await waitForStableLayout(page);

    // 关着的时候主内容是**满宽**的（左边只剩 ProLayout 自己的菜单）
    //
    // ⚠️ 不是 `viewport.width`：左边还有 ProLayout 的菜单（约 256px）。
    //    这里要证明的是「**没有**给 AI 工作台留位置」⇒
    //    差值不应达到 400px（浮层不占布局宽度）。
    const contentClosed = await content(page).boundingBox();
    const viewport = page.viewportSize();
    if (!contentClosed || !viewport) {
      throw new Error('主内容或视口没有布局盒');
    }
    expect(viewport.width - contentClosed.width).toBeLessThan(400);

    // 点开 ⇒ 浮层出现，按钮消失
    await openPanel(page);
    await expect(panel(page).getByText('AI 工作台')).toBeVisible();
    await expect(panel(page).getByRole('tab', { name: '对话' })).toBeVisible();
    await expect(launcher(page)).toHaveCount(0);

    // ⚠️ **浮层不占布局宽度** ⇒ 主内容宽度**不变**
    //    （这是「不再被挤掉 400px」的关键）
    const contentOpen = await content(page).boundingBox();
    if (!contentOpen) {
      throw new Error('主内容没有布局盒');
    }
    expect(contentOpen.width).toBeCloseTo(contentClosed.width, 0);

    // ⚠️ 浮层**盖在**内容上面（不是坐在内容右边）
    const panelBox = await panel(page).boundingBox();
    const tableBox = await page.locator('.ant-table').first().boundingBox();
    if (!panelBox || !tableBox) {
      throw new Error('浮层或表格没有布局盒');
    }
    expect(panelBox.x + panelBox.width).toBeCloseTo(viewport.width, 0);
    // 表格的右边缘**伸到**浮层底下（⇒ 被盖住）
    expect(tableBox.x + tableBox.width).toBeGreaterThan(panelBox.x);

    // 请求走的是**独立前缀** `/ai-api/`（不能是 AiAdmin 的 `/api/`）
    //
    // ⚠️ 若构建时 `AI_API_BASE_URL` 是绝对地址（`http://localhost:3100`），
    //    命中的就是第二条 pattern ⇒ 两种形态都算「走到了 AI 服务」，
    //    但**不能**是 AiAdmin 的 `/api/v1/...`。
    expect(requests.length).toBeGreaterThan(0);
    for (const url of requests) {
      expect(url).toMatch(/(\/ai-api)?\/api\/agent\//);
      expect(url).not.toContain('/api/v1/');
    }
  });

  test('⌘B 能开关面板,主内容宽度不变', async ({ page }) => {
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

    await waitForStableLayout(page);
    const contentBefore = await content(page).boundingBox();
    const tableBefore = await page.locator('.ant-table').first().boundingBox();
    if (!contentBefore || !tableBefore) {
      throw new Error('主内容 / 表格没有布局盒');
    }

    // ⌘B ⇒ **打开**浮层
    await page.keyboard.press('Control+b');
    await expect(panel(page)).toBeVisible();
    expect(await panelWidth(page)).toBe(400);

    // ⚠️ **主内容宽度不变**（浮层不占布局宽度 ⇒ 表格不再被挤掉 400px）
    const contentAfter = await content(page).boundingBox();
    const tableAfter = await page.locator('.ant-table').first().boundingBox();
    if (!contentAfter || !tableAfter) {
      throw new Error('主内容 / 表格没有布局盒');
    }
    expect(contentAfter.width).toBeCloseTo(contentBefore.width, 0);
    expect(tableAfter.width).toBeCloseTo(tableBefore.width, 0);

    // 再按一次 ⇒ **关掉**
    await page.keyboard.press('Control+b');
    await expect(panel(page)).toHaveCount(0);
    await expect(launcher(page)).toBeVisible();
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

    await openPanel(page);

    // 说一句话
    await page.getByPlaceholder('输入消息').fill(USER_TEXT);
    // ⚠️ antd 会在两个汉字之间插一个空格 ⇒ 按钮的可访问名是「发 送」
    // ⚠️ `exact: true`：输入区左下角那个「发送图片（暂未开放）」图标按钮
    //    的可访问名里也带「发送」⇒ 不加 exact 会命中两个元素。
    await page.getByRole('button', { name: /^发\s*送$/ }).click();

    // 用户自己的话先上屏（乐观上屏）
    await expect(page.locator('[data-role="user"]')).toContainText(
      'PRJ-2026-Q3-001',
    );

    // 助手回复（流式推来的）
    await expect(page.locator('[data-role="assistant"]').last()).toContainText(
      '已在 PRJ-2026-Q3-001 下建好任务',
    );

    // 命令卡片：命令名 + 状态
    await expect(panel(page).getByText('create_task')).toBeVisible();
    await expect(panel(page).getByText('已执行')).toBeVisible();

    // 命令真的发到了 AI 服务（走 /ai-api 前缀）
    expect(
      requests.some((url) =>
        url.endsWith(`/api/agent/${CONVERSATION_ID}/command`),
      ),
    ).toBe(true);
  });
});

/**
 * 一次采样：用户气泡数、助手气泡数、命令卡片数。
 */
async function sampleChat(page: Page): Promise<string> {
  const users = await page.locator('[data-role="user"]').count();
  const assistants = await page.locator('[data-role="assistant"]').count();
  const cards = await page.getByText('create_task').count();
  const sample = `${users}/${assistants}/${cards}`;
  return sample;
}

/**
 * 断言：**历史只渲染一遍**（用户一条 + 助手一条 + 命令卡片在）。
 *
 * ⚠️ **三个数必须在同一次采样里**：
 *    分开断言会各自等到「碰巧对上」的那一刻 —— 旧代码里命令卡片是
 *    **闪现**的（回放帧先上屏、快照后到把它盖掉）⇒ 分开断言会假绿。
 */
async function expectSingleHistory(page: Page): Promise<void> {
  await expect
    .poll(() => sampleChat(page), {
      timeout: 15_000,
      intervals: [200, 200, 200, 200],
    })
    .toBe('1/1/1');
}

/**
 * 装一个**分块**的 SSE 假实现（复现服务端回放的真实时序）。
 *
 * ## 为什么不能用 `route.fulfill`
 *
 * `route.fulfill` 一次性把整个 body 交出去 ⇒ 浏览器一次读完
 * ⇒ 所有帧在**同一条微任务链**里处理完 ⇒ 拉快照的那次网络往返
 * **不可能**落在回放中间 ⇒ 测不到「历史被渲染两遍」这个真问题。
 *
 * 真实服务端是 `write(connected)` → `for (...) write(...)`
 * ⇒ HTTP 分块传输 ⇒ 浏览器可能分几次读到
 * ⇒ 快照完全可能落在回放的**中间**（回放的尾巴随后才到）。
 *
 * @param page 页面。
 * @param chunks 依次写出的每一块。
 * @param gapMs 两块之间的间隔（毫秒）。
 */
async function installChunkedSse(
  page: Page,
  chunks: string[],
  gapMs: number,
): Promise<void> {
  await page.addInitScript(
    ({ parts, gap }: { parts: string[]; gap: number }) => {
      const urlOf = (input: RequestInfo | URL): string => {
        if (typeof input === 'string') {
          return input;
        }
        if (input instanceof URL) {
          return input.href;
        }
        return input.url;
      };
      const originalFetch = window.fetch.bind(window);
      window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = urlOf(input);
        if (!url.includes('/api/agent/') || !url.endsWith('/events')) {
          return originalFetch(input, init);
        }
        const encoder = new TextEncoder();
        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            for (const part of parts) {
              controller.enqueue(encoder.encode(part));
              await new Promise((resolve) => {
                setTimeout(resolve, gap);
              });
            }
            // ⚠️ **不关流**：真实服务端的事件流是长连接 ⇒
            //    客户端不会重连 ⇒ 界面会稳下来（断言才有意义）。
          },
        });
        return new Response(stream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      };
    },
    { parts: chunks, gap: gapMs },
  );
}

/**
 * 服务端的**回放**（真实时序）。
 *
 * ## 背景
 *
 * 服务端连上后会在**同一个响应**里先发 `connected`、紧接着把整段历史写完
 * （`src/app/api/agent/[conversationId]/events/route.ts`）。
 * 客户端收到 `connected` 就去拉快照 ⇒ **两者赛跑**：
 * 快照完全可能落在回放的**中间** ⇒ 回放的尾巴随后又上屏
 * ⇒ 历史被渲染**两遍**（而且是永久的）。
 *
 * ⇒ 这组用例钉死：**历史只渲染一遍**。
 */
test.describe('服务端回放（真实时序）', () => {
  test('同一个响应里回放整段历史:历史只渲染一遍,命令卡片也不丢', async ({
    page,
  }) => {
    await setupAiService(page, { sse: 'replay' });
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

    await openPanel(page);

    // 历史**只渲染一遍**（回放 + 快照不能叠成两份），
    // 且命令卡片不能丢（快照里**没有**工具调用历史）。
    await expectSingleHistory(page);

    // 正文就是快照里那一句（不是「回放 + 快照」拼起来的两份）
    await expect(page.locator('[data-role="assistant"]').first()).toContainText(
      '已在 PRJ-2026-Q3-001 下建好任务',
    );
  });

  test('快照落在回放中间时,回放的尾巴不会把历史再渲染一遍', async ({
    page,
  }) => {
    // ⚠️ 分块回放：第一块是 `connected` + 这一轮的前半截，
    //    第二块是后半截（**中间**留给快照落地）。
    await installChunkedSse(
      page,
      [
        connectedFrame() +
          `event: message_start\ndata: ${JSON.stringify({ role: 'assistant' })}\n\n` +
          `event: text_delta\ndata: ${JSON.stringify({
            conversationId: CONVERSATION_ID,
            delta: '好的，',
          })}\n\n`,
        `event: text_delta\ndata: ${JSON.stringify({
          conversationId: CONVERSATION_ID,
          delta: REPLY_TEXT,
        })}\n\n` +
          `event: tool_call\ndata: ${JSON.stringify({
            toolName: 'create_task',
            args: { projectCode: 'PRJ-2026-Q3-001', title: '侧栏冒烟' },
          })}\n\n` +
          `event: tool_result\ndata: ${JSON.stringify({
            toolName: 'create_task',
            status: 'ok',
            summary: '任务「侧栏冒烟」已创建',
          })}\n\n` +
          `event: message_end\ndata: ${JSON.stringify({
            text: REPLY_TEXT,
          })}\n\n` +
          `event: agent_settled\ndata: {}\n\n`,
      ],
      600,
    );
    await setupAiService(page, { sse: 'replay' });
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

    await openPanel(page);

    // ⚠️ 历史**只渲染一遍**：回放的尾巴不能盖在快照上面变成第二份
    await expectSingleHistory(page);
    await expect(page.locator('[data-role="assistant"]').first()).toContainText(
      '已在 PRJ-2026-Q3-001 下建好任务',
    );
  });
});

/**
 * 窄屏（< 1200px）：侧栏**自动**收成竖条，主内容不被挤扁。
 *
 * ⚠️ 全局视口是 1600×900（理由见 `playwright.config.ts`），
 *    所以这条用例**自己**把视口改窄 —— 窄屏的行为不能因为
 *    「全局视口宽一点」就在 CI 里看不见。
 */
test.describe('窄屏（< 1200px）', () => {
  test.use({ viewport: { width: 1000, height: 900 } });

  test('窄屏时浮层占满整宽,主内容不被挤扁', async ({ page }) => {
    await setupAiService(page);
    await setupModulePage(page, {
      menus: [{ title: '岗位管理', routePath: 'position' }],
      listUrl: LIST_URL,
      listBody: LIST_BODY,
    });

    // ⚠️ **先在宽视口下进页面**（菜单可见），再把视口改窄 ——
    //    反过来的话 ProLayout 会把菜单收进抽屉 ⇒ 等不到那个菜单项。
    await gotoModulePage(
      page,
      PAGE_PATH,
      page.locator('.ant-menu').getByText('岗位管理'),
    );

    await waitForStableLayout(page);

    // 改窄（< 768px）：浮层要占满整宽
    await page.setViewportSize({ width: 500, height: 900 });

    // ⚠️ **等布局稳下来**再量：改窄视口会让 ProLayout 把左侧菜单收起来
    //    （那会让主内容**变宽** 256px）⇒ 不等就会量到一个假的差值。
    await waitForStableLayout(page);

    // 面板**关着**时主内容有多宽
    const contentNarrow = await content(page).boundingBox();
    if (!contentNarrow) {
      throw new Error('主内容没有布局盒');
    }

    // 点开 ⇒ 浮层占满整宽（不是只露出一条 400px）
    await openPanel(page);
    const panelNarrow = await panel(page).boundingBox();
    const viewport = page.viewportSize();
    if (!panelNarrow || !viewport) {
      throw new Error('浮层或视口没有布局盒');
    }
    expect(panelNarrow.width).toBeCloseTo(viewport.width, 0);

    // ⚠️ 浮层**不占布局宽度** ⇒ 打开它，主内容宽度**一点不变**
    //    （旧实现里常驻右栏会把主内容压掉 400px）
    const contentAfterOpen = await content(page).boundingBox();
    if (!contentAfterOpen) {
      throw new Error('主内容没有布局盒');
    }
    expect(contentAfterOpen.width).toBeCloseTo(contentNarrow.width, 0);
  });
});

/**
 * 侧栏的**留白**与**固定**。
 *
 * 这两条是真实用户报出来的体验问题，钉在这里防回退：
 * 1. 三个页签曾经**贴着侧栏的左边缘**（antd 的 Tabs 根节点没有内边距）；
 * 2. 侧栏曾经不固定：要么整列跟着主内容一起滚走，要么高度链断在某一环上，
 *    内容溢出到页面外面、于是要滚一屏才找得到发送按钮。
 *    现在侧栏是 `position: fixed` 的一列（和左侧菜单栏一样）⇒ **不随主内容上下滚**，
 *    发送按钮一直贴在视口底。
 */
test.describe('浮层的留白与固定', () => {
  test('三个页签不贴着浮层的左边缘', async ({ page }) => {
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
    await openPanel(page);

    // 第一个页签的左边缘离浮层左边缘至少 8px
    const gap = await page.evaluate(() => {
      const side = document.querySelector('[data-testid=ai-workspace-panel]');
      const tab = side?.querySelector('.ant-tabs-tab');
      if (!side || !tab) {
        return null;
      }
      return Math.round(
        tab.getBoundingClientRect().x - side.getBoundingClientRect().x,
      );
    });
    expect(gap).not.toBeNull();
    expect(gap!).toBeGreaterThanOrEqual(8);
  });

  test('浮层贴死视口右边缘', async ({ page }) => {
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
    await openPanel(page);

    const viewport = page.viewportSize();
    const box = await panel(page).boundingBox();
    expect(viewport).not.toBeNull();
    expect(box).not.toBeNull();

    // ⚠️ **贴死右边缘**。
    expect(box!.x + box!.width).toBeCloseTo(viewport!.width, 0);

    // 竖向：从固定头部下面一直到视口底部
    expect(box!.y).toBeGreaterThan(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height + 1);
  });

  test('浮层不随主内容滚,发送按钮一直在视口里', async ({ page }) => {
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
    await openPanel(page);

    // 说一句话（让面板里有内容）
    await page.getByPlaceholder('输入消息').fill(USER_TEXT);
    await page.getByRole('button', { name: /^发\s*送$/ }).click();
    await expect(page.locator('[data-role="assistant"]').last()).toContainText(
      '已在 PRJ-2026-Q3-001 下建好任务',
    );

    const viewportHeight = page.viewportSize()?.height ?? 0;

    // 初始：浮层的顶边在固定头部下面
    const topBefore = (await panel(page).boundingBox())?.y ?? -1;
    expect(topBefore).toBeGreaterThan(0);

    // 滚到底 ⇒ **浮层不动**（它是 `position: fixed` 的）
    await page.evaluate(() => {
      window.scrollTo(0, document.documentElement.scrollHeight);
    });
    await page.waitForTimeout(400);
    const topAfter = (await panel(page).boundingBox())?.y ?? -1;
    expect(Math.abs(topAfter - topBefore)).toBeLessThanOrEqual(2);

    // 发送按钮在视口里（不用先滚一屏才找得到它）
    const sendBox = await page
      .getByRole('button', { name: /^发\s*送$/ })
      .boundingBox();
    expect(sendBox).not.toBeNull();
    expect(sendBox!.y + sendBox!.height).toBeLessThanOrEqual(viewportHeight);
  });
});
