/**
 * **项目列表视图**（表格形态）。
 *
 * ## 视图家族
 *
 * 项目清单有两种视图：
 * - 表格 —— 就是本组件（`ProjectListView`）；
 * - 卡片 —— `ProjectCardView`（同一页的另一个视图）。
 *
 * ⚠️ 两个视图**共用同一份数据**（`useProjectDataset`）⇒ 切视图零请求，
 * 两边看到的永远是同一批项目。
 *
 * ## 取数与筛选
 *
 * 搜索与分页都在**本地**做（`requestLocal`）：数据已经一次性取全了，
 * 再让后端筛一遍就是白跑一趟。
 *
 * ⚠️ 本地筛选的语义**照抄后端**（LIKE / eq 的区别）—— 见 `./filterProjects`。
 *    自己另写一套 ⇒ 「后端筛得到、本地筛不到」的分裂会悄悄回来。
 *
 * ⚠️ 取数有上限（10 页 × 100 条 = 1000 条）⇒ 被截断时页面**显式提示**，
 *    不静默（见下面的 Alert）。
 */
import { PlusOutlined, RobotOutlined } from '@ant-design/icons';
import { type ProColumns, ProTable } from '@ant-design/pro-components';
import { Link, useAccess } from '@umijs/max';
import { Alert, Button, Space } from 'antd';
import type React from 'react';
import { useCallback, useMemo } from 'react';
import {
  CRUD_PAGINATION,
  useCrudColumns,
  useCrudTable,
} from '@/components/CrudTable';
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
  updateProject,
} from '@/services/api/pm/project';
import { listUsers } from '@/services/api/system/user';
import { filterProjects } from './filterProjects';
import ProjectModalForm from './ProjectModalForm';
import { useDiscussProject } from './useDiscussProject';
import { useProjectDataset } from './useProjectDataset';

/**
 * 项目列表视图。
 *
 * 骨架逻辑（状态机 / 操作列 / 分页）在共享脚手架 `@/components/CrudTable` 里，
 * 这里只留「列定义 + service 调用 + 声明式 JSX」，与 module_system 各页同范式。
 * 状态/优先级/可见性是字典驱动：表格标签用 DictTag，下拉提交的是线上码。
 */
export function ProjectListView(): React.ReactElement {
  const access = useAccess();

  /*
    **共享项目数据集** —— 与卡片视图读的是同一份数据。
    ⇒ 切视图不用重新取数；写操作后重新取数，两个视图立刻一致。
  */
  const dataset = useProjectDataset();

  const crud = useCrudTable<ProjectOut, ProjectCreateParams>({
    create: createProject,
    update: updateProject,
    remove: deleteProjects,
    // ⚠️ 写操作后要**重新取全量**（本地筛选的数据源变了），
    //    而不是刷 ProTable（刷了也只是把同一份数据重新切一遍）。
    reload: dataset.reload,
  });

  /** 「与 AI 讨论」：与卡片视图共用同一份实现（见 ./useDiscussProject） */
  const discussProject = useDiscussProject();

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
   * 列表的取数：**在本地做**（过滤 + 分页）。
   *
   * ⚠️ 筛选语义照后端（LIKE / eq 的区别）—— 见 ./filterProjects。
   */
  const requestLocal = useCallback(
    async (params: {
      current?: number;
      pageSize?: number;
      [key: string]: unknown;
    }) => {
      const { current, pageSize, ...filters } = params;
      const filtered = filterProjects(dataset.projects, filters);
      const size = pageSize ?? 10;
      const start = ((current ?? 1) - 1) * size;
      return {
        data: filtered.slice(start, start + size),
        total: filtered.length,
        success: true,
      };
    },
    [dataset.projects],
  );

  const columns: ProColumns<ProjectOut>[] = [
    { title: 'ID', dataIndex: 'id', width: 80, search: false },
    {
      title: '项目名称',
      dataIndex: 'name',
      width: 220,
      fieldProps: { placeholder: '支持模糊查询' },
      /*
        项目名称是**详情页的入口**:点它进 /pm/project/:id。
        菜单里没有「项目详情」这一项(后端种子只种了列表),详情页从列表进。

        ⚠️ 「与 AI 讨论」以前是**单独一列** ⇒ 表格白白多占一列宽度。
        ⇒ 改成**项目名称后面的一个小机器人图标**,功能完全一样。
      */
      render: (_, record) => (
        <Space size={4}>
          {record.id == null ? (
            (record.name ?? '-')
          ) : (
            <Link to={`/pm/project/${record.id}`}>{record.name ?? '-'}</Link>
          )}
          {/*
            小机器人：与 AI 讨论。

            ⚠️ 它是项目名称链接的**兄弟**（不是嵌在链接里）⇒
            点它不会顺手进详情页。
          */}
          <Button
            type="link"
            size="small"
            data-role="ai-discuss-button"
            icon={<RobotOutlined />}
            title="与 AI 讨论"
            aria-label="与 AI 讨论"
            onClick={() => {
              discussProject(record);
            }}
          />
        </Space>
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
      {/*
        取数有上限（10 页 × 100 条 = 1000 条）⇒ 被截断时**显式提示**，
        不静默（用户搜不到的项目会以为不存在）。
      */}
      {dataset.truncated ? (
        <Alert
          type="info"
          showIcon
          title={`项目太多,一次最多取 ${dataset.projects.length} 条(共 ${dataset.total} 条),其余请用搜索缩小范围`}
        />
      ) : null}
      <ProTable<ProjectOut>
        // ⚠️ **不要 headerTitle**：标题在工作台上（`ProjectWorkspace` 的那行）
        //    ⇒ 这里再写一遍就是同一个标题出现两次
        rowKey="id"
        actionRef={crud.actionRef}
        columns={[...columns, ...operationColumns]}
        request={requestLocal}
        /*
          `__v` 是**数据集的版本号**（react-query 的 dataUpdatedAt）：
          数据集变了（写操作后重新取数）⇒ ProTable 重跑一次本地切片 ⇒ 表格立刻是新的。
          ⚠️ 它不在可搜索字段的白名单里 ⇒ 不会被当成筛选条件（见 filterProjects）。
        */
        params={{ __v: dataset.dataUpdatedAt }}
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
}
