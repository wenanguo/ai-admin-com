import { describe, expect, it } from 'vitest';
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
});
