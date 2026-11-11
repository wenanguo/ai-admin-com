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
 *
 * ⚠️ **侧载有上限,上限是可见的**:后端 page_size 最大 100,这里一次只拉 100 条
 * (排序显式写成 id 倒序 ⇒ 拿到的是**最新的** 100 条)。项目与里程碑都是会
 * 越攒越多的东西,所以「第 101 条开始就查不到名字」是迟早的事。
 * 页面据此给出提示(见 task/index.tsx 的 Alert),**不静默截断**:
 * 侧载到的条数与后端的总数都会带出去,页面据此判断要不要提示。
 */

/** 侧载一次的上限:后端 page_size 最大 100(同 CRUD_PAGINATION) */
const SIDE_LOAD_PARAMS = {
  page_no: 1,
  page_size: 100,
  // 排序显式写出来:后端的默认排序也是 id 倒序,但写出来才能保证
  // 「侧载到的是最新的 100 条」是构造出来的,而不是后端改了默认值才知道
  order_by: JSON.stringify([{ id: 'desc' }]),
} as const;

/** 下拉选项(label 给人看,value 是实体 id) */
export interface ProjectOption {
  label: string;
  value: number;
}

/** useProjectNames 的返回值 */
export interface ProjectNames {
  /** 项目 id → 项目名(列的 render 里查表) */
  projectNames: Map<number, string>;
  /** 里程碑 id → 里程碑名(列的 render 里查表) */
  milestoneNames: Map<number, string>;
  /** 项目下拉选项(表单与搜索栏共用,不再发请求) */
  projectOptions: ProjectOption[];
  /**
   * 里程碑选项(与项目选项同形)。
   *
   * ⚠️ **表单不再用这一份**:表单的「所属里程碑」是**按所选项目单独拉**的
   * (见 task/ModalForm.tsx)—— 全局侧载只覆盖最新的 100 条,跨项目一多就漏。
   * 这里留着是为了表格里把 milestone_id 映射成名字,以及判断侧载有没有被截断。
   */
  milestoneOptions: ProjectOption[];
  /** 侧载是否还在途 */
  loading: boolean;
  /** 后端一共多少个项目(侧载只拿到其中 100 条,差值用来提示) */
  projectTotal: number;
  /** 后端一共多少个里程碑(侧载只拿到其中 100 条,差值用来提示) */
  milestoneTotal: number;
}

/** 项目/里程碑列表 → 下拉选项(没有 id 的行没法当候选项,丢掉) */
function toOptions(
  items: { id?: number | null; name?: string | null }[],
): ProjectOption[] {
  return items.flatMap((item) =>
    item.id == null
      ? []
      : [{ label: item.name ?? String(item.id), value: item.id }],
  );
}

/**
 * 侧载项目与里程碑的名字映射。
 *
 * 页面与表单共用这一份:表单的项目下拉直接用返回的选项,
 * 不再单独发请求(里程碑页的「所属项目」是远程搜索,这里是侧载复用)。
 * 表单的「所属里程碑」**不**用这里的选项 —— 它按所选项目单独拉,见上面的说明。
 */
export function useProjectNames(): ProjectNames {
  const [projectOptions, setProjectOptions] = useState<ProjectOption[]>([]);
  const [milestoneOptions, setMilestoneOptions] = useState<ProjectOption[]>([]);
  const [projectTotal, setProjectTotal] = useState(0);
  const [milestoneTotal, setMilestoneTotal] = useState(0);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [milestonesLoading, setMilestonesLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    listProjects(SIDE_LOAD_PARAMS)
      .then((res) => {
        if (cancelled) return;
        setProjectOptions(toOptions(res?.data?.items ?? []));
        setProjectTotal(res?.data?.total ?? 0);
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
        setMilestoneOptions(toOptions(res?.data?.items ?? []));
        setMilestoneTotal(res?.data?.total ?? 0);
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
    projectTotal,
    milestoneTotal,
  };
}
