import { request } from '@umijs/max';
import type { ApiResponse } from '@/services/types';
import type { CaptchaOut, LoginForm, LoginResult, TokenPair } from './types';

/** 获取图形验证码 */
export async function getCaptcha() {
  return request<ApiResponse<CaptchaOut>>('/system/auth/captcha/get', {
    method: 'GET',
  });
}

/**
 * 登录。
 * 后端用的是 OAuth2PasswordRequestForm,必须以 form-urlencoded 提交,JSON 会 422。
 */
export async function login(form: LoginForm) {
  const body = new URLSearchParams({
    username: form.username,
    password: form.password,
    captcha_key: form.captcha_key ?? '',
    captcha: form.captcha ?? '',
    login_type: form.login_type ?? 'PC端',
  });

  return request<ApiResponse<LoginResult>>('/system/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    data: body.toString(),
    // 登录失败由登录页内联展示(error.info.msg),不要再弹一次全局 toast
    skipErrorHandler: true,
  });
}

/** 刷新 token */
export async function refreshToken(token: string) {
  return request<ApiResponse<TokenPair>>('/system/auth/token/refresh', {
    method: 'POST',
    data: { refresh_token: token },
  });
}

/** 退出登录 */
export async function logout(token: string) {
  return request<ApiResponse<null>>('/system/auth/logout', {
    method: 'POST',
    data: { token },
  });
}
