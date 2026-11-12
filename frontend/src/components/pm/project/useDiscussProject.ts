import { useModel } from '@umijs/max';
import { useCallback } from 'react';
import {
  buildAiProjectContext,
  mergeDictLabels,
} from '@/components/pm/aiContext';
import { useDictOptions } from '@/components/pm/useDictOptions';
import type { ProjectOut } from '@/services/api/pm/project';

/**
 * 「与 AI 讨论」—— 列表视图与卡片视图**共用**的同一份实现。
 *
 * ## 为什么必须是同一份
 *
 * 项目清单有两种视图（表格 / 卡片），两边都有一个「与 AI 讨论」按钮。
 * 如果各写一份 ⇒ 迟早有一边漏了字段、或者一边忘了切到「对话」页签
 * ⇒ 用户在两个视图里得到**不一样的**行为 ⇒ 这才叫分裂。
 *
 * ⇒ 所以这里是**一个** hook，两个视图都调它。
 *
 * ## 做什么
 *
 * 把用户点的那**一行项目**设为当前讨论对象：
 * 1. 前端组装上下文（不发请求 —— 用户点的是他看到的这一行）；
 * 2. 塞进 AI 工作台的全局桥（`ai-bridge`）；
 * 3. 展开面板（它可能是收着的）；
 * 4. 切到「对话」页签（点完就能说话）。
 *
 * @returns 绑到按钮上的处理函数
 */
export function useDiscussProject(): (project: ProjectOut) => void {
  /** AI 工作台 ↔ 主工作区的桥（当前讨论对象） */
  const aiBridge = useModel('ai-bridge');

  // 字典选项:上下文字段里要把线上码翻成中文（模型照抄线上码就会写出不存在的状态）
  const { options: statusOptions } = useDictOptions('module_pm_project_status');
  const { options: priorityOptions } = useDictOptions('module_pm_priority');

  /**
   * 「与 AI 讨论」：把**这个项目**设为当前讨论对象。
   *
   * ⚠️ 上下文由**前端**组装（不发请求）：用户点的是他看到的这一行。
   */
  return useCallback(
    (record: ProjectOut) => {
      const context = buildAiProjectContext({
        project: {
          id: record.id,
          code: record.code,
          name: record.name,
          status_code: record.status_code,
          priority_code: record.priority_code,
          owner_by: record.owner_by,
        },
        labels: mergeDictLabels(statusOptions, priorityOptions),
      });
      if (!context) {
        return;
      }
      aiBridge.setContext(context);
      // 面板可能是收着的 ⇒ 展开它
      aiBridge.requestExpand();
      // 切到「对话」页签（点完就能说话）
      aiBridge.requestFocus();
    },
    [aiBridge, priorityOptions, statusOptions],
  );
}
