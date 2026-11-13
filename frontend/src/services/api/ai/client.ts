/**
 * AI 服务（`D:/project/ai-admin-ai`）的 REST 客户端。
 *
 * ## 前缀：为什么不是 `/api`
 *
 * 前端自己的 API base 是 `/api/v1`（`src/services/http.ts`），dev 代理里
 * `'/api/'` 这条规则归 **AiAdmin**；而 AI 服务的路径也是 `/api/agent/...`
 * ⇒ 浏览器侧必须用**另一个前缀**，否则请求会被 AiAdmin 的代理规则接走。
 * 所以这里用 `AI_API_BASE_URL`（缺省 `/ai-api`），完整地址是
 * `${AI_API_BASE_URL}/api/agent/...`；开发期由 `config/proxy.ts` 的
 * `'/ai-api/'` 规则转发到 AI 服务（Task 4 加那条规则）。
 *
 * ## 身份：复用 AiAdmin 的 token
 *
 * AI 服务**不自己校验 token**，它把 token 透传给 AiAdmin（AiAdmin 是权威）
 * ⇒ 前端直接把当前用户的 token 放进 `Authorization: Bearer <token>`，
 * 用户在 AiAdmin 里的权限就是他让 AI 做的事的权限。
 * token 从 `@/auth/token` 的 `getAccessToken()` 取 —— **不另造一套存取**。
 */
import { request } from '@umijs/max';
import { getAccessToken } from '@/auth/token';
import { AI_API_BASE_URL, aiUrl } from './base';
import type {
  AiAuditRow,
  AiConversation,
  AiEnvelope,
  AiPendingRow,
  AiSkillSummary,
  AiState,
  AiTaskContext,
} from './types';

/**
 * 前缀常量住在 `./base`（叶子模块）里。
 *
 * ⚠️ 这里**再导出**一份，是为了兼容既有引用；
 *    真正需要它的共享请求配置应该直接 import `@/services/api/ai/base`
 *    （那才是没有依赖的那一份）。
 */
export { AI_API_BASE_URL, aiUrl };

/** 请求选项（只用到这几个）。 */
interface AiRequestOptions {
  method: 'GET' | 'POST';
  params?: Record<string, string | number | undefined>;
  data?: unknown;
  /** 超时（毫秒）—— 不给就跟着 axios 的默认（不超时）。 */
  timeout?: number;
}

/**
 * 调 AI 服务：拼前缀、带上 Bearer token、拆掉信封。
 *
 * ⚠️ `baseURL: ''` 是必须的：共享的 request 实例的 baseURL 是 AiAdmin 的
 * `/api/v1`（`src/app.tsx`）⇒ 不置空的话 AI 服务的路径会被拼成
 * `/api/v1/ai-api/...`，打到 AiAdmin 的代理规则上去。
 *
 * ⚠️ `skipErrorHandler: true`：AI 服务不可达时**不要弹全局错误提示**。
 * 侧栏是常挂在整个布局上的（每个页面都会发这几次请求）⇒ 服务没起来的话，
 * 用户在别的页面上也会莫名其妙看到一串报错。侧栏自己会把错误显示在面板里
 * （对话页签的错误条、待确认/审计页签的错误态）。
 */
async function aiRequest<T>(
  path: string,
  options: AiRequestOptions,
): Promise<T> {
  const response = await request<AiEnvelope<T>>(aiUrl(path), {
    method: options.method,
    baseURL: '',
    skipErrorHandler: true,
    headers: { Authorization: `Bearer ${getAccessToken()}` },
    params: options.params,
    data: options.data,
    timeout: options.timeout,
  });
  return response.data;
}

/** 列出会话（当前用户的，最近更新的在前）。 */
export async function listAiConversations(): Promise<AiConversation[]> {
  return aiRequest<AiConversation[]>('/api/agent/conversations', {
    method: 'GET',
  });
}

/** 新建会话（标题可以后面再补）。 */
export async function createAiConversation(
  title?: string,
): Promise<AiConversation> {
  return aiRequest<AiConversation>('/api/agent/conversations', {
    method: 'POST',
    data: title === undefined ? {} : { title },
  });
}

/**
 * 快照请求的超时（毫秒）。
 *
 * ⚠️ **必须有**：AI 服务卡住时 `GET /state` 会一直挂着
 *    ⇒ 前端的回放窗口一直开着 ⇒ 实时帧被无限期攒着不上屏
 *    （用户看到的是「我发了话，助手不回」）。
 *    超时之后请求失败 ⇒ 前端走「快照读不到」那条路（用回放的积压顶上）。
 *
 * ⚠️ 它要比前端回放窗口的上限（`useAgentStream.ts` 的 `REPLAY_MAX_WINDOW_MS`）
 *    **短**：让请求先失败 ⇒ 历史由回放的积压补上，而不是等窗口到期。
 */
const SNAPSHOT_TIMEOUT_MS = 3000;

/** 取会话快照（消息、是否在跑、当前模型）。 */
export async function getAiState(conversationId: string): Promise<AiState> {
  return aiRequest<AiState>(`/api/agent/${conversationId}/state`, {
    method: 'GET',
    timeout: SNAPSHOT_TIMEOUT_MS,
  });
}

/**
 * 生成命令 id。
 *
 * ⚠️ **服务端按它去重**（同一个 `commandId` 再来一次只跑一遍，见服务端
 * `src/agent/runtime.ts` 的 `submitCommand`）⇒ **重试必须复用同一个 id**，
 * 否则重试会真的把命令再执行一遍。
 */
