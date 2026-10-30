import type { BackendMenu } from '@/menu/adapter';

/**
 * umi access 插件的权限判定。
 *
 * - canAdmin:超级管理员
 * - hasPermission(code):按钮级权限码,取自后端菜单的 permission 字段
 *
 * currentUser 只读 is_superuser,但 initialState 里带的是完整用户对象
 * (username/name/... 都在),所以这里允许存在其它字段。
 */
export default function access(
  initialState:
    | {
        currentUser?: {
          is_superuser?: boolean | null;
          [key: string]: unknown;
        } | null;
        permissions?: string[];
        menus?: BackendMenu[];
      }
    | undefined,
) {
  const permissions = initialState?.permissions ?? [];

  return {
    canAdmin: Boolean(initialState?.currentUser?.is_superuser),
    hasPermission: (code: string) => permissions.includes(code),
  };
}
