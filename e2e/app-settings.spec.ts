import { expect, test } from '@playwright/test';
import { gotoModulePage, seedAuthState, setupModulePage } from './helpers';

/**
 * 顶栏的「设置」按钮（界面布局 / 主题）。
 *
 * ⚠️ 为什么要自己做一个按钮：
 * ProLayout 自带的那个浮动齿轮是 `SettingDrawer` 内部渲染的 `position: fixed`
 * 元素，**贴视口右边缘** ⇒ 会被右侧常驻的 AI 工作台面板（400px 宽、
 * 也是 `position: fixed`）整个盖住 ⇒ 用户再也开不了「布局与主题」。
 *
 * 而且那个抽屉 `closable: false`，**唯一的关闭入口就是那个把手**
 * ⇒ 顶栏这个按钮必须是**切换**，不能只“开”。
 */
test.describe('顶栏的设置按钮', () => {
  test.beforeEach(async ({ page }) => {
    await seedAuthState(page);
    await setupModulePage(page, {
      menus: [{ title: '岗位管理', routePath: 'position' }],
      listUrl: '**/api/v1/system/position/list**',
      listBody: { code: 0, data: { items: [], total: 0 } },
    });
    await gotoModulePage(
      page,
      '/system/position',
      page.locator('.ant-menu').getByText('岗位管理'),
    );
  });

  test('浮动齿轮被隐藏,顶栏上有可见可点的设置按钮', async ({ page }) => {
    // 内置的浮动把手不能被 AI 面板盖住就完事 —— 要彻底不渲染
    const floating = page.locator('.ant-pro-setting-drawer-handle');
    await expect(floating).toBeHidden();

    const toggle = page.getByTestId('app-setting-toggle');
    await expect(toggle).toBeVisible();

    // 点一下 ⇒ 设置抽屉打开
    await toggle.click();
    await expect(page.locator('.ant-drawer-open')).toBeVisible();

    // ⚠️ 抽屉是 `closable: false`（没有 X 按钮），而且它是 `placement="right"`，
    //    打开后**盖住顶栏右侧** ⇒ 那个切换按钮此时点不到。
    //    ⇒ 关闭靠点**遮罩**（antd 的 `maskClosable` 默认开）。
    await page
      .locator('.ant-drawer-mask')
      .click({ position: { x: 10, y: 10 } });
    await expect(page.locator('.ant-drawer-open')).toHaveCount(0);
  });
});
