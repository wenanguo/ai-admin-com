import { useMutation, useQueryClient } from '@tanstack/react-query';
import { history, Link } from '@umijs/max';
import { Button, Form, Input, Popover, Progress } from 'antd';
import type { Store } from 'antd/es/form/interface';
import type { FC } from 'react';
import { useState } from 'react';
import type { UserRegisterParams } from '@/services/api/system/types';
import { registerUser } from '@/services/api/system/user';
import useStyles from './styles';

const FormItem = Form.Item;

const passwordProgressMap: {
  ok: 'success';
  pass: 'normal';
  poor: 'exception';
} = {
  ok: 'success',
  pass: 'normal',
  poor: 'exception',
};

const getPasswordStatus = (value?: string) => {
  if (value && value.length > 9) {
    return 'ok';
  }
  if (value && value.length > 5) {
    return 'pass';
  }
  return 'poor';
};

const PasswordProgress: React.FC<{
  value?: string;
  styles: Record<string, string>;
}> = ({ value, styles }) => {
  const passwordStatus = getPasswordStatus(value);
  return value?.length ? (
    <div className={styles[`progress-${passwordStatus}`]}>
      <Progress
        status={passwordProgressMap[passwordStatus]}
        size={6}
        percent={Math.min(100, value.length * 10)}
        showInfo={false}
      />
    </div>
  ) : null;
};

const Register: FC = () => {
  const { styles } = useStyles();
  const [open, setVisible]: [boolean, any] = useState(false);
  const [popover, setPopover]: [boolean, any] = useState(false);
  const queryClient = useQueryClient();

  const passwordStatusMap = {
    ok: (
      <div className={styles.success}>
        <span>强度：强</span>
      </div>
    ),
    pass: (
      <div className={styles.warning}>
        <span>强度：中</span>
      </div>
    ),
    poor: (
      <div className={styles.error}>
        <span>强度：太短</span>
      </div>
    ),
  };

  const [form] = Form.useForm();
  const { isPending: submitting, mutate: register } = useMutation({
    mutationFn: (formValues: Store) => {
      const payload: UserRegisterParams = {
        username: formValues.username,
        password: formValues.password,
        mobile: formValues.mobile,
      };
      return registerUser(payload);
    },
    onSuccess: (_data, params) => {
      // 后端返回的是 { code, msg, data } 信封,请求层已经弹过成功提示了,这里不要再弹
      queryClient.invalidateQueries({ queryKey: ['current-user'] });
      history.push({
        pathname: `/user/register-result?account=${params.username}`,
      });
    },
  });
  const onFinish = (values: Store) => {
    register(values);
  };
  const checkPassword = (_: any, value: string) => {
    const promise = Promise;
    // 没有值的情况
    if (!value) {
      setVisible(!!value);
      return promise.reject('请输入密码!');
    }
    // 有值的情况
    if (!open) {
      setVisible(!!value);
    }
    setPopover(!popover);
    if (value.length < 6) {
      return promise.reject('');
    }
    return promise.resolve();
  };
  const password = Form.useWatch('password', form);
  const passwordStatus = getPasswordStatus(password);
  return (
    <div className={styles.main}>
      <h3>注册</h3>
      <Form form={form} name="UserRegister" onFinish={onFinish}>
        <FormItem
          name="username"
          rules={[
            {
              required: true,
              message: '请输入用户名!',
            },
            {
              // 后端 UserRegisterSchema 的账号规则:字母开头,3-32 位,
              // 仅允许字母、数字、下划线、点和短横线
              pattern: /^[A-Za-z][A-Za-z0-9_.-]{2,31}$/,
              message: '账号需以字母开头,3-32 位,仅允许字母、数字、_ . -',
            },
          ]}
        >
          <Input size="large" placeholder="用户名" />
        </FormItem>
        <Popover
          getPopupContainer={(node) => {
            if (node?.parentNode) {
              return node.parentNode as HTMLElement;
            }
            return node;
          }}
          content={
            open && (
              <div
                style={{
                  padding: '4px 0',
                }}
              >
                {passwordStatusMap[passwordStatus]}
                <PasswordProgress value={password} styles={styles} />
                <div
                  style={{
                    marginTop: 10,
                  }}
                >
                  <span>请至少输入 6 个字符。请不要使用容易被猜到的密码。</span>
                </div>
              </div>
            )
          }
          overlayStyle={{
            width: 240,
          }}
          placement="right"
          open={open}
        >
          <FormItem
            name="password"
            className={
              form.getFieldValue('password') &&
              form.getFieldValue('password').length > 0 &&
              styles.password
            }
            rules={[
              {
                validator: checkPassword,
              },
            ]}
          >
            <Input
              size="large"
              type="password"
              placeholder="至少6位密码，区分大小写"
            />
          </FormItem>
        </Popover>
        <FormItem
          name="mobile"
          rules={[
            {
              required: true,
              message: '请输入手机号!',
            },
            {
              pattern: /^\d{11}$/,
              message: '手机号格式错误!',
            },
          ]}
        >
          <Input size="large" placeholder="手机号" />
        </FormItem>
        <FormItem>
          <div className={styles.footer}>
            <Button
              size="large"
              loading={submitting}
              className={styles.submit}
              type="primary"
              htmlType="submit"
            >
              <span>注册</span>
            </Button>
            <Link to="/user/login" prefetch>
              <span>使用已有账户登录</span>
            </Link>
          </div>
        </FormItem>
      </Form>
    </div>
  );
};
export default Register;
