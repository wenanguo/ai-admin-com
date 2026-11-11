import { request } from '@umijs/max';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  batchSetParamsStatus,
  createParam,
  deleteParams,
  getParamDetail,
  listParams,
  updateParam,
} from './param';

vi.mock('@umijs/max', () => ({
  request: vi.fn(),
}));

describe('system param service', () => {
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

  it('lists params with pagination params', async () => {
    await listParams({ page_no: 1, page_size: 10, config_name: 'site' });

    expect(request).toHaveBeenCalledWith('/system/param/list', {
      method: 'GET',
      params: { page_no: 1, page_size: 10, config_name: 'site' },
    });
  });

  it('gets a param detail by id', async () => {
    await getParamDetail(7);

    expect(request).toHaveBeenCalledWith('/system/param/detail/7', {
      method: 'GET',
    });
  });

  it('creates a param', async () => {
    await createParam({ config_name: '站点名', config_key: 'site.name' });

    expect(request).toHaveBeenCalledWith('/system/param/create', {
      method: 'POST',
      data: { config_name: '站点名', config_key: 'site.name' },
    });
  });

  it('updates a param by id', async () => {
    await updateParam(7, { config_name: '站点名', config_key: 'site.name' });

    expect(request).toHaveBeenCalledWith('/system/param/update/7', {
      method: 'PUT',
      data: { config_name: '站点名', config_key: 'site.name' },
    });
  });

  it('deletes params by a bare id array', async () => {
    await deleteParams([1, 2]);

    expect(request).toHaveBeenCalledWith('/system/param/delete', {
      method: 'DELETE',
      data: [1, 2],
    });
  });

  it('batch sets status with PATCH', async () => {
    await batchSetParamsStatus([1, 2], 1);

    expect(request).toHaveBeenCalledWith('/system/param/status/batch', {
      method: 'PATCH',
      data: { ids: [1, 2], status: 1 },
    });
  });
});
