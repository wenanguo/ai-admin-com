import type { Page } from '@playwright/test';

/**
 * 等应用真正挂载。
 *
 * umi dev server 首次编译时,页面先显示「正在加载资源」这一屏,
 * 此时应用还没跑起来 —— 断言会全部落空(接口都还没发出去)。
 * CI 上没有预热的 dev server,尤其容易踩。
 *
 * 判断条件与页面形态无关:登录页走的是 UserLayout,没有 ProLayout。
 *
 * 另外还要挡掉打包器的「正在编译」提示:
 * dev server 是**按需编译**的,首屏加载完之后,路由对应的 chunk 可能还在编译,
 * 页面会停在「Utoopack is compiling...」。此时 #root 已经有内容(Skeleton),
 * 但真正的页面还没渲染 —— 只判断 #root 有子节点会过早放行,断言随即失败。
 *
 * 现在 e2e 默认跑生产构建(见 playwright.config.ts),这条分支只在
 * 有人手动对着 dev server 跑 `e2e:only` 时才会命中。
 */
export async function waitForApp(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const root = document.getElementById('root');
      const loading = document.body.textContent?.includes('正在加载资源');
      const compiling = document.body.textContent?.includes('compiling');
      return !!root && root.childElementCount > 0 && !loading && !compiling;
    },
    undefined,
    { timeout: 120_000 },
  );
}
