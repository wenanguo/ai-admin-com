import { describe, expect, it } from 'vitest';
import type { UserOut } from '@/services/api/system/types';
import access from './access';

describe('access', () => {
  it('grants a permission code present in the permission list', () => {
    const result = access({
      currentUser: { username: 'admin' },
      permissions: ['module_system:user:query', 'module_system:user:create'],
    });

    expect(result.hasPermission('module_system:user:query')).toBe(true);
    expect(result.hasPermission('module_system:user:create')).toBe(true);
  });

  it('denies a permission code that is absent', () => {
    const result = access({
      currentUser: { username: 'u' },
      permissions: ['module_system:user:query'],
    });

    expect(result.hasPermission('module_system:user:create')).toBe(false);
  });

  it('denies everything when there are no permissions', () => {
    const result = access({ currentUser: { username: 'u' }, permissions: [] });

    expect(result.hasPermission('module_system:user:query')).toBe(false);
  });

  it('denies everything when initialState is undefined', () => {
    const result = access(undefined);

    expect(result.hasPermission('module_system:user:query')).toBe(false);
    expect(result.canAdmin).toBe(false);
  });

  it('treats a superuser as admin', () => {
    const result = access({ currentUser: { is_superuser: true } });

    expect(result.canAdmin).toBe(true);
  });

  it('does not treat a normal user as admin', () => {
    const result = access({ currentUser: { is_superuser: false } });

    expect(result.canAdmin).toBe(false);
  });

  it('accepts a full UserOut object', () => {
    // UserOut 是 interface,没有隐式索引签名 —— 用索引签名声明 currentUser 会报 TS2345
    const currentUser: UserOut = {
      id: 1,
      username: 'admin',
      name: '管理员',
      is_superuser: true,
    };

    const result = access({ currentUser });

    expect(result.canAdmin).toBe(true);
  });

  it('denies everything when there is no current user', () => {
    const result = access({ currentUser: null });

    expect(result.canAdmin).toBe(false);
    expect(result.hasPermission('module_system:user:query')).toBe(false);
  });

  it('does not treat a null superuser flag as admin', () => {
    const result = access({ currentUser: { is_superuser: null } });

    expect(result.canAdmin).toBe(false);
  });

  it('denies everything when there is a user but no permissions', () => {
    const result = access({ currentUser: { username: 'u' } });

    expect(result.hasPermission('module_system:user:query')).toBe(false);
  });
});
