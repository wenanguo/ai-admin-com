import { request } from '@umijs/max';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deleteLoginLogs,
  deleteOperationLogs,
  getLoginLogDetail,
  getOperationLogDetail,
  listLoginLogs,
  listOperationLogs,
} from './log';

vi.mock('@umijs/max', () => ({
  request: vi.fn(),
}));

describe('system log service', () => {
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

  it('lists login logs with pagination params', async () => {
    await listLoginLogs({ page_no: 1, page_size: 10, username: 'admin' });

    expect(request).toHaveBeenCalledWith('/system/log/login/list', {
      method: 'GET',
      params: { page_no: 1, page_size: 10, username: 'admin' },
    });
  });

  it('gets a login log detail by id', async () => {
    await getLoginLogDetail(7);

    expect(request).toHaveBeenCalledWith('/system/log/login/detail/7', {
      method: 'GET',
    });
  });

  it('deletes login logs by a bare id array', async () => {
    await deleteLoginLogs([1, 2]);

    expect(request).toHaveBeenCalledWith('/system/log/login/delete', {
      method: 'DELETE',
      data: [1, 2],
    });
  });

  it('lists operation logs with pagination params', async () => {
    await listOperationLogs({
      page_no: 1,
      page_size: 10,
      request_path: '/system',
    });

    expect(request).toHaveBeenCalledWith('/system/log/operation/list', {
      method: 'GET',
      params: { page_no: 1, page_size: 10, request_path: '/system' },
    });
  });

  it('gets an operation log detail by id', async () => {
    await getOperationLogDetail(7);

    expect(request).toHaveBeenCalledWith('/system/log/operation/detail/7', {
      method: 'GET',
    });
  });

  it('deletes operation logs with the BatchDelete body', async () => {
    await deleteOperationLogs([1, 2]);

    expect(request).toHaveBeenCalledWith('/system/log/operation/delete', {
      method: 'DELETE',
      // 这个接口后端收的是 BatchDelete({ ids }),不是裸数组 ——
      // 见 backend/app/api/v1/module_system/log/controller.py 的
      // `delete(*, data: BatchDelete, ...)`,与登录日志的裸数组不一样
      data: { ids: [1, 2] },
    });
  });
});
