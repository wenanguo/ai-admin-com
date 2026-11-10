import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { useAccess } from '@umijs/max';
import { Button, Popconfirm } from 'antd';
import type React from 'react';
import { useCallback, useRef, useState } from 'react';

/**
 * 共享 CRUD 脚手架。
 *
 * 8 个系统管理模块的页面从这里取这些东西:
 *
 * - `useCrudTable`: 弹窗开关 / 编辑对象 / 删除 / 提交 的状态机
 * - `useCrudColumns`: 带权限门控的「操作」列(编辑入口成对给 ⇒ 只读页也能用)
 * - `useDeleteHandler`: 删除 → 刷新 → 吞异常(没有状态机的页面用)
 * - `CRUD_PAGINATION`: 分页配置(page_size 上限 100 是后端约束,只能定义一次)
 *
 * 声明式的部分(ProTable props、工具栏「新增」按钮、弹窗元素)刻意留在每个页面 ——
 * 8 个模块的页面形态差异很大(树形 / 主从分栏 / 双 tab / 多一个授权弹窗),
 * 硬凑一个通用 wrapper 只会让 props 面变大。
 *
 * 规格见 docs/superpowers/specs/2026-11-02-ai-admin-system-modules-design.md §5.3。
 */

/** 列表行必须有 id —— 删除与编辑都要用它 */
export interface CrudRecord {
  id?: number | null;
}

/** 页面注入的三个写操作 */
export interface CrudActions<V> {
  /** 新增 */
  create: (values: V) => Promise<unknown>;
  /** 更新(id 是行主键) */
  update: (id: number, values: V) => Promise<unknown>;
  /** 删除(批量,请求体是裸数组) */
  remove: (ids: number[]) => Promise<unknown>;
  /**
   * 写操作成功后的刷新回调(可选)。
   *
   * 不给就刷 **ProTable**(actionRef.reload())—— 列表页不用管。
   *
   * ⚠️ **没有 ProTable 的页面必须传**(甘特视图就是):甘特的数据在
   * `useGanttTasks` 里,ProTable 的 actionRef 根本没人调 ⇒ 不传的话
   * 删完/改完页面纹丝不动 ⇒ 看着像「没生效」。
   */
  reload?: () => void;
}

/** useCrudTable 的返回值 */
export interface CrudTable<T extends CrudRecord, V> {
  /** 传给 ProTable 的 actionRef,用于 reload */
  actionRef: React.RefObject<ActionType | undefined>;
  /** 弹窗是否打开 */
  modalOpen: boolean;
  /** 正在编辑的行(undefined = 新增) */
  editing: T | undefined;
  /** 打开「新增」弹窗 */
  openCreate: () => void;
  /** 打开「编辑」弹窗 */
  openEdit: (record: T) => void;
  /** 弹窗开关变化(接 ModalForm 的 onOpenChange) */
  closeModal: (open: boolean) => void;
  /** 删除一行 */
  handleDelete: (record: T) => Promise<void>;
  /** 提交表单:成功 true / 失败 false(决定弹窗是否关闭) */
  handleSubmit: (values: V) => Promise<boolean>;
}

/** 分页配置。page_size 上限 100 是后端约束(C2),集中定义避免各页面各写各的 */
export const CRUD_PAGINATION = {
  defaultPageSize: 10,
  pageSizeOptions: [10, 20, 50, 100],
  showSizeChanger: true,
};

/**
 * 删除处理器的公共实现:删除 → 刷新列表 → 吞掉异常。
 *
 * `useCrudTable.handleDelete` 与只读页的删除走的是**同一段逻辑**
 * (刷新那一步漏了页面就不会更新,异常不吞掉会变成未处理的 rejection),
 * 所以必须只有一份实现。
 *
 * @param remove 删除接口(入参是 id 数组)
 * @param reload 刷新列表的回调
 * @returns 绑定到操作列 `onDelete` 的处理函数
 */
function useDeleteHandlerCore<T extends CrudRecord>(
  remove: (ids: number[]) => Promise<unknown>,
  reload: () => void,
): (record: T) => Promise<void> {
  return useCallback(
    async (record: T) => {
      if (!record.id) return;
      try {
        await remove([record.id]);
        // 成功提示由请求层统一弹(后端信封里的 msg),这里不要再弹一次
        reload();
      } catch {
        // 失败提示也由请求层统一弹,这里只需要把异常消化掉
      }
    },
    [reload, remove],
  );
}

/**
 * 删除处理器:删除 → 刷新列表 → 吞掉异常。
 *
 * ⚠️ `actionRef` **必填** —— 少了它就退化成「删完不刷新表格」:
 * 接口报错了、页面却像没反应,是最难发现的一类 bug。
 *
 * @param remove 删除接口(入参是 id 数组)
 * @param actionRef ProTable 的 actionRef;删除成功后调用它的 reload 刷新列表
 * @returns 绑定到操作列 `onDelete` 的处理函数
 */
export function useDeleteHandler<T extends CrudRecord>(
  remove: (ids: number[]) => Promise<unknown>,
  actionRef: React.RefObject<ActionType | undefined>,
): (record: T) => Promise<void> {
  const reload = useCallback(() => {
    actionRef.current?.reload();
  }, [actionRef]);
  return useDeleteHandlerCore<T>(remove, reload);
}

/**
 * CRUD 状态机:把「弹窗开关 / 编辑对象 / 删除 / 提交」这套逻辑集中到一处。
 *
 * 页面只剩列定义 + service 调用 + 声明式 JSX。
 */
