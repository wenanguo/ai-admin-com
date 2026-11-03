import { request } from '@umijs/max';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createProject,
  deleteProjects,
  getProjectDetail,
  listProjects,
  updateProject,
} from './project';

vi.mock('@umijs/max', () => ({
  request: vi.fn(),
}));

describe('pm project service', () => {
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

  it('lists projects with pagination params', async () => {
    await listProjects({ page_no: 1, page_size: 10, name: '管理后台' });

    expect(request).toHaveBeenCalledWith('/pm_project/list', {
      method: 'GET',
      params: { page_no: 1, page_size: 10, name: '管理后台' },
    });
  });

  it('gets a project detail by id', async () => {
    await getProjectDetail(7);

    expect(request).toHaveBeenCalledWith('/pm_project/detail/7', {
      method: 'GET',
    });
  });

  it('creates a project', async () => {
    await createProject({
      code: 'APP_REWORK',
      name: '管理后台重构',
      owner_id: 1,
      status_code: 'planning',
      priority_code: 'P1',
      start_date: '2026-11-03',
      due_date: '2026-12-31',
      visibility_code: 'private',
    });

    expect(request).toHaveBeenCalledWith('/pm_project/create', {
      method: 'POST',
      data: {
        code: 'APP_REWORK',
        name: '管理后台重构',
        owner_id: 1,
        status_code: 'planning',
        priority_code: 'P1',
        start_date: '2026-11-03',
        due_date: '2026-12-31',
        visibility_code: 'private',
      },
    });
  });

  it('updates a project by id with the full object', async () => {
    await updateProject(7, {
      code: 'APP_REWORK',
      name: '管理后台重构',
      owner_id: 1,
      status_code: 'planning',
      priority_code: 'P1',
      start_date: '2026-11-03',
      due_date: '2026-12-31',
      visibility_code: 'private',
    });

    expect(request).toHaveBeenCalledWith('/pm_project/update/7', {
      method: 'PUT',
      data: {
        code: 'APP_REWORK',
        name: '管理后台重构',
        owner_id: 1,
        status_code: 'planning',
        priority_code: 'P1',
        start_date: '2026-11-03',
        due_date: '2026-12-31',
        visibility_code: 'private',
      },
    });
  });

  it('deletes projects by a bare id array', async () => {
    await deleteProjects([1, 2]);

    expect(request).toHaveBeenCalledWith('/pm_project/delete', {
      method: 'DELETE',
      data: [1, 2],
    });
  });
});
