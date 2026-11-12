/**
 * AI 工作台**全宽页**（规格 §4）。
 *
 * 路由 `/ai/workspace`（后端菜单「AI智能助手」指的就是它）。
 *
 * ## 这一页只是「宽版内容的一个宿主」
 *
 * 宽版内容本身在 `AiWorkspaceWide` 里 —— 因为它还有另一个宿主：
 * 从 400px 的小浮层点「全宽页」⇒ **浮层**盖住内容区（原页面不卸载）。
 *
 * ⇒ 两种宿主共用同一份实现（免得改一处漏一处）。
 *
 * ## 这一页的会话与浮层是**同一个**
 *
 * 会话 id 存在 `localStorage['aipm.workspace']` 里 ⇒ 两边共用一个会话。
 * ⚠️ 这一页上**不挂浮层**（见 `AiWorkspaceShell`）——
 * 两个 `useWorkspace` 实例会各建一个会话（还会互相覆盖存储里的会话 id）。
 */
import { history } from '@umijs/max';
import type React from 'react';
import { AiWorkspace } from '@/components/ai-workspace';

/**
 * AI 工作台全宽页。
 */
export default function AiWorkspacePage(): React.ReactElement {
  return (
    <AiWorkspace
      variant="wide"
      onBack={() => {
        history.back();
      }}
    />
  );
}
