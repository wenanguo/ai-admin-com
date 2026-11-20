/**
 * AI 管理面的**路由常量**与几个**两边必须一致**的字符串。
 *
 * 单独一个模块，是因为这些值被**两个地方**用到了：
 * - `config/routes.ts`（注册路由）；
 * - `src/pages/ai/admin/index.tsx`（页面本身）。
 *
 * ⚠️ 「后端反代的挂载前缀」是**跨仓一致**的：后端是
 *    `backend/ai/src/core/adapter/dsh-admin/proxy.ts` 的 `DSH_ADMIN_MOUNT_PATH`
 *    ⇒ 两边对不上 ⇒ iframe 打不到我们的路由 ⇒ 白屏。
 */

/** AI 管理面页面的路由（菜单项也链到这里）。 */
export const AI_ADMIN_PAGE_PATH = '/ai/admin';

/** 后端反代的挂载前缀（**与后端同名常量一致**）。 */
export const DSH_ADMIN_MOUNT_PATH = '/dsh-admin';

/** iframe 的 `src`（末尾带斜杠 ⇒ dsh 认得自己是根）。 */
export const DSH_ADMIN_IFRAME_SRC = `${DSH_ADMIN_MOUNT_PATH}/`;

/**
 * 管理面 token 的 **cookie 名**（后端反代认它）。
 *
 * ## 为什么需要 cookie
 *
 * 管理面是**整页 iframe** ⇒ 浏览器发的是**导航请求**
 * ⇒ **带不了 `Authorization` 头** ⇒ 只能靠 cookie / 查询参数。
 *
 * ⚠️ cookie 的 **Path 限定在 `/dsh-admin`** ⇒ 别的路由收不到它。
 */
export const ADMIN_TOKEN_COOKIE = 'aipm_admin';
