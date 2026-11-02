import { request } from '@umijs/max';
import type { ApiResponse, PageQuery, PageResult } from '@/services/types';

/** 后端 NoticeOutSchema */
export interface NoticeOut {
  id?: number | null;
  notice_title?: string | null;
  notice_type?: string | null;
  notice_content?: string | null;
  status?: number | null;
  description?: string | null;
  created_time?: string | null;
}

export type NoticeListParams = Partial<PageQuery> & {
  notice_title?: string;
  notice_type?: string;
  status?: number;
};

export type NoticeCreateParams = {
  notice_title: string;
  notice_type: string;
  notice_content?: string | null;
  status?: number;
  description?: string | null;
};

export type NoticeUpdateParams = NoticeCreateParams;

/** 公告列表 */
export async function listNotices(params: NoticeListParams) {
  return request<ApiResponse<PageResult<NoticeOut>>>('/system/notice/list', {
    method: 'GET',
    params,
  });
}

/** 公告详情 */
export async function getNoticeDetail(id: number) {
  return request<ApiResponse<NoticeOut>>(`/system/notice/detail/${id}`, {
    method: 'GET',
  });
}

/** 创建公告 */
export async function createNotice(params: NoticeCreateParams) {
  return request<ApiResponse<NoticeOut>>('/system/notice/create', {
    method: 'POST',
    data: params,
  });
}

/** 更新公告 */
export async function updateNotice(id: number, params: NoticeUpdateParams) {
  return request<ApiResponse<NoticeOut>>(`/system/notice/update/${id}`, {
    method: 'PUT',
    data: params,
  });
}

/** 删除公告(后端请求体是裸数组,不是 { ids }) */
export async function deleteNotices(ids: number[]) {
  return request<ApiResponse<null>>('/system/notice/delete', {
    method: 'DELETE',
    data: ids,
  });
}

/** 批量启用/禁用公告(请求体是 { ids, status } 两个平级字段) */
export async function batchSetNoticesStatus(ids: number[], status: number) {
  return request<ApiResponse<null>>('/system/notice/status/batch', {
    method: 'PATCH',
    data: { ids, status },
  });
}
