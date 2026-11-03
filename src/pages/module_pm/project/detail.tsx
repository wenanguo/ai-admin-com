import { useParams } from '@umijs/max';
import {
  Card,
  Descriptions,
  type DescriptionsProps,
  Empty,
  List,
  Progress,
  Space,
  Spin,
  Table,
  type TableProps,
  Tabs,
  Tag,
} from 'antd';
import type React from 'react';
import { useEffect, useState } from 'react';
import { DictTag } from '@/components/pm/DictTag';
import { renderJsonTags } from '@/components/pm/JsonTags';
import {
  RISK_LEVEL_COLOR,
  riskLevel,
  riskLevelLabel,
} from '@/components/pm/riskLevel';
import { listMilestones, type MilestoneOut } from '@/services/api/pm/milestone';
import {
  getProjectDetail,
  getProjectMembers,
  type ProjectMemberOut,
  type ProjectOut,
} from '@/services/api/pm/project';
import { listRisks, type RiskOut } from '@/services/api/pm/risk';
import { listTasks, type TaskOut } from '@/services/api/pm/task';

/**
 * 子列表的分页参数:详情页各 tab 是只读总览,一次拉满后端 page_size
 * 上限(100,同 CRUD_PAGINATION)就不再翻页了
 */
const SUB_LIST_PARAMS = { page_no: 1, page_size: 100 } as const;

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
  const [milestones, setMilestones] = useState<MilestoneOut[]>([]);

  useEffect(() => {
    let cancelled = false;
    // 失败提示由请求层统一弹,这里落地成空态
    listMilestones({ project_id: projectId, ...SUB_LIST_PARAMS })
      .then((res) => {
        if (!cancelled) setMilestones(res?.data?.items ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  if (milestones.length === 0) {
    return <Empty description="暂无里程碑" />;
  }

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      {milestones.map((milestone) => (
        <Card
          key={String(milestone.id ?? milestone.name ?? '')}
          size="small"
          title={milestone.name ?? '-'}
          extra={
            milestone.status_code ? (
              <DictTag
                dictType="module_pm_milestone_status"
                value={milestone.status_code}
              />
            ) : null
          }
        >
          <Space direction="vertical" size="small" style={{ width: '100%' }}>
            <Progress percent={milestone.progress ?? 0} />
            <Space size="large" wrap>
              <span>
                计划区间 {dateRange(milestone.start_date, milestone.due_date)}
              </span>
              <span>
                实际区间{' '}
                {dateRange(
                  milestone.actual_start_date,
                  milestone.actual_end_date,
                )}
              </span>
            </Space>
          </Space>
        </Card>
      ))}
    </Space>
  );
}

/**
 * 任务 tab:精简表格(标题/状态/优先级/负责人/截止日)。
 * 负责人读 assignee_by 冗余字段(JOIN sys_user 的姓名),不回查用户表
 */
function TasksTab({ projectId }: { projectId: number }) {
  const [tasks, setTasks] = useState<TaskOut[]>([]);

  useEffect(() => {
    let cancelled = false;
    listTasks({ project_id: projectId, ...SUB_LIST_PARAMS })
      .then((res) => {
        if (!cancelled) setTasks(res?.data?.items ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const columns: TableProps<TaskOut>['columns'] = [
    {
      title: '标题',
      dataIndex: 'title',
      render: (_, record) => record.title ?? '-',
    },
    {
      title: '状态',
      dataIndex: 'status_code',
      render: (_, record) =>
        record.status_code ? (
          <DictTag
            dictType="module_pm_task_status"
            value={record.status_code}
          />
        ) : (
          '-'
        ),
    },
    {
      title: '优先级',
      dataIndex: 'priority_code',
      render: (_, record) =>
        record.priority_code ? (
          <DictTag dictType="module_pm_priority" value={record.priority_code} />
        ) : (
          '-'
        ),
    },
    {
      title: '负责人',
      dataIndex: 'assignee_id',
      render: (_, record) => record.assignee_by?.name ?? '-',
    },
    {
      title: '截止日',
      dataIndex: 'due_date',
      render: (_, record) => record.due_date ?? '-',
    },
  ];

  return <Table<TaskOut> rowKey="id" columns={columns} dataSource={tasks} />;
}

/**
 * 风险 tab:列表 + 等级标签。后端只有 score(= 概率 × 影响)没有 level,
 * 等级用共享件 riskLevel 本地推导;分数随行展示(等级的推导依据)
 */
function RisksTab({ projectId }: { projectId: number }) {
  const [risks, setRisks] = useState<RiskOut[]>([]);

  useEffect(() => {
    let cancelled = false;
    listRisks({ project_id: projectId, ...SUB_LIST_PARAMS })
      .then((res) => {
        if (!cancelled) setRisks(res?.data?.items ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  return (
    <List
      dataSource={risks}
      renderItem={(risk) => {
        // score 为空就没法推导等级,连标签一起不显示
        const level = risk.score == null ? null : riskLevel(risk.score);
        return (
          <List.Item>
            <Space size="middle" wrap>
              <span>{risk.title ?? '-'}</span>
              {level ? (
                <Tag color={RISK_LEVEL_COLOR[level]}>
                  {riskLevelLabel(level)}
                </Tag>
              ) : null}
              {risk.score == null ? null : <span>{risk.score} 分</span>}
              {risk.status_code ? (
                <DictTag
                  dictType="module_pm_risk_status"
                  value={risk.status_code}
                />
              ) : null}
            </Space>
          </List.Item>
        );
      }}
    />
  );
}

/**
 * 成员 tab:members 是路径参数接口(/pm_project/members/{id}),返回的
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
