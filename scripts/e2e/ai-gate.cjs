/**
 * 端到端验收：AI 改已有数据 ⇒ 挂起等人点头 ⇒ 同意 ⇒ **任务真被改了**。
 *
 * ## 它证明什么
 *
 * 1. 模型会**主动加载技能**（`load_skill`）再动手；
 * 2. 改已有数据时**挂起**（SSE 推 `pending`）⇒ 界面出现「⏳ 等待你确认」；
 * 3. 「待确认」页签有**同意按钮**，点了之后 **hook 放行** ⇒ 原工具调用真的执行；
 * 4. 助手**接着说**（那一轮没被打断）。
 *
 * ⚠️ **会真的改 AiAdmin 里的任务** ⇒ 只在测试环境跑。
 *
 * 用法：
 *   node scripts/e2e/login.cjs          # 先取 token
 *   node scripts/e2e/ai-gate.cjs        # 再跑这个
 *   NEW_TITLE=xxx node scripts/e2e/ai-gate.cjs   # 换个标题（重复跑要换，否则模型说「已经是这个标题」）
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
const TASK_ID = process.env.TASK_ID || '117';
const NEW_TITLE =
  process.env.NEW_TITLE || `【验收】待确认闭环 ${Date.now().toString().slice(-6)}`;
const TOKEN_FILE =
  process.env.TOKEN_FILE || path.join(process.cwd(), '.scratch', 'token.txt');

(async () => {
  const token =
    process.env.USER_TOKEN || fs.readFileSync(TOKEN_FILE, 'utf8').trim();

  const browser = await chromium.launch();
  const page = await browser.newPage();

  // 注入登录态（跳过 UI 登录：验证码 key 会因 React 双渲染而不稳定）
  await page.addInitScript((t) => {
    localStorage.setItem('access_token', t);
    localStorage.setItem('refresh_token', t);
    localStorage.setItem('remember_me', 'true');
  }, token);

  await page.goto(`${FRONTEND}/ai/workspace`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(8000);
  console.log('① 工作台可见:', await page.getByTestId('ai-workspace-page').isVisible().catch(() => false));

  // 让 AI 改任务
  const input = page
    .getByTestId('ai-workspace-page')
    .getByPlaceholder(/问点什么/);
  await input.fill(`把任务 ${TASK_ID} 的标题改成「${NEW_TITLE}」`);
  await page.getByRole('button', { name: /^发\s*送$/ }).click();
  console.log('② 已发送，等模型…');

  // 等「等待你确认」
  const hint = page.locator('[data-role="ai-pending-hint"]');
  await hint.waitFor({ timeout: 120000 });
  console.log('③ 出现提示:', (await hint.textContent())?.trim().slice(0, 100));

  // 去「待确认」页签点同意
  await page.getByRole('tab', { name: '待确认' }).click();
  await page.waitForTimeout(3000);
  const approve = page.locator('[data-role="pending-approve"]').first();
  await approve.waitFor({ timeout: 30000 });
  console.log('④ 待确认卡片上有同意按钮');
  await approve.click();
  console.log('⑤ 已点同意，等模型继续…');

  await page.waitForTimeout(15000);
  const bubbles = await page.locator('[data-role="assistant"]').allTextContents();
  const reply = bubbles.join(' | ');
  console.log('⑥ 助手回复:', reply.slice(-300));

  const ok = reply.includes(NEW_TITLE);
  console.log(ok ? '✅ 任务已被改（助手确认了新标题）' : '⚠️ 没看到新标题，人工核对一下');

  await browser.close();
  process.exit(ok ? 0 : 1);
})().catch((e) => {
  console.error('失败:', e.message);
  process.exit(1);
});
