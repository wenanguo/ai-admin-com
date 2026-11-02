import { request } from '@umijs/max';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  batchSetDeptsStatus,
  createDept,
  deleteDepts,
  getDeptDetail,
  getDeptTree,
  updateDept,
} from './dept';

vi.mock('@umijs/max', () => ({
  request: vi.fn(),
}));

describe('system dept service', () => {
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

  it('gets the dept tree without params', async () => {
    await getDeptTree();

    // 后端只有 /system/dept/tree,没有 /system/dept/list
    expect(request).toHaveBeenCalledWith('/system/dept/tree', {
      method: 'GET',
    });
  });

  it('gets a dept detail by id', async () => {
    await getDeptDetail(7);

    expect(request).toHaveBeenCalledWith('/system/dept/detail/7', {
      method: 'GET',
    });
  });

  it('creates a dept', async () => {
    await createDept({ name: '研发', code: 'rd' });

    expect(request).toHaveBeenCalledWith('/system/dept/create', {
      method: 'POST',
      data: { name: '研发', code: 'rd' },
    });
  });

  it('updates a dept by id', async () => {
    await updateDept(7, { name: '研发', code: 'rd' });

    expect(request).toHaveBeenCalledWith('/system/dept/update/7', {
      method: 'PUT',
      data: { name: '研发', code: 'rd' },
    });
  });

  it('deletes depts by a bare id array', async () => {
    await deleteDepts([1, 2]);

    expect(request).toHaveBeenCalledWith('/system/dept/delete', {
      method: 'DELETE',
      data: [1, 2],
    });
  });

  it('batch sets status with PATCH', async () => {
    await batchSetDeptsStatus([1, 2], 1);

    expect(request).toHaveBeenCalledWith('/system/dept/status/batch', {
      method: 'PATCH',
      data: { ids: [1, 2], status: 1 },
    });
  });
});
