/** 后端统一响应信封(后端 app/common/response.py 的 ResponseSchema) */
export interface ApiResponse<T = unknown> {
  code: number;
  msg: string;
  data: T | null;
  status_code: number;
  success: boolean;
}

/** 后端分页查询参数(app/core/base_params.py 的 PaginationQueryParam) */
export interface PageQuery {
  page_no: number;
  page_size: number;
  order_by?: string;
}

/** 后端分页结果(app/core/base_schema.py 的 PageResultSchema) */
export interface PageResult<T> {
  items: T[];
  total: number;
  page_no: number | null;
  page_size: number | null;
  has_next: boolean | null;
}
