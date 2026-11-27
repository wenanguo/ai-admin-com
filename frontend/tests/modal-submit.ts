/**
 * 「点弹窗里的确定按钮」这件事的**共享等待助手**。
 *
 * ## 为什么要有它
 *
 * 弹窗里的「确定」按钮,在**挂载那一刻**并不是最终那个节点:
 *
 * 1. ProComponents 的 `ModalForm` 先把提交按钮 **inline 渲染在表单旁边**,
 *    等 footer 的 ref 挂上后再 `forceUpdate`、用 portal **搬进 footer**
 *    ⇒ 中间 **DOM 节点会被换掉一次**
 *    (见 `@ant-design/pro-components` → `form/layouts/_shared/useOverlayForm`
 *    的 `contentRender`:没有 `footerRef.current` 时直接渲染 `submitterDom`,
 *    有了就 `createPortal(submitterDom, footerRef.current)`)。
 * 2. 搬完之后,弹窗还要走一遍 **入场动画**(antd 的 zoom 动效,
 *    是 **CSS animation**,不是 transition)
 *    ⇒ 这段时间里弹窗整体在**缩放**、`transform` 一直在变。
 *
 * ⇒ 两个窗口里点「确定」都可能点空:
 * 窗口 ① 是「点到的节点不是最终那个节点」,
 * 窗口 ② 是「点下去的那一瞬间弹窗还在动」。
 *
 * ⚠️ **#154 踩过的坑**:issue #154 等的是「按钮已经在 footer 里」——
 *    而「按钮进 footer」发生在**挂载那一刻**,比入场动画**早得多**
 *    ⇒ 等「在 footer 里」根本等不到动画结束 ⇒ 那次修的其实只是窗口 ①。
 *    真正的窗口 ② 要等「动画结束」这个**状态**才说得清。
 *
 * ## 这里等的是**状态**,不是时间
 *
 * `submitButtonReadiness()` 是一个**同步的状态判定**,它回答
 * 「现在能不能安全地点确定」;`waitForSubmitButtonReady()` 只是
 * 「反复问这个状态,直到答案是 ready」。
 *
 * ⇒ **没有任何 sleep、没有「多等一会儿」**;
 *    `timeout` 只是这条状态等待的**上限**(状态在几百毫秒内就会达成),
 *    不是「靠拖时间把用例糊过去」。
 */

/** 「确定」按钮的中文文案(antd 会在两个汉字之间插空格) */
const CONFIRM_TEXT = /确\s*认/;

/**
 * rc-motion / antd 的动效类名。
 *
 * 弹窗打开时 `.ant-modal` 上会带 `ant-zoom-appear` / `ant-zoom-appear-active`
 * (入场)或 `ant-zoom-leave` / `ant-zoom-leave-active`(退场),
 * **动画结束后这些类会被摘掉** ⇒ 「有没有动效类」就是「动画有没有结束」。
 *
 * ⚠️ 这里匹配的是 rc-motion 的**命名约定**(`appear` / `enter` / `leave`),
 *    不是 antd 的某个具体类名 ⇒ antd 换主题、换动效名也不影响。
 *
 * ⚠️ **实测**:`rerender` 换角色后,**立刻**就能在 `.ant-modal` 上看到
 *    `ant-zoom-appear ant-zoom-appear-start` ⇒ 动效类在**挂载那一刻**
 *    就已经在了 ⇒ 「等动效类消失」**不会**落进「动画还没开始」的缝里
 *    （#154 那次等的「按钮在不在 footer 里」就有这个缝）。
 */
const MOTION_CLASS = /(?:^|-)(appear|enter|leave)(?:-|$)/;

/**
 * 「确定」按钮当前的**状态**。
 *
 * 每一项都说明了「为什么现在还不能点」——
 * `animating` 就是**原竞态真正发生的那一步**。
 */
export type SubmitButtonState =
  /** 可以点了 */
  | 'ready'
  /** 弹窗还没挂出来 */
  | 'no-modal'
  /** 弹窗的入场/退场动画还没结束(原竞态的窗口) */
  | 'animating'
  /** 弹窗里还没有「确定」按钮 */
  | 'no-button'
  /** 「确定」按钮还没被搬进 footer(portal 搬运没完成) */
  | 'not-in-footer'
  /** 「确定」按钮是禁用的(表单还不许提交) */
  | 'disabled';

