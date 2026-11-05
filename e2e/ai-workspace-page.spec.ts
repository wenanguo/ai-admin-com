/**
 * AI 工作台**全宽页**（`/ai/workspace`）的端到端。
 *
 * ## 拦的是哪个地址
 *
 * AI 服务（`D:/project/ai-admin-ai`）是另一个源，浏览器侧走独立前缀
 * **`/ai-api/`**（见 `config/proxy.ts`）⇒ 真正请求的是 `/ai-api/api/agent/...`。
 * 下面两个 pattern 都挂上（代理路径 + 绝对地址），两种形态都能拦住。
 *
 * ## 五件事
 *
 * 1. 页面能打开（头部、当前模型、三个页签都在）；
 * 2. 「规则与 AI 的分工」的两栏都在，ETA 那条按实情写（**没有**关键路径、没有 P50/P90）；
 * 3. 点意图卡片**只把问句填进输入框**（**不发出任何请求**）；
 * 4. **不画配额条**（服务端没有配额端点 ⇒ 没有数据源就不画假数字）；
 * 5. **不承诺后端还没有的能力**（没接通的意图卡片上必须有「暂未开放」的标记）。
 */
import type { Page, Route } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { gotoModulePage, setupModulePage } from './helpers';

/** 页面路径。 */
const PAGE_PATH = '/ai/workspace';

/** AI 服务的会话 id（假的）。 */
const CONVERSATION_ID = 'e2e-page-conversation';

/** 假模型名（页面只显示服务端给的这一个）。 */
const MODEL = 'e2e-model';

/**
 * 「后端还没有能力」的那几张卡片。
 *
 * ⚠️ 负载 / 依赖 / 历史相似 / SLA / 文档 —— 这五个意图**连数据都没有**
 * （后端没有负载口径、没有依赖图、没有相似检索、没有 SLA、没有文档库）。
 */
const NOT_OPEN_INTENTS = [
  '负载查询',
  '依赖查询',
  '历史相似',
  'SLA 查询',
  '文档查询',
];

/** 装上 AI 服务的假实现。 */
async function setupAiService(page: Page): Promise<string[]> {
  const requests: string[] = [];

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

    // 会话：新建 / 列表
    if (path.endsWith('/api/agent/conversations')) {
      if (route.request().method() === 'POST') {
        json({ conversationId: CONVERSATION_ID, title: '新对话' });
        return;
      }
      json([]);
      return;
    }

    // 事件流（SSE）：只回一个 connected —— 这一页不需要真的对话
    if (path.endsWith('/events')) {
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

    // 会话快照（**模型**从这儿来）
    if (path.endsWith('/state')) {
      json({
        conversationId: CONVERSATION_ID,
        messages: [],
        isStreaming: false,
        model: MODEL,
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

/** 打开全宽页（装好登录态与 AI 服务的假实现）。 */
async function openWorkspacePage(page: Page): Promise<string[]> {
  const requests = await setupAiService(page);
  await setupModulePage(page, {
    menus: [{ title: '岗位管理', routePath: 'position' }],
    // 这一页不读 AiAdmin 的列表接口；给一个永远不会被请求的占位。
    listUrl: '**/api/v1/system/position/list**',
    listBody: { code: 0, msg: 'ok', data: { items: [], total: 0 } },
  });
  await gotoModulePage(page, PAGE_PATH);
  await expect(page.getByTestId('ai-workspace-page')).toBeVisible();
  return requests;
}

test.describe('AI 工作台全宽页', () => {
  test('页面能打开', async ({ page }) => {
    await openWorkspacePage(page);

    // 头部
    await expect(
      page.getByRole('heading', { name: 'AI 工作台' }),
    ).toBeVisible();
    await expect(page.getByText('命令层受控写入 · 实时引用')).toBeVisible();

    // 当前模型（只有服务端给的这一个）
    await expect(page.locator('[data-role="ai-model"]')).toContainText(MODEL);

    // 三个页签
    await expect(page.getByRole('tab', { name: '待确认' })).toBeVisible();
    await expect(page.getByRole('tab', { name: '审计' })).toBeVisible();
    await expect(
      page.getByRole('tab', { name: '规则与 AI 的分工' }),
    ).toBeVisible();
  });

  test('规则与 AI 的分工两栏都在,ETA 按实情写', async ({ page }) => {
    await openWorkspacePage(page);

    await page.getByRole('tab', { name: '规则与 AI 的分工' }).click();

    // 两栏
    await expect(
      page.locator('[data-role="ai-split-rule-engine"]'),
    ).toContainText('规则引擎');
    await expect(page.locator('[data-role="ai-split-llm"]')).toContainText(
      'LLM',
    );

    // ⚠️ ETA 那条按**实情**写：后端没有依赖图接口 ⇒ 没有关键路径、没有 P50/P90。
    await expect(
      page.locator('[data-role="ai-split-rule-engine"]'),
    ).toContainText(
      'ETA 预测（burndown 外推；依赖图接口后端尚无 ⇒ 无关键路径、无 P50/P90）',
    );

    // 底部的边界提示
    await expect(page.locator('[data-role="ai-split-boundary"]')).toBeVisible();
  });

  test('意图卡片点击后输入框被填上（且没有发出请求）', async ({ page }) => {
    const requests = await openWorkspacePage(page);

    const input = page
      .getByTestId('ai-workspace-page')
      .getByPlaceholder(/问点什么/);
    await expect(input).toHaveValue('');

    await page
      .locator('[data-role="intent-card"][data-intent="进度查询"]')
      .click();

    // 问句**被填上了**
    await expect(input).toHaveValue(
      '上周我负责的项目进度如何？哪个有延期风险？',
    );

    // ⚠️ **没有发出任何请求** —— 点卡片只填输入框，不发送。
    expect(requests.filter((url) => url.includes('/command'))).toHaveLength(0);

    // 助手那边也没有多出气泡（没发 ⇒ 没回）
    await expect(page.locator('[data-role="user"]')).toHaveCount(0);
  });

  test('不画配额条', async ({ page }) => {
    await openWorkspacePage(page);

    // 服务端**没有**配额端点 ⇒ 页面不许画配额进度条
    await expect(page.locator('.ant-progress')).toHaveCount(0);
    // 也不许出现配额仪表（原型里是「今日配额 ▓▓▓░░ 350/1000」这种编出来的数）
    await expect(
      page.getByTestId('ai-workspace-page').getByText('今日配额'),
    ).toHaveCount(0);
    await expect(
      page.getByTestId('ai-workspace-page').getByText(/\d+\s*\/\s*\d{3,}/),
    ).toHaveCount(0);
  });

  test('没有承诺后端还没有的能力', async ({ page }) => {
    await openWorkspacePage(page);

    // 没接通的意图卡片上必须有标记
    for (const title of NOT_OPEN_INTENTS) {
      const card = page.locator(
        `[data-role="intent-card"][data-intent="${title}"]`,
      );
      await expect(card).toHaveCount(1);
      await expect(card.locator('[data-role="intent-status"]')).toHaveText(
        '暂未开放',
      );
    }

    // 十张卡片**每一张**都有状态标记（没有一张是「已接通」的）
    const cards = page.locator('[data-role="intent-card"]');
    await expect(cards).toHaveCount(10);
    await expect(cards.locator('[data-role="intent-status"]')).toHaveCount(10);

    // 页面自己说清楚：现在只接通了 create_task
    await expect(page.locator('[data-role="ai-intent-note"]')).toContainText(
      'create_task',
    );
  });
});
