import { request } from '@umijs/max';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  batchSetNoticesStatus,
  createNotice,
  deleteNotices,
  getNoticeDetail,
  listNotices,
  updateNotice,
} from './notice';

vi.mock('@umijs/max', () => ({
  request: vi.fn(),
}));

describe('system notice service', () => {
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

  it('lists notices with pagination params', async () => {
    await listNotices({ page_no: 1, page_size: 10, notice_title: '发布' });

    expect(request).toHaveBeenCalledWith('/system/notice/list', {
      method: 'GET',
      params: { page_no: 1, page_size: 10, notice_title: '发布' },
    });
  });

  it('gets a notice detail by id', async () => {
    await getNoticeDetail(7);

    expect(request).toHaveBeenCalledWith('/system/notice/detail/7', {
      method: 'GET',
    });
  });

  it('creates a notice', async () => {
    await createNotice({ notice_title: '系统维护', notice_type: '公告' });

    expect(request).toHaveBeenCalledWith('/system/notice/create', {
      method: 'POST',
      data: { notice_title: '系统维护', notice_type: '公告' },
    });
  });

  it('updates a notice by id', async () => {
    await updateNotice(7, { notice_title: '系统维护', notice_type: '公告' });

    expect(request).toHaveBeenCalledWith('/system/notice/update/7', {
      method: 'PUT',
      data: { notice_title: '系统维护', notice_type: '公告' },
    });
  });

  it('deletes notices by a bare id array', async () => {
    await deleteNotices([1, 2]);

    expect(request).toHaveBeenCalledWith('/system/notice/delete', {
      method: 'DELETE',
      data: [1, 2],
    });
  });

  it('batch sets status with PATCH', async () => {
    await batchSetNoticesStatus([1, 2], 1);

    expect(request).toHaveBeenCalledWith('/system/notice/status/batch', {
      method: 'PATCH',
      data: { ids: [1, 2], status: 1 },
    });
  });
});
