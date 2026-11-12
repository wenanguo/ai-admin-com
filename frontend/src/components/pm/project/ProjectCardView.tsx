/**
 * **项目卡片视图**（紧凑看板卡）。
 *
 * ## 视图家族
 *
 * 项目清单有两种视图：
 * - 表格 —— `ProjectListView`；
 * - 卡片 —— **本组件**。
 *
 * ⚠️ 两个视图**共用同一份数据**（`useProjectDataset`）⇒ 切视图零请求，
 *    两边看到的永远是同一批项目。
 *
 * ## 卡片长什么样（紧凑卡）
 *
 * ```
 * ┌──────────────────────────────┐
 * │ AIPM 核心项目           🤖    │  名称（进详情页）+ 机器人（与 AI 讨论）
 * │ 规划中 · 高 · 张三 · 12-31    │  状态 · 优先级 · 负责人 · 计划截止
 * └──────────────────────────────┘
 * ```
 *
 * ⚠️ **机器人是标题链接的兄弟**（不是嵌在链接里）⇒ 点它不会顺手进详情页。
 *
 * ## 筛选行
 *
 * 卡片没有天然分组（看板按状态分列）⇒ 卡片视图**自带**一个精简筛选行
 * （名称/编码 + 状态 + 优先级），筛的是**同一份数据集**。
 */
import { PlusOutlined, RobotOutlined } from '@ant-design/icons';
import { Link, useAccess } from '@umijs/max';
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Input,
  Popconfirm,
  Row,
  Select,
  Spin,
} from 'antd';
import type React from 'react';
import { useMemo, useState } from 'react';
import { useCrudTable } from '@/components/CrudTable';
import { DictTag } from '@/components/pm/DictTag';
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
import { filterProjects } from './filterProjects';
import ProjectModalForm from './ProjectModalForm';
import { useDiscussProject } from './useDiscussProject';
import { useProjectDataset } from './useProjectDataset';

/**
 * 卡片视图的**便捷搜索**：名称**或**编码命中即可。
 *
 * ⚠️ 这是**卡片视图自己的**筛选口径，**不属于** `filterProjects` 的后端语义
 *    （后端 `name` 与 `code` 是两个独立条件 ⇒ 同时给是「与」的关系）。
 *    卡片视图只有一个搜索框 ⇒ 让它命中任一个，少一次「搜名字搜不到」的误会。
 *
 * 状态 / 优先级仍走 `filterProjects`（照后端语义）—— 见下面的 `filtered`。
 */
function matchesKeyword(project: ProjectOut, keyword: string): boolean {
  const needle = keyword.toLowerCase();
  return (
    String(project.name ?? '')
      .toLowerCase()
      .includes(needle) ||
    String(project.code ?? '')
      .toLowerCase()
      .includes(needle)
  );
}

/**
 * 项目卡片视图。
 *
 * 与表格视图同款：同一份数据集、同一套 CRUD、同一套字典、同一个「与 AI 讨论」实现。
 */
