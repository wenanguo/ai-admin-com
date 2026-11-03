import { request } from '@umijs/max';
import type { ApiResponse, PageQuery, PageResult } from '@/services/types';

/**
 * 字典是两个资源:
 * - **字典类型**(dict_type):`/system/dict/type/*`
 * - **字典数据**(dict_data):`/system/dict/data/*`
 *
 * 两条线的通用约束一样:
 * - 列表参数是 page_no / page_size,响应体字段是 `items`
 * - 删除的请求体是**裸数组**(不是 `{ ids }`)
 * - 批量启停是 PATCH,请求体是 `{ ids, status }` 两个平级字段
 *
 * ⚠️ 字典数据有**两个后端必填**的字段容易被漏掉:
 *   `dict_sort`(1–999)与 `dict_type`(字典类型**编码**,不是 id)——
 *   少任何一个,FastAPI 的 body 校验就会直接 422(`Field required`)。
 *   `dict_type` 由「当前选中的字典类型」带出,`dict_type_id` 才是 id。
 *
 * ⚠️ 字典**类型**没有 `dict_sort`:后端 `DictTypeCreateSchema` 与 `DictTypeModel`
 *   里都没有这个字段,提交了会被静默丢弃 —— 类型表单里也就没有「排序」。
 */

/** 后端 DictTypeOutSchema */
export interface DictTypeOut {
  id?: number | null;
  dict_name?: string | null;
  dict_type?: string | null;
  status?: number | null;
  description?: string | null;
  created_time?: string | null;
}

/** 后端 DictDataOutSchema */
export interface DictDataOut {
  id?: number | null;
  /** 排序(后端 DictDataOutSchema 继承自 DictDataCreateSchema) */
  dict_sort?: number | null;
  dict_label?: string | null;
  dict_value?: string | null;
  dict_type?: string | null;
  dict_type_id?: number | null;
  css_class?: string | null;
  list_class?: string | null;
  is_default?: boolean | null;
  status?: number | null;
  description?: string | null;
  created_time?: string | null;
}

/** 后端 DictTypeQueryParam */
export type DictTypeListParams = Partial<PageQuery> & {
  dict_name?: string;
  dict_type?: string;
  status?: number;
};

/** 后端 DictDataQueryParam */
export type DictDataListParams = Partial<PageQuery> & {
  dict_label?: string;
  dict_type?: string;
  status?: number;
};

export type DictTypeCreateParams = {
  dict_name: string;
  dict_type: string;
  status?: number;
  description?: string | null;
};

export type DictTypeUpdateParams = DictTypeCreateParams;

export type DictDataCreateParams = {
  /** 排序 —— 后端必填,取值 1–999 */
  dict_sort: number;
  dict_label: string;
  dict_value: string;
  /** 字典类型**编码**(如 user_status)—— 后端必填,取所选字典类型的 dict_type */
  dict_type: string;
  dict_type_id: number;
  css_class?: string | null;
  list_class?: string | null;
  is_default?: boolean;
  status?: number;
  description?: string | null;
};

export type DictDataUpdateParams = DictDataCreateParams;

/** 字典类型列表 */
export async function listDictTypes(
  params: DictTypeListParams,
): Promise<ApiResponse<PageResult<DictTypeOut>>> {
  return request<ApiResponse<PageResult<DictTypeOut>>>(
    '/system/dict/type/list',
    {
      method: 'GET',
      params,
    },
  );
}

/** 字典类型详情 */
export async function getDictTypeDetail(
  id: number,
): Promise<ApiResponse<DictTypeOut>> {
  return request<ApiResponse<DictTypeOut>>(`/system/dict/type/detail/${id}`, {
    method: 'GET',
  });
}

/** 字典类型下拉选项 */
export async function listDictTypeOptions(): Promise<
  ApiResponse<DictTypeOut[]>
> {
  return request<ApiResponse<DictTypeOut[]>>('/system/dict/type/optionselect', {
    method: 'GET',
  });
}

/** 创建字典类型 */
export async function createDictType(
  params: DictTypeCreateParams,
): Promise<ApiResponse<DictTypeOut>> {
  return request<ApiResponse<DictTypeOut>>('/system/dict/type/create', {
    method: 'POST',
    data: params,
  });
}

/** 更新字典类型 */
export async function updateDictType(
  id: number,
  params: DictTypeUpdateParams,
): Promise<ApiResponse<DictTypeOut>> {
  return request<ApiResponse<DictTypeOut>>(`/system/dict/type/update/${id}`, {
    method: 'PUT',
    data: params,
  });
}

/** 删除字典类型(后端请求体是裸数组,不是 { ids }) */
export async function deleteDictTypes(
  ids: number[],
): Promise<ApiResponse<null>> {
  return request<ApiResponse<null>>('/system/dict/type/delete', {
    method: 'DELETE',
    data: ids,
  });
}

/** 批量启用/禁用字典类型(请求体是 { ids, status } 两个平级字段) */
export async function batchSetDictTypesStatus(
  ids: number[],
  status: number,
): Promise<ApiResponse<null>> {
  return request<ApiResponse<null>>('/system/dict/type/status/batch', {
    method: 'PATCH',
    data: { ids, status },
  });
}

/** 字典数据列表 */
export async function listDictDatas(
  params: DictDataListParams,
): Promise<ApiResponse<PageResult<DictDataOut>>> {
  return request<ApiResponse<PageResult<DictDataOut>>>(
    '/system/dict/data/list',
    {
      method: 'GET',
      params,
    },
  );
}

/** 字典数据详情 */
export async function getDictDataDetail(
  id: number,
): Promise<ApiResponse<DictDataOut>> {
  return request<ApiResponse<DictDataOut>>(`/system/dict/data/detail/${id}`, {
    method: 'GET',
  });
}

/** 按字典类型取字典数据(字典类型编码,如 user_status) */
export async function getDictDataByType(
  dictType: string,
): Promise<ApiResponse<DictDataOut[]>> {
  return request<ApiResponse<DictDataOut[]>>(
    `/system/dict/data/info/${dictType}`,
    {
      method: 'GET',
    },
  );
}

/** 创建字典数据 */
export async function createDictData(
  params: DictDataCreateParams,
): Promise<ApiResponse<DictDataOut>> {
  return request<ApiResponse<DictDataOut>>('/system/dict/data/create', {
    method: 'POST',
    data: params,
  });
}

/** 更新字典数据 */
export async function updateDictData(
  id: number,
  params: DictDataUpdateParams,
): Promise<ApiResponse<DictDataOut>> {
  return request<ApiResponse<DictDataOut>>(`/system/dict/data/update/${id}`, {
    method: 'PUT',
    data: params,
  });
}

/** 删除字典数据(后端请求体是裸数组,不是 { ids }) */
export async function deleteDictDatas(
  ids: number[],
): Promise<ApiResponse<null>> {
  return request<ApiResponse<null>>('/system/dict/data/delete', {
    method: 'DELETE',
    data: ids,
  });
}

/** 批量启用/禁用字典数据(请求体是 { ids, status } 两个平级字段) */
export async function batchSetDictDatasStatus(
  ids: number[],
  status: number,
): Promise<ApiResponse<null>> {
  return request<ApiResponse<null>>('/system/dict/data/status/batch', {
    method: 'PATCH',
    data: { ids, status },
  });
}
