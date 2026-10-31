import { request } from '@umijs/max';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createUser,
  deleteUsers,
  getCurrentUser,
  listUsers,
  updateUser,
} from './user';

vi.mock('@umijs/max', () => ({
  request: vi.fn(),
}));

describe('system user service', () => {
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

  it('lists users with pagination params', async () => {
    await listUsers({ page_no: 1, page_size: 10, username: 'ad' });

    expect(request).toHaveBeenCalledWith('/system/user/list', {
      method: 'GET',
      params: { page_no: 1, page_size: 10, username: 'ad' },
    });
  });

  it('gets the current user info', async () => {
    await getCurrentUser();

    expect(request).toHaveBeenCalledWith('/system/user/current/info', {
      method: 'GET',
    });
  });

  it('creates a user', async () => {
    await createUser({ username: 'u1', password: 'pw123456' });

    expect(request).toHaveBeenCalledWith('/system/user/create', {
      method: 'POST',
      data: { username: 'u1', password: 'pw123456' },
    });
  });

  it('updates a user by id', async () => {
    await updateUser(7, { username: 'u1' });

    expect(request).toHaveBeenCalledWith('/system/user/update/7', {
      method: 'PUT',
      data: { username: 'u1' },
    });
  });

  it('deletes users by id list', async () => {
    await deleteUsers([1, 2]);

    expect(request).toHaveBeenCalledWith('/system/user/delete', {
      method: 'DELETE',
      data: [1, 2],
    });
  });
});
