import type { BackendMenu } from '@/menu/adapter';

/** 后端 UserOutSchema.roles(角色下挂菜单树) */
export interface UserRole {
  id?: number | null;
  name?: string | null;
  code?: string | null;
  /** 角色下挂的菜单树(collectPermissions 会连同顶层 menus 一起遍历) */
  menus?: BackendMenu[] | null;
}

/** 后端 UserOutSchema(用户列表/详情返回) */
export interface UserOut {
  id?: number | null;
  uuid?: string | null;
  username?: string | null;
  name?: string | null;
  mobile?: string | null;
  email?: string | null;
  gender?: string | null;
  avatar?: string | null;
  status?: number | null;
  description?: string | null;
  dept_id?: number | null;
  dept_name?: string | null;
  dept?: { id: number; name: string } | null;
  position_ids?: number[] | null;
  positions?: { id: number; name: string }[] | null;
  role_ids?: number[] | null;
  roles?: UserRole[] | null;
  /** 当前用户可见的菜单树(后端 UserOutSchema.menus) */
  menus?: BackendMenu[] | null;
  is_superuser?: boolean | null;
  tenant_id?: number | null;
  created_time?: string | null;
  updated_time?: string | null;
}

/** 后端 UserCreateSchema */
export interface UserCreateParams {
  username?: string;
  password?: string;
  name?: string;
  mobile?: string;
  email?: string;
  gender?: string;
  status?: number;
  description?: string;
  dept_id?: number | null;
  role_ids?: number[];
  position_ids?: number[];
  tenant_id?: number | null;
}

/** 后端 UserUpdateSchema */
export interface UserUpdateParams {
  username?: string;
  name?: string;
  mobile?: string;
  email?: string;
  gender?: string;
  status?: number;
  description?: string;
  dept_id?: number | null;
  role_ids?: number[];
  position_ids?: number[];
}

/** 后端 UserRegisterSchema */
export interface UserRegisterParams {
  username: string;
  password: string;
  name?: string;
  mobile?: string;
  role_ids?: number[];
  description?: string;
}

/** 后端 CaptchaOutSchema */
export interface CaptchaOut {
  /** 是否启用验证码 */
  enable: boolean;
  /** 验证码唯一标识,登录时作为 captcha_key 回传 */
  key: string;
  /** base64 编码的验证码图片(data URL) */
  img_base: string;
}

/** 后端 JWTOutSchema */
export interface TokenPair {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
}

/** 后端 TenantOptionSchema */
export interface TenantOption {
  id: number;
  name: string;
  code: string;
}

/** 后端 LoginWithTenantsSchema */
export interface LoginResult extends TokenPair {
  tenants: TenantOption[];
  user_info: Record<string, unknown>;
}

/** 登录表单 */
export interface LoginForm {
  username: string;
  password: string;
  captcha_key?: string;
  captcha?: string;
  login_type?: string;
}
