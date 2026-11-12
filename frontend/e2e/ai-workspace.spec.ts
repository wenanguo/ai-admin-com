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

/** 宽版浮层（最大化后）。 */
function wideOverlay(page: Page) {
  return page.getByTestId('ai-workspace-wide-overlay');
}

/** 宽版头部的「返回」按钮。 */
function backButton(page: Page) {
  return page.locator('[data-role="ai-back-button"]');
}

/** 窄版头部的「最大化」按钮。 */
function expandButton(page: Page) {
  return page.getByRole('button', { name: '最大化' });
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
 * 最大化（宽版浮层）**不重载原界面**。
 *
 * ## 这条用例钉的是什么
 *
 * 以前「全宽页」是个 `<Link to="/ai/workspace">` ⇒ 点它 = **路由跳转**
 * ⇒ 原页面被**卸载** ⇒ 点「返回」再跳回来 = 重新挂载
 * ⇒ 用户看到的是「原界面刷新了」（滚动位置、筛选条件、页码全丢）。
 *
 * ⇒ 现在最大化是**状态切换**：宽版也是浮层 ⇒ **原页面始终不卸载**。
 */
test.describe('最大化（宽版浮层）', () => {
  test('最大化与返回都不动原界面:URL、筛选、页码、滚动位置全保留', async ({
    page,
  }) => {
    await setupAiService(page);
    await setupModulePage(page, {
      menus: [{ title: '岗位管理', routePath: 'position' }],
      listUrl: LIST_URL,
      // ⚠️ **给足行数**：要能翻页、内容区也要能滚动
      //    （否则「页码 / 滚动位置」这两个状态压根不存在，测不到东西）
      listBody: {
        ...LIST_BODY,
        data: {
          ...LIST_BODY.data,
          items: Array.from({ length: 20 }, (_, index) => ({
            id: index + 1,
            name: `岗位 ${index + 1}`,
            code: `code-${index + 1}`,
            order: index,
            status: 0,
            description: `第 ${index + 1} 行`,
          })),
          total: 20,
        },
      },
    });
    await gotoModulePage(
      page,
      PAGE_PATH,
      page.locator('.ant-menu').getByText('岗位管理'),
    );
    await waitForStableLayout(page);

    // 在主界面上做点动作（这些状态在刷新后就全没了）
    await page.getByPlaceholder('支持模糊查询').fill('后端');
    await page.waitForTimeout(500);
    await page.locator('.ant-pagination-item-2').click();
    await page.waitForTimeout(1000);
    await content(page).evaluate((element) => {
      element.scrollTop = 120;
    });

    const snapshot = async (): Promise<string> =>
      page.evaluate(() => {
        const root = document.querySelector(
          '[data-testid="ai-workspace-content"]',
        );
        const input = document.querySelector(
          'input[placeholder="支持模糊查询"]',
        ) as HTMLInputElement | null;
        return JSON.stringify({
          url: location.pathname + location.search,
          filter: input?.value,
          page: document.querySelector('.ant-pagination-item-active')
            ?.textContent,
          scroll: root?.scrollTop,
        });
      });

    const before = await snapshot();

    // 打开小浮层 ⇒ 最大化
    await openPanel(page);
    await expandButton(page).click();
    await expect(wideOverlay(page)).toBeVisible();

    // ⚠️ **没有发生路由跳转**（原来这里是 `to="/ai/workspace"`）
    expect(page.url()).not.toContain('/ai/workspace');

    // ⚠️ 原界面**一点没变**（没被卸载 ⇒ 没被重新渲染成初始状态）
    expect(await snapshot()).toBe(before);

    // 返回 ⇒ 回到小浮层，原界面还是原样
    await backButton(page).click();
    await expect(panel(page)).toBeVisible();
    await expect(wideOverlay(page)).toHaveCount(0);
    expect(await snapshot()).toBe(before);
  });

  test('宽版盖住内容区,顶栏与左侧菜单留着', async ({ page }) => {
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

    await openPanel(page);
    await expandButton(page).click();
    await expect(wideOverlay(page)).toBeVisible();

    const overlay = await wideOverlay(page).boundingBox();
    const contentBox = await content(page).boundingBox();
    if (!overlay || !contentBox) {
      throw new Error('宽版浮层或主内容没有布局盒');
    }
    // ⚠️ **正好盖住内容区**（不是整个视口）
    expect(overlay.x).toBeCloseTo(contentBox.x, 0);
    expect(overlay.y).toBeCloseTo(contentBox.y, 0);
    expect(overlay.width).toBeCloseTo(contentBox.width, 0);
    expect(overlay.height).toBeCloseTo(contentBox.height, 0);

    // 顶栏与左侧菜单**没有被盖住**（用户还要用它们）
    await expect(page.locator('.ant-pro-layout-header')).toBeVisible();
    await expect(page.locator('.ant-menu').first()).toBeVisible();
  });

  test('宽窄切换不新建会话(同一个 useWorkspace 实例)', async ({ page }) => {
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
    const before = requests.filter((url) =>
      url.endsWith('/api/agent/conversations'),
    ).length;

    await expandButton(page).click();
    await expect(wideOverlay(page)).toBeVisible();
    await backButton(page).click();
    await expect(panel(page)).toBeVisible();

    // ⚠️ **没有再新建会话** ⇒ 宽窄切换时 `useWorkspace` 实例没被重建
    //    （重建的话会重连 SSE、消息区闪一下、正在生成的回答会断）
    const after = requests.filter((url) =>
      url.endsWith('/api/agent/conversations'),
    ).length;
    expect(after).toBe(before);
  });

  /**
   * 最大化之后是**两栏**：左边对话，右边 360px 的侧栏。
   *
   * ⚠️ 「页面自己不滚」那条断言**就在这个用例的末尾**（意图卡片墙已经
   *    折进输入框上方的抽屉 ⇒ 不在文档流里了 ⇒ 宽版内容盒不溢出）。
   *    但**「对话区吃满这一行」还没做**（对话区还是固定高度 `min(560px,55vh)`）
   *    ⇒ 「一屏铺满」的另一半是下一个任务的事。
   *
   * ⚠️ 但**「对话区还在、而且点得到」是这里必须钉的**：
   *    意图卡片墙在文档流里时，它曾经把对话区盖住 ⇒ 发送按钮点不到。
   */
  test('最大化后右侧栏出现,对话在左、侧栏在右', async ({ page }) => {
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
    await expandButton(page).click();
    await expect(wideOverlay(page)).toBeVisible();

    // 右侧栏存在
    const sidebar = page.locator('[data-role="ai-wide-sidebar"]');
    await expect(sidebar).toBeVisible();

    // 侧栏里就是「待确认 / 审计 / 规则与 AI 的分工」那三个页签
    await expect(sidebar.getByRole('tab', { name: '待确认' })).toBeVisible();
    await expect(sidebar.getByRole('tab', { name: '审计' })).toBeVisible();
    await expect(
      sidebar.getByRole('tab', { name: '规则与 AI 的分工' }),
    ).toBeVisible();

    // 对话在左、侧栏在右
    const chatColumn = page.locator('[data-role="ai-wide-chat-column"]');
    await expect(chatColumn).toBeVisible();

    // ⚠️ **对话区还在**（不是只剩一个空壳）：左列里必须有输入框与发送按钮。
    //    把 `WideChat` 整个卸掉的话，这两条会挂 ⇒ 它们守住「输入框点得到」。
    const composer = chatColumn.locator('textarea');
    await expect(composer).toBeVisible();
    // ⚠️ `^发\s*送$`：antd 会把按钮里**两个汉字**之间插一个空格
    //    ⇒ 按钮的可访问名是「发 送」而不是「发送」。
    const sendButton = chatColumn.getByRole('button', {
      name: /^发\s*送$/,
    });
    await expect(sendButton).toBeVisible();

    // ⚠️ **发送按钮没被挡住**：卡片墙曾经盖住输入区 ⇒ 用命中测试确认
    //    按钮中心点到的就是按钮自己（不是盖在上面的卡片墙）。
    await sendButton.scrollIntoViewIfNeeded();
    const covered = await sendButton.evaluate((button) => {
      const rect = button.getBoundingClientRect();
      const hit = document.elementFromPoint(
        rect.x + rect.width / 2,
        rect.y + rect.height / 2,
      );
      return hit ? !button.contains(hit) : true;
    });
    expect(covered).toBe(false);

    const chatBox = await chatColumn.boundingBox();
    const sidebarBox = await sidebar.boundingBox();
    if (!chatBox || !sidebarBox) {
      throw new Error('对话列或侧栏没有布局盒');
    }
    expect(chatBox.x).toBeLessThan(sidebarBox.x);
    // 两栏**不重叠**（对话列的右边缘 ≤ 侧栏的左边缘）
    expect(chatBox.x + chatBox.width).toBeLessThanOrEqual(sidebarBox.x + 1);

    // 侧栏是固定宽度的窄栏（360px），不是把对话挤掉的那种自适应
    expect(sidebarBox.width).toBeCloseTo(360, 0);

    // ⚠️ **整页不滚**：意图卡片墙折进输入框上方的抽屉之后（不在文档流里了），
    //    宽版内容盒的高度就等于视口高度 ⇒ 不该再溢出。
    const wideBox = await page
      .locator('[data-testid="ai-workspace-page"]')
      .evaluate((el) => ({
        clientH: el.clientHeight,
        scrollH: el.scrollHeight,
      }));
    expect(wideBox.scrollH).toBeLessThanOrEqual(wideBox.clientH);
  });

  /**
   * 对话区**吃满剩余高度**（不再是固定的 `min(560px, 55vh)`）。
   *
   * ⚠️ 光断言「没有滚动条」**不够**：宽版内容盒有 `padding: 16px`
   *    ⇒ 溢出落在内边距里**不会**撑高 `scrollHeight`
   *    ⇒ 最多 16px 的回退是看不见的。
   *    ⇒ 这里量**几何**：对话面板的底边要**贴着内容区的底边**，
   *      而且高度要超过视口的 55%（固定高度时正好 55vh）。
   */
  test('对话区吃满剩余高度:底边贴着内容区底边', async ({ page }) => {
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
    await expandButton(page).click();
    await expect(wideOverlay(page)).toBeVisible();

    const chat = page.locator('[data-role="ai-wide-chat"]');
    await expect(chat).toBeVisible();

    const geo = await page.evaluate(() => {
      const panel = document.querySelector('[data-role="ai-wide-chat"]');
      const column = document.querySelector(
        '[data-role="ai-wide-chat-column"]',
      );
      const wide = document.querySelector('[data-testid="ai-workspace-page"]');
      if (!panel || !column || !wide) {
        return null;
      }
      const panelRect = panel.getBoundingClientRect();
      const columnRect = column.getBoundingClientRect();
      const wideRect = wide.getBoundingClientRect();
      const wideStyle = getComputedStyle(wide);
      return {
        panelBottom: panelRect.bottom,
        panelHeight: panelRect.height,
        columnBottom: columnRect.bottom,
        // 内容区的底边（**去掉根容器的内边距** —— 那不是内容区的边）
        contentBottom:
          wideRect.bottom - parseFloat(wideStyle.paddingBottom || '0'),
        viewportHeight: window.innerHeight,
      };
    });
    if (!geo) {
      throw new Error('对话面板 / 左列 / 宽版内容盒缺一个');
    }

    // ① 对话面板的底边**贴着内容区的底边**（差 <= 8px）
    expect(Math.abs(geo.panelBottom - geo.contentBottom)).toBeLessThanOrEqual(
      8,
    );

    // ② 对话面板吃满了左列（底边 ≈ 左列底边）
    expect(Math.abs(geo.panelBottom - geo.columnBottom)).toBeLessThanOrEqual(2);

    // ③ 不再是固定的 560 / 55vh ⇒ 高度**超过**视口的 55%
    expect(geo.panelHeight).toBeGreaterThan(geo.viewportHeight * 0.55);
  });

  /**
   * 意图卡片**折进输入框上方的抽屉**（不再是页面底部铺开的一片卡片）。
   *
   * 抽屉是**绝对定位**的浮层 ⇒ 不占高度 ⇒ 页面不用滚。
   */
  test('意图卡片折进输入框上方的抽屉:能开、点卡片填输入框并自动收起', async ({
    page,
  }) => {
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
    await expandButton(page).click();
    await expect(wideOverlay(page)).toBeVisible();

    // ① 页面上**没有**直接铺开的意图卡片墙了
    await expect(page.locator('[data-role="ai-intent-gallery"]')).toHaveCount(
      0,
    );

    // ② 点「意图卡片」按钮 ⇒ 抽屉出现
    const toggle = page.locator('[data-role="ai-intent-toggle"]');
    await expect(toggle).toBeVisible();
    // 按钮上写着「意图卡片（10）」（10 = 意图的类数）
    await expect(toggle).toContainText('意图卡片（10）');

    // ⚠️ **抽屉不占文档流** ⇒ 打开它不能把页面撑高。
    //    记下**关闭时**宽版内容盒的 `scrollHeight`，开抽屉后要一模一样。
    const wideBox = page.locator('[data-testid="ai-workspace-page"]');
    const closedScrollH = await wideBox.evaluate((el) => el.scrollHeight);

    await toggle.click();
    const drawer = page.locator('[data-role="ai-intent-drawer"]');
    await expect(drawer).toBeVisible();
    await expect(
      drawer.locator('[data-role="intent-card"]').first(),
    ).toBeVisible();

    // ⚠️ 打开抽屉 ⇒ 高度**一点没变**（抽屉是绝对定位的浮层）
    await expect
      .poll(() => wideBox.evaluate((el) => el.scrollHeight))
      .toBe(closedScrollH);

    // ③ 抽屉**浮在输入框上方**（不挡输入框）
    const composer = page.locator('[data-role="ai-wide-chat-column"] textarea');
    const drawerBox = await drawer.boundingBox();
    const composerBox = await composer.boundingBox();
    if (!drawerBox || !composerBox) {
      throw new Error('抽屉或输入框没有布局盒');
    }
    expect(drawerBox.y + drawerBox.height).toBeLessThanOrEqual(
      composerBox.y + 1,
    );

    // ④ 点一张卡片 ⇒ 输入框被填上（**不发送**）、抽屉自动收起
    const card = drawer.locator('[data-role="intent-card"]').first();
    const cardText = (await card.textContent())?.replace(/\s+/g, '') ?? '';
    await card.click();
    const filled = (await composer.inputValue()).replace(/\s+/g, '');
    expect(filled.length).toBeGreaterThan(0);
    // 填进去的正是那张卡片上的示例问句
    expect(cardText).toContain(filled);
    await expect(drawer).toHaveCount(0);

    // ⑤ 按 Esc 也能收起
    await toggle.click();
    await expect(drawer).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);

    // ⑥ 点抽屉**外面**也能收起
    await toggle.click();
    await expect(drawer).toBeVisible();
    await page.locator('[data-role="ai-model"]').click();
    await expect(drawer).toHaveCount(0);
  });

  /**
   * 模型条**只留一行**：那句解释收进 tooltip。
   *
   * ## 为什么要收
   *
   * 「服务端没有模型列表端点，也没有配额端点 ⇒ 没有数据源就不画配额条」
   * 是**写给开发者看的**（解释为什么不画配额条）⇒ 它不该占页面上一整行
   * ⇒ 挪进 ⓘ 的 tooltip（想看的人 hover 一下就看到）。
   *
   * ## 钉住的三件事
   *
   * 1. **模型名看得见**（用户真正要的那部分不能被牺牲掉）；
   * 2. 那句解释**不在页面上**；
   * 3. hover ⓘ ⇒ tooltip 里能看到原句（不能只是把它删了）。
   */
  test('模型条只留一行,那句开发者解释收进 tooltip', async ({ page }) => {
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
    await expandButton(page).click();
    await expect(wideOverlay(page)).toBeVisible();

    const modelRow = page.locator('[data-role="ai-model"]');
    await expect(modelRow).toBeVisible();

    // ① 模型名**看得见**（「当前模型：xxx」还得在）
    await expect(modelRow).toContainText('当前模型：');
    // ⚠️ 用 `toBeVisible()`（不是 `toContainText`）⇒ 模型名被 `visibility:hidden`
    //    之类藏起来时这条会红。
    await expect(modelRow.getByText('e2e-model')).toBeVisible();

    // ② 那句开发者解释**不在模型条这一行上**
    // ⚠️ 限定在 `modelRow` 里查（不是整页）⇒ tooltip 打开后同一个字符串会进 DOM
    //    （在页脚 portal 里）⇒ 整页查询会依赖断言顺序，把两条断言**解耦**。
    await expect(modelRow.getByText('没有数据源就不画配额条')).toHaveCount(0);

    // ③ hover ⓘ ⇒ tooltip 里能看到原句
    const note = page.locator('[data-role="ai-model-note"]');
    await expect(note).toBeVisible();
    await note.hover();
    await expect(page.getByRole('tooltip')).toContainText(
      '没有数据源就不画配额条',
    );
    // ⚠️ tooltip 渲染在 body 的 portal 里，**不在**模型条那一行
    //    ⇒ 断言② 在 tooltip 打开时**依然**成立 ⇒ 两条断言互不依赖顺序。
    await expect(modelRow.getByText('没有数据源就不画配额条')).toHaveCount(0);

    // ⑥ tooltip 弹在ⓘ的**下方**（`placement="bottom"`）
    //    ⇒ 不盖住正上方的「AI 工作台」标题。
    const tipBox = await page.getByRole('tooltip').boundingBox();
    const noteBox = await note.boundingBox();
    if (!tipBox || !noteBox) {
      throw new Error('tooltip 或 ⓘ 没有布局盒');
    }
    expect(tipBox.y).toBeGreaterThan(noteBox.y + noteBox.height - 1);

    // ④ 键盘**聚焦** ⓘ ⇒ tooltip 也打开
    //    （触发器是原生 `<button>` ⇒ 天生可聚焦；`trigger` 含 `focus` ⇒ 聚焦即开）
    //    ⚠️ 先等 hover 触发的那个 tooltip **收掉**（`toHaveCount(0)`）——
    //    否则这条会蹭上一个还没消失的 tooltip 而假绿。
    await modelRow.getByText('当前模型：').hover();
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await note.focus();
    await expect(page.getByRole('tooltip')).toContainText(
      '没有数据源就不画配额条',
    );

    // ⑤ 整条只有**一行**高（原来那句解释把这条撑成了两行）
    const box = await modelRow.boundingBox();
    if (!box) {
      throw new Error('模型条没有布局盒');
    }
    expect(box.height).toBeLessThan(60);
  });
});

