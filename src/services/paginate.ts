import type { ApiResponse, PageQuery, PageResult } from './types';

/** ProTable request 回调收到的参数 */
export interface ProTableParams {
  current?: number;
  pageSize?: number;
  [key: string]: unknown;
}

/**
 * 把 ProTable 的 request 回调适配到后端分页协议。
 *
 * 后端分页参数是 page_no / page_size,响应是 { items, total };
 * ProTable 期望 current / pageSize 与 { data, total, success }
 * (见 @ant-design/pro-components 的 RequestData<T> = { data, success?, total? })。
 */
export function toProTableRequest<T>(
  api: (params: PageQuery) => Promise<ApiResponse<PageResult<T>>>,
) {
  return async (params: ProTableParams) => {
    const { current, pageSize, ...rest } = params;

    const res = await api({
      ...(rest as object),
      page_no: current ?? 1,
      page_size: pageSize ?? 10,
    });

    return {
      data: res?.data?.items ?? [],
      total: res?.data?.total ?? 0,
      success: res?.success ?? false,
    };
  };
}