export function useCrudTable<T extends CrudRecord, V>(
  actions: CrudActions<V>,
): CrudTable<T, V> {
  const { create, update, remove } = actions;
  const actionRef = useRef<ActionType | undefined>(undefined);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<T | undefined>(undefined);

  // 刷新:默认刷 ProTable;页面自带数据源(甘特)就用自己的
  const reload = useCallback(() => {
    if (actions.reload) {
      actions.reload();
      return;
    }
    actionRef.current?.reload();
  }, [actions.reload]);

  const openCreate = useCallback(() => {
    setEditing(undefined);
    setModalOpen(true);
  }, []);

  const openEdit = useCallback((record: T) => {
    setEditing(record);
    setModalOpen(true);
  }, []);

  const closeModal = useCallback((open: boolean) => {
    setModalOpen(open);
  }, []);

  // 删除走共享的 useDeleteHandler —— 只有一份实现
  const handleDelete = useDeleteHandlerCore<T>(remove, reload);

  const handleSubmit = useCallback(
    async (values: V) => {
      try {
        if (editing?.id) {
          await update(editing.id, values);
        } else {
          await create(values);
        }
        reload();
        return true;
      } catch {
        // 失败提示由请求层统一弹;返回 false 让弹窗保持打开
        return false;
      }
    },
    [create, editing, reload, update],
  );

  return {
    actionRef,
    modalOpen,
    editing,
    openCreate,
    openEdit,
    closeModal,
    handleDelete,
    handleSubmit,
  };
}

/** 操作列里与「有没有编辑入口」无关的部分 */
export interface CrudColumnCommon<T> {
  /** 点「删除」(二次确认后触发) */
  onDelete: (record: T) => void | Promise<void>;
  /** 删除按钮的权限码 */
  deletePerm: string;
  /** 实体中文名,用于删除二次确认的文案 */
  entityName: string;
}

/** 有编辑入口的形态:`onEdit` 与 `editPerm` **必须成对**出现 */
export interface CrudColumnEditOptions<T> {
  /**
   * 点「编辑」。
   *
   * 与 `editPerm` **必须同时给** —— 只给 `onEdit` 编译不过(见 `CrudColumnOptions`)。
   */
  onEdit: (record: T) => void;
  /** 编辑按钮的权限码。与 `onEdit` 必须成对出现 */
  editPerm: string;
}

/** 只读形态:不渲染「编辑」按钮(只剩删除按钮) */
export interface CrudColumnReadOnlyOptions {
  /** 只读形态:不渲染「编辑」按钮 */
  onEdit?: never;
  /** 只读形态:不渲染「编辑」按钮 */
  editPerm?: never;
}

/**
 * useCrudColumns 的入参 —— **联合类型**,`onEdit` 与 `editPerm` 要么同时给、
 * 要么同时不给。
 *
 * 为什么要做成联合类型而不是两个可选属性:可选属性会把
 * 「忘了传 `editPerm`」从**编译错误**变成**静默少一个「编辑」按钮** ——
 * 而权限码写错恰恰是脚手架注释里警告的「最难发现的一类 bug」。
 * 联合类型把这个坑挪回编译期:
 *
 * - `onEdit` + `editPerm` ⇒ 渲染「编辑」按钮
 * - 两个都不给 ⇒ 不渲染「编辑」按钮(只读页,如日志管理)
 * - 只给一个 ⇒ **编译报错**
 *
 * 只读页(如日志管理)没有编辑入口,但删除按钮的权限门控必须与其它模块
 * 走同一份实现 —— 所以这里加一个分支,而不是让页面另抄一份。
 */
export type CrudColumnOptions<T> =
  | (CrudColumnCommon<T> & CrudColumnEditOptions<T>)
  | (CrudColumnCommon<T> & CrudColumnReadOnlyOptions);

/**
 * 标准的「操作」列:编辑按钮 + 删除按钮(删除包在 Popconfirm 里)。
 *
 * 两个按钮都按权限码门控 —— 权限码写错会**静默禁用**按钮,是最难发现的一类 bug,
 * 所以这段必须只有一份实现。
 *
 * `onEdit` / `editPerm` 都不给时**不渲染「编辑」按钮** —— 只读页(只有删除)走同一份实现,
 * 页面不用再抄一遍权限门控;只给一个则在**编译期**就报错。
 */
export function useCrudColumns<T>(
  options: CrudColumnOptions<T>,
): ProColumns<T>[] {
  // 内部要读 access 做权限门控,所以这是一个 hook —— 名字必须以 use 开头
  // (Rules of Hooks 的命名约定,biome 的 useHookAtTopLevel 规则也是这么判的)
  const access = useAccess();
  const { onEdit, onDelete, editPerm, deletePerm, entityName } = options;

  return [
    {
      title: '操作',
      valueType: 'option',
      width: 160,
      render: (_, record) => [
        // 类型上已保证 onEdit / editPerm 成对(见 CrudColumnOptions),
        // 这里再兜一层:万一有人用 as 绕过类型,缺一也不渲染(只读页)
        ...(onEdit && editPerm
          ? [
              <Button
                key="edit"
                type="link"
                size="small"
                disabled={!access.hasPermission(editPerm)}
                onClick={() => onEdit(record)}
              >
                编辑
              </Button>,
            ]
          : []),
        <Popconfirm
          key="delete"
          title={`确认删除该${entityName}?`}
          onConfirm={() => onDelete(record)}
          disabled={!access.hasPermission(deletePerm)}
        >
          <Button
            type="link"
            size="small"
            danger
            disabled={!access.hasPermission(deletePerm)}
          >
            删除
          </Button>
        </Popconfirm>,
      ],
    },
  ];
}
