/**
 * 表格体高度 —— 让 ProTable 的表格体**吃满剩余高度**（内部滚动、表头固定）。
 *
 * ## 为什么不能写死一个数
 *
 * 表格体上面还有：搜索表单（可展开/收起）+ 工具栏；下面还有分页。
 * 这些高度会变（表单收起、屏幕窄时换行）⇒ 写死的 `scroll.y` 要么留白、要么溢出。
 *
 * ## 怎么量
 *
 * - `thead` 的**下边**相对 `.ant-table-wrapper` 顶部的距离
 *   ⇒ 就是「表格体开始的位置」（含搜索表单 + 工具栏 + 表头）
 * - 分页占的高度（分页在表格外面，要单独减）
 *
 * ⚠️ 量不到（表格还没渲染）⇒ 返回 `undefined`
 *   ⇒ **不给 `scroll.y`**（表格自然高度）⇒ 等量到了再给。
 */
import { useEffect, useState } from 'react';

/** 一个元素占的总高度（内容 + 上下外边距）。 */
function occupied(element: Element): number {
  const style = window.getComputedStyle(element);
  const marginTop = Number.parseFloat(style.marginTop) || 0;
  const marginBottom = Number.parseFloat(style.marginBottom) || 0;
  return element.getBoundingClientRect().height + marginTop + marginBottom;
}

/**
 * 量表格体的高度。
 *
 * @param container 包住 ProTable 的容器（还没有时传 `null`）
 * @param availableHeight 视图的可用高度（内容区里还剩多少）
 */
export function useTableBodyHeight(
  container: HTMLElement | null,
  availableHeight: number,
): number | undefined {
  const [bodyHeight, setBodyHeight] = useState<number | undefined>(undefined);

  useEffect(() => {
    if (!container) {
      return undefined;
    }

    const measure = () => {
      const wrapper = container.querySelector('.ant-table-wrapper');
      const thead =
        wrapper?.querySelector('.ant-table-thead') ??
        wrapper?.querySelector('thead');
      if (!wrapper || !thead) {
        // 表格还没渲染出来 ⇒ 先不给 scroll.y
        return;
      }
      const wrapperTop = wrapper.getBoundingClientRect().top;
      // 表格体的顶部（thead 下边）
      const bodyTop = thead.getBoundingClientRect().bottom - wrapperTop;
      const pagination = container.querySelector('.ant-pagination');
      const paginationHeight = pagination ? occupied(pagination) : 0;
      const next = Math.max(
        200,
        Math.round(availableHeight - bodyTop - paginationHeight - 8),
      );
      setBodyHeight(next);
    };

    measure();
    // 表格出现/变高、搜索表单展开收起、分页换行 ⇒ 容器尺寸变了就重量
    const observer = new ResizeObserver(() => measure());
    observer.observe(container);
    return () => observer.disconnect();
  }, [availableHeight, container]);

  return bodyHeight;
}