/**
 * **内容区窄**（< 900px）：右侧栏改成**抽屉**。
 *
 * ## 为什么
 *
 * 最大化后的浮层宽度 = **内容区**的宽度 ⇒ 手机上只有 ~400px。
 * 侧栏是固定 360px 且 `flexShrink: 0` ⇒ 它会把对话区挤成一条
 * （窄到 376px 以下还会被根容器的 `overflowX: hidden` **裁掉**，用户够不着）。
 * ⇒ 内容区 < 900px 时侧栏改成**右侧抽屉**，对话区占满整宽。
 *
 * ⚠️ 断点看的是**内容区**的宽度（不是视口）⇒ 两个宿主
 *    （最大化浮层 / 路由页 `/ai/workspace`）自动一致。
 */
test.describe('内容区窄（< 900px）', () => {
  test('内容区窄时右侧栏变成抽屉,对话区不被挤扁', async ({ page }) => {
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

    // ⚠️ **先在宽视口下进页面**（菜单可见），再把视口调窄 ——
    //    反过来的话 ProLayout 会把菜单收进抽屉 ⇒ 等不到那个菜单项。
    await page.setViewportSize({ width: 760, height: 900 });
    await waitForStableLayout(page);

    await openPanel(page);
    await expandButton(page).click();
    await expect(wideOverlay(page)).toBeVisible();

    // ① 有一个「侧栏」按钮 ⇒ 说明已经是**窄形态**（侧栏在抽屉里）
    const toggle = page.locator('[data-role="ai-wide-sidebar-toggle"]');
    await expect(toggle).toBeVisible();

    // ② **侧栏默认收起**（页面里没有那块 360px 的窄栏）
    await expect(page.locator('[data-role="ai-wide-sidebar"]')).toHaveCount(0);

    // ③ **对话区占满整个宽度**（没被 360px 的侧栏挤扁）
    const chatBox = await page
      .locator('[data-role="ai-wide-chat-column"]')
      .boundingBox();
    const overlayBox = await wideOverlay(page).boundingBox();
    const pageBox = await page
      .locator('[data-testid="ai-workspace-page"]')
      .boundingBox();
    if (!chatBox || !overlayBox || !pageBox) {
      throw new Error('对话列、宽版浮层或宽版内容盒没有布局盒');
    }
    // 对话区比侧栏（360px）宽
    expect(chatBox.width).toBeGreaterThan(360);
    // 对话区吃掉了浮层的一大半（不是被挤到左边一条缝）
    expect(chatBox.x + chatBox.width).toBeGreaterThan(
      overlayBox.x + overlayBox.width / 2,
    );
    // ⚠️ **对话区 ≈ 内容区宽度**（这条才有区分度）：
    //    侧栏若是**内联**的（360px 窄栏 + 间隙），对话列就只剩「内容区宽度
    //    减去 400 多一点」⇒ 上面那两条**不一定挂**（实测：内容区 1200px 时
    //    对话列 669px ⇒ `> 360` 与「越过中线」都过）⇒ 只有这条能分辨
    //    「并排」与「抽屉」。
    //    （内容区自己那 32px 内边距扣掉 ⇒ 差值不超过 48px 就算「占满」。）
    expect(chatBox.width).toBeGreaterThan(pageBox.width - 48);
    expect(chatBox.width).toBeGreaterThan(overlayBox.width - 64);

    // ④ ⚠️ **竖向也不滚**（窄形态的竖向守卫）。
    //    窄形态下头部多了一个「侧栏」按钮 ⇒ 它换行会挤压对话区
    //    ⇒ 光断言宽度看不见这类回归 ⇒ 这里量高度。
    const narrowPageBox = await page
      .locator('[data-testid="ai-workspace-page"]')
      .evaluate((el) => ({
        clientH: el.clientHeight,
        scrollH: el.scrollHeight,
      }));
    expect(narrowPageBox.scrollH).toBeLessThanOrEqual(narrowPageBox.clientH);

    // ⑤ ⚠️ **发送按钮在窄形态下还点得到**（没被换行的头部挤没）。
    //    命中测试：按钮中心点到的**就是按钮自己**（不是被别的东西盖住）。
    const narrowColumn = page.locator('[data-role="ai-wide-chat-column"]');
    const narrowSendButton = narrowColumn.getByRole('button', {
      name: /^发\s*送$/,
    });
    await expect(narrowSendButton).toBeVisible();
    await narrowSendButton.scrollIntoViewIfNeeded();
    const narrowCovered = await narrowSendButton.evaluate((button) => {
      const rect = button.getBoundingClientRect();
      const hit = document.elementFromPoint(
        rect.x + rect.width / 2,
        rect.y + rect.height / 2,
      );
      return hit ? !button.contains(hit) : true;
    });
    expect(narrowCovered).toBe(false);

    // ⑥ 点「侧栏」⇒ 抽屉滑出来，那三个页签都在（用户还够得着待确认/审计/规则）
    await toggle.click();
    const sidebar = page.locator('[data-role="ai-wide-sidebar"]');
    await expect(sidebar).toBeVisible();
    await expect(sidebar.getByRole('tab', { name: '待确认' })).toBeVisible();
    await expect(sidebar.getByRole('tab', { name: '审计' })).toBeVisible();
    await expect(
      sidebar.getByRole('tab', { name: '规则与 AI 的分工' }),
    ).toBeVisible();

    // ⑦ 抽屉在**右边**（贴视口右边缘）
    //    ⚠️ 抽屉是**滑进来**的 ⇒ 量位置之前先等它停下来
    //    （否则量到的是动画中间的位置，右侧会多出半个抽屉的宽度）。
    let lastRight = -1;
    await expect
      .poll(async () => {
        const box = await sidebar.boundingBox();
        const right = box ? Math.round(box.x + box.width) : -1;
        const stable = right === lastRight;
        lastRight = right;
        return stable;
      })
      .toBe(true);

    const sidebarBox = await sidebar.boundingBox();
    const viewport = page.viewportSize();
    if (!sidebarBox || !viewport) {
      throw new Error('侧栏或视口没有布局盒');
    }
    // 在视口的**右半边**
    expect(sidebarBox.x).toBeGreaterThan(viewport.width / 2);
    // 贴视口右边缘（抽屉自己的内边距是 12px ⇒ 差值不超过 24px）
    expect(sidebarBox.x + sidebarBox.width).toBeGreaterThan(
      viewport.width - 24,
    );

    // ⑧ 点抽屉的「关闭」⇒ 抽屉收起来（侧栏滑回屏幕外）
    //    ⚠️ antd v6 的抽屉**不处理 Esc** ⇒ 用关闭按钮。
    //    ⚠️ 关掉后抽屉的 DOM **还在**（只是滑出屏幕、不可见）⇒ 断言「不可见」。
    await page.getByRole('button', { name: '关闭', exact: true }).click();
    await expect(sidebar).toBeHidden();
    await expect(page.locator('.ant-drawer.ant-drawer-open')).toHaveCount(0);
  });

  /**
   * ⚠️ **离开窄形态时抽屉状态要复位**（真 bug 的回归守卫）。
   *
   * ## 原来的症状
   *
   * 窄形态下打开抽屉 ⇒ 把窗口拉宽到 900px 以上 ⇒ 抽屉**卸载**了，
   * 但「抽屉开着」那个状态还是 `true` ⇒ 再变窄时抽屉**自己弹出来**，
   * 盖住对话区（用户莫名其妙被遮住）。
   */
  test('拉宽到并排形态后再变窄,抽屉不会自己弹出来', async ({ page }) => {
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

    await page.setViewportSize({ width: 760, height: 900 });
    await waitForStableLayout(page);

    await openPanel(page);
    await expandButton(page).click();
    await expect(wideOverlay(page)).toBeVisible();

    // 窄形态 ⇒ 打开抽屉
    const toggle = page.locator('[data-role="ai-wide-sidebar-toggle"]');
    await expect(toggle).toBeVisible();
    await toggle.click();
    await expect(page.locator('[data-role="ai-wide-sidebar"]')).toBeVisible();
    await expect(page.locator('.ant-drawer.ant-drawer-open')).toHaveCount(1);

    // 拉宽 ⇒ 变回**并排**形态（抽屉卸载，侧栏常驻）
    await page.setViewportSize({ width: 1200, height: 900 });
    await waitForStableLayout(page);
    await expect(
      page.locator('[data-role="ai-wide-sidebar-toggle"]'),
    ).toHaveCount(0);
    await expect(page.locator('[data-role="ai-wide-sidebar"]')).toBeVisible();

    // 再变窄 ⇒ 抽屉**不该自己弹出来**（状态已复位）
    await page.setViewportSize({ width: 760, height: 900 });
    await waitForStableLayout(page);
    await expect(
      page.locator('[data-role="ai-wide-sidebar-toggle"]'),
    ).toBeVisible();
    await expect(page.locator('.ant-drawer.ant-drawer-open')).toHaveCount(0);
    await expect(page.locator('[data-role="ai-wide-sidebar"]')).toHaveCount(0);
  });

  /**
   * ⚠️ **内容区比抽屉还窄时，抽屉要自己收窄**（不溢出屏幕）。
   *
   * 抽屉固定 360px 时，内容区窄到 ~380px 时，靠右的抽屉会**伸出左边**
   * ⇒ 侧栏左侧的东西（例如「待确认」的同意 / 拒绝按钮）够不着。
   * ⇒ 抽屉宽度取 `min(360, 内容区宽度 - 32)`。
   */
  test('内容区比抽屉还窄时,抽屉自动收窄(不溢出屏幕)', async ({ page }) => {
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

    // 视口调窄 ⇒ 内容区比 360 + 32 还窄
    await page.setViewportSize({ width: 380, height: 900 });
    await waitForStableLayout(page);

    await openPanel(page);
    await expandButton(page).click();
    await expect(wideOverlay(page)).toBeVisible();

    const pageBox = await page
      .locator('[data-testid="ai-workspace-page"]')
      .boundingBox();
    if (!pageBox) {
      throw new Error('宽版内容盒没有布局盒');
    }
    // 内容区确实比「360 + 32」还窄（这条用例的前提）
    expect(pageBox.width).toBeLessThan(392);

    // 打开抽屉
    await page.locator('[data-role="ai-wide-sidebar-toggle"]').click();
    const drawer = page.locator('.ant-drawer-content-wrapper');
    await expect(drawer).toBeVisible();
    // ⚠️ 抽屉是**滑进来**的 ⇒ 量之前先等它停下来
    let lastWidth = -1;
    await expect
      .poll(async () => {
        const box = await drawer.boundingBox();
        const width = box ? Math.round(box.width) : -1;
        const stable = width === lastWidth;
        lastWidth = width;
        return stable;
      })
      .toBe(true);

    const drawerBox = await drawer.boundingBox();
    if (!drawerBox) {
      throw new Error('抽屉没有布局盒');
    }
    // 抽屉跟着内容区收了（不再是死的 360px）
    expect(drawerBox.width).toBeLessThan(360);
    expect(drawerBox.width).toBeCloseTo(pageBox.width - 32, 0);
    // 没有伸出屏幕左边
    expect(drawerBox.x).toBeGreaterThanOrEqual(0);
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
