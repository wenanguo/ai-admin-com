import { request } from '@umijs/max';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  batchSetRolesStatus,
  createRole,
  deleteRoles,
  getRoleDetail,
  listRoles,
  setRolePermission,
  updateRole,
} from './role';

vi.mock('@umijs/max', () => ({
  request: vi.fn(),
}));

describe('system role service', () => {
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

  it('lists roles with pagination params', async () => {
    await listRoles({ page_no: 1, page_size: 10, name: '管理' });

    expect(request).toHaveBeenCalledWith('/system/role/list', {
      method: 'GET',
      params: { page_no: 1, page_size: 10, name: '管理' },
    });
  });

  it('gets a role detail by id', async () => {
    await getRoleDetail(7);

    expect(request).toHaveBeenCalledWith('/system/role/detail/7', {
      method: 'GET',
    });
  });

  it('creates a role', async () => {
    await createRole({ name: '管理员', code: 'admin' });

    expect(request).toHaveBeenCalledWith('/system/role/create', {
      method: 'POST',
      data: { name: '管理员', code: 'admin' },
    });
  });

  it('updates a role by id', async () => {
    await updateRole(7, { name: '管理员', code: 'admin' });

    expect(request).toHaveBeenCalledWith('/system/role/update/7', {
      method: 'PUT',
      data: { name: '管理员', code: 'admin' },
    });
  });

  it('deletes roles by a bare id array', async () => {
    await deleteRoles([1, 2]);

    expect(request).toHaveBeenCalledWith('/system/role/delete', {
      method: 'DELETE',
      data: [1, 2],
    });
  });

  it('batch sets status with PATCH', async () => {
    await batchSetRolesStatus([1, 2], 1);

    expect(request).toHaveBeenCalledWith('/system/role/status/batch', {
      method: 'PATCH',
      data: { ids: [1, 2], status: 1 },
    });
  });

  it('sets role permission with four flat fields', async () => {
    await setRolePermission({
      data_scope: 1,
      role_ids: [7],
      menu_ids: [1, 2],
      dept_ids: [],
    });

    expect(request).toHaveBeenCalledWith('/system/role/permission', {
      method: 'PUT',
      data: { data_scope: 1, role_ids: [7], menu_ids: [1, 2], dept_ids: [] },
    });
  });
});
