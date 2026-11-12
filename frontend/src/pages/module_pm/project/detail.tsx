import { CommentOutlined } from '@ant-design/icons';
import { ProTable } from '@ant-design/pro-components';
import { useModel, useParams } from '@umijs/max';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  type DescriptionsProps,
  Empty,
  Space,
  Spin,
  Table,
  type TableProps,
  Tabs,
} from 'antd';
import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { buildAiProjectContext } from '@/components/pm/aiContext';
import { milestoneColumns } from '@/components/pm/columns/milestone';
import { riskColumns } from '@/components/pm/columns/risk';
import { taskColumns } from '@/components/pm/columns/task';
import { DictTag } from '@/components/pm/DictTag';
import { renderJsonTags } from '@/components/pm/JsonTags';
import { useMilestoneNames } from '@/components/pm/useProjectNames';
import { listMilestones, type MilestoneOut } from '@/services/api/pm/milestone';
import {
  getProjectDetail,
  getProjectMembers,
  type ProjectMemberOut,
  type ProjectOut,
} from '@/services/api/pm/project';
import { listRisks, type RiskOut } from '@/services/api/pm/risk';
import { listTasks, type TaskOut } from '@/services/api/pm/task';
import { isSuccess } from '@/services/response';
import type { ApiResponse, PageResult } from '@/services/types';

/**
 * 子列表的分页参数:详情页各 tab 是只读总览,一次拉满后端 page_size
 * 上限(100,同 CRUD_PAGINATION)就不再翻页了
 */
const SUB_LIST_PARAMS = { page_no: 1, page_size: 100 } as const;

/**
 * 子列表的 request：**一次只拉一页**（后端上限 100），并记住总数/加载数。
 *
 * ## 为什么不用 ProTable 的分页
 *
 * 详情页的三个页签是**只读总览**：不翻页。
 * ⇒ 这里把 page_no / page_size 写死，ProTable 传什么都不理。
 *
 * ## 为什么还要记住总数
 *
 * 「上限**不静默**」：后端一共 250 个而这里只加载了 100 个 ⇒
 * 得把两个数都摆出来（见 `truncationAlert`）。
 */
function useSubListRequest<T>(
  api: (params: {
    page_no: number;
    page_size: number;
    project_id: number;
  }) => Promise<ApiResponse<PageResult<T>>>,
  projectId: number,
): {
  request: () => Promise<{ data: T[]; total: number; success: boolean }>;
  stats: { total: number; loaded: number };
} {
  const [stats, setStats] = useState({ total: 0, loaded: 0 });

  const request = useCallback(async () => {
    const res = await api({ project_id: projectId, ...SUB_LIST_PARAMS });
    const items = res?.data?.items ?? [];
    const total = res?.data?.total ?? 0;
    setStats({ total, loaded: items.length });
    return { data: items, total, success: isSuccess(res) };
  }, [api, projectId]);

  return { request, stats };
}

/**
 * 子列表被截断时的提示(与任务页/风险页同款:type=info,标题说上限,
 * 描述说实情)。
 *
 * 详情页各 tab 一次只拉后端上限(100 条)那一页,**不翻页** ⇒ 超过 100 条的
 * 子列表只显示最新的一段。上限**不静默**:总数与实际加载数都摆出来。
 *
 * ⚠️ 只在**真的被截断**的那个 tab 里提示 —— 项目多、里程碑少是常态,
 * 把没被截断的也写进去等于夸大。截断是**按子列表**判定的,所以提示是
 * tab 级的:切到哪个 tab 就看哪个 tab 的提示,而不是页面顶上的一条。
 */
function truncationAlert(
  label: string,
  total: number,
  loaded: number,
): React.ReactElement | null {
  if (total <= loaded) return null;
  return (
    <Alert
      type="info"
      showIcon
      title={`${label}列表后端一次最多给 100 个`}
      description={`后端一共 ${total} 个${label},这里只加载了最新的 ${loaded} 个,其余 ${total - loaded} 个未显示。`}
    />
  );
}

/** 日期区间的展示:两个日期中缀一个 ~,空值用占位符 */
function dateRange(start?: string | null, end?: string | null): string {
  return `${start ?? '-'} ~ ${end ?? '-'}`;
}