export function createAiCommandId(): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return `cmd-${crypto.randomUUID()}`;
  }
  // ⚠️ `crypto.randomUUID` 只在**安全上下文**里有（https 或 localhost）——
  // 用局域网 IP 以 http 打开时没有它 ⇒ 退化成一个基于 getRandomValues 的 id。
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return `cmd-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

/** 提交命令时的选项。 */
export interface AiCommandOptions {
  /**
   * 命令 id：省略时由客户端生成（`cmd-<uuid>`）。
   *
   * ⚠️ **重试时必须把上次返回的 id 原样传回来** —— 服务端按它去重。
   */
  id?: string;
  /**
   * 当前讨论的上下文（点「与 AI 讨论」时带上）。
   *
   * ⚠️ **每条消息都带**（不是只在会话创建时带）：上下文是「此刻在聊哪条任务」，
   *    用户随时可能换一条任务继续聊。
   */
  context?: AiTaskContext;
}

/** 命令的受理结果（`success` 的意思是「已受理并排队」，不是「这一轮跑完了」）。 */
export interface AiCommandAck {
  /** 实际发出去的命令 id（**重试时原样传回**）。 */
  id: string;
  success: boolean;
}

/**
 * 提交一条命令（当前只有 `prompt` 一种）。
 *
 * @param conversationId 会话 id。
 * @param message 用户说的那句话。
 * @param options 命令 id（省略则客户端生成）。
 */
export async function sendAiCommand(
  conversationId: string,
  message: string,
  options?: AiCommandOptions,
): Promise<AiCommandAck> {
  const id = options?.id ?? createAiCommandId();
  const ack = await aiRequest<{ id: string; type: string; success: boolean }>(
    `/api/agent/${conversationId}/command`,
    {
      method: 'POST',
      // ⚠️ `context` 没有上下文时**不要发**这个键（别发 null：
      //    服务端把「没有上下文」与「上下文不合法」都当成「没有」）。
      data: {
        id,
        type: 'prompt',
        message,
        ...(options?.context ? { context: options.context } : {}),
      },
    },
  );
  // ⚠️ 返回**发出去的那个** id（不是服务端回显的）—— 重试要复用的一定是它。
  return { id, success: ack?.success === true };
}

/**
 * 中止当前正在跑的那一轮（用户点「停止生成」）。
 *
 * ⚠️ 服务端的 `POST /api/agent/:cid/abort` ⇒ pi 的 `session.abort()`。
 *    中止**不是回滚**：这一轮已经落库的消息（用户那句话、助手已写出的部分）
 *    都还在，已经建出来的任务也不会被撤销。
 *
 * ⚠️ 中止后服务端会发一帧 `agent_settled` ⇒ 前端输入框解禁。
 *    但为了不让界面卡在「本轮进行中…」，调用方还会**乐观地**解禁一次
 *    （见 `useWorkspace.abort`）。
 */
export async function abortAiConversation(
  conversationId: string,
): Promise<void> {
  await aiRequest<{ conversationId: string; aborted: boolean }>(
    `/api/agent/${conversationId}/abort`,
    { method: 'POST' },
  );
}

/**
 * 批准一条挂起的修改。
 *
 * ⚠️ 服务端在 `tool_call` hook 里同步挂起 ⇒ 批准 ⇒ **原工具调用照常执行**
 *   （那一轮不打断）⇒ 模型接着说。
 *
 * @param id 待确认行的 id。
 */
export async function approveAiPending(id: string): Promise<void> {
  await aiRequest<{ id: string; status: string }>(
    `/api/agent/pending/${id}/approve`,
    { method: 'POST' },
  );
}

/**
 * 拒绝一条挂起的修改。
 *
 * ⚠️ 拒绝 ⇒ 服务端把工具调用 block 掉 ⇒ 模型收到「被拒绝」的错误 ⇒
 *   **它会自己告诉用户这次没做成**。
 *
 * @param id 待确认行的 id。
 */
export async function rejectAiPending(id: string): Promise<void> {
  await aiRequest<{ id: string; status: string }>(
    `/api/agent/pending/${id}/reject`,
    { method: 'POST' },
  );
}

/** 审计流水的筛选条件（服务端只认这几个，其余参数静默忽略）。 */
export interface AiAuditQuery {
  actor?: 'AI' | 'USER';
  command?: string;
  limit?: number;
}

/** 一页审计（`total` 是符合条件的总行数，不是本页条数）。 */
export interface AiAuditPage {
  total: number;
  items: AiAuditRow[];
}

/** 读审计流水（新的在前）。 */
export async function listAiAudit(params?: AiAuditQuery): Promise<AiAuditPage> {
  return aiRequest<AiAuditPage>('/api/audit', {
    method: 'GET',
    params: {
      actor: params?.actor,
      command: params?.command,
      limit: params?.limit,
    },
  });
}

/**
 * 读待确认列表（缺省只看 `PENDING` —— 还等人点头的那些）。
 *
 * ⚠️ 服务端当前**没有任何命令会进待确认**（唯一的 `create_task` 是非破坏性的）
 * ⇒ 这个列表现在是空的，但端点是**真的读表**的。
 */
/**
 * 列出当前可用的技能（服务端 `GET /api/agent/skills`）。
 *
 * ⚠️ 读的是**真文件** ⇒ 改完 SKILL.md 重启服务就能看到新说明。
 */
export async function listAiSkills(): Promise<AiSkillSummary[]> {
  return aiRequest<AiSkillSummary[]>('/api/agent/skills', { method: 'GET' });
}

export async function listAiPending(status?: string): Promise<AiPendingRow[]> {
  return aiRequest<AiPendingRow[]>('/api/pending', {
    method: 'GET',
    params: { status },
  });
}
