import { request } from '@umijs/max';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  batchSetDictDatasStatus,
  batchSetDictTypesStatus,
  createDictData,
  createDictType,
  deleteDictDatas,
  deleteDictTypes,
  getDictDataByType,
  getDictDataDetail,
  getDictTypeDetail,
  listDictDatas,
  listDictTypeOptions,
  listDictTypes,
  updateDictData,
  updateDictType,
} from './dict';

vi.mock('@umijs/max', () => ({
  request: vi.fn(),
}));

/**
 * 字典是两个资源(类型 / 数据),接口前缀也不同:
 * - /system/dict/type/*  字典类型
 * - /system/dict/data/*  字典数据
 *
 * 两条线的**通用约束**一样:
 * - 列表用 page_no / page_size,响应体字段是 items
 * - 删除的请求体是**裸数组**(不是 { ids })
 * - 批量启停是 PATCH,请求体是 { ids, status } 两个平级字段
 *
 * ⚠️ 字典数据的写路径有两个后端必填字段:`dict_sort`(1–999)与 `dict_type`(类型编码),
 *   少一个就是 422 —— 这里用单测把提交体钉死。
 */
describe('system dict service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(request).mockResolvedValue({
      code: 0,
      msg: 'ok',
      data: null,
      status_code: 200,
      success: true,
    });
  });

  it('lists dict types with pagination params', async () => {
    await listDictTypes({ page_no: 1, page_size: 10, dict_name: '用户' });

    expect(request).toHaveBeenCalledWith('/system/dict/type/list', {
      method: 'GET',
      params: { page_no: 1, page_size: 10, dict_name: '用户' },
    });
  });

  it('gets a dict type detail by id', async () => {
    await getDictTypeDetail(7);

    expect(request).toHaveBeenCalledWith('/system/dict/type/detail/7', {
      method: 'GET',
    });
  });

  it('lists dict type options', async () => {
    await listDictTypeOptions();

    expect(request).toHaveBeenCalledWith('/system/dict/type/optionselect', {
      method: 'GET',
    });
  });

  it('creates a dict type', async () => {
    await createDictType({ dict_name: '用户状态', dict_type: 'user_status' });

    expect(request).toHaveBeenCalledWith('/system/dict/type/create', {
      method: 'POST',
      data: { dict_name: '用户状态', dict_type: 'user_status' },
    });
  });

  it('updates a dict type by id', async () => {
    await updateDictType(7, {
      dict_name: '用户状态',
      dict_type: 'user_status',
    });

    expect(request).toHaveBeenCalledWith('/system/dict/type/update/7', {
      method: 'PUT',
      data: { dict_name: '用户状态', dict_type: 'user_status' },
    });
  });

  it('deletes dict types by a bare id array', async () => {
    await deleteDictTypes([1, 2]);

    expect(request).toHaveBeenCalledWith('/system/dict/type/delete', {
      method: 'DELETE',
      data: [1, 2],
    });
  });

  it('batch sets dict type status with PATCH', async () => {
    await batchSetDictTypesStatus([1, 2], 1);

    expect(request).toHaveBeenCalledWith('/system/dict/type/status/batch', {
      method: 'PATCH',
      data: { ids: [1, 2], status: 1 },
    });
  });

  it('lists dict datas with pagination params', async () => {
    await listDictDatas({
      page_no: 1,
      page_size: 10,
      dict_type: 'user_status',
    });

    expect(request).toHaveBeenCalledWith('/system/dict/data/list', {
      method: 'GET',
      params: { page_no: 1, page_size: 10, dict_type: 'user_status' },
    });
  });

  it('gets a dict data detail by id', async () => {
    await getDictDataDetail(7);

    expect(request).toHaveBeenCalledWith('/system/dict/data/detail/7', {
      method: 'GET',
    });
  });

  it('gets dict datas by dict type', async () => {
    await getDictDataByType('user_status');

    expect(request).toHaveBeenCalledWith('/system/dict/data/info/user_status', {
      method: 'GET',
    });
  });

  it('creates a dict data', async () => {
    await createDictData({
      dict_sort: 1,
      dict_label: '启用',
      dict_value: '1',
      dict_type: 'user_status',
      dict_type_id: 3,
    });

    expect(request).toHaveBeenCalledWith('/system/dict/data/create', {
      method: 'POST',
      data: {
        dict_sort: 1,
        dict_label: '启用',
        dict_value: '1',
        dict_type: 'user_status',
        dict_type_id: 3,
      },
    });
  });

  it('updates a dict data by id', async () => {
    await updateDictData(7, {
      dict_sort: 2,
      dict_label: '启用',
      dict_value: '1',
      dict_type: 'user_status',
      dict_type_id: 3,
    });

    expect(request).toHaveBeenCalledWith('/system/dict/data/update/7', {
      method: 'PUT',
      data: {
        dict_sort: 2,
        dict_label: '启用',
        dict_value: '1',
        dict_type: 'user_status',
        dict_type_id: 3,
      },
    });
  });

  it('deletes dict datas by a bare id array', async () => {
    await deleteDictDatas([1, 2]);

    expect(request).toHaveBeenCalledWith('/system/dict/data/delete', {
      method: 'DELETE',
      data: [1, 2],
    });
  });

  it('batch sets dict data status with PATCH', async () => {
    await batchSetDictDatasStatus([1, 2], 1);

    expect(request).toHaveBeenCalledWith('/system/dict/data/status/batch', {
      method: 'PATCH',
      data: { ids: [1, 2], status: 1 },
    });
  });
});