/** 概览 tab:详情接口的字段原样呈现(字典字段用 DictTag 转成中文标签) */
function OverviewTab({ project }: { project: ProjectOut }) {
  const items: DescriptionsProps['items'] = [
    { key: 'code', label: '项目编码', children: project.code ?? '-' },
    { key: 'name', label: '项目名称', children: project.name ?? '-' },
    {
      key: 'status',
      label: '状态',
      children: project.status_code ? (
        <DictTag
          dictType="module_pm_project_status"
          value={project.status_code}
        />
      ) : (
        '-'
      ),
    },
    {
      key: 'priority',
      label: '优先级',
      children: project.priority_code ? (
        <DictTag dictType="module_pm_priority" value={project.priority_code} />
      ) : (
        '-'
      ),
    },
    {
      key: 'visibility',
      label: '可见性',
      children: project.visibility_code ? (
        <DictTag
          dictType="module_pm_visibility"
          value={project.visibility_code}
        />
      ) : (
        '-'
      ),
    },
    {
      key: 'owner',
      label: '负责人',
      children: project.owner_by?.name ?? '-',
    },
    {
      key: 'plan',
      label: '计划区间',
      children: dateRange(project.start_date, project.due_date),
    },
    { key: 'tags', label: '标签', children: renderJsonTags(project.tags) },
    {
      key: 'description',
      label: '描述',
      children: project.description ?? '-',
    },
    {
      key: 'created',
      label: '创建时间',
      children: project.created_time ?? '-',
    },
    {
      key: 'updated',
      label: '更新时间',
      children: project.updated_time ?? '-',
    },
  ];

  return <Descriptions column={{ xs: 1, md: 2, xl: 3 }} items={items} />;
}

/**
 * 里程碑 tab:卡片列表。progress 是后端缓存的派生字段(0-100)——
 * 里程碑响应里没有任何任务数据,前端无从重算,只负责展示
 */
function MilestonesTab({ projectId }: { projectId: number }) {
  const { request, stats } = useSubListRequest(listMilestones, projectId);

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      {truncationAlert('里程碑', stats.total, stats.loaded)}
      <ProTable<MilestoneOut>
        rowKey="id"
        // ⚠️ 列定义与**独立里程碑页共用同一份** ⇒ 改一个字段只改一处
        columns={milestoneColumns({ hideProject: true })}
        request={request}
        // 详情页的子列表是**只读总览**:不搜、不翻页
        search={false}
        pagination={false}
        // 列多的时候横向滚动,不要把表头挤成竖排的一列字
        scroll={{ x: 'max-content' }}
        // 错误提示由请求层统一弹,这里只需阻止 ProTable 把 rejection 重新抛出
        onRequestError={() => {}}
      />
    </Space>
  );
}

/**
 * 任务 tab:与**独立任务页共用同一份列定义**。
 *
 * ⚠️ 「所属项目」列在这里是冗余的（就是这个项目）⇒ `hideProject`。
 * ⚠️ 「所属里程碑」要显示名字 ⇒ 需要里程碑的**侧载**（响应里没有 milestone_by）。
 */
function TasksTab({ projectId }: { projectId: number }) {
  const { request, stats } = useSubListRequest(listTasks, projectId);
  const { milestoneNames } = useMilestoneNames();

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      {truncationAlert('任务', stats.total, stats.loaded)}
      <ProTable<TaskOut>
        rowKey="id"
        // ⚠️ 列定义与**独立任务页共用同一份** ⇒ 改一个字段只改一处
        columns={taskColumns({ milestoneNames, hideProject: true })}
        request={request}
        // 详情页的子列表是**只读总览**:不搜、不翻页
        search={false}
        pagination={false}
        // 列多的时候横向滚动,不要把表头挤成竖排的一列字
        scroll={{ x: 'max-content' }}
        // 错误提示由请求层统一弹,这里只需阻止 ProTable 把 rejection 重新抛出
        onRequestError={() => {}}
      />
    </Space>
  );
}

/**
 * 风险 tab:与**独立风险页共用同一份列定义**。
 *
 * ⚠️ 「所属项目」列在这里是冗余的（就是这个项目）⇒ `hideProject`。
 */
function RisksTab({ projectId }: { projectId: number }) {
  const { request, stats } = useSubListRequest(listRisks, projectId);

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      {truncationAlert('风险', stats.total, stats.loaded)}
      <ProTable<RiskOut>
        rowKey="id"
        // ⚠️ 列定义与**独立风险页共用同一份** ⇒ 改一个字段只改一处
        columns={riskColumns({ hideProject: true })}
        request={request}
        // 详情页的子列表是**只读总览**:不搜、不翻页
        search={false}
        pagination={false}
        // 列多的时候横向滚动,不要把表头挤成竖排的一列字
        scroll={{ x: 'max-content' }}
        // 错误提示由请求层统一弹,这里只需阻止 ProTable 把 rejection 重新抛出
        onRequestError={() => {}}
      />
    </Space>
  );
}

/**
 * 成员 tab:members 是路径参数接口(/pm_project/pm_project/members/{id}),返回的
 * 是数组(带 user_info 冗余)不是分页信封;姓名直接读 user_info
 */
