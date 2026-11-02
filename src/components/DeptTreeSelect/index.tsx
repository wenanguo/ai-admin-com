import { TreeSelect, type TreeSelectProps } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import type { DeptOut } from '@/services/api/system/dept';
import { getDeptTree } from '@/services/api/system/dept';

/**
 * 部门树选择器 —— 跨模块复用的共用组件。
 *
 * 消费者:部门页(选上级部门)、角色页(自定义数据权限)、用户表单(选所属部门)。
 * 组件本身**零业务耦合**:数据源只有一个(GET /system/dept/tree),
 * 交互只有「选一个部门 id」。
 */

/** TreeSelect 的节点类型(从 antd 的 props 里取,不深导入 antd 内部路径) */
type DeptTreeNode = NonNullable<TreeSelectProps<number>['treeData']>[number];

export interface DeptTreeSelectProps {
  /** 选中的部门 id */
  value?: number | null;
  /** 选中变化(清空时回传 undefined) */
  onChange?: (value: number | undefined) => void;
  placeholder?: string;
  disabled?: boolean;
  allowClear?: boolean;
  /** 排除某个节点及其子树(选父部门时用来防自引用) */
  excludeId?: number;
}

/**
 * 部门树 → TreeSelect 的 treeData。
 *
 * `excludeId` 命中的节点**连同它的整棵子树**一起剪掉 ——
 * 选上级部门时不能把自己(或自己的下级)选成父部门,否则会造出环。
 */
function buildTreeData(
  nodes: DeptOut[],
  excludeId: number | undefined,
): DeptTreeNode[] {
  const result: DeptTreeNode[] = [];

  for (const node of nodes) {
    // 没有 id 的节点没法当选项(选中值是 id)
    if (node.id == null) continue;
    // 被排除的节点整棵子树都不出现
    if (excludeId !== undefined && node.id === excludeId) continue;

    const children = buildTreeData(node.children ?? [], excludeId);
    result.push({
      title: node.name ?? node.code ?? String(node.id),
      value: node.id,
      ...(children.length > 0 ? { children } : {}),
    });
  }

  return result;
}

/**
 * 部门树选择器。
 *
 * - 数据源:`GET /system/dept/tree`(后端没有部门列表接口,只有树)
 * - 请求失败时降级为「没有选项」,**不抛异常**(错误提示由请求层统一弹)
 */
export default function DeptTreeSelect({
  value,
  onChange,
  placeholder = '请选择部门',
  disabled,
  allowClear = true,
  excludeId,
}: DeptTreeSelectProps) {
  const [depts, setDepts] = useState<DeptOut[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    getDeptTree()
      .then((res) => {
        if (!cancelled) setDepts(res?.data ?? []);
      })
      .catch(() => {
        // 降级成「没有选项」,组件照常渲染(提示由请求层统一弹)
        if (!cancelled) setDepts([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const treeData = useMemo(
    () => buildTreeData(depts, excludeId),
    [depts, excludeId],
  );

  return (
    <TreeSelect<number | undefined>
      value={value ?? undefined}
      // 包一层:对外的契约是「回传部门 id」,不透传 antd 的 labelList / extra
      onChange={(next) => onChange?.(next)}
      placeholder={placeholder}
      disabled={disabled}
      allowClear={allowClear}
      loading={loading}
      treeData={treeData}
      treeDefaultExpandAll
      showSearch={{ treeNodeFilterProp: 'title' }}
      style={{ width: '100%' }}
    />
  );
}
