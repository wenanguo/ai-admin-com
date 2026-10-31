# 最终集成复审后的修复轮

集成阶段跑了一次跨文件的最终复审(对照**线上** OpenAPI `https://www.pmdict.cn/api/v1/openapi.json`
与后端源码),结论是 **Needs fixes** —— 1 条 Critical、2 条 Important、若干 Minor。
这一轮把它们处理掉。

## 待处理清单

| # | 文件 | 问题 | 级别 | 处理 |
|---|---|---|---|---|
| R1 | `src/auth/session.ts` | 刷新 token 失败的判定写在 `error?.response` 上,而真实链路里错误已被转成 BizError(只有 `info`),`response` 恒为 undefined ⇒ 「刷新失败 → 登出跳登录页」永远走不到 | **Critical** | 在源头判定:`doRefresh` 里「服务端给了响应」(`response` 或 `info` 存在)⇒ UnauthorizedError;纯网络故障才原样抛出 |
| R2 | `config/routes.ts` | 登录后落到 antd-pro 演示看板 `/dashboard/analysis`,那个页面的接口后端没有 ⇒ 登录后第一屏就报错 | Important | `'/'` 路由改指 `/system/user` |
| R3 | `src/pages/module_system/user/ModalForm.tsx` | 新建用户不带角色(后端 `role_ids` 默认 `[]`)⇒ 建出来的账号登录后是空的 | Important | 加角色多选下拉 + `src/services/api/system/role.ts` |
| R4 | `src/pages/user/login/index.tsx` | 换了验证码图但没清掉已填的答案 ⇒ 新 key 配旧答案必错 | Minor | `loadCaptcha` 里 `setFieldValue('captcha', '')` |
| R5 | `src/pages/user/login/index.tsx` | 验证码拉取失败时静默把输入框藏掉,用户只看到「验证码不能为空」 | Minor | 失败时给 Alert + 重试按钮 |
| R6 | `src/pages/user/login/index.tsx` | 「忘记密码」按钮没有 onClick(上游遗留) | Minor | 删掉(后端有 `forget_password` 接口,但没做重置流程,留个死按钮更误导) |
| R7 | `src/components/RightContent/AvatarDropdown.tsx` | 地址带 `?redirect=` 时登出后不跳转,清完 token 停在原页 → 空壳页 | Minor | 登出一律回登录页,不再带 redirect |
| R8 | `src/pages/user/register-result/index.tsx` | 写「激活邮件已发送到邮箱」,但后端注册不发邮件;邮箱兜底值是 `AntDesign@example.com` | Minor | 改成「账号已创建,请登录」+ 去品牌残留 |
| R9 | `src/pages/user/register/index.tsx` | 提交体带一个表单里根本不存在的 `name` 字段 | Minor | 去掉 |
| R10 | `src/pages/user/register/index.tsx` | 用户名只校验 `min:3`,后端要 `^[A-Za-z][A-Za-z0-9_.-]{2,31}$` ⇒ 提交后 422 | Minor | 前端补同样的规则 |
| R11 | `src/locales/*/pages.ts` | 登录页副标题还是「Ant Design 是西湖区最具影响力的 Web 设计规范」 | Minor | 换成 AiAdmin |
| R12 | `biome.json` | `e2e-out`(playwright 报告)没被 biome 忽略 ⇒ `npm run lint` 被生成物刷出 3698 个错 | Minor | 加进 `files.includes` 的忽略列表 |
| R13 | `src/pages/module_system/user/index.tsx` | 删除失败时 Popconfirm 的 onConfirm 抛出未处理的 Promise | Minor | try/catch 兜住(提示仍由请求层统一弹) |

R1 之外的都不影响主链路,但都是「模板被别人照抄时会一起带过去」的问题,一并收掉。

## R1 的关键细节

后端刷新接口的失败**不走 401**:`app/api/v1/module_system/auth/service.py` 里
刷新失败抛的是 `CustomException`,默认 `status_code=500, code=-1`。
于是真实链路是:

```
刷新接口返回 HTTP 500 + 信封
  → 响应拦截器 onRejected 把它转成 BizError(只有 info,没有 response)
    → doRefresh 拿到 BizError
      → 老写法 `if (error?.response)` 恒为 false ⇒ 直接把 BizError 抛出去
        → errorHandler 走「业务错误」分支,只弹了个 toast
          → clearAuth() 和 redirectToLogin() 永远不执行
```

症状:会话卡死,每个后续请求都重复「401 → 刷新 → 500 → 弹两次提示」,
唯一的出路是手动敲 `/user/login`。

修法:失败分类放到源头(`doRefresh`),不再从错误的形状去反推语义 ——
「有没有 response / info」就等价于「服务端有没有作答」。

补的两个测试都按**真实形状**写:一个用 BizError(线上真实链路),
一个用没有 response 的网络错误(不能登出)。
原来的那个测试用的是一个带 `.response` 的原始 axios error,
真实链路上根本不会出现这种形状,所以它一直是绿的。

## 验收门禁

- `npm run lint`(Biome + tsc)通过
- `npm run test` 通过
- `npx antd lint ./src` 不新增告警
- 人工走查:登录 → 当前用户 → 后端菜单 → 用户管理页真实数据 → 退出 → 401 静默刷新

## 提交

- `fix(auth): 刷新 token 失败时清登录态并跳回登录页`
- `feat(user): 用户表单支持选择角色`
- `fix(login): 落地页指向后端页面,修掉验证码与品牌文案`
