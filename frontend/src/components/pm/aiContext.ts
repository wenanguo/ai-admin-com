import type { AiTaskContext } from '@/services/api/ai/types';
import type { TaskOut } from '@/services/api/pm/task';

/**
 * 「当前讨论的任务」上下文的组装。
 *
 * ## 为什么由前端组装（而不是让 AI 服务去查）
 *
 * - **权限**：查详情要 `…:detail` 权限，只有列表权限的角色拿不到 ⇒
 *   服务端查会 403 ⇒ 对话直接废掉。而列表页**手上就有**那一行。
 * - **一致性**：用户点的是**他看到的这一行** ⇒ 上下文就该是这一行。
 * - **零额外请求**：列表/看板/甘特本来就把数据拉在本地了。
 *
 * ## task 里为什么是「回填基线」那一组字段
 *
 * 后端 `update_task` 是**整对象 PUT**（`UpdateSchema` 继承 `CreateSchema`）：
 * 缺 `project_id/title/type_code/status_code/priority_code` 任一个就 422。
 *
 * ⇒ 上下文里的 `task` 必须是**能直接 PUT 出去的那份** ⇒
 *   基线字段与列表页编辑表单提交的那一组**保持一致**
 *   （见 `pages/module_pm/task/ModalForm.tsx` 的 `toBasePayload`）。
 *
 * ⚠️ **不带** `reporter_id` / `sort_order` / `created_via_code`：
 * 那三列不是用户可编辑的（报告人是创建人、排序是看板顺序、创建方式是来源），
 * 后端 `exclude_unset=True` ⇒ 不带就是保持原值 ⇒ 带上反而会改掉它们。
 */
export interface BuildAiContextInput {
  /** 任务行（列表/看板/甘特里的那一行）。 */
  task: TaskOut;
  /** 所属项目名（列表页是侧载出来的）。 */
  projectName?: string;
  /** 所属里程碑名。 */
  milestoneName?: string;
  /** 字典中文名（线上码 → 中文）：状态/优先级/类型。 */
  labels?: Record<string, string>;
}

/** 项目上下文的入参。 */
export interface BuildAiProjectContextInput {
  /** 项目行（项目列表/详情里的那一行）。 */
  project: {
    id?: number | null;
    code?: string | null;
    name?: string | null;
    status_code?: string | null;
    priority_code?: string | null;
    owner_by?: { id?: number | null; name?: string | null } | null;
  };
  /** 字典中文名（线上码 → 中文）。 */
  labels?: Record<string, string>;
}

/**
 * 任务行 → 讨论上下文。
 *
 * @returns 任务没有 id ⇒ null（没有 id 就没法回填，也没法高亮）。
 */
export function buildAiTaskContext(
  input: BuildAiContextInput,
): AiTaskContext | null {
  const { task, projectName, milestoneName, labels } = input;
  if (task.id == null) return null;

  // ⚠️ 基线字段与「编辑任务」表单提交的字段**保持一致**（整对象 PUT 的要求）。
  const baseline: Record<string, unknown> = {
    project_id: task.project_id ?? null,
    milestone_id: task.milestone_id ?? null,
    parent_id: task.parent_id ?? null,
    title: task.title ?? '',
    description: task.description ?? null,
    type_code: task.type_code ?? '',
    status_code: task.status_code ?? '',
    priority_code: task.priority_code ?? '',
    estimate_hours: task.estimate_hours ?? null,
    actual_hours: task.actual_hours ?? null,
    assignee_id: task.assignee_id ?? null,
    reviewers: task.reviewers ?? null,
    labels: task.labels ?? null,
    start_date: task.start_date ?? null,
    due_date: task.due_date ?? null,
    blocked_reason: task.blocked_reason ?? null,
  };

  return {
    kind: 'task',
    task: { ...baseline, id: task.id },
    labels,
    names: {
      assignee:
        task.assignee_by?.name ?? task.assignee_by?.username ?? undefined,
      reporter:
        task.reporter_by?.name ?? task.reporter_by?.username ?? undefined,
    },
    project:
      task.project_id == null
        ? undefined
        : {
            id: task.project_id,
            name: projectName ?? `项目 ${task.project_id}`,
          },
    milestone:
      task.milestone_id == null
        ? undefined
        : {
            id: task.milestone_id,
            name: milestoneName ?? `里程碑 ${task.milestone_id}`,
          },
  };
}

/**
 * 项目行 → 讨论上下文。
 *
 * ## 为什么项目也要有上下文
 *
 * 用户点开的是**项目** ⇒ 他想知道的是「这个项目现在怎么样」⇒
 * 智能体要能列它的里程碑与任务 ⇒ 上下文里必须有项目的 id 与名字。
 *
 * ⚠️ 项目上下文**没有** `task` ⇒ 服务端**不会**把写操作收窄到某一条任务
 *    （那是任务上下文才有的待遇）⇒ 但「只能改三个字段」这条规矩仍然有效。
 *
 * @returns 项目没有 id ⇒ null（没 id 就没法让智能体去查它）。
 */
export function buildAiProjectContext(
  input: BuildAiProjectContextInput,
): AiTaskContext | null {
  const { project, labels } = input;
  if (project.id == null) {
    return null;
  }
  return {
    kind: 'project',
    labels,
    names: { assignee: project.owner_by?.name ?? undefined },
    project: {
      id: project.id,
      name: project.name ?? `项目 ${project.id}`,
    },
    projectCode: project.code ?? undefined,
  };
}

/**
 * 上下文 → 气泡上的**技能标签**（像参考界面里的那个 chip）。
 *
 * ⚠️ 只是给人看的标签 ⇒ 智能体那边不靠它识别（它靠真正的上下文块）。
 */
export function contextSkillLabel(context: AiTaskContext): string {
  return context.kind === 'project' ? '项目助手' : '任务助手';
}

/**
 * 字典选项（线上码 → 中文）合成一张表。
 *
 * ⚠️ 三个字典（状态/优先级/类型）合成**一张**表：它们的线上码不重叠
 *   （状态是 backlog/todo/in_progress…，优先级是 P0/P1…，类型是 feature/bug…）
 *   ⇒ 一张表就够，服务端渲染成「in_progress（进行中）」。
 */
export function mergeDictLabels(
  ...groups: { value: string; label: string }[][]
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const group of groups) {
    for (const option of group) {
      result[option.value] = option.label;
    }
  }
  return result;
}
