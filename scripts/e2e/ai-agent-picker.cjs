/**
 * 端到端验收：工作台上的**智能体选择器**（issue #101）。
 *
 * ## 它证明什么
 *
 * 1. 工作台（宽版 `/ai/workspace`）上**有**智能体下拉框，选项来自 `GET /api/agents`；
 * 2. **选中一个智能体 ⇒ 另起一个会话**，而且那个会话**真的用这个智能体**
 *    （会话列表里它的 `agentId` 就是选中的那个 ⇒ 落库到了 `ai_conversation.agent_id`）；
 * 3. **旧的会话不被改动**（切智能体只是新建，不是把旧会话改掉）。
 *
 * ## 怎么跑
 *
 *   node scripts/e2e/login.cjs              # 先取 token（本地开发环境）
 *   node scripts/e2e/ai-agent-picker.cjs    # 再跑这个
 *
 * ⚠️ 需要：前端跑着（8000）+ AI 服务跑着（3100）。
 */
const fs = require('node:fs');
const path = require('node:path');

/**
 * 从 `frontend/node_modules` 解析模块。
 *
 * ⚠️ playwright 只装在 `frontend/`（根目录没有 node_modules）⇒
 *    不能直接 require('@playwright/test')。
 */
const req = (name) =>
  require(require.resolve(name, { paths: [path.join(process.cwd(), 'frontend')] }));
const { chromium } = req('@playwright/test');

const FRONTEND = process.env.FRONTEND_URL || 'http://localhost:8000';
const AI_SERVICE = process.env.AI_SERVICE_URL || 'http://localhost:3100';
const TOKEN_FILE =
  process.env.TOKEN_FILE || path.join(process.cwd(), '.scratch', 'token.txt');
/** 选哪个智能体（默认挑一个**不是** pm 的那个 ⇒ 换得动才说明真换了）。 */
const TARGET_AGENT = process.env.AGENT_ID || '';

/**
 * 调 AI 服务（带 token）。
 *
 * @param {string} path_ 路径。
 * @returns {Promise<unknown>} 信封里的 data。
 */
async function aiGet(path_) {
  const response = await fetch(`${AI_SERVICE}${path_}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(`${path_} ⇒ HTTP ${response.status}`);
  }
  const envelope = await response.json();
  return envelope.data;
}

let token = '';

(async () => {
  token = process.env.USER_TOKEN || fs.readFileSync(TOKEN_FILE, 'utf8').trim();

  // ① 智能体清单（真接口）
  const agents = await aiGet('/api/agents');
  console.log('① 智能体清单:', agents.map((a) => `${a.id}(${a.name})`).join(', '));
  if (!Array.isArray(agents) || agents.length === 0) {
    throw new Error('一个智能体都没有 ⇒ 没法验选择器');
  }

  const target = TARGET_AGENT
    ? agents.find((a) => a.id === TARGET_AGENT)
    : agents.find((a) => a.id !== 'pm') ?? agents[0];
  if (!target) {
    throw new Error(`找不到智能体 ${TARGET_AGENT}`);
  }

  // ② 记下**旧的**会话（用来证明旧会话没被动过）
  const before = await aiGet('/api/agent/conversations');
  console.log('② 现有会话:', before.length, '条');

  const browser = await chromium.launch();
  const page = await browser.newPage();

  // 注入登录态（跳过 UI 登录：验证码 key 会因 React 双渲染而不稳定）
  await page.addInitScript((t) => {
    localStorage.setItem('access_token', t);
    localStorage.setItem('refresh_token', t);
    localStorage.setItem('remember_me', 'true');
  }, token);

  await page.goto(`${FRONTEND}/ai/workspace`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);

  // ③ 工作台上有智能体选择器
  const select = page.locator('[data-role="ai-agent-select"]');
  await select.waitFor({ timeout: 30000 });
  console.log('③ 智能体选择器可见');

  // ④ 挑中它 ⇒ 另起一个会话
  await select.click();
  await page.getByText(target.name, { exact: true }).click();
  console.log('④ 已选中:', target.name);
  await page.waitForTimeout(5000);

  // ⑤ 新会话**真的用这个智能体**
  const after = await aiGet('/api/agent/conversations');
  const fresh = after.find(
    (c) => !before.some((old) => old.conversationId === c.conversationId),
  );
  console.log('⑤ 新会话:', fresh?.conversationId, 'agentId =', fresh?.agentId);

  const ok =
    fresh !== undefined &&
    fresh.agentId === target.id &&
    String(fresh.conversationId).startsWith(`${target.id}_`);

  // ⑥ 旧会话**没被动过**
  const untouched = before.every((old) =>
    after.find((c) => c.conversationId === old.conversationId)?.agentId ===
    old.agentId,
  );
  console.log('⑥ 旧会话的智能体没变:', untouched);

  await browser.close();

  if (!ok) {
    console.error('⚠️ 新会话不是用选中的智能体建的 ⇒ 人工核对一下');
    process.exit(1);
  }
  if (!untouched) {
    console.error('⚠️ 旧会话的智能体被改了 ⇒ 人工核对一下');
    process.exit(1);
  }
  console.log('✅ 选中智能体 ⇒ 新会话用的是它（旧会话没被动）');
  process.exit(0);
})().catch((e) => {
  console.error('失败:', e.message);
  process.exit(1);
});
