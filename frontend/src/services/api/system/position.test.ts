import { request } from '@umijs/max';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  batchSetPositionsStatus,
  createPosition,
  deletePositions,
  getPositionDetail,
  listPositions,
  updatePosition,
} from './position';

vi.mock('@umijs/max', () => ({
  request: vi.fn(),
}));

describe('system position service', () => {
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

  it('lists positions with pagination params', async () => {
    await listPositions({ page_no: 1, page_size: 10, name: 'dev' });

    expect(request).toHaveBeenCalledWith('/system/position/list', {
      method: 'GET',
      params: { page_no: 1, page_size: 10, name: 'dev' },
    });
  });

  it('gets a position detail by id', async () => {
    await getPositionDetail(7);

    expect(request).toHaveBeenCalledWith('/system/position/detail/7', {
      method: 'GET',
    });
  });

  it('creates a position', async () => {
    await createPosition({ name: '后端', code: 'backend' });

    expect(request).toHaveBeenCalledWith('/system/position/create', {
      method: 'POST',
      data: { name: '后端', code: 'backend' },
    });
  });

  it('updates a position by id', async () => {
    await updatePosition(7, { name: '后端', code: 'backend' });

    expect(request).toHaveBeenCalledWith('/system/position/update/7', {
      method: 'PUT',
      data: { name: '后端', code: 'backend' },
    });
  });

  it('deletes positions by a bare id array', async () => {
    await deletePositions([1, 2]);

    expect(request).toHaveBeenCalledWith('/system/position/delete', {
      method: 'DELETE',
      data: [1, 2],
    });
  });

  it('batch sets status with PATCH', async () => {
    await batchSetPositionsStatus([1, 2], 1);

    expect(request).toHaveBeenCalledWith('/system/position/status/batch', {
      method: 'PATCH',
      data: { ids: [1, 2], status: 1 },
    });
  });
});
