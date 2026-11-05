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
 *
 * 外加一条**窄屏**用例：视口窄于 1200px 时侧栏自动收成竖条（规格 §3.1）。
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

/** 主内容那一列（侧栏左边那块）。 */
function content(page: Page) {
  return page.getByTestId('ai-workspace-content');
}

/** 侧边栏的宽度（折叠 ⇄ 展开）。 */
async function siderWidth(page: Page): Promise<number | undefined> {
  const box = await sider(page).boundingBox();
  return box?.width;
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

    await waitForStableLayout(page);

    // 展开时 400px
    expect(await siderWidth(page)).toBe(400);

    // 在主内容**右边**（不是盖在主内容上面）
    //
    // ⚠️ 光比 `siderBox.x > tableBox.x` **抓不到重叠** ——
    //    侧栏盖在表格上时，表格的左边缘仍然在侧栏的左边缘左边。
    //    要比的是「表格的**右**边缘」和「侧栏的**左**边缘」。
    const siderBox = await sider(page).boundingBox();
    const tableBox = await page.locator('.ant-table').first().boundingBox();
    if (!siderBox || !tableBox) {
      throw new Error('侧栏或表格没有布局盒');
    }
    expect(tableBox.x + tableBox.width).toBeLessThanOrEqual(siderBox.x);

    // 主内容的右边缘**贴着**侧栏的左边缘（既没有空档，也没有被盖住）
    const contentBox = await content(page).boundingBox();
    if (!contentBox) {
      throw new Error('主内容没有布局盒');
    }
    expect(contentBox.x + contentBox.width).toBeCloseTo(siderBox.x, 0);

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
    await waitForStableLayout(page);
    expect(await siderWidth(page)).toBe(400);

    // 折叠**之前**的盒子
    const siderBefore = await sider(page).boundingBox();
    const contentBefore = await content(page).boundingBox();
    const tableBefore = await page.locator('.ant-table').first().boundingBox();
    if (!siderBefore || !contentBefore || !tableBefore) {
      throw new Error('侧栏 / 主内容 / 表格没有布局盒');
    }

    // 折叠
    await page.keyboard.press('Control+b');
    await expect(page.getByTestId('ai-workspace-strip')).toBeVisible();
    await expect.poll(() => siderWidth(page)).toBe(40);

    // 折叠**之后**的盒子
    const siderAfter = await sider(page).boundingBox();
    const contentAfter = await content(page).boundingBox();
    const tableAfter = await page.locator('.ant-table').first().boundingBox();
    if (!siderAfter || !contentAfter || !tableAfter) {
      throw new Error('侧栏 / 主内容 / 表格没有布局盒');
    }

    // 侧栏让出了 360px（400 → 40）⇒ 主内容**正好**多出这么多
    // （不是留一个空档，也不是把主内容盖住）
    expect(contentAfter.width - contentBefore.width).toBeCloseTo(360, 0);
    expect(tableAfter.width - tableBefore.width).toBeCloseTo(360, 0);

    // 主内容的右边缘**贴着**侧栏的左边缘（没有空档）
    expect(contentAfter.x + contentAfter.width).toBeCloseTo(siderAfter.x, 0);
    // 表格也没有被侧栏盖住
    expect(tableAfter.x + tableAfter.width).toBeLessThanOrEqual(siderAfter.x);

    // 展开
    await page.keyboard.press('Control+b');
    await expect.poll(() => siderWidth(page)).toBe(400);
    const contentBack = await content(page).boundingBox();
    if (!contentBack) {
      throw new Error('主内容没有布局盒');
    }
    expect(contentBack.width).toBeCloseTo(contentBefore.width, 0);
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

/**
 * 窄屏（< 1200px）：侧栏**自动**收成竖条，主内容不被挤扁。
 *
 * ⚠️ 全局视口是 1600×900（理由见 `playwright.config.ts`），
 *    所以这条用例**自己**把视口改窄 —— 窄屏的行为不能因为
 *    「全局视口宽一点」就在 CI 里看不见。
 */
test.describe('窄屏（< 1200px）', () => {
  test.use({ viewport: { width: 1000, height: 900 } });

  test('侧栏自动收成竖条,主内容不被挤扁;用户仍可以展开它', async ({ page }) => {
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

    // 窄屏 ⇒ antd 的 Sider 自己收起（breakpoint = xl = 1200px）
    await expect(page.getByTestId('ai-workspace-strip')).toBeVisible();
    await expect.poll(() => siderWidth(page)).toBe(40);

    await waitForStableLayout(page);

    const contentNarrow = await content(page).boundingBox();
    const siderNarrow = await sider(page).boundingBox();
    if (!contentNarrow || !siderNarrow) {
      throw new Error('主内容或侧栏没有布局盒');
    }
    // 侧栏**没有**把主内容挤到 ProTable 搜索表单的断点（576px）以下
    expect(contentNarrow.width).toBeGreaterThan(576);
    // 主内容的右边缘贴着竖条的左边缘（没有空档）
    expect(contentNarrow.x + contentNarrow.width).toBeCloseTo(siderNarrow.x, 0);

    // 用户仍然可以把它展开（展开后主内容才会被挤窄）
    await page.getByTestId('ai-workspace-strip').click();
    await expect.poll(() => siderWidth(page)).toBe(400);
    const contentExpanded = await content(page).boundingBox();
    if (!contentExpanded) {
      throw new Error('主内容没有布局盒');
    }
    expect(contentExpanded.width).toBeCloseTo(contentNarrow.width - 360, 0);
  });
});
