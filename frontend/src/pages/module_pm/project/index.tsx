import { CommentOutlined, PlusOutlined } from '@ant-design/icons';
import { type ProColumns, ProTable } from '@ant-design/pro-components';
import { Link, useAccess, useModel } from '@umijs/max';
import { Button } from 'antd';
import type React from 'react';
import { useCallback, useMemo } from 'react';
import {
  CRUD_PAGINATION,
  useCrudColumns,
  useCrudTable,
} from '@/components/CrudTable';
import {
  buildAiProjectContext,
  mergeDictLabels,
} from '@/components/pm/aiContext';
import { DictTag } from '@/components/pm/DictTag';
import { renderJsonTags } from '@/components/pm/JsonTags';
import { toValueEnum } from '@/components/pm/toValueEnum';
import { useDictOptions } from '@/components/pm/useDictOptions';
import type {
  ProjectCreateParams,
  ProjectOut,
} from '@/services/api/pm/project';
import {
  createProject,
  deleteProjects,
  listProjects,
  updateProject,
} from '@/services/api/pm/project';
import { listUsers } from '@/services/api/system/user';
import { toProTableRequest } from '@/services/paginate';
import ProjectModalForm from './ModalForm';

const requestProjects = toProTableRequest<ProjectOut>(listProjects);

/**
 * 项目管理列表页 —— 路由 /pm/project(菜单由后端下发,目录挂在 /pm 下)。
 *
 * 骨架逻辑(状态机 / 操作列 / 分页)在共享脚手架 @/components/CrudTable 里,
 * 本页只留「列定义 + service 调用 + 声明式 JSX」,与 module_system 各页同范式。
 * 状态/优先级/可见性是字典驱动:表格标签用 DictTag,下拉提交的是线上码。
 */
