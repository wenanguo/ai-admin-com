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

/** 后端 page_size 上限(公网 OpenAPI: maximum = 100) */
const MAX_PAGE_SIZE = 100;

/** 丢掉空查询值:后端对部分查询参数有严格正则,空串也会 422 */
function pruneEmpty(params: Record<string, unknown>) {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === '' || value === undefined || value === null) continue;
    result[key] = value;
  }
  return result;
}

export function toProTableRequest<T>(
  api: (params: PageQuery) => Promise<ApiResponse<PageResult<T>>>,
) {
  return async (params: ProTableParams) => {
    const { current, pageSize, ...rest } = params;

    const res = await api({
      // `as object` 是必须的:`PageQuery` 里没有索引签名,而 `rest` 的索引签名
      // 会让展开结果的类型带上 `[key: string]: unknown`,那样 `order_by?: string`
      // 就对不上了(原代码也是这么绕过去的)
      ...(pruneEmpty(rest) as object),
      page_no: Math.max(1, current ?? 1),
      page_size: Math.min(MAX_PAGE_SIZE, Math.max(1, pageSize ?? 10)),
    });

    return {
      data: res?.data?.items ?? [],
      total: res?.data?.total ?? 0,
      success: res?.success ?? false,
    };
  };
}
