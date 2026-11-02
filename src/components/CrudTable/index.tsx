import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { useAccess } from '@umijs/max';
import { Button, Popconfirm } from 'antd';
import type React from 'react';
import { useCallback, useRef, useState } from 'react';

/**
 * 共享 CRUD 脚手架。
 *
 * 8 个系统管理模块的页面从这里取三样东西:
 *
 * - `useCrudTable`: 弹窗开关 / 编辑对象 / 删除 / 提交 的状态机
 * - `getCrudColumns`: 带权限门控的「操作」列
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

  const handleDelete = useCallback(
    async (record: T) => {
      if (!record.id) return;
      try {
        await remove([record.id]);
        // 成功提示由请求层统一弹(后端信封里的 msg),这里不要再弹一次
        actionRef.current?.reload();
      } catch {
        // 失败提示也由请求层统一弹,这里只需要把异常消化掉
      }
    },
    [remove],
  );

  const handleSubmit = useCallback(
    async (values: V) => {
      try {
        if (editing?.id) {
          await update(editing.id, values);
        } else {
          await create(values);
        }
        actionRef.current?.reload();
        return true;
      } catch {
        // 失败提示由请求层统一弹;返回 false 让弹窗保持打开
        return false;
      }
    },
    [create, editing, update],
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

/** getCrudColumns 的入参 */
export interface CrudColumnOptions<T> {
  /** 点「编辑」 */
  onEdit: (record: T) => void;
  /** 点「删除」(二次确认后触发) */
  onDelete: (record: T) => void | Promise<void>;
  /** 编辑按钮的权限码 */
  editPerm: string;
  /** 删除按钮的权限码 */
  deletePerm: string;
  /** 实体中文名,用于删除二次确认的文案 */
  entityName: string;
}

/**
 * 标准的「操作」列:编辑按钮 + 删除按钮(删除包在 Popconfirm 里)。
 *
 * 两个按钮都按权限码门控 —— 权限码写错会**静默禁用**按钮,是最难发现的一类 bug,
 * 所以这段必须只有一份实现。
 */
export function getCrudColumns<T>(
  options: CrudColumnOptions<T>,
): ProColumns<T>[] {
  // biome-ignore lint/correctness/useHookAtTopLevel: getCrudColumns 是渲染期调用的列工厂,内部要读 access 做权限门控;API 名由规格 §5.3 指定,不能改成 useXxx
  const access = useAccess();
  const { onEdit, onDelete, editPerm, deletePerm, entityName } = options;

  return [
    {
      title: '操作',
      valueType: 'option',
      width: 160,
      render: (_, record) => [
        <Button
          key="edit"
          type="link"
          size="small"
          disabled={!access.hasPermission(editPerm)}
          onClick={() => onEdit(record)}
        >
          编辑
        </Button>,
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
