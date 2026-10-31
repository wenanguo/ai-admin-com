import { expect, test } from '@playwright/test';

test.describe('Login Page', () => {
  test('should show the login form and the captcha image', async ({ page }) => {
    // 需要等待 umi 编译完成
    test.setTimeout(60_000);
    await page.goto('/user/login');

    await expect(page.getByText('AiAdmin').first()).toBeVisible({
      timeout: 30_000,
    });
    // 验证码图片是后端下发的 base64 data URL
    await expect(page.locator('img[alt="点击刷新验证码"]')).toBeVisible();
  });
});
