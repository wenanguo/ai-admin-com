import type { App } from 'antd';
import { message as staticMessage } from 'antd';

/**
 * antd 的**静态** `message` API 不消费 ConfigProvider 的**上下文**:
 * 拿不到 React 上下文里的 theme / locale,也不在 `<App>` 的 holder 里渲染。
 * `App.useApp()` 拿到的实例才吃上下文 —— 但它是 hook,只能在组件里调。
 *
 * 请求层的 errorHandler 是模块级函数(不是 React 组件),调不了 hook。
 * 于是用 `AppMessageBridge` 组件把实例发布到这里,请求层再从这里取。
 */

/** `App.useApp()` 返回的 message 实例类型 */
export type AppMessage = ReturnType<typeof App.useApp>['message'];

/** 当前已发布的实例;null = 桥组件还没挂上(或已卸载) */
let appMessage: AppMessage | null = null;

/**
 * 发布(或撤销发布)App 的 message 实例 —— 只由 `AppMessageBridge` 调用。
 *
 * 传 null 表示撤销:实例失效后必须退回静态 API,而不是留着一个
 * 指向已卸载组件树的死实例。
 */
export function setAppMessage(instance: AppMessage | null): void {
  appMessage = instance;
}

/** 已发布的 App 实例;桥组件还没挂上(或已卸载)时是 null */
export function getAppMessage(): AppMessage | null {
  return appMessage;
}

/**
 * 取当前可用的 message 实例 —— 请求层用这个。
 *
 * App 的实例优先;还没挂上时退回 antd 的静态 API ——
 * 静态 API 拿不到主题,但至少不会让整条错误提示链路崩掉。
 */
export function getMessage(): AppMessage {
  return appMessage ?? staticMessage;
}
