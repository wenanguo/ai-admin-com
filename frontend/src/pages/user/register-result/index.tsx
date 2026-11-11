import { Link, useSearchParams } from '@umijs/max';
import { Button, Result } from 'antd';
import React from 'react';
import useStyles from './style.style';

const RegisterResult: React.FC<Record<string, unknown>> = () => {
  const { styles } = useStyles();
  const [params] = useSearchParams();

  const actions = (
    <div className={styles.actions}>
      <Link to="/user/login" prefetch>
        <Button size="large" type="primary">
          <span>去登录</span>
        </Button>
      </Link>
      <Link to="/" prefetch>
        <Button size="large">返回首页</Button>
      </Link>
    </div>
  );

  // 后端的注册接口不发送激活邮件,账号建好就能登录
  const account = params?.get('account') || '新账号';
  return (
    <Result
      className={styles.registerResult}
      status="success"
      title={
        <div className={styles.title}>
          <span>你的账号：{account} 注册成功</span>
        </div>
      }
      subTitle="账号已创建成功，请使用该账号登录。新账号默认没有角色，需要管理员分配角色后才能看到菜单。"
      extra={actions}
    />
  );
};
export default RegisterResult;
