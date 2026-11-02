import type { ProColumns } from '@ant-design/pro-components';
import type { TableColumnType } from 'antd';
import type React from 'react';
import type { CrudRecord } from '@/components/CrudTable';

/**
 * 「ProColumns → antd Table 列」的适配层。
 *
 * ## 为什么需要它
 *
 * 共享脚手架 `useCrudColumns` 返回的是 **ProColumns**(ProTable 专用):
 * - `title` 允许是函数,antd Table 的列不认
 * - `render` 的第 5 个参数(schema)是 ProTable 内部对象,页面里没有来源
 * - `render` 的返回值还可能是 `{ children, props }`(可编辑表格的合并单元格形态)
 *
 * 主从分栏页(如字典管理)的左栏是**普通 antd Table**,所以要把操作列**降级**成 antd 能吃的形状。
 * 按钮本身(权限门控 + 删除二次确认)仍然由脚手架的 render 生成 ——
 * 适配层只负责「换个形状」,页面里**没有第二份**门控实现。
 *
 * ## 为什么只有一份
 *
 * 角色页(ProTable,要在脚手架那组按钮后面追加自己的「授权」入口)与字典页(antd Table)
 * 都从这里取 —— 否则下一个主从页面会再抄一个变体,改一处漏两处。
 */

/**
 * ProColumns 的 render 允许返回 `{ children, props }`
 * (ProTable 合并单元格用的形态),普通表格不会走到。
 */
export interface MergedCell {
  children: React.ReactNode;
  props: unknown;
}

/** 是不是合并单元格形态 */
export function isMergedCell(value: unknown): value is MergedCell {
  return (
    typeof value === 'object' &&
    value !== null &&
    'children' in value &&
    'props' in value
  );
}

/**
 * ReactNode 摊平成数组。
 *
 * 用在「要在脚手架那组按钮后面追加自己的入口」的地方:
 * 脚手架操作列的 render 返回的是**一组按钮**(数组),先摊平再拼。
 */
export function toNodeArray(
  value: React.ReactNode | MergedCell,
): React.ReactNode[] {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined) return [];
  if (isMergedCell(value)) return [value.children];
  return [value];
}

/** 把 ProColumns 的 render 结果转成 ReactNode(合并单元格形态取 children) */
function toReactNode(value: React.ReactNode | MergedCell): React.ReactNode {
  if (isMergedCell(value)) return value.children;
  return value;
}

/** 操作列的默认标题(脚手架的 `useCrudColumns` 给的也是它) */
const DEFAULT_OPERATION_TITLE = '操作';

/**
 * 操作列的标题:用脚手架给的 title,拿不到才回落到默认。
 *
 * 硬编码 '操作' 的话,脚手架改了标题这里会**静默**保持旧文案 —— 两张表对不上。
 *
 * 返回值可以是 ReactNode，也可以是函数（antd 的列标题两种都收）。
 */
function resolveOperationTitle<T extends CrudRecord>(
  column: ProColumns<T>,
): React.ReactNode | (() => React.ReactNode) {
  const { title } = column;
  if (typeof title === 'function') {
    // ProColumns 的 title 是函数形态(ProTable 专用:参数是 schema / type / dom),
    // antd Table 的列标题不吃这种形态 —— 包一层,把 schema 换成列自身
    return () => title(column, 'table', undefined);
  }
  return title ?? DEFAULT_OPERATION_TITLE;
}

/**
 * 把共享脚手架的操作列接到 antd Table 上。
 *
 * 按钮(权限门控 + 删除二次确认)仍然由脚手架的 render 生成,这里只换形状。
 *
 * @param column 脚手架 `useCrudColumns` 给的操作列
 * @param width 列宽
 */
export function toAntdOperationColumn<T extends CrudRecord>(
  column: ProColumns<T>,
  width: number,
): TableColumnType<T> {
  /**
   * 脚手架 render 的第 5 个参数是 ProTable 内部的 schema —— 页面里没有来源。
   *
   * ⚠️ 脚手架的 render **不读它**(只用 dom / entity / index),这里补一个同形状的
   * **类型占位**只是为了满足签名。占位里装的不是真 schema:
   * 将来脚手架若开始读它,这里必须换成真的来源(否则会静默拿到一个假对象)。
   */
  const schema = { ...column, type: undefined };

  return {
    title: resolveOperationTitle(column),
    key: 'operation',
    width,
    render: (_value, record, index) =>
      toReactNode(column.render?.(undefined, record, index, undefined, schema)),
  };
}