/**
 * 判定「现在能不能安全地点确定」——**同步**的,没有等待、没有 sleep、没有副作用。
 *
 * ⚠️ 判定顺序是**从外到内**:先看动画,再看节点归属。
 *    这样在「动画还在跑」的时候,报出来的原因就是 `animating`
 *    —— 也就是原竞态真正发生的那一步。
 */
export function submitButtonState(scope: ParentNode = document): SubmitButtonState {
  const modals = [...scope.querySelectorAll('.ant-modal')];
  if (modals.length === 0) return 'no-modal';

  // ⇒ 动画还在跑 ⇒ 弹窗整体在缩放,按钮也在动 ⇒ 不许点
  if (modals.some((modal) => [...modal.classList].some((n) => MOTION_CLASS.test(n)))) {
    return 'animating';
  }

  // ⇒ 找「有确定按钮的那个弹窗」
  const modal = modals.find((m) => findConfirmButton(m));
  if (!modal) return 'no-button';

  const button = findConfirmButton(modal);
  if (!button) return 'no-button';

  // ⇒ 提交按钮必须已经在 footer 里(portal 搬运完成)
  if (!button.closest('.ant-modal-footer')) return 'not-in-footer';

  if (button.disabled) return 'disabled';

  return 'ready';
}

/** 找出弹窗里的「确定」按钮(按文案匹配) */
function findConfirmButton(scope: ParentNode): HTMLButtonElement | null {
  for (const button of scope.querySelectorAll<HTMLButtonElement>('button')) {
    if (CONFIRM_TEXT.test(button.textContent ?? '')) return button;
  }
  return null;
}

/** 「确定」按钮现在的盒子(取整,免得亚像素抖动被当成「在动」) */
function confirmButtonBox(scope: ParentNode): string | null {
  const modal = scope.querySelector('.ant-modal');
  const button = modal ? findConfirmButton(modal) : null;
  if (!button) return null;
  const rect = button.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;
  return `${Math.round(rect.x)},${Math.round(rect.y)},${Math.round(rect.width)},${Math.round(rect.height)}`;
}

/**
 * 等「确定按钮可以安全点击」——等的是**状态**。
 *
 * 除了 `submitButtonState()` 那几条,还额外要求
 * **按钮的盒子在两次采样之间没有变**:
 *
 * ⚠️ 这是 #154 的 note 里记过的**实测**位移:菜单树数据一到,
 *    弹窗内容变高,底部的「确定」按钮会**整体上移**(实测 top 442 → 498)。
 *    ⇒ 「动画结束了」还不够,还要确认**内容不再把它挪走**。
 *
 * ⚠️ 这条检查放在**动画结束之后**才有意义:
 *    动画期间盒子本来就在变(而且「动画还没开始」时它也可能一动不动
 *    —— 那正是 #154 踩的坑),所以顺序必须是
 *    **先等动画结束,再看盒子稳不稳**。
 *
 * @param timeout 状态等待的**上限**(毫秒)。状态正常在几百毫秒内达成;
 *                给它一个上限只是为了让「状态永远达不成」时能**快速失败**,
 *                而不是把整个用例挂到 vitest 的 15s 超时。
 */
export async function waitForSubmitButtonReady(
  options: { timeout?: number; scope?: ParentNode } = {},
): Promise<void> {
  const { timeout = 10_000, scope = document } = options;
  const deadline = Date.now() + timeout;
  let state: SubmitButtonState = 'no-modal';
  let lastBox: string | null = null;

  for (;;) {
    state = submitButtonState(scope);
    if (state === 'ready') {
      const box = confirmButtonBox(scope);
      // ⇒ 盒子和上一次采样一致 ⇒ 它真的停下来了
      if (box !== null && box === lastBox) return;
      lastBox = box;
    } else {
      lastBox = null;
    }

    if (Date.now() >= deadline) {
      throw new Error(
        `等了 ${timeout}ms,「确定」按钮仍然不能点(当前状态:${state})`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
}
