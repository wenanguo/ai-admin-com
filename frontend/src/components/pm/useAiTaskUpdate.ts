import { useModel } from '@umijs/max';
import type { GetProp, Table } from 'antd';
import { useCallback, useEffect, useState } from 'react';

/**
 * AI 写回成功 ⇒ 刷新当前列表 + 高亮那一行。
 *
 * ## 为什么需要它
 *
 * AI 在右侧工作台里改了任务，左边的列表/看板**不知道** ⇒ 用户看到的是
 * 「AI 说改好了，可我这边还是旧数据」⇒ 看着像没生效。
 *
 * ⇒ 收到写回信号（服务端的 `entity_updated` 事件 ⇒ 全局 model）就：
 *   1. 重新取数（`reload`）；
 *   2. 把刚改的那一行**高亮**一下（几秒后自动消掉）—— 让用户看见「改的是这条」。
 *
 * ## 为什么要几秒后自动消掉
 *
 * 高亮是**瞬时反馈**，不是状态 ⇒ 一直亮着会变成「这行有问题」的错觉。
 */
export interface UseAiTaskUpdateResult {
  /** 刚被改的那条任务的 id（没有时 undefined）。 */
  highlightedId: number | undefined;
  /** 给表格用的行 class 名（高亮那一行）。 */
  rowClassName: RowClassName;
}

/**
 * 行 class 回调的类型 —— **直接取自 antd**（`GetProp`）。
 *
 * ⚠️ 为什么不自己写一份 `(record: { id?: number }) => string`：
 *    antd Table 与 ProTable 的 `rowClassName` 是**同一个签名**
 *    （`string | ((record, index) => string)`）⇒ 自己抄一份早晚跟 antd 对不上
 *    ⇒ 这里用 antd 6 的 `GetProp` **从组件本身取**（antd 5.13+ 提供）。
 */
export type RowClassName = GetProp<typeof Table, 'rowClassName'>;

/** 高亮持续多久（毫秒）。 */
const HIGHLIGHT_MS = 4000;

/**
 * 写回后**再刷一次**的间隔（毫秒）。
 *
 * ## 为什么要点两次
 *
 * 后端的写操作是「**请求结束时才 commit**」⇒ 工具调用返回「成功」时，
 * 事务**可能还没落库** ⇒ 紧接着发的那次列表查询有可能读到**旧数据**
 * ⇒ 表现为“AI 说改好了，列表却还是老样子”。
 *
 * ⇒ 第一次立刻刷（多数时候就够），再过 `RETRY_RELOAD_MS` 补一次
 *   （覆盖 commit 还没落库的那一小段时间）。
 */
const RETRY_RELOAD_MS = 1000;

/**
 * @param reload 重新取数的回调（**要稳定**：用 useCallback 包一下）
 */
export function useAiTaskUpdate(reload: () => void): UseAiTaskUpdateResult {
  const { lastUpdate } = useModel('ai-bridge');
  const [highlightedId, setHighlightedId] = useState<number | undefined>(
    undefined,
  );

  useEffect(() => {
    if (!lastUpdate || lastUpdate.entityType !== 'task') {
      return;
    }
    reload();
    // ⚠️ 后端是「请求结束才 commit」⇒ 立刻查可能读到旧值 ⇒ 补一次
    const retry = setTimeout(reload, RETRY_RELOAD_MS);
    setHighlightedId(lastUpdate.entityId);
    const timer = setTimeout(() => setHighlightedId(undefined), HIGHLIGHT_MS);
    return () => {
      clearTimeout(retry);
      clearTimeout(timer);
    };
  }, [lastUpdate, reload]);

  return {
    highlightedId,
    rowClassName: ((record: { id?: number | null } | undefined) =>
      record?.id === highlightedId ? 'pm-ai-updated-row' : '') as RowClassName,
  };
}