const ProjectManagement: React.FC = () => {
  const access = useAccess();
  // AI 工作台 ↔ 主工作区的桥（当前讨论对象）
  const aiBridge = useModel('ai-bridge');

  const crud = useCrudTable<ProjectOut, ProjectCreateParams>({
    create: createProject,
    update: updateProject,
    remove: deleteProjects,
  });

  // 字典选项:表格标签(DictTag 内部也用它)与搜索下拉(valueEnum)共用,
  // useDictOptions 有模块级缓存,这里两个类型只发一次请求
  const { options: statusOptions } = useDictOptions('module_pm_project_status');
  const { options: priorityOptions } = useDictOptions('module_pm_priority');

  const statusValueEnum = useMemo(
    () => toValueEnum(statusOptions),
    [statusOptions],
  );
  const priorityValueEnum = useMemo(
    () => toValueEnum(priorityOptions),
    [priorityOptions],
  );

  /**
   * 「与 AI 讨论」：把**这个项目**设为当前讨论对象。
   *
   * ⚠️ 上下文由**前端**组装（不发请求）：用户点的是他看到的这一行。
   */
  const discussProject = useCallback(
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

  const columns: ProColumns<ProjectOut>[] = [
    {
      title: '与 AI 讨论',
      dataIndex: 'discuss',
      width: 110,
      search: false,
      render: (_, record) => (
        <Button
          type="link"
          size="small"
          icon={<CommentOutlined />}
          onClick={() => {
            discussProject(record);
          }}
        >
          讨论
        </Button>
      ),
    },
    { title: 'ID', dataIndex: 'id', width: 80, search: false },
    {
      title: '项目名称',
      dataIndex: 'name',
      width: 200,
      fieldProps: { placeholder: '支持模糊查询' },
      /*
        项目名称是**详情页的入口**:点它进 /pm/project/:id。
        菜单里没有「项目详情」这一项(后端种子只种了列表),详情页从列表进。
      */
      render: (_, record) =>
        record.id == null ? (
          (record.name ?? '-')
        ) : (
          <Link to={`/pm/project/${record.id}`}>{record.name ?? '-'}</Link>
        ),
    },
    {
      title: '项目编码',
      dataIndex: 'code',
      width: 160,
      fieldProps: { placeholder: '支持模糊查询' },
    },
    {
      title: '状态',
      dataIndex: 'status_code',
      width: 100,
      valueEnum: statusValueEnum,
      render: (_, record) => (
        <DictTag
          dictType="module_pm_project_status"
          value={record.status_code}
        />
      ),
    },
    {
      title: '优先级',
      dataIndex: 'priority_code',
      width: 100,
      valueEnum: priorityValueEnum,
      render: (_, record) => (
        <DictTag dictType="module_pm_priority" value={record.priority_code} />
      ),
    },
    {
      title: '负责人',
      dataIndex: 'owner_id',
      width: 140,
      valueType: 'select',
      // ⚠️ 列级 select 必须显式开 showSearch,否则远程搜索是死代码
      // (rc-select 的输入框 readOnly,onSearch 永远不触发) —— 见工单页处理人列
      fieldProps: { showSearch: true },
      // 远程搜索防抖(毫秒);ProComponents 的默认是 0,每敲一个字发一次请求
      debounceTime: 300,
      /*
        搜索项:负责人是用户,候选来自 listUsers,按姓名远程搜。
        ⚠️ 这个接口在后端要 module_system:user:query 权限;
        没有这个权限时只有这一项搜索用不了,列表本身不受影响。
      */
      request: async ({ keyWords }: { keyWords?: string }) => {
        const keyword = keyWords?.trim();
        const res = await listUsers({
          page_no: 1,
          page_size: 100,
          ...(keyword ? { name: keyword } : {}),
        });
        return (res?.data?.items ?? []).flatMap((user) =>
          user.id == null
            ? []
            : [
                {
                  label: user.name ?? user.username ?? String(user.id),
                  value: user.id,
                },
              ],
        );
      },
      // 表格里读后端随行返回的 owner_by 冗余字段,不用再查用户表
      render: (_, record) => record.owner_by?.name ?? '-',
    },
    {
      title: '计划区间',
      dataIndex: 'start_date',
      width: 200,
      search: false,
      render: (_, record) =>
        `${record.start_date ?? '-'} ~ ${record.due_date ?? '-'}`,
    },
    {
      title: '标签',
      dataIndex: 'tags',
      width: 200,
      search: false,
      render: (_, record) => renderJsonTags(record.tags),
    },
    {
      title: '创建时间',
      dataIndex: 'created_time',
      width: 180,
      search: false,
    },
  ];

  const operationColumns = useCrudColumns<ProjectOut>({
    onEdit: crud.openEdit,
    onDelete: crud.handleDelete,
    editPerm: 'module_pm_project:pm_project:update',
    deletePerm: 'module_pm_project:pm_project:delete',
    entityName: '项目',
  });

  return (
    <>
      <ProTable<ProjectOut>
        headerTitle="项目管理"
        rowKey="id"
        actionRef={crud.actionRef}
        columns={[...columns, ...operationColumns]}
        request={requestProjects}
        search={{ labelWidth: 80 }}
        pagination={CRUD_PAGINATION}
        // 列多的时候横向滚动,不要把表头挤成竖排的一列字
        // (内容区被右侧的 AI 工作台占掉一块,列宽被压到最小就会这样)
        scroll={{ x: 'max-content' }}
        // 错误提示由请求层统一弹,这里只需阻止 ProTable 把 rejection 重新抛出
        // (ProComponents v3 在 onRequestError 未定义时会 rethrow,产生未捕获的 promise rejection)
        onRequestError={() => {}}
        toolBarRender={() => [
          <Button
            key="create"
            type="primary"
            icon={<PlusOutlined />}
            disabled={
              !access.hasPermission('module_pm_project:pm_project:create')
            }
            onClick={crud.openCreate}
          >
            新增
          </Button>,
        ]}
      />
      <ProjectModalForm
        open={crud.modalOpen}
        record={crud.editing}
        onOpenChange={crud.closeModal}
        onSubmit={crud.handleSubmit}
      />
    </>
  );
};

export default ProjectManagement;
