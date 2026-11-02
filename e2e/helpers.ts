import type { Page } from '@playwright/test';

/**
 * 等应用真正挂载。
 *
 * umi dev server 首次编译时,页面先显示「正在加载资源」这一屏,
 * 此时应用还没跑起来 —— 断言会全部落空(接口都还没发出去)。
 * CI 上没有预热的 dev server,尤其容易踩。
 *
 * 判断条件与页面形态无关:登录页走的是 UserLayout,没有 ProLayout。
 */
export async function waitForApp(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const root = document.getElementById('root');
      const loading = document.body.textContent?.includes('正在加载资源');
      return !!root && root.childElementCount > 0 && !loading;
    },
    undefined,
    { timeout: 120_000 },
  );
}
