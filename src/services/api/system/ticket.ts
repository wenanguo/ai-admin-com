import { request } from '@umijs/max';
import type { ApiResponse, PageQuery, PageResult } from '@/services/types';

/**
 * 工单类型。
 *
 * 取值来自后端 `app/common/enums.py` 的 `TicketTypeEnum`:
 * suggestion(建议)/ bug(缺陷)/ optimize(优化)/ other(其他)。
 * 写路径上把类型收窄成联合类型 ⇒ 提交了非法类型在编译期就被挡住
 * (后端 `TicketCreateSchema.ticket_type` 用的是同一个枚举,其它值一律 422)。
 */
export type TicketType = 'suggestion' | 'bug' | 'optimize' | 'other';

/**
 * 工单状态。
 *
 * 取值来自后端 `TicketBatchSchema.status`(0..3)与 `TicketUpdateSchema.status`:
 * 0 待处理 / 1 处理中 / 2 已完成 / 3 已关闭。
 */
export type TicketStatus = 0 | 1 | 2 | 3;

/** 后端 TicketOutSchema.assigned_by(后端 CommonSchema:{ id, name }) */
export interface TicketAssignee {
  id?: number | null;
  name?: string | null;
}

/** 后端 TicketOutSchema */
export interface TicketOut {
  id?: number | null;
  title?: string | null;
  /**
   * 响应里的类型**不收窄**:它是后端返回的数据(可能来自历史脏数据),
   * 用到它的表单会自己校验成 TicketType 再提交。
   */
  ticket_type?: TicketType | string | null;
  ticket_content?: string | null;
  summary?: string | null;
  images?: string | null;
  description?: string | null;
  /** 处理人 id(后端 TicketOutSchema.assigned_id) */
  assigned_id?: number | null;
  /**
   * 处理人(后端 TicketOutSchema.assigned_by)。
   *
   * 后端 `TicketModel.assigned_by` 是 `lazy="selectin"` 的关系,
   * 查列表时就一并加载了 ⇒ 表格里能直接显示处理人的名字,不用再查一次用户表。
   */
  assigned_by?: TicketAssignee | null;
  status?: number | null;
  created_time?: string | null;
}

/** 工单列表的查询参数(与后端 TicketQueryParam 对应) */
export type TicketListParams = Partial<PageQuery> & {
  /** 标题(后端按 like 匹配) */
  title?: string;
  /** 工单类型(与存储值一致) */
  ticket_type?: string;
  /** 处理人 id */
  assigned_id?: number;
  /** 状态 0..3 */
  status?: number;
};

export type TicketCreateParams = {
  title: string;
  ticket_content: string;
  ticket_type: TicketType;
  summary?: string | null;
  images?: string | null;
  description?: string | null;
};

export type TicketUpdateParams = TicketCreateParams;

/**
 * 批量更新的入参 —— 后端 `TicketBatchSchema` 就这两个字段。
 *
 * ⚠️ 工单的「批量更新」**不是**通用的「批量改任意字段」,而是**批量改状态**:
 * `ids` 是工单 id 列表,`status` 是目标状态(0..3)。
 */
export interface TicketBatchParams {
  ids: number[];
  status: TicketStatus;
}

/** 工单列表 */
export async function listTickets(params: TicketListParams) {
  return request<ApiResponse<PageResult<TicketOut>>>('/system/ticket/list', {
    method: 'GET',
    params,
  });
}

/** 工单详情 */
export async function getTicketDetail(id: number) {
  return request<ApiResponse<TicketOut>>(`/system/ticket/detail/${id}`, {
    method: 'GET',
  });
}

/** 创建工单 */
export async function createTicket(params: TicketCreateParams) {
  return request<ApiResponse<TicketOut>>('/system/ticket/create', {
    method: 'POST',
    data: params,
  });
}

/** 更新工单 */
export async function updateTicket(id: number, params: TicketUpdateParams) {
  return request<ApiResponse<TicketOut>>(`/system/ticket/update/${id}`, {
    method: 'PUT',
    data: params,
  });
}

/** 删除工单(后端请求体是裸数组,不是 { ids }) */
export async function deleteTickets(ids: number[]) {
  return request<ApiResponse<null>>('/system/ticket/delete', {
    method: 'DELETE',
    data: ids,
  });
}

/**
 * 批量更新工单状态 —— PUT /system/ticket/batch。
 *
 * ⚠️ 方法是 **PUT**(不是 PATCH),入参是 `{ ids, status }` 两个平级字段
 * (后端 `TicketBatchSchema`)。后端还会校验状态流转是否合法
 * (例如「已完成」不能直接回到「待处理」),不合法时返回业务错误。
 */
export async function batchUpdateTickets(params: TicketBatchParams) {
  return request<ApiResponse<null>>('/system/ticket/batch', {
    method: 'PUT',
    data: params,
  });
}
