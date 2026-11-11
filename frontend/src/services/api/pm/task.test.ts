import { request } from '@umijs/max';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createTask,
  deleteTasks,
  getTaskDetail,
  listTasks,
  updateTask,
} from './task';

vi.mock('@umijs/max', () => ({
  request: vi.fn(),
}));

describe('pm task service', () => {
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

  it('lists tasks with pagination params', async () => {
    await listTasks({ page_no: 1, page_size: 10, project_id: 3 });

    expect(request).toHaveBeenCalledWith('/pm_project/pm_task/list', {
      method: 'GET',
      params: { page_no: 1, page_size: 10, project_id: 3 },
    });
  });

  it('gets a task detail by id', async () => {
    await getTaskDetail(7);

    expect(request).toHaveBeenCalledWith('/pm_project/pm_task/detail/7', {
      method: 'GET',
    });
  });

  it('creates a task', async () => {
    await createTask({
      project_id: 3,
      title: '梳理风险清单',
      type_code: 'feature',
      status_code: 'todo',
      priority_code: 'P2',
    });

    expect(request).toHaveBeenCalledWith('/pm_project/pm_task/create', {
      method: 'POST',
      data: {
        project_id: 3,
        title: '梳理风险清单',
        type_code: 'feature',
        status_code: 'todo',
        priority_code: 'P2',
      },
    });
  });

  it('updates a task by id with the full object', async () => {
    await updateTask(7, {
      project_id: 3,
      title: '梳理风险清单',
      type_code: 'feature',
      status_code: 'todo',
      priority_code: 'P2',
    });

    expect(request).toHaveBeenCalledWith('/pm_project/pm_task/update/7', {
      method: 'PUT',
      data: {
        project_id: 3,
        title: '梳理风险清单',
        type_code: 'feature',
        status_code: 'todo',
        priority_code: 'P2',
      },
    });
  });

  it('deletes tasks by a bare id array', async () => {
    await deleteTasks([1, 2]);

    expect(request).toHaveBeenCalledWith('/pm_project/pm_task/delete', {
      method: 'DELETE',
      data: [1, 2],
    });
  });
});
