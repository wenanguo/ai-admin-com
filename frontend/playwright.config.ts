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
      // ⚠️ 视口为什么是 1600x900(而不是 Desktop Chrome 默认的 1280x720):
      // 1280 宽时 ProTable 的搜索表单在表单宽度 < 576px 时会塌成
      // 「一行一个字段」⇒「用第二个搜索字段筛选」这类用例点不到那个字段。
      // 1600 宽是现在常见的笔记本屏幕。
      //
      // ⚠️ 以前这里还有一条「AI 工作台占 400px 右栏」的顾虑 ——
      //    **现在没有了**：AI 工作台改成了浮层，不占布局宽度 ⇒
      //    主内容宽度**始终不变**（见 `AiWorkspaceShell.tsx`）。
      //
      // ⚠️ 必须写在 devices 的**后面**:项目级的 use 会覆盖顶级的 use。
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1600, height: 900 },
      },
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
    //
    // ⚠️ `preview:e2e`(8010)与 `preview`(8000)是两个不同用途的脚本:
    // - `preview`     → 8000 端口,**给人工预览**用(照常代理 `/ai-api/` 到 AI 服务);
    // - `preview:e2e` → 8010 端口,**只服务 e2e**,自带 `PROXY_AI_API=off`。
    // 关掉 8010 的 AI 代理不会影响 8000 的人工预览。
    command: 'npm run preview:e2e',
    url: 'http://localhost:8010',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // ⚠️ 为什么 e2e 要把 AI 服务的代理关掉(PROXY_AI_API=off):
    // 预览服务器默认会把 `/ai-api/**` 代理到**在线的 AI 服务**(3100),
    // 而 AI 服务会拿浏览器带来的 AiAdmin token 去后端验真 ⇒ e2e 的假 token
    // (`e2e-mock-access-token`)是 401 ⇒ AI 服务如实回 401 ⇒ 前端共享请求层
    // 对 401 走「静默刷新 token + 重放」⇒ 刷新也失败 ⇒ **全局登出**
    // ⇒ 页面跳到 /user/login ⇒ 所有「等表格渲染」的断言超时。
    //
    // 关掉之后 `/ai-api/**` 打到静态服务器 ⇒ umi preview 的 SPA fallback
    // 返回**首页 index.html(200, `content-type: text/html`)**(**不是 401**)
    // ⇒ 前端不会触发「刷新 token ⇒ 登出」。
    //
    // ⚠️ AI 相关的用例**自己 mock 了 AI 服务**
    // (e2e/ai-workspace.spec.ts 的 setupAiService,在浏览器侧拦截)⇒ 不受影响。
    // ⚠️ 本地开发(`npm run dev`)不设这个变量 ⇒ 照常代理到 AI 服务。
    //
    // ⚠️ 为什么这里**还要**写一遍 env(开关其实已经下沉到 `preview:e2e` 脚本):
    // `webServer.env` **只在 Playwright 自己拉起进程时**才生效;
    // 而 `reuseExistingServer: !process.env.CI` 为真时,Playwright 会**直接复用**
    // 8010 上已经在跑的那台服务器 —— 那台若是用别的命令起的(没带 `PROXY_AI_API=off`),
    // 代理就还开着 ⇒ 401 ⇒ 登出 ⇒ 70 个失败,而且看起来像 flaky。
    // 所以真正的修复是**下沉到 `preview:e2e` 脚本**(任何用该脚本起的服务器代理都是关的),
    // 这里的 env 只是「Playwright 自己拉起」这条路径上的双保险。
    env: { ...process.env, PROXY_AI_API: 'off' },
  },
});
