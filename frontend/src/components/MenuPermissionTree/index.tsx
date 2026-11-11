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
 * ## 「全选」与「半选」必须是两个集合
 *
 * - **全选**:整棵子树都被选中的节点。**只有它**能进 antd Tree 的 `checkedKeys`。
 * - **半选**:父节点只被选中了一部分(孩子没选全)。
 *
 * 为什么不能混:rc-tree 拿到受控的 `checkedKeys` 会跑 `conductCheck`
 * (见 `@rc-component/tree/lib/utils/conductUtil.js` 的 `fillConductCheck`),
 * 它的第一步是「勾中的父节点 ⇒ 它的**所有**后代都算勾中」。
 * 把半选的父节点混进 `checkedKeys`,用户**没勾**的兄弟节点会一起变成勾选态,
 * 下一次交互就会把没授权的菜单一起提交给后端。
 *
 * 所以这里的约定是:
 * - 提交给后端的是「全选 ∪ 半选」的并集(`onChange` 回传的就是它);
 * - 喂回 Tree 的只有「全选」。
 *
 * ## 「不在树里的 id」必须原样带走
 *
 * 树的数据源是**当前用户**的菜单(`getCurrentUser()` 的 `menus`)——
 * 角色已授权、但当前用户自己没有的菜单(id 不在这棵树里)**不在树中**。
 * 它们没法在树上被勾选,也就没法被取消 —— 但如果每次交互都只按树里的
 * 勾选结果重建集合,这些 id 会在**第一次交互**后被悄悄丢掉。
 * 后端 `set_role_menus_crud` 是**整体替换**角色的菜单集合 ⇒
 * 丢一个 id 就是静默地撤销一条权限。
 *
 * 所以交互时:树里勾到的照旧带上,**树里没有的上一次合并结果也带上**。
 */
export interface MenuPermissionTreeProps {
  /** 选中的菜单 id(勾选与半选的并集) */
  value?: number[];
  /** 选中变化:回传勾选与半选合并去重后的菜单 id */
  onChange?: (value: number[]) => void;
  disabled?: boolean;
}

/** 树结构节点:推导「全选 / 半选」用 */
interface MenuNode {
  id: number;
  children: MenuNode[];
}

/** 菜单树:antd 的 treeData + 树里所有的菜单 id + 树结构 */
interface MenuTree {
  treeData: TreeDataNode[];
  ids: number[];
  /** 树结构(推导勾选态用) */
  nodes: MenuNode[];
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
  const structure: MenuNode[] = [];

  for (const node of nodes) {
    // 没有 id 的节点没法当选项(选中值是菜单 id),它的子树也一起不出现
    if (node.id == null) continue;

    const children = buildMenuTree(node.children ?? []);
    ids.push(node.id, ...children.ids);
    structure.push({ id: node.id, children: children.nodes });
    treeData.push({
      key: node.id,
      title: node.title || node.name || String(node.id),
      ...(children.treeData.length > 0 ? { children: children.treeData } : {}),
    });
  }

  return { treeData, ids, nodes: structure };
}

/**
 * 从「全选 ∪ 半选」的并集里,推导出哪些节点是**全选**的。
 *
 * 规则与 rc-tree 的联动语义一致:
 * - 叶子节点:在集合里就是全选
 * - 有孩子的节点:自己在集合里**且**孩子全是全选 ⇒ 整棵子树都被选中;
 *   否则只是半选(有孩子被选中,但没选全)
 *
 * 「孩子全选」是递归判断,所以只看直接孩子就够了。
 *
 * 注意这里是**自底向上**算的:不会把父节点的勾选状态**向下**传播 ——
 * 向下传播正是 rc-tree 的 `conductCheck` 会做的事,也是本组件要绕开的坑。
 */
function deriveCheckedKeys(merged: number[], nodes: MenuNode[]): number[] {
  const selected = new Set(merged);
  const checked: number[] = [];

  // 返回这一层每个节点是否「全选」
  const walk = (list: MenuNode[]): boolean[] =>
    list.map((node) => {
      const childrenChecked = walk(node.children);
      const isChecked =
        selected.has(node.id) && childrenChecked.every((child) => child);
      if (isChecked) checked.push(node.id);
      return isChecked;
    });

  walk(nodes);
  return checked;
}

export default function MenuPermissionTree({
  value,
  onChange,
  disabled,
}: MenuPermissionTreeProps) {
  const [menus, setMenus] = useState<BackendMenu[]>([]);
  // 受控时用外部的 value;没传 value 时用自己的状态(否则勾选不会有任何反馈)
  // 存的是「全选 ∪ 半选」的并集 —— 树里真正勾选的只有「全选」那部分
  const [internalValue, setInternalValue] = useState<number[]>([]);
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

  const { treeData, ids, nodes } = useMemo(() => buildMenuTree(menus), [menus]);

  // 菜单是异步来的,defaultExpandAll 只在挂载那一刻生效(那时还没有数据),
  // 所以默认展开要用受控的 expandedKeys
  useEffect(() => {
    setExpandedKeys(ids);
  }, [ids]);

  // 「全选 ∪ 半选」的并集 —— 提交给后端的就是它
  const merged = value ?? internalValue;

  // 喂回 Tree 的只有「全选」:半选的父节点混进去,
  // rc-tree 的 conductCheck 会把用户没勾的兄弟节点也变成勾选态
  const checkedKeys = useMemo(
    () => deriveCheckedKeys(merged, nodes),
    [merged, nodes],
  );

  const handleCheck: NonNullable<TreeProps['onCheck']> = (checked, info) => {
    // antd 的 onCheck 有两种形态:checkStrictly 时给 { checked, halfChecked },
    // 默认(联动)时给勾选数组,半选的在 info.halfCheckedKeys 里
    const checkedIds = Array.isArray(checked) ? checked : checked.checked;
    const halfCheckedIds = Array.isArray(checked)
      ? (info.halfCheckedKeys ?? [])
      : checked.halfChecked;

    // ⚠️ 不在这棵树里的 id(角色已授权、但当前用户自己看不到的菜单)
    //   树上勾不到也取消不了 ⇒ 原样带走。
    //   丢了就是**静默撤销权限**(后端是整体替换角色的菜单集合)。
    const treeIds = new Set(ids);
    const invisible = merged.filter((id) => !treeIds.has(id));

    const nextMerged = Array.from(
      new Set<Key>([...invisible, ...checkedIds, ...halfCheckedIds]),
    ).filter((key): key is number => typeof key === 'number');

    setInternalValue(nextMerged);
    onChange?.(nextMerged);
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
