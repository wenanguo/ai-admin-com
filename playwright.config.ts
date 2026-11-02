import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e-out/test-results',
  reporter: [['html', { outputFolder: 'e2e-out/playwright-report' }]],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // dev server 首次编译某个路由的 chunk 可能要十几秒,断言的默认 5s 超时不够用
  expect: {
    timeout: 30_000,
  },
  use: {
    // 用 8010 而不是 8000:8000 是 dev server 的默认端口,
    // 本地开发时 `npm start` 常驻在那儿,playwright 的 reuseExistingServer 会
    // 悄悄复用 dev server,于是又回到「等 chunk 编译」的不确定状态。
    // 端口分开后,e2e 永远对着独立的 preview 服务。
    baseURL: 'http://localhost:8010',
    trace: 'on-first-retry',
    locale: 'en-US',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    // 跑**生产构建**而不是 dev server:
    // dev server 按需编译路由 chunk,首次访问 /system/user 时页面会停在
    // 「Utoopack is compiling...」,断言在编译完成前就发出 ⇒ 用例随机失败
    // (已实测:同一份代码对着 dev server 跑 4 条用例,有时 4 通过、有时 1 条超时;
    //   对着生产构建跑则稳定 4 通过、耗时从 22s 降到 6s)。
    // 副作用是好的:e2e 同时验证了真实构建产物。
    // 前置条件是 dist/ 已构建 —— `npm run e2e` 会先 build,这里只负责起服务。
    command: 'npm run preview:e2e',
    url: 'http://localhost:8010',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