function MembersTab({ projectId }: { projectId: number }) {
  const [members, setMembers] = useState<ProjectMemberOut[]>([]);

  useEffect(() => {
    let cancelled = false;
    getProjectMembers(projectId)
      .then((res) => {
        if (!cancelled) setMembers(res?.data ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const columns: TableProps<ProjectMemberOut>['columns'] = [
    {
      title: '成员',
      dataIndex: 'user_id',
      render: (_, record) =>
        record.user_info?.name ?? record.user_info?.username ?? '-',
    },
    {
      title: '角色',
      dataIndex: 'role_code',
      render: (_, record) =>
        record.role_code ? (
          <DictTag dictType="module_pm_project_role" value={record.role_code} />
        ) : (
          '-'
        ),
    },
    {
      title: '加入时间',
      dataIndex: 'joined_at',
      // 后端 datetime 序列化成 ISO(带 T),展示时换成空格
      render: (_, record) =>
        record.joined_at ? record.joined_at.replace('T', ' ') : '-',
    },
  ];

  return (
    <Table<ProjectMemberOut>
      rowKey="id"
      columns={columns}
      dataSource={members}
    />
  );
}

/**
 * 项目详情页 —— 路由 /pm/project/:id(菜单里没有这一项,从列表页进)。
 *
 * 五个 tab:概览/里程碑/任务/风险/成员(评论 tab v1 不做)。
 * antd Tabs 默认懒挂载:面板首次激活才渲染 ⇒ 各 tab 的数据在首次
 * 打开时才拉,进页面只发 detail 一个业务请求;切走的面板保持挂载,
 * 切回不重拉
 */
const ProjectDetail: React.FC = () => {
  // AI 工作台 ↔ 主工作区的桥（当前讨论对象）
  const aiBridge = useModel('ai-bridge');
  // 项目 id 是路径参数(umi 路由占位符 :id)
  const params = useParams<{ id: string }>();
  const projectId = Number(params?.id);
  const validId = Number.isInteger(projectId) && projectId > 0;

  const [project, setProject] = useState<ProjectOut | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!validId) return;
    let cancelled = false;
    setLoading(true);
    // 失败提示由请求层统一弹,这里落地成空态
    getProjectDetail(projectId)
      .then((res) => {
        if (cancelled) return;
        setProject(res?.data ?? null);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, validId]);

  /**
   * 「与 AI 讨论」：把**这个项目**设为当前讨论对象。
   *
   * ⚠️ 上下文由**前端**组装（详情页手上就有这个项目）。
   */
  const discussProject = useCallback(() => {
    if (project === null) {
      return;
    }
    const context = buildAiProjectContext({
      project: {
        id: project.id,
        code: project.code,
        name: project.name,
        status_code: project.status_code,
        priority_code: project.priority_code,
        owner_by: project.owner_by,
      },
    });
    if (!context) {
      return;
    }
    aiBridge.setContext(context);
    aiBridge.requestExpand();
    aiBridge.requestFocus();
  }, [aiBridge, project]);

  if (!validId) {
    return (
      <Card>
        <Empty description="无效的项目 ID" />
      </Card>
    );
  }

  return (
    <Card
      title={
        <Space size="middle" wrap>
          <span>{project?.name ?? (loading ? '加载中…' : '项目详情')}</span>
          {project?.code ? <span>编码 {project.code}</span> : null}
        </Space>
      }
      extra={
        <Space size="small">
          <Button
            type="link"
            size="small"
            icon={<CommentOutlined />}
            onClick={discussProject}
          >
            与 AI 讨论
          </Button>
          {project?.status_code ? (
            <DictTag
              dictType="module_pm_project_status"
              value={project.status_code}
            />
          ) : null}
          {project?.priority_code ? (
            <DictTag
              dictType="module_pm_priority"
              value={project.priority_code}
            />
          ) : null}
        </Space>
      }
    >
      <Tabs
        items={[
          {
            key: 'overview',
            label: '概览',
            children: loading ? (
              <Spin />
            ) : project ? (
              <OverviewTab project={project} />
            ) : (
              <Empty description="项目不存在或已被删除" />
            ),
          },
          {
            key: 'milestones',
            label: '里程碑',
            children: <MilestonesTab projectId={projectId} />,
          },
          {
            key: 'tasks',
            label: '任务',
            children: <TasksTab projectId={projectId} />,
          },
          {
            key: 'risks',
            label: '风险',
            children: <RisksTab projectId={projectId} />,
          },
          {
            key: 'members',
            label: '成员',
            children: <MembersTab projectId={projectId} />,
          },
        ]}
      />
    </Card>
  );
};

export default ProjectDetail;
