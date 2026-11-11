import { App, ConfigProvider } from 'antd';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from 'vitest-browser-react';
import { getAppMessage, setAppMessage } from '@/utils/appMessage';
import AppMessageBridge from './AppMessageBridge';

/**
 * 桥组件的单测。
 *
 * 钉住三件事:
 * - 挂上以后,模块级能拿到 `App.useApp()` 的实例(请求层就是从这儿取的)
 * - 这个实例吃 ConfigProvider 的主题 —— 静态 message API 不吃,
 *   这正是把它换掉的理由(主题色进了提示的样式就是证据)
 * - 卸载时撤销发布,不留指向已卸载组件树的死实例
 */
describe('AppMessageBridge', () => {
  afterEach(async () => {
    await cleanup();
    setAppMessage(null);
  });

  it('publishes the App.useApp() instance while mounted', async () => {
    await render(
      <App>
        <AppMessageBridge />
      </App>,
    );

    await expect.poll(() => getAppMessage()).not.toBeNull();
    expect(typeof getAppMessage()?.error).toBe('function');
  });

  it('withdraws the instance when unmounted', async () => {
    const { unmount } = await render(
      <App>
        <AppMessageBridge />
      </App>,
    );

    await expect.poll(() => getAppMessage()).not.toBeNull();

    await unmount();

    await expect.poll(() => getAppMessage()).toBeNull();
  });

  it('renders the toast with the ConfigProvider theme', async () => {
    // 主题色只写在 ConfigProvider 上:静态 message API 拿不到它,
    // App.useApp() 的实例才拿得到 —— 这条断言就是「提示能被主题影响」的验收点。
    await render(
      <ConfigProvider theme={{ token: { colorError: 'rgb(255, 0, 255)' } }}>
        <App>
          <AppMessageBridge />
        </App>
      </ConfigProvider>,
    );

    await expect.poll(() => getAppMessage()).not.toBeNull();

    getAppMessage()?.error('出错了');

    const notice = await waitForNotice();
    const icon = notice.querySelector('.anticon');
    expect(icon).toBeTruthy();
    expect(getComputedStyle(icon as Element).color).toBe('rgb(255, 0, 255)');
  });
});

/** 等提示出现在 DOM 里(message 的入场有动画延迟) */
async function waitForNotice(): Promise<Element> {
  let notice: Element | null = null;
  for (let i = 0; i < 50 && !notice; i += 1) {
    notice = document.querySelector('.ant-message-notice');
    if (!notice) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  if (!notice) throw new Error('提示没有渲染出来');
  return notice;
}
