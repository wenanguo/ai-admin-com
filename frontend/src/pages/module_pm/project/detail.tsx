import { CommentOutlined } from '@ant-design/icons';
import { useModel, useParams } from '@umijs/max';
import {
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
import { DictTag } from '@/components/pm/DictTag';
import { renderJsonTags } from '@/components/pm/JsonTags';
import { MilestoneListView } from '@/components/pm/milestone/MilestoneListView';
import { RiskListView } from '@/components/pm/risk/RiskListView';
import { TaskWorkspace } from '@/components/pm/task/TaskWorkspace';
import {
  getProjectDetail,
  getProjectMembers,
  type ProjectMemberOut,
  type ProjectOut,
} from '@/services/api/pm/project';

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

/** 日期区间的展示:两个日期中缀一个 ~,空值用占位符 */
function dateRange(start?: string | null, end?: string | null): string {
  return `${start ?? '-'} ~ ${end ?? '-'}`;
} /**
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
            children: <MilestoneListView projectId={projectId} />,
          },
          {
            key: 'tasks',
            label: '任务',
            children: <TaskWorkspace projectId={projectId} />,
          },
          {
            key: 'risks',
            label: '风险',
            children: <RiskListView projectId={projectId} />,
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
