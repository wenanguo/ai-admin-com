import { request } from '@umijs/max';
import type { ApiResponse, PageQuery, PageResult } from '@/services/types';
import { PM_PROJECT_PREFIX } from './paths';

/**
 * 项目管理 service。
 *
 * 后端的坑:
 * - 路由前缀是**两段**的 `/pm_project/pm_project`(后端容器前缀与 controller
 *   自己的 prefix 拼接而成,成因见 ./paths.ts)—— 路径一律由 PM_PROJECT_PREFIX 拼出
 * - 更新是 `PUT /pm_project/pm_project/update/{id}` 且要传**整对象** —— 后端
 *   `ModulePmProjectUpdateSchema` 继承 CreateSchema,没有 PATCH,少一个必填字段就是 422
 * - 删除的请求体是**裸数组**(不是 `{ ids }`)
 * - `tags` / `extra_fields` 语义是数组和对象,但后端存的是 **JSON 字符串** ——
 *   序列化/反序列化是表单层的职责,service 层原样透传
 */

/** 后端 ModulePmProjectOutSchema.owner_by —— 项目 PM 信息 {id, name, username} */
export interface ProjectOwnerBy {
  id?: number | null;
  name?: string | null;
  username?: string | null;
}

/** 后端 ModulePmProjectOutSchema */
export interface ProjectOut {
  id?: number | null;
  /** 项目编码(后端正则 ^[A-Z0-9_-]{2,32}$,租户内唯一) */
  code?: string | null;
  /** 项目名称 */
  name?: string | null;
  /** 项目描述(Markdown) */
  description?: string | null;
  /** 项目PM(sys_user.id) */
  owner_id?: number | null;
  /** 来源模板(module_pm_project_template.id) */
  template_id?: number | null;
  /** 状态(字典:module_pm_project_status) */
  status_code?: string | null;
  /** 优先级(字典:module_pm_priority) */
  priority_code?: string | null;
  /** 计划开始日期 */
  start_date?: string | null;
  /** 计划截止日期 */
  due_date?: string | null;
  /** 可见性(字典:module_pm_visibility) */
  visibility_code?: string | null;
  /** 标签数组(后端存 JSON 字符串) */
  tags?: string | null;
  /** 模板扩展字段(JSON 字符串) */
  extra_fields?: string | null;
  /** 项目 PM 信息 {id, name, username} */
  owner_by?: ProjectOwnerBy | null;
  created_time?: string | null;
  updated_time?: string | null;
}

/** 后端 ModulePmProjectQueryParam */
export type ProjectListParams = Partial<PageQuery> & {
  code?: string;
  name?: string;
  owner_id?: number;
  template_id?: number;
  status_code?: string;
  priority_code?: string;
  start_date?: string;
  due_date?: string;
  visibility_code?: string;
  tags?: string;
  extra_fields?: string;
};

/** 后端 ModulePmProjectCreateSchema */
export type ProjectCreateParams = {
  /** 项目编码(^[A-Z0-9_-]{2,32}$,租户内唯一) */
  code: string;
  /** 项目名称 */
  name: string;
  /** 项目描述(Markdown) */
  description?: string | null;
  /** 项目PM(sys_user.id) */
  owner_id: number;
  /** 来源模板(module_pm_project_template.id) */
  template_id?: number | null;
  /** 状态(字典:module_pm_project_status) */
  status_code: string;
  /** 优先级(字典:module_pm_priority) */
  priority_code: string;
  /** 计划开始日期 */
  start_date: string;
  /** 计划截止日期 */
  due_date: string;
  /** 可见性(字典:module_pm_visibility) */
  visibility_code: string;
  /** 标签数组(后端存 JSON 字符串) */
  tags?: string | null;
  /** 模板扩展字段(JSON 字符串) */
  extra_fields?: string | null;
};

/** 更新要传整对象:后端 UpdateSchema 继承 CreateSchema,必填集相同 */
export type ProjectUpdateParams = ProjectCreateParams;

/** 项目列表 */
export async function listProjects(
  params: ProjectListParams,
): Promise<ApiResponse<PageResult<ProjectOut>>> {
  return request<ApiResponse<PageResult<ProjectOut>>>(
    `${PM_PROJECT_PREFIX}/list`,
    {
      method: 'GET',
      params,
    },
  );
}

/** 项目详情 */
export async function getProjectDetail(
  id: number,
): Promise<ApiResponse<ProjectOut>> {
  return request<ApiResponse<ProjectOut>>(`${PM_PROJECT_PREFIX}/detail/${id}`, {
    method: 'GET',
  });
}

/**
 * 项目成员(JOIN sys_user 的出参,姓名等用户信息在 user_info 冗余字段里)。
 * 字段全部可空:接口只保证 project_id/user_id/role_code 有值
 */
export interface ProjectMemberOut {
  id?: number | null;
  project_id?: number | null;
  user_id?: number | null;
  /** 项目角色码(字典 module_pm_project_role) */
  role_code?: string | null;
  joined_at?: string | null;
  /** JOIN sys_user 带出来的用户信息,可能为 null(用户被删时) */
  user_info?: {
    id?: number | null;
    username?: string | null;
    name?: string | null;
  } | null;
}

/**
 * 项目成员列表。
 *
 * 注意与其它子列表不一样:这是路径参数接口(/pm_project/pm_project/members/{id}),
 * 返回的是**数组**而不是分页信封 —— data 直接就是成员列表,
 * 没有 items/total 包裹
 */
export async function getProjectMembers(
  id: number,
): Promise<ApiResponse<ProjectMemberOut[]>> {
  return request<ApiResponse<ProjectMemberOut[]>>(
    `${PM_PROJECT_PREFIX}/members/${id}`,
    {
      method: 'GET',
    },
  );
}

/** 创建项目 */
export async function createProject(
  params: ProjectCreateParams,
): Promise<ApiResponse<ProjectOut>> {
  return request<ApiResponse<ProjectOut>>(`${PM_PROJECT_PREFIX}/create`, {
    method: 'POST',
    data: params,
  });
}

/** 更新项目(整对象 PUT,后端没有 PATCH) */
export async function updateProject(
  id: number,
  params: ProjectUpdateParams,
): Promise<ApiResponse<ProjectOut>> {
  return request<ApiResponse<ProjectOut>>(`${PM_PROJECT_PREFIX}/update/${id}`, {
    method: 'PUT',
    data: params,
  });
}

/** 删除项目(后端请求体是裸数组,不是 { ids }) */
export async function deleteProjects(
  ids: number[],
): Promise<ApiResponse<null>> {
  return request<ApiResponse<null>>(`${PM_PROJECT_PREFIX}/delete`, {
    method: 'DELETE',
    data: ids,
  });
}
