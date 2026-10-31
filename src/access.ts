import type { BackendMenu } from '@/menu/adapter';
import type { UserOut } from '@/services/api/system/types';

/**
 * umi access 插件的权限判定。
 *
 * - canAdmin:超级管理员
 * - hasPermission(code):按钮级权限码,取自后端菜单的 permission 字段
 *
 * currentUser 用真实的 UserOut 类型(而不是索引签名):UserOut 是 interface,
 * 没有隐式索引签名,声明成 `{ [key: string]: unknown }` 的话赋给它会报 TS2345。
 */
export default function access(
  initialState:
    | {
        currentUser?: Partial<UserOut> | null;
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
