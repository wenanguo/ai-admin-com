/**
 * 所有列表的「操作」列**固定在右边**（横向滚动时不跟着滚走）。
 *
 * ## 为什么要有这条守卫
 *
 * 列一多就要横向滚 ⇒ 操作列（编辑 / 删除）会被滚出屏幕 ⇒
 * 用户得先滚回去才能改一行，操作列就白放在那儿了。
 *
 * ⇒ 共享脚手架 `useCrudColumns` 里的操作列加了 `fixed: 'right'`。
 *
 * ⚠️ **antd 的 `fixed` 列必须配 `scroll.x` 才有粘性效果**
 *    （没配的话它只是一列普通的列，还会报 warning）
 *    ⇒ 每个用到操作列的表都要 `scroll={{ x: 'max-content' }}`。
 *
 * 这条用例钉的是**行为**（滚到最右，操作列还在原地），
 * 而不是「某一行代码里写了 fixed」⇒ 有人把 `scroll` 或 `fixed` 弄掉就会红。
 */
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { gotoModulePage, setupModulePage } from './helpers';

const PAGE_PATH = '/system/position';
const LIST_URL = '**/api/v1/system/position/list**';
const LIST_BODY = {
  code: 0,
  msg: '查询岗位列表成功',
  data: {
    items: [
      {
        id: 1,
        name: '后端工程师',
        code: 'backend',
        order: 7,
        status: 0,
        description: '负责服务端开发',
        created_time: '2026-06-21 17:56:33',
      },
    ],
    total: 1,
    page_no: 1,
    page_size: 10,
    has_next: false,
  },
  status_code: 200,
  success: true,
};

/** 「操作」列表头。 */
function actionHeader(page: Page) {
  return page.locator('.ant-table-thead th', { hasText: '操作' }).first();
}

test.describe('列表的操作列固定在右边', () => {
  test('横向滚到最右,操作列仍钉在右边且没出视口', async ({ page }) => {
    await setupModulePage(page, {
      menus: [
        {
          title: '岗位管理',
          routePath: 'position',
          permission: 'module_system:position:query',
          buttons: [],
        },
      ],
      listUrl: LIST_URL,
      listBody: LIST_BODY,
    });

    // ⚠️ 视口**故意弄窄**：表格撑得比容器宽 ⇒ 才会真的横向滚动
    //    （不窄的话表格放得下，就没有「滚」这回事，测不到东西）。
    await page.setViewportSize({ width: 900, height: 900 });

    await gotoModulePage(
      page,
      PAGE_PATH,
      page.locator('.ant-menu').getByText('岗位管理'),
    );
    await expect(page.locator('.ant-table-tbody tr.ant-table-row')).toHaveCount(
      1,
    );

    // 找到那个能横向滚的容器，并确认它**真的**能滚（否则下面就没意义了）
    const scrolled = await page.evaluate(() => {
      const table = document.querySelector('.ant-table');
      const scroller = table
        ? [...table.querySelectorAll('*')].find(
            (element) => element.scrollWidth > element.clientWidth + 10,
          )
        : undefined;
      if (!scroller) {
        return null;
      }
      scroller.scrollLeft = scroller.scrollWidth;
      return {
        scrollWidth: scroller.scrollWidth,
        clientWidth: scroller.clientWidth,
        scrollLeft: scroller.scrollLeft,
      };
    });
    expect(scrolled, '表格应该能横向滚动（视口故意弄窄了）').not.toBeNull();
    if (!scrolled) {
      throw new Error('表格应该能横向滚动（视口故意弄窄了）');
    }
    expect(scrolled.scrollWidth).toBeGreaterThan(scrolled.clientWidth);
    expect(scrolled.scrollLeft).toBeGreaterThan(0);

    // 操作列的**位置**：滚动前后都一样 ⇒ 它是钉住的
    const actionBox = await actionHeader(page).boundingBox();
    expect(actionBox).not.toBeNull();
    if (!actionBox) {
      throw new Error('操作列没有布局盒');
    }

    // 钉在**右边缘**：右边不超出视口
    const viewportWidth = page.viewportSize()?.width ?? 0;
    expect(actionBox.x + actionBox.width).toBeLessThanOrEqual(
      viewportWidth + 1,
    );

    // 再滚回最左，操作列仍然不动（⇒ 真的固定，不是「恰好在右边」）
    await page.evaluate(() => {
      const table = document.querySelector('.ant-table');
      const scroller = table
        ? [...table.querySelectorAll('*')].find(
            (element) => element.scrollWidth > element.clientWidth + 10,
          )
        : undefined;
      if (scroller) {
        scroller.scrollLeft = 0;
      }
    });
    await page.waitForTimeout(300);

    const actionBoxAfter = await actionHeader(page).boundingBox();
    expect(actionBoxAfter).not.toBeNull();
    if (!actionBoxAfter) {
      throw new Error('操作列没有布局盒');
    }
    expect(actionBoxAfter.x).toBeCloseTo(actionBox.x, 0);
  });

  test('操作列是最后一列(它钉在最右边)', async ({ page }) => {
    await setupModulePage(page, {
      menus: [
        {
          title: '岗位管理',
          routePath: 'position',
          permission: 'module_system:position:query',
          buttons: [],
        },
      ],
      listUrl: LIST_URL,
      listBody: LIST_BODY,
    });
    await gotoModulePage(
      page,
      PAGE_PATH,
      page.locator('.ant-menu').getByText('岗位管理'),
    );
    await expect(page.locator('.ant-table-tbody tr.ant-table-row')).toHaveCount(
      1,
    );

    const titles = await page.locator('.ant-table-thead th').allTextContents();
    expect(titles[titles.length - 1]?.trim()).toBe('操作');
  });
});
