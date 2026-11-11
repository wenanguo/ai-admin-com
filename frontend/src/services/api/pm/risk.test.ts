import { request } from '@umijs/max';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createRisk,
  deleteRisks,
  getRiskDetail,
  listRisks,
  updateRisk,
} from './risk';

vi.mock('@umijs/max', () => ({
  request: vi.fn(),
}));

describe('pm risk service', () => {
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

  it('lists risks with pagination params', async () => {
    await listRisks({ page_no: 1, page_size: 10, project_id: 3 });

    expect(request).toHaveBeenCalledWith('/pm_risk/pm_risk/list', {
      method: 'GET',
      params: { page_no: 1, page_size: 10, project_id: 3 },
    });
  });

  it('gets a risk detail by id', async () => {
    await getRiskDetail(7);

    expect(request).toHaveBeenCalledWith('/pm_risk/pm_risk/detail/7', {
      method: 'GET',
    });
  });

  it('creates a risk with the caller-computed score in the body', async () => {
    await createRisk({
      project_id: 3,
      title: '后端接口延期',
      category_code: 'schedule',
      probability: 3,
      impact: 5,
      score: 15,
      status_code: 'open',
      owner_id: 2,
      created_via_code: 'manual',
    });

    expect(request).toHaveBeenCalledWith('/pm_risk/pm_risk/create', {
      method: 'POST',
      data: {
        project_id: 3,
        title: '后端接口延期',
        category_code: 'schedule',
        probability: 3,
        impact: 5,
        score: 15,
        status_code: 'open',
        owner_id: 2,
        created_via_code: 'manual',
      },
    });
  });

  it('updates a risk by id with the full object', async () => {
    await updateRisk(7, {
      project_id: 3,
      title: '后端接口延期',
      category_code: 'schedule',
      probability: 3,
      impact: 5,
      score: 15,
      status_code: 'open',
      owner_id: 2,
      created_via_code: 'manual',
    });

    expect(request).toHaveBeenCalledWith('/pm_risk/pm_risk/update/7', {
      method: 'PUT',
      data: {
        project_id: 3,
        title: '后端接口延期',
        category_code: 'schedule',
        probability: 3,
        impact: 5,
        score: 15,
        status_code: 'open',
        owner_id: 2,
        created_via_code: 'manual',
      },
    });
  });

  it('deletes risks by a bare id array', async () => {
    await deleteRisks([1, 2]);

    expect(request).toHaveBeenCalledWith('/pm_risk/pm_risk/delete', {
      method: 'DELETE',
      data: [1, 2],
    });
  });

  it('exposes the owner_by redundancy the backend fills in per row', async () => {
    vi.mocked(request).mockResolvedValueOnce({
      code: 0,
      msg: 'ok',
      data: {
        items: [
          {
            id: 31,
            owner_id: 1,
            owner_by: { id: 1, name: '张三', username: 'zhangsan' },
          },
        ],
        total: 1,
        page_no: 1,
        page_size: 10,
        has_next: false,
      },
      status_code: 200,
      success: true,
    });

    const res = await listRisks({ page_no: 1, page_size: 10 });

    // 后端 service 会给每一行补 owner_by(负责人姓名直接读它,不用再查用户表)
    expect(res?.data?.items?.[0]?.owner_by).toEqual({
      id: 1,
      name: '张三',
      username: 'zhangsan',
    });
  });
});
