import { Tree, type TreeDataNode, type TreeProps } from 'antd';
import { type Key, useEffect, useMemo, useState } from 'react';
import type { BackendMenu } from '@/menu/adapter';
import { getCurrentUser } from '@/services/api/system/user';

/**
 * 菜单权限树 —— 角色授权时勾选菜单(含按钮)权限。
 *
 * 数据源是 **`getCurrentUser()` 返回的 `menus`** ——
 * 只有这里给的是**带 children 的树**;
 * `/platform/menu/tree` 的 response_model 是 `list[MenuOutSchema]`,
 * 没有 children 字段,拿到的是扁平列表,不能当树源。
 *
 * 半选的父节点也要提交给后端(后端要的是「勾选 + 半选」的并集),
 * 所以 `onChange` 回传的是两者合并去重后的菜单 id。
 */
export interface MenuPermissionTreeProps {
  /** 选中的菜单 id(勾选与半选的并集) */
  value?: number[];
  /** 选中变化:回传勾选与半选合并去重后的菜单 id */
  onChange?: (value: number[]) => void;
  disabled?: boolean;
}

/** 菜单树:antd 的 treeData + 树里所有的菜单 id */
interface MenuTree {
  treeData: TreeDataNode[];
  ids: number[];
}

/**
 * 后端菜单节点 → antd Tree 的 treeData。
 *
 * 树与 id 列表在**同一次遍历**里产出 —— 分开算的话,
 * 两边对「没有 id 的节点怎么处理」的判断可能不一致。
 */
function buildMenuTree(nodes: BackendMenu[]): MenuTree {
  const treeData: TreeDataNode[] = [];
  const ids: number[] = [];

  for (const node of nodes) {
    // 没有 id 的节点没法当选项(选中值是菜单 id),它的子树也一起不出现
    if (node.id == null) continue;

    const children = buildMenuTree(node.children ?? []);
    ids.push(node.id, ...children.ids);
    treeData.push({
      key: node.id,
      title: node.title || node.name || String(node.id),
      ...(children.treeData.length > 0 ? { children: children.treeData } : {}),
    });
  }

  return { treeData, ids };
}

export default function MenuPermissionTree({
  value,
  onChange,
  disabled,
}: MenuPermissionTreeProps) {
  const [menus, setMenus] = useState<BackendMenu[]>([]);
  // 受控时用外部的 value;没传 value 时用自己的状态(否则勾选不会有任何反馈)
  const [internalChecked, setInternalChecked] = useState<number[]>([]);
  const [expandedKeys, setExpandedKeys] = useState<number[]>([]);

  useEffect(() => {
    let cancelled = false;

    getCurrentUser()
      .then((res) => {
        if (cancelled) return;
        setMenus(res?.data?.menus ?? []);
      })
      .catch(() => {
        // 失败提示由请求层统一弹;这里降级成空树,不抛异常
        if (cancelled) return;
        setMenus([]);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const { treeData, ids } = useMemo(() => buildMenuTree(menus), [menus]);

  // 菜单是异步来的,defaultExpandAll 只在挂载那一刻生效(那时还没有数据),
  // 所以默认展开要用受控的 expandedKeys
  useEffect(() => {
    setExpandedKeys(ids);
  }, [ids]);

  const knownIds = useMemo(() => new Set(ids), [ids]);
  // 过滤掉树里没有的 id:数据还没加载完时传进去会让 rc-tree 报
  // "Tree missing follow keys" 的警告
  const checkedKeys = (value ?? internalChecked).filter((id) =>
    knownIds.has(id),
  );

  const handleCheck: NonNullable<TreeProps['onCheck']> = (checked, info) => {
    // antd 的 onCheck 有两种形态:checkStrictly 时给 { checked, halfChecked },
    // 默认(联动)时给勾选数组,半选的在 info.halfCheckedKeys 里
    const checkedIds = Array.isArray(checked) ? checked : checked.checked;
    const halfCheckedIds = Array.isArray(checked)
      ? (info.halfCheckedKeys ?? [])
      : checked.halfChecked;

    const merged = Array.from(
      new Set<Key>([...checkedIds, ...halfCheckedIds]),
    ).filter((key): key is number => typeof key === 'number');

    setInternalChecked(merged);
    onChange?.(merged);
  };

  return (
    <Tree
      checkable
      disabled={disabled}
      treeData={treeData}
      checkedKeys={checkedKeys}
      onCheck={handleCheck}
      expandedKeys={expandedKeys}
      onExpand={(keys) =>
        setExpandedKeys(
          keys.filter((key): key is number => typeof key === 'number'),
        )
      }
      style={{ maxHeight: 320, overflow: 'auto' }}
    />
  );
}
