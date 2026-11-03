import { request } from '@umijs/max';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createMilestone,
  deleteMilestones,
  getMilestoneDetail,
  listMilestones,
  updateMilestone,
} from './milestone';

vi.mock('@umijs/max', () => ({
  request: vi.fn(),
}));

describe('pm milestone service', () => {
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

  it('lists milestones with pagination params', async () => {
    await listMilestones({ page_no: 1, page_size: 10, project_id: 3 });

    expect(request).toHaveBeenCalledWith('/pm_milestone/list', {
      method: 'GET',
      params: { page_no: 1, page_size: 10, project_id: 3 },
    });
  });

  it('gets a milestone detail by id', async () => {
    await getMilestoneDetail(7);

    expect(request).toHaveBeenCalledWith('/pm_milestone/detail/7', {
      method: 'GET',
    });
  });

  it('creates a milestone', async () => {
    await createMilestone({
      project_id: 3,
      name: 'M1 需求冻结',
      start_date: '2026-11-03',
      due_date: '2026-11-30',
      status_code: 'not_started',
      sort_order: 1,
    });

    expect(request).toHaveBeenCalledWith('/pm_milestone/create', {
      method: 'POST',
      data: {
        project_id: 3,
        name: 'M1 需求冻结',
        start_date: '2026-11-03',
        due_date: '2026-11-30',
        status_code: 'not_started',
        sort_order: 1,
      },
    });
  });

  it('updates a milestone by id with the full object', async () => {
    await updateMilestone(7, {
      project_id: 3,
      name: 'M1 需求冻结',
      start_date: '2026-11-03',
      due_date: '2026-11-30',
      status_code: 'not_started',
      sort_order: 1,
    });

    expect(request).toHaveBeenCalledWith('/pm_milestone/update/7', {
      method: 'PUT',
      data: {
        project_id: 3,
        name: 'M1 需求冻结',
        start_date: '2026-11-03',
        due_date: '2026-11-30',
        status_code: 'not_started',
        sort_order: 1,
      },
    });
  });

  it('deletes milestones by a bare id array', async () => {
    await deleteMilestones([1, 2]);

    expect(request).toHaveBeenCalledWith('/pm_milestone/delete', {
      method: 'DELETE',
      data: [1, 2],
    });
  });
});
