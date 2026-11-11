import { request } from '@umijs/max';
import type { ApiResponse, PageQuery, PageResult } from '@/services/types';

/**
 * 公告类型。
 *
 * 后端只认这两个值:'1'(通知)/ '2'(公告) ——
 * `NoticeCreateSchema.notice_type` 是 `max_length=1`,并且有校验器
 * `_validate_notice_type` 拒绝其它取值(见后端
 * `backend/app/api/v1/module_system/notice/schema.py`)。
 * 提交中文或自定义值一律 422 ⇒ 写路径上把类型收窄成联合类型,
 * 让「提交了非法类型」在编译期就被挡住。
 */
export type NoticeType = '1' | '2';

/** 后端 NoticeOutSchema */
export interface NoticeOut {
  id?: number | null;
  notice_title?: string | null;
  /**
   * 响应里的类型**不收窄**:它是后端返回的数据(可能来自历史脏数据),
   * 用到它的表单会自己校验成 NoticeType 再提交。
   */
  notice_type?: string | null;
  notice_content?: string | null;
  status?: number | null;
  description?: string | null;
  created_time?: string | null;
}

export type NoticeListParams = Partial<PageQuery> & {
  notice_title?: string;
  /** 筛选用的类型 —— 与存储值一致,也是 '1' / '2' */
  notice_type?: NoticeType;
  status?: number;
};

export type NoticeCreateParams = {
  notice_title: string;
  /** 提交给后端的类型 —— 只能是 '1' / '2' */
  notice_type: NoticeType;
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