export function ProjectCardView(): React.ReactElement {
  const access = useAccess();

  /*
    **共享项目数据集** —— 与表格视图读的是同一份数据。
    ⇒ 切视图不用重新取数；写操作后重新取数，两个视图立刻一致。
  */
  const dataset = useProjectDataset();

  const crud = useCrudTable<ProjectOut, ProjectCreateParams>({
    create: createProject,
    update: updateProject,
    remove: deleteProjects,
    // ⚠️ 写操作后要**重新取全量**（本地筛选的数据源变了）——
    //    卡片自己维护筛选态 ⇒ 刷卡片没有意义。
    reload: dataset.reload,
  });

  /** 「与 AI 讨论」：与表格视图共用同一份实现（见 ./useDiscussProject） */
  const discussProject = useDiscussProject();

  // 字典选项：与表格共用同一套字典 ⇒ 标签与筛选项的文案一致
  const { options: statusOptions } = useDictOptions('module_pm_project_status');
  const { options: priorityOptions } = useDictOptions('module_pm_priority');

  /** 筛选行自己的状态（每个视图的筛选是各自独立的 UI 状态） */
  const [keyword, setKeyword] = useState('');
  const [statusCode, setStatusCode] = useState<string | undefined>(undefined);
  const [priorityCode, setPriorityCode] = useState<string | undefined>(
    undefined,
  );

  /**
   * 筛完的项目。
   *
   * - 状态 / 优先级 ⇒ `filterProjects`（**语义照后端**）
   * - 名称 / 编码 ⇒ 卡片视图自己的便捷搜索（见 `matchesKeyword`）
   */
  const filtered = useMemo(() => {
    const byDict = filterProjects(dataset.projects, {
      status_code: statusCode,
      priority_code: priorityCode,
    });
    const trimmed = keyword.trim();
    if (!trimmed) return byDict;
    return byDict.filter((project) => matchesKeyword(project, trimmed));
  }, [dataset.projects, keyword, priorityCode, statusCode]);

  // 权限码与表格视图**同一套**（见 ProjectListView）
  const canCreate = access.hasPermission('module_pm_project:pm_project:create');
  const canEdit = access.hasPermission('module_pm_project:pm_project:update');
  const canDelete = access.hasPermission('module_pm_project:pm_project:delete');

  return (
    <div className="flex flex-col gap-4">
      {/*
        取数有上限（10 页 × 100 条 = 1000 条）⇒ 被截断时**显式提示**，
        不静默（与表格视图同一条口径）。
      */}
      {dataset.truncated ? (
        <Alert
          type="info"
          showIcon
          title={`项目太多,一次最多取 ${dataset.projects.length} 条(共 ${dataset.total} 条),其余请用搜索缩小范围`}
        />
      ) : null}

      {/* 筛选行 + 「新增」（新增按钮放在筛选行右边,与甘特图自己带一个「新增任务」同款） */}
      <div className="flex flex-wrap items-center gap-2">
        <Input.Search
          allowClear
          placeholder="搜索项目名称/编码"
          aria-label="搜索项目名称或编码"
          value={keyword}
          onChange={(event) => {
            setKeyword(event.target.value);
          }}
          style={{ width: 240 }}
        />
        <Select
          allowClear
          placeholder="状态"
          aria-label="按状态筛选"
          value={statusCode}
          onChange={(value) => {
            setStatusCode(value);
          }}
          options={statusOptions.map((option) => ({
            label: option.label,
            value: option.value,
          }))}
          style={{ width: 140 }}
        />
        <Select
          allowClear
          placeholder="优先级"
          aria-label="按优先级筛选"
          value={priorityCode}
          onChange={(value) => {
            setPriorityCode(value);
          }}
          options={priorityOptions.map((option) => ({
            label: option.label,
            value: option.value,
          }))}
          style={{ width: 140 }}
        />
        <Button
          type="primary"
          icon={<PlusOutlined />}
          className="ml-auto"
          disabled={!canCreate}
          onClick={crud.openCreate}
        >
          新增
        </Button>
      </div>

      {dataset.loading ? (
        <div className="flex justify-center py-10">
          <Spin />
        </div>
      ) : filtered.length === 0 ? (
        <Empty description="没有符合条件的项目" />
      ) : (
        <Row gutter={[16, 16]}>
          {filtered.map((project) => (
            <Col
              key={String(project.id ?? project.code ?? project.name ?? '')}
              xs={24}
              sm={12}
              lg={8}
              xl={6}
            >
              <Card
                size="small"
                // ⚠️ e2e 靠它数卡片（与表格的行数对比）
                data-project-id={project.id}
                className="group h-full"
                title={
                  project.id == null ? (
                    (project.name ?? '-')
                  ) : (
                    <Link to={`/pm/project/${project.id}`}>
                      {project.name ?? '-'}
                    </Link>
                  )
                }
                /*
                  机器人在**卡片头右侧**（与标题链接是兄弟节点,不是嵌在链接里）
                  ⇒ 点它不会顺手进详情页。
                */
                extra={
                  <Button
                    type="text"
                    size="small"
                    data-role="ai-discuss-button"
                    icon={<RobotOutlined />}
                    title="与 AI 讨论"
                    aria-label="与 AI 讨论"
                    onClick={() => {
                      discussProject(project);
                    }}
                  />
                }
              >
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <DictTag
                      dictType="module_pm_project_status"
                      value={project.status_code}
                    />
                    <DictTag
                      dictType="module_pm_priority"
                      value={project.priority_code}
                    />
                    <span>{project.owner_by?.name ?? '-'}</span>
                    {project.due_date ? <span>{project.due_date}</span> : null}
                  </div>
                  {/*
                    编辑 / 删除：右下角，**hover 才出现**（鼠标不在卡片上时收起）。
                    权限码与表格视图同一套 ⇒ 少了权限就点不动。
                  */}
                  <div className="flex justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                    <Button
                      type="text"
                      size="small"
                      disabled={!canEdit}
                      onClick={() => {
                        crud.openEdit(project);
                      }}
                    >
                      编辑
                    </Button>
                    <Popconfirm
                      title="确认删除该项目?"
                      onConfirm={() => {
                        crud.handleDelete(project);
                      }}
                      disabled={!canDelete}
                    >
                      <Button
                        type="text"
                        size="small"
                        danger
                        disabled={!canDelete}
                      >
                        删除
                      </Button>
                    </Popconfirm>
                  </div>
                </div>
              </Card>
            </Col>
          ))}
        </Row>
      )}

      <ProjectModalForm
        open={crud.modalOpen}
        record={crud.editing}
        onOpenChange={crud.closeModal}
        onSubmit={crud.handleSubmit}
      />
    </div>
  );
}
