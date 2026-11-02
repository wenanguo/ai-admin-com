import { App } from 'antd';
import { useEffect } from 'react';
import { setAppMessage } from '@/utils/appMessage';

/**
 * 把 `App.useApp()` 的 message 实例发布到模块级。
 *
 * 放在 antd 的 `<App>` 内部渲染即可;卸载时撤销发布,
 * 免得留下一个指向已卸载组件树的死实例。
 *
 * 为什么要这么绕:请求层的 errorHandler 是模块级函数,调不了 hook,
 * 而静态 `message` 不吃 ConfigProvider 的上下文(见 `@/utils/appMessage`)。
 */
export default function AppMessageBridge(): null {
  const { message } = App.useApp();

  useEffect(() => {
    // 不在 <App> 里时 useApp() 给的是空壳上下文({ message: {} }),
    // 发出去会让 message.error 直接抛「不是函数」—— 这种情况下不发布。
    if (typeof message?.error !== 'function') return;

    setAppMessage(message);
    return () => {
      setAppMessage(null);
    };
  }, [message]);

  return null;
}
