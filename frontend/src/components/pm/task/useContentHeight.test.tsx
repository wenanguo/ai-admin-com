/**
 * `useContentHeight` 的测试 —— 高度口径的钉子。
 *
 * ⚠️ 本项目跑的是 **browser mode**（vitest-browser-react）⇒ DOM 是真的
 *    ⇒ 高度得靠真实的 inline style 撑出来。
 *
 * 覆盖三件事：
 * 1. 高度 = 滚动祖先的可用高度（减去上方占用的）
 * 2. 滚动祖先变小（窗口缩放）⇒ 高度跟着变
 * 3. 找不到滚动祖先 ⇒ 不炸，用下限
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from 'vitest-browser-react';
import { useContentHeight } from './useContentHeight';

/**
 * 造一个「自己滚的祖先 + 上方占位 + 渲染位」。
 *
 * ⚠️ React 必须**直接渲染进这个祖先内部**（用 render 的 container 选项）
 *    ⇒ 元素一挂上就有个可滚的父链（先渲染再挪走的话，
 *    父链在挪动前就已经量过了）。
 */
function mountScrollParent(options: { height: number; topOffset: number }) {
  const parent = document.createElement('div');
  parent.style.overflowY = 'auto';
  parent.style.height = `${options.height}px`;
  parent.style.position = 'relative';

  const spacer = document.createElement('div');
  spacer.style.height = `${options.topOffset}px`;
  parent.appendChild(spacer);

  const mount = document.createElement('div');
  parent.appendChild(mount);

  document.body.appendChild(parent);
  return { parent, mount };
}

/** 把 hook 结果挂到一个真实 DOM 节点上的小组件。 */
function Probe({ onHeight }: { onHeight: (h: number) => void }) {
  const { ref, height } = useContentHeight<HTMLDivElement>({ min: 100 });
  onHeight(height);
  return (
    <div
      ref={ref}
      data-testid="content-height-view"
      style={{ height: `${height}px` }}
    />
  );
}

describe('useContentHeight', () => {
  afterEach(() => {
    cleanup();
  });

  it('高度 = 滚动祖先的可用高度（减去上方占用的）', async () => {
    const { parent, mount } = mountScrollParent({
      height: 800,
      topOffset: 120,
    });
    let latest = 0;
    await render(
      <Probe
        onHeight={(h) => {
          latest = h;
        }}
      />,
      { container: mount },
    );

    // 800 - 120 = 680
    await expect.poll(() => latest).toBe(680);
    parent.remove();
  });

  it('滚动祖先变小 ⇒ 高度跟着变', async () => {
    const { parent, mount } = mountScrollParent({ height: 800, topOffset: 0 });
    let latest = 0;
    await render(
      <Probe
        onHeight={(h) => {
          latest = h;
        }}
      />,
      { container: mount },
    );

    await expect.poll(() => latest).toBe(800);

    // 模拟窗口缩放 ⇒ 内容区变矮
    parent.style.height = '500px';

    await expect.poll(() => latest).toBe(500);
    parent.remove();
  });

  it('找不到滚动祖先 ⇒ 用下限，不炸', async () => {
    let latest = 0;
    await render(
      <Probe
        onHeight={(h) => {
          latest = h;
        }}
      />,
    );

    // 没有可滚祖先 ⇒ 保持下限 100
    await expect.poll(() => latest).toBe(100);
  });
});
