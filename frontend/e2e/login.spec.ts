/**
 * 登录页 —— 验证码**不依赖真实后端**。
 *
 * ## 为什么要有这个 mock
 *
 * 验证码图片是**后端下发的**（`/api/v1/system/auth/captcha/get` 返回 base64 data URL）
 * ⇒ 而 e2e 的前端跑在**本地 preview**（`http://localhost:8010`）
 * ⇒ 不拦这个接口的话，这条用例就**依赖线上后端** ⇒ 线上抖动 / 证书 / 验证码服务慢
 * ⇒ 随机失败（2026-11-16 卡过 PR #95）。
 *
 * ⇒ 照仓里已有的做法拦掉它（`e2e/helpers.ts` 的 `page.route` 模式）：
 * **自己返回一张图** ⇒ 用例只验「登录页长什么样」，不碰线上。
 */

import { expect, test } from '@playwright/test';

/** 1×1 的透明 PNG（data URL）—— 当作「验证码图片」。 */
const FAKE_CAPTCHA_IMAGE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** 拦掉验证码接口（自己发一张图）。 */
async function mockCaptcha(page: import('@playwright/test').Page): Promise<void> {
  await page.route('**/api/v1/system/auth/captcha/get', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        code: 0,
        msg: '成功',
        data: {
          enable: true,
          key: 'e2e-captcha-key',
          img_base: FAKE_CAPTCHA_IMAGE,
        },
        status_code: 200,
        success: true,
      }),
    }),
  );
}

test.describe('Login Page', () => {
  test('should show the login form and the captcha image', async ({ page }) => {
    // 需要等待 umi 编译完成
    test.setTimeout(60_000);
    // ⚠️ **验证码自己发**（不依赖线上后端 ⇒ 这条用例不再随机失败）
    await mockCaptcha(page);
    await page.goto('/user/login');

    await expect(page.getByText('AiAdmin').first()).toBeVisible({
      timeout: 30_000,
    });
    // 验证码图片是后端下发的 base64 data URL（这里是自己 mock 的那张）
    await expect(page.locator('img[alt="点击刷新验证码"]')).toBeVisible();
  });

  test('验证码接口失败 ⇒ 页面给出「加载失败」与重试入口（不白屏）', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    // ⚠️ **故意让它失败** ⇒ 验「验证码挂了也要有话说」
    await page.route('**/api/v1/system/auth/captcha/get', (route) =>
      route.fulfill({ status: 500, body: '{}' }),
    );
    await page.goto('/user/login');

    await expect(page.getByText('验证码加载失败')).toBeVisible({
      timeout: 30_000,
    });
    // ⚠️ antd 会在两个汉字之间插空格 ⇒ 「重 试」
    await expect(page.getByRole('button', { name: /重\s*试/ })).toBeVisible();
  });
});
