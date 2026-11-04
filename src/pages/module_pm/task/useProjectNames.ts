import { useEffect, useMemo, useState } from 'react';
import { listMilestones } from '@/services/api/pm/milestone';
import { listProjects } from '@/services/api/pm/project';

/**
 * 项目/里程碑名字的**侧载**。
 *
 * 后端的**任务**响应里没有 project_by / milestone_by ——
 * 任务的 schema 只带 assignee_by 与 reporter_by(里程碑的响应才有 project_by)。
 * 任务表里只有 project_id / milestone_id 两个外键,前端要显示名字,
 * 就得自己把项目表与里程碑表拉下来做映射。
 *
 * 三条纪律:
 * 1. **一次**:两张表各拉一次(挂载时),不是在每行的 render 里发请求 ——
 *    20 行任务就是 40 个请求,后端直接被打爆,表格也卡。
 * 2. **查表**:列的 render 只做 Map 查表,不发请求。
 * 3. **降级**:某一张表拉失败,只是那一张没有名字,另一张照常 ——
 *    失败提示由请求层统一弹,这里不抛。
 */

/** 侧载一次的上限:后端 page_size 最大 100(同 CRUD_PAGINATION) */
const SIDE_LOAD_PARAMS = { page_no: 1, page_size: 100 } as const;

/** 项目下拉选项(label 给人看,value 是项目 id) */
export interface ProjectOption {
  label: string;
  value: number;
}

/** 里程碑下拉选项(多带 projectId:表单里按所属项目过滤) */
export interface MilestoneOption extends ProjectOption {
  /** 所属项目 id(后端里程碑的 project_id) */
  projectId: number | null;
}

/** useProjectNames 的返回值 */
export interface ProjectNames {
  /** 项目 id → 项目名(列的 render 里查表) */
  projectNames: Map<number, string>;
  /** 里程碑 id → 里程碑名(列的 render 里查表) */
  milestoneNames: Map<number, string>;
  /** 项目下拉选项(表单与搜索栏共用,不再发请求) */
  projectOptions: ProjectOption[];
  /** 里程碑下拉选项(表单里按所属项目过滤) */
  milestoneOptions: MilestoneOption[];
  /** 侧载是否还在途 */
  loading: boolean;
}

/** 项目列表 → 下拉选项(没有 id 的行没法当候选项,丢掉) */
function toProjectOptions(
  items: { id?: number | null; name?: string | null }[],
): ProjectOption[] {
  return items.flatMap((project) =>
    project.id == null
      ? []
      : [{ label: project.name ?? String(project.id), value: project.id }],
  );
}

/** 里程碑列表 → 下拉选项(带上所属项目,表单里按项目过滤) */
function toMilestoneOptions(
  items: {
    id?: number | null;
    name?: string | null;
    project_id?: number | null;
  }[],
): MilestoneOption[] {
  return items.flatMap((milestone) =>
    milestone.id == null
      ? []
      : [
          {
            label: milestone.name ?? String(milestone.id),
            value: milestone.id,
            projectId: milestone.project_id ?? null,
          },
        ],
  );
}

/**
 * 侧载项目与里程碑的名字映射。
 *
 * 页面与表单共用这一份:表单的项目/里程碑下拉直接用返回的选项,
 * 不再单独发请求(里程碑页的「所属项目」是远程搜索,这里是侧载复用)。
 */
export function useProjectNames(): ProjectNames {
  const [projectOptions, setProjectOptions] = useState<ProjectOption[]>([]);
  const [milestoneOptions, setMilestoneOptions] = useState<MilestoneOption[]>(
    [],
  );
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [milestonesLoading, setMilestonesLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    listProjects(SIDE_LOAD_PARAMS)
      .then((res) => {
        if (cancelled) return;
        setProjectOptions(toProjectOptions(res?.data?.items ?? []));
      })
      .catch(() => {
        // 失败提示由请求层统一弹,这里降级成空选项
      })
      .finally(() => {
        if (!cancelled) setProjectsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    listMilestones(SIDE_LOAD_PARAMS)
      .then((res) => {
        if (cancelled) return;
        setMilestoneOptions(toMilestoneOptions(res?.data?.items ?? []));
      })
      .catch(() => {
        // 失败提示由请求层统一弹,这里降级成空选项
      })
      .finally(() => {
        if (!cancelled) setMilestonesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // id → 名字的映射表:列的 render 里查表,不回查接口
  const projectNames = useMemo(
    () => new Map(projectOptions.map((option) => [option.value, option.label])),
    [projectOptions],
  );
  const milestoneNames = useMemo(
    () =>
      new Map(milestoneOptions.map((option) => [option.value, option.label])),
    [milestoneOptions],
  );

  return {
    projectNames,
    milestoneNames,
    projectOptions,
    milestoneOptions,
    loading: projectsLoading || milestonesLoading,
  };
}
