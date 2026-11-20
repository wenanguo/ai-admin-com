/**
 * AI 管理面 = **整页嵌 dsh 自带的 Web UI**（issue #124）。
 *
 * ## 为什么是 iframe（不是「用 dsh 的 API 接我们的前端」）
 *
 * 实测：dsh **自带**插件市场 / 技能管理 / MCP 管理（web profile 里 56 个
 * client-ui）⇒ 我们**不造**管理界面（那正是这次要避免的重复造轮子）
 * ⇒ 改成把 dsh 的完整 UI 整页嵌进来。
 *
 * ## 这一页只做三件事
 *
 * ① **把 token 写进 cookie**（`aipm_admin`）—— iframe 的**导航请求带不了
 *    `Authorization` 头** ⇒ 后端反代只能认 cookie / 查询参数；
 * ② **渲染 iframe**（`src="/dsh-admin/"`）；
 * ③ **高度自适应**（整页嵌 ⇒ 不裁剪 dsh 的界面 ⇒ 高度跟着视口走）。
 *
 * ⚠️ **普通用户看不到入口**：路由上挂了 `access: 'canAdmin'`
 *    ⇒ umi 的 access 插件直接拦掉 ⇒ 即便手工敲地址，后端反代也会 **403**。
 */
import { Spin } from 'antd';
import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { getAccessToken } from '@/auth/token';
import {
  ADMIN_TOKEN_COOKIE,
  DSH_ADMIN_IFRAME_SRC,
  DSH_ADMIN_MOUNT_PATH,
} from './paths';

/**
 * 把访问 token 写进 `aipm_admin` cookie（**Path 限定在反代前缀**）。
 *
 * ⚠️ 不是 HttpOnly（JS 得能写）⇒ 它的作用域被 Path 限死在 `/dsh-admin`。
 */
function writeAdminTokenCookie(token: string): void {
  if (!token) return;
  document.cookie = `${ADMIN_TOKEN_COOKIE}=${encodeURIComponent(
    token,
  )}; Path=${DSH_ADMIN_MOUNT_PATH}; SameSite=Strict`;
}

/**
 * AI 管理面页（整页嵌 dsh 的 UI）。
 */
export default function AiAdminPage(): React.ReactElement {
  const [ready, setReady] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // ① 先把 token 放进 cookie ⇒ 再让 iframe 去导航（顺序不能反）
  useEffect(() => {
    writeAdminTokenCookie(getAccessToken());
    setReady(true);
  }, []);

  // ② 高度自适应（**整页嵌** ⇒ 不裁剪 ⇒ 高度跟着视口走）
  useEffect(() => {
    const sync = () => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const top = wrap.getBoundingClientRect().top;
      wrap.style.height = `${Math.max(window.innerHeight - top, 320)}px`;
    };
    sync();
    window.addEventListener('resize', sync);
    return () => window.removeEventListener('resize', sync);
  }, []);

  return (
    <div ref={wrapRef} style={{ height: 'calc(100vh - 120px)' }}>
      {ready ? (
        <iframe
          title="AI 管理面"
          src={DSH_ADMIN_IFRAME_SRC}
          style={{ width: '100%', height: '100%', border: 0 }}
        />
      ) : (
        <Spin />
      )}
    </div>
  );
}
