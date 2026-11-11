import { describe, expect, it } from 'vitest';
import { API_BASE_URL, AUTH_FREE_API_PATHS } from './http';
import {
  createBizError,
  isApiResponse,
  isSuccess,
  isUnauthorized,
} from './response';

describe('response envelope helpers', () => {
  describe('isApiResponse', () => {
    it('returns true for a valid envelope', () => {
      expect(
        isApiResponse({
          code: 0,
          msg: '成功',
          data: null,
          status_code: 200,
          success: true,
        }),
      ).toBe(true);
    });

    it('returns false for null', () => {
      expect(isApiResponse(null)).toBe(false);
    });

    it('returns false for a plain string', () => {
      expect(isApiResponse('ok')).toBe(false);
    });

    it('returns false when code is not a number', () => {
      expect(isApiResponse({ code: '0', msg: '' })).toBe(false);
    });
  });

  describe('isSuccess', () => {
    it('treats code 0 as success', () => {
      expect(
        isSuccess({
          code: 0,
          msg: '',
          data: null,
          status_code: 200,
          success: true,
        }),
      ).toBe(true);
    });

    it('treats code 200 as success', () => {
      expect(
        isSuccess({
          code: 200,
          msg: '',
          data: null,
          status_code: 200,
          success: true,
        }),
      ).toBe(true);
    });

    it('treats code 400 as failure even when success flag is true', () => {
      expect(
        isSuccess({
          code: 400,
          msg: '订单状态异常',
          data: null,
          status_code: 200,
          success: true,
        }),
      ).toBe(false);
    });

    it('treats code -1 as failure', () => {
      expect(
        isSuccess({
          code: -1,
          msg: '验证码不能为空',
          data: null,
          status_code: 500,
          success: false,
        }),
      ).toBe(false);
    });

    it('returns false for a non-envelope value', () => {
      expect(isSuccess(undefined)).toBe(false);
    });
  });

  describe('isUnauthorized', () => {
    it('detects code 401', () => {
      expect(
        isUnauthorized({
          code: 401,
          msg: '未授权',
          data: null,
          status_code: 401,
          success: false,
        }),
      ).toBe(true);
    });

    it('detects code 10401 (backend auth failure)', () => {
      expect(
        isUnauthorized({
          code: 10401,
          msg: '认证失败,请登录后再试',
          data: null,
          status_code: 401,
          success: false,
        }),
      ).toBe(true);
    });

    it('does not treat code 403 as unauthorized', () => {
      expect(
        isUnauthorized({
          code: 403,
          msg: '访问受限',
          data: null,
          status_code: 403,
          success: false,
        }),
      ).toBe(false);
    });
  });

  describe('createBizError', () => {
    it('creates a BizError carrying code, msg and data', () => {
      const error = createBizError({
        code: 4001,
        msg: '参数错误',
        data: { field: 'username' },
        status_code: 400,
        success: false,
      });

      expect(error.name).toBe('BizError');
      expect(error.message).toBe('参数错误');
      expect(error.info).toEqual({
        code: 4001,
        msg: '参数错误',
        data: { field: 'username' },
      });
    });

    it('falls back to a default message when msg is empty', () => {
      const error = createBizError({
        code: 1,
        msg: '',
        data: null,
        status_code: 400,
        success: false,
      });
      expect(error.message).toBe('请求失败');
      expect(error.info.msg).toBe('请求失败');
    });
  });

  describe('API_BASE_URL', () => {
    it('is the backend API prefix', () => {
      expect(API_BASE_URL).toBe('/api/v1');
    });
  });

  describe('AUTH_FREE_API_PATHS', () => {
    it('lists the endpoints that must not carry a bearer token', () => {
      // 请求拦截器靠这份清单决定要不要注入 token —— 它只有这一处定义
      // (src/requestErrorConfig.ts 直接引这里)。
      expect(AUTH_FREE_API_PATHS).toContain('/system/auth/login');
      expect(AUTH_FREE_API_PATHS).toContain('/system/auth/token/refresh');
      expect(AUTH_FREE_API_PATHS).toContain('/system/auth/captcha/get');
    });
  });
});
