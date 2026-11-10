/**
 * 「与 AI 讨论」的**界面**验收（一次性脚本）：
 * 点「讨论」⇒ 面板头部下面出现「当前讨论」条（任务/项目/里程碑/状态）。
 *
 * 用法：node scripts/verify-discuss-bar.mjs
 */

import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';

const TOKEN = readFileSync('D:/tmp/token.txt', 'utf8').trim();
const BASE = 'http://localhost:8000';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });

page.on('pageerror', (err) => console.log('[pageerror]', String(err).slice(0, 300)));

await page.addInitScript((token) => {
  localStorage.setItem('access_token', token);
  localStorage.setItem('refresh_token', token);
  localStorage.setItem('remember_me', 'true');
}, TOKEN);

await page.goto(`${BASE}/pm/task`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(8000);

const row = page.locator('tr', { hasText: '测试333' }).first();
await row.waitFor({ timeout: 30000 });
await row.locator('button', { hasText: '讨论' }).first().click();
await page.waitForTimeout(1500);

const bar = page.locator('[data-testid="ai-context-bar"]');
console.log('「当前讨论」条出现：', await bar.count());
if (await bar.count()) {
  console.log('内容：', (await bar.innerText()).replace(/\s+/g, ' '));
}
await page.screenshot({ path: 'D:/tmp/discuss-bar-01.png' });

// 切到「待确认」页签 ⇒ 条必须还在（这是用户反馈「什么都没变」的关键）
await page.getByRole('tab', { name: /待确认/ }).first().click();
await page.waitForTimeout(1200);
console.log('切到待确认页签后仍在：', await bar.count());
await page.screenshot({ path: 'D:/tmp/discuss-bar-02.png' });

// 结束讨论 ⇒ 条消失
const end = page.getByRole('button', { name: /结束讨论/ }).first();
if (await end.count()) {
  await end.click();
  await page.waitForTimeout(800);
  console.log('结束讨论后还在：', await bar.count());
}
await page.screenshot({ path: 'D:/tmp/discuss-bar-03.png' });

// 收起面板后再点「讨论」⇒ 面板要自动展开
await page.getByRole('button', { name: /收起 AI 工作台/ }).click();
await page.waitForTimeout(800);
console.log('收起后再点「讨论」：');
await page.locator('tr', { hasText: '测试333' }).first().locator('button', { hasText: '讨论' }).first().click();
await page.waitForTimeout(1200);
console.log('  条还在：', await bar.count(), '| 面板宽度：', await page.locator('.ant-layout-sider').last().evaluate((el) => el.getBoundingClientRect().width).catch(() => 'n/a'));
await page.screenshot({ path: 'D:/tmp/discuss-bar-04.png' });

await browser.close();
