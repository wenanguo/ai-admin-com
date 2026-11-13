/**
 * 「内容区可用高度」—— 三个视图（列表 / 看板 / 甘特）共用。
 *
 * ## 为什么要有它
 *
 * 任务页三个视图以前各算各的：
 * - 看板：**没有高度概念** ⇒ 列高 = 内容高 ⇒ 卡片少时只有两百多像素，下面空一大片
 * - 列表：ProTable 自然高度 ⇒ 也不满高
 * - 甘特：自己有一套测量逻辑（`findScrollParent` + `spaceBelow`）
 *
 * ⇒ 三个视图高度不一致、切过去「塌一下」。
 * ⇒ 把甘特那套测量逻辑抽到这里，**三个视图共用一个口径**。
 *
 * ## 它量的是什么
 *
 * **从视图容器的顶部，到滚动祖先（内容区）的底部**的可用高度。
 *
 * ⚠️ 内容区（`.ant-pro-layout-content`）自己滚 ⇒ 视图应该**恰好占满**它，
 *    页面不出现外层滚动条（甘特的既有 e2e 断言就钉着这条）。
 *
 * ⚠️ 内容区里页面的**下面**还有页脚等兄弟节点 ⇒ 要减掉（见 `spaceBelow`）。
 */
import { useCallback, useEffect, useState } from 'react';

/** 默认下限：太矮就没法看了（甘特原来用 320，用户反馈「只显示了一小部分」）。 */
export const DEFAULT_MIN_HEIGHT = 420;

/** 往上找第一个「自己滚」的祖先（内容区）。 */
function findScrollParent(element: HTMLElement | null): HTMLElement | null {
  let node = element?.parentElement ?? null;
  while (node) {
    const overflowY = window.getComputedStyle(node).overflowY;
    if (overflowY === 'auto' || overflowY === 'scroll') {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

/** 一个元素占的总高度（内容 + 上下外边距）。 */
function occupied(element: HTMLElement): number {
  const style = window.getComputedStyle(element);
  const marginTop = Number.parseFloat(style.marginTop) || 0;
  const marginBottom = Number.parseFloat(style.marginBottom) || 0;
  return element.getBoundingClientRect().height + marginTop + marginBottom;
}

/**
 * 视图容器**下面**还占着多少高度（页脚等兄弟节点）。
 *
 * ⚠️ app shell 的页脚是内容区里页面的**兄弟节点** ⇒ 不减掉它，
 *    内容区就会多出一条滚动条（页面自己滚了）。
 */
function spaceBelow(element: HTMLElement, scrollParent: HTMLElement): number {
  let total = 0;
  let node: HTMLElement = element;
  while (node.parentElement && node.parentElement !== scrollParent) {
    let sibling = node.nextElementSibling as HTMLElement | null;
    while (sibling) {
      total += occupied(sibling);
      sibling = sibling.nextElementSibling as HTMLElement | null;
    }
    node = node.parentElement;
  }
  // ⚠️ node 现在是内容区的**直接子元素** ⇒ 它的后续兄弟（页脚）也要算
  //    （漏了这一段 ⇒ 页面比可用高度高 ⇒ 内容区多出一条滚动条）
  let sibling = node.nextElementSibling as HTMLElement | null;
  while (sibling) {
    total += occupied(sibling);
    sibling = sibling.nextElementSibling as HTMLElement | null;
  }
  return total;
}

/** useContentHeight 的返回值。 */
export interface ContentHeight<T extends HTMLElement> {
  /**
   * 挂在**视图容器**上的 ref（量高度要用它的顶边）。
   *
   * ⚠️ 是 **callback ref**（不是 `useRef`）：
   *    `useRef` 的 `current` 在首帧还是 `null`，而 effect 只在挂载后跑一次
   *    ⇒ 元素后挂上（比如条件渲染）就永远量不到高度。
   *    callback ref 把元素存进 state ⇒ 元素到位时 effect 自动重跑。
   */
  ref: (node: T | null) => void;
  /** 当前挂上去的元素（要拿它量别的东西时用）。 */
  element: T | null;
  /** 可用高度（px）。 */
  height: number;
}

/**
 * 量「视图容器顶部 → 内容区底部」的可用高度。
 *
 * @param options `min` 下限（默认 {@link DEFAULT_MIN_HEIGHT}）
 *
 * @example
 * ```tsx
 * const { ref, height } = useContentHeight<HTMLDivElement>();
 * return <div ref={ref} style={{ height }}>内容</div>;
 * ```
 */
export function useContentHeight<T extends HTMLElement>(options?: {
  min?: number;
}): ContentHeight<T> {
  const min = options?.min ?? DEFAULT_MIN_HEIGHT;
  const [element, setElement] = useState<T | null>(null);
  const [height, setHeight] = useState(min);

  /** callback ref：元素到位就存进 state ⇒ effect 重跑。 */
  const ref = useCallback((node: T | null) => {
    setElement(node);
  }, []);

  const measure = useCallback(() => {
    if (!element) {
      return;
    }
    const scrollParent = findScrollParent(element);
    if (!scrollParent) {
      return;
    }
    const parentRect = scrollParent.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();
    const parentStyle = window.getComputedStyle(scrollParent);
    const paddingBottom = Number.parseFloat(parentStyle.paddingBottom) || 0;
    const elementStyle = window.getComputedStyle(element);
    const marginBottom = Number.parseFloat(elementStyle.marginBottom) || 0;

    const available = Math.round(
      scrollParent.clientHeight -
        // 视图容器上面已经占掉的空间（内容区内边距 + 容器的上外边距）
        (elementRect.top - parentRect.top) -
        // 视图容器下面还有的东西（页脚）
        spaceBelow(element, scrollParent) -
        marginBottom -
        paddingBottom,
    );
    setHeight(Math.max(min, available));
  }, [element, min]);

  useEffect(() => {
    if (!element) {
      return undefined;
    }
    const scrollParent = findScrollParent(element);
    if (!scrollParent) {
      return undefined;
    }
    measure();
    // 内容区尺寸变了（窗口缩放、AI 工作台收放）⇒ 重新量
    const observer = new ResizeObserver(() => measure());
    observer.observe(scrollParent);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element, measure]);

  return { ref, element, height };
}
