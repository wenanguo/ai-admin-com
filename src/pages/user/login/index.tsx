import { LockOutlined, UserOutlined } from '@ant-design/icons';
import {
  LoginForm,
  ProFormCheckbox,
  ProFormText,
} from '@ant-design/pro-components';
import {
  FormattedMessage,
  Helmet,
  SelectLang,
  useIntl,
  useModel,
} from '@umijs/max';
import type { FormInstance } from 'antd';
import { Alert, App, Button } from 'antd';
import { createStyles } from 'antd-style';
import React, {
  startTransition,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { loginWithSession } from '@/auth/session';
import { setTokens } from '@/auth/token';
import { Footer } from '@/components';
import { getCaptcha } from '@/services/api/system/auth';
import type { CaptchaOut } from '@/services/api/system/types';
import { API_BASE_URL } from '@/services/http';
import Settings from '../../../../config/defaultSettings';

/**
 * Validate redirect URL to prevent open redirect attacks.
 * Only allow same-origin relative paths starting with '/'.
 */
const getSafeRedirectUrl = (redirect: string | null): string => {
  if (!redirect?.startsWith('/')) return '/';

  if (redirect.startsWith('//')) return '/';

  try {
    const parsed = new URL(redirect, window.location.origin);
    if (parsed.origin !== window.location.origin) return '/';
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return '/';
  }
};

const useStyles = createStyles(({ token }) => {
  return {
    lang: {
      width: 42,
      height: 42,
      lineHeight: '42px',
      position: 'fixed',
      right: 16,
      borderRadius: token.borderRadius,
      ':hover': {
        backgroundColor: token.colorBgTextHover,
      },
    },
    container: {
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      overflow: 'auto',
      backgroundImage:
        "url('https://mdn.alipayobjects.com/yuyan_qk0oxh/afts/img/V-_oS6r-i7wAAAAAAAAAAAAAFl94AQBr')",
      backgroundSize: '100% 100%',
    },
  };
});

const Lang = () => {
  const { styles } = useStyles();

  return (
    <div className={styles.lang} data-lang>
      {SelectLang && <SelectLang />}
    </div>
  );
};

const LoginMessage: React.FC<{
  content: string;
}> = ({ content }) => {
  return (
    <Alert
      style={{
        marginBottom: 24,
      }}
      title={content}
      type="error"
      showIcon
    />
  );
};

const Login: React.FC = () => {
  const [captcha, setCaptcha] = useState<CaptchaOut | null>(null);
  const [captchaError, setCaptchaError] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [oauthLoading, setOauthLoading] = useState<string | null>(null);
  const formRef = useRef<FormInstance | undefined>(undefined);
  const { initialState, setInitialState } = useModel('@@initialState');
  const { styles } = useStyles();
  const { message } = App.useApp();
  const intl = useIntl();

  const loadCaptcha = useCallback(async () => {
    try {
      const res = await getCaptcha();
      setCaptcha(res?.data ?? null);
      setCaptchaError(false);
    } catch {
      setCaptcha(null);
      setCaptchaError(true);
    }
    // 验证码是一次性的:换了图就必须把已经填的答案清掉,
    // 否则新 key 配旧答案,下次必定「验证码错误」
    formRef.current?.setFieldValue('captcha', '');
  }, []);

  useEffect(() => {
    loadCaptcha();
  }, [loadCaptcha]);

  /**
   * 三方登录回跳:后端 302 回来看板会带上 access_token / refresh_token,
   * 失败时带 oauth_error。
   */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const accessToken = params.get('access_token');
    const refreshToken = params.get('refresh_token');
    const oauthError = params.get('oauth_error');

    if (oauthError) {
      message.error(oauthError);
      window.history.replaceState({}, '', window.location.pathname);
      return;
    }

    if (accessToken && refreshToken) {
      setTokens(accessToken, refreshToken, true);
      window.location.href = '/';
    }
  }, [message]);

  const fetchUserInfo = async () => {
    const userInfo = await initialState?.fetchUserInfo?.();
    if (userInfo) {
      startTransition(() => {
        setInitialState((s) => ({
          ...s,
          ...userInfo,
        }));
      });
    }
  };

  const handleSubmit = async (values: {
    username?: string;
    password?: string;
    captcha?: string;
    autoLogin?: boolean;
  }) => {
    setSubmitError(null);

    try {
      await loginWithSession(
        {
          username: values.username ?? '',
          password: values.password ?? '',
          captcha_key: captcha?.key ?? '',
          captcha: values.captcha ?? '',
          login_type: 'PC端',
        },
        Boolean(values.autoLogin),
      );

      message.success(
        intl.formatMessage({
          id: 'pages.login.success',
          defaultMessage: '登录成功！',
        }),
      );

      // 用本文件里的局部 fetchUserInfo(Task 10 已经改成整块回写 currentUser/menus/permissions)
      await fetchUserInfo();

      const urlParams = new URL(window.location.href).searchParams;
      const redirectUrl = getSafeRedirectUrl(urlParams.get('redirect'));
      window.location.href = redirectUrl;
    } catch (error: any) {
      const msg = error?.info?.msg || error?.message || '登录失败，请重试！';
      setSubmitError(msg);
      // 验证码可能已失效,重新拉一张
      loadCaptcha();
    }
  };

  return (
    <div className={styles.container}>
      <Helmet>
        <title>
          {intl.formatMessage({
            id: 'menu.login',
            defaultMessage: '登录页',
          })}
          {Settings.title && ` - ${Settings.title}`}
        </title>
      </Helmet>
      <Lang />
      <div
        style={{
          flex: '1',
          padding: '32px 0',
        }}
      >
        <LoginForm
          contentStyle={{
            minWidth: 280,
            maxWidth: '75vw',
          }}
          formRef={formRef}
          logo={<img alt="logo" src="/logo.svg" />}
          title="AiAdmin"
          subTitle={intl.formatMessage({
            id: 'pages.layouts.userLayout.title',
          })}
          initialValues={{
            autoLogin: true,
          }}
          actions={[
            <FormattedMessage
              key="loginWith"
              id="pages.login.loginWith"
              defaultMessage="其他登录方式"
            />,
            <div key="oauth" style={{ display: 'flex', gap: 8 }}>
              {(['github', 'gitee', 'wechat', 'qq'] as const).map(
                (provider) => (
                  <Button
                    key={provider}
                    type="link"
                    loading={oauthLoading === provider}
                    onClick={() => {
                      setOauthLoading(provider);
                      const redirectUri = `${window.location.origin}/user/login`;
                      window.location.href = `${API_BASE_URL}/system/auth/oauth/${provider}/login?redirect_uri=${encodeURIComponent(redirectUri)}`;
                    }}
                  >
                    {provider}
                  </Button>
                ),
              )}
              <Button type="link" href="/user/register">
                注册
              </Button>
            </div>,
          ]}
          onFinish={async (values) => {
            await handleSubmit(values);
          }}
        >
          {submitError && <LoginMessage content={submitError} />}
          {captchaError && (
            <Alert
              style={{ marginBottom: 16 }}
              type="error"
              showIcon
              title="验证码加载失败"
              action={
                <Button size="small" onClick={loadCaptcha}>
                  重试
                </Button>
              }
            />
          )}

          <ProFormText
            name="username"
            fieldProps={{
              size: 'large',
              prefix: <UserOutlined />,
            }}
            placeholder={intl.formatMessage({
              id: 'pages.login.username.placeholder',
              defaultMessage: '请输入用户名',
            })}
            rules={[
              {
                required: true,
                message: (
                  <FormattedMessage
                    id="pages.login.username.required"
                    defaultMessage="请输入用户名!"
                  />
                ),
              },
            ]}
          />

          <ProFormText.Password
            name="password"
            fieldProps={{
              size: 'large',
              prefix: <LockOutlined />,
            }}
            placeholder={intl.formatMessage({
              id: 'pages.login.password.placeholder',
              defaultMessage: '请输入密码',
            })}
            rules={[
              {
                required: true,
                message: (
                  <FormattedMessage
                    id="pages.login.password.required"
                    defaultMessage="请输入密码！"
                  />
                ),
              },
            ]}
          />

          {captcha?.enable && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <ProFormText
                name="captcha"
                style={{ flex: 1 }}
                fieldProps={{
                  size: 'large',
                  prefix: <LockOutlined />,
                }}
                placeholder="请输入验证码"
                rules={[
                  {
                    required: true,
                    message: '请输入验证码！',
                  },
                ]}
              />
              <img
                src={captcha.img_base}
                alt="点击刷新验证码"
                onClick={loadCaptcha}
                style={{
                  height: 40,
                  cursor: 'pointer',
                  borderRadius: 4,
                  border: '1px solid rgba(0,0,0,0.15)',
                }}
              />
            </div>
          )}
          <div
            style={{
              marginBottom: 24,
            }}
          >
            <ProFormCheckbox noStyle name="autoLogin">
              <FormattedMessage
                id="pages.login.rememberMe"
                defaultMessage="自动登录"
              />
            </ProFormCheckbox>
          </div>
        </LoginForm>
      </div>
      <Footer />
    </div>
  );
};

export default Login;
